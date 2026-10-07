import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import axios from 'axios';
import YAML from 'yaml';
import { readTaskSettings, type TaskSettings } from '@/urgency';
import { readStatusColors, resolveStatusColors, writeStatusColors, type StatusColorEdits, type StatusColors } from '@/status-color';
import { useFilesStore } from '@/stores/files';

export const TASK_SETTINGS_PATH = '.mory/tasks.yaml';
export const useTaskSettingsStore = defineStore('task-settings', () => {
    const files = useFilesStore();
    const settings = ref<TaskSettings>({});
    // As the file writes them; `resolvedStatusColors` is what to draw.
    const statusColors = ref<StatusColors>({});
    const resolvedStatusColors = computed(() => resolveStatusColors(statusColors.value));
    const problems = ref<string[]>([]);
    let loading: Promise<void> | null = null;
    let requested = false;
    function load(): Promise<void> {
        requested = true;
        if (loading) {
            return loading;
        }
        loading = Promise.resolve().then(async () => {
            try {
                // A commit arriving during a read still needs a read of its newer contents.
                while (requested) {
                    requested = false;
                    try {
                        const value = YAML.parse(await files.read(TASK_SETTINGS_PATH));
                        const parsed = readTaskSettings(value);
                        const colors = readStatusColors(value);
                        settings.value = parsed.settings;
                        statusColors.value = colors.colors;
                        problems.value = [...parsed.problems, ...colors.problems];
                    }
                    catch (error) {
                        settings.value = {};
                        statusColors.value = {};
                        problems.value = isMissing(error) ? [] : [String(error)];
                    }
                }
            }
            finally {
                loading = null;
            }
        });
        return loading;
    }
    // Git timestamps have second precision and cannot identify a settings version.
    watch(() => files.commitId, () => {
        void load();
    }, { immediate: true });
    /// Make `edits` to the colours the statuses are drawn in, changing only their lines of the file.
    ///
    /// Made to the file as it is now, not as it was last read, so a colour set meanwhile -- by hand,
    /// through MCP, on another machine -- survives; and the write is refused if the file changes
    /// again before it lands, rather than putting back what that change replaced.
    async function saveStatusColors(edits: StatusColorEdits): Promise<void> {
        let source = '';
        let etag = 'absent';
        try {
            const version = await files.readVersion(TASK_SETTINGS_PATH);
            if (typeof version.content !== 'string') {
                throw new Error(`${TASK_SETTINGS_PATH} could not be read as text.`);
            }
            source = version.content;
            etag = version.etag;
        }
        catch (error) {
            if (!isMissing(error)) {
                throw error;
            }
        }
        const edited = writeStatusColors(source, edits);
        if (edited !== source) {
            try {
                await files.writeChecked(TASK_SETTINGS_PATH, edited, etag);
            }
            catch (error) {
                if (axios.isAxiosError(error) && error.response?.status === 412) {
                    void load();
                    throw new Error(`${TASK_SETTINGS_PATH} changed while saving. It has been read again; save once more.`, { cause: error });
                }
                throw error;
            }
        }
        statusColors.value = readStatusColors(YAML.parse(edited)).colors;
    }
    return { settings, statusColors, resolvedStatusColors, problems, load, saveStatusColors };
});

function isMissing(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 404;
}
