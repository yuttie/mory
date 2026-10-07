import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import axios from 'axios';
import YAML from 'yaml';
import { readTaskSettings, type TaskSettings } from '@/urgency';
import { readStatusColors, resolveStatusColors, writeStatusColors, type StatusColors } from '@/status-color';
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
    /// Set the colours the statuses are drawn in, changing only the `status_colors:` lines of the
    /// file. A status left out takes its default.
    async function saveStatusColors(next: StatusColors): Promise<void> {
        let source = '';
        try {
            source = await files.read(TASK_SETTINGS_PATH);
        }
        catch (error) {
            if (!isMissing(error)) {
                throw error;
            }
        }
        const edited = writeStatusColors(source, next);
        if (edited !== source) {
            await files.write(TASK_SETTINGS_PATH, edited);
        }
        statusColors.value = next;
    }
    return { settings, statusColors, resolvedStatusColors, problems, load, saveStatusColors };
});

function isMissing(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 404;
}
