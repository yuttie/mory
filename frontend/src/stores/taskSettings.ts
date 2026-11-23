import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import axios from 'axios';
import YAML from 'yaml';
import { readTaskSettings, type TaskSettings } from '@/urgency';
import { readStatusColors, resolveStatusColors, writeStatusColors, type StatusColorEdits, type StatusColors } from '@/status-color';
import { useFilesStore } from '@/stores/files';
import { keepEqual } from '@/keep';

export const TASK_SETTINGS_PATH = '.mory/tasks.yaml';
export const useTaskSettingsStore = defineStore('task-settings', () => {
    const files = useFilesStore();
    const settings = ref<TaskSettings>({});
    // As the file writes them; `resolvedStatusColors` is what to draw.
    const statusColors = ref<StatusColors>({});
    const resolvedStatusColors = computed(() => resolveStatusColors(statusColors.value));
    const problems = ref<string[]>([]);
    // The commit the last read began at, or `null` when it reached no file to read, failing for
    // moried or the network rather than for what the file holds: what needs the settings as of a
    // commit, as the health checks do, tells by it whether `problems` are the file's then.
    const readAt = ref<string | null>(null);
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
                    const commit = files.commitId;
                    try {
                        const source = await files.read(TASK_SETTINGS_PATH);
                        const value = YAML.parse(source);
                        const parsed = readTaskSettings(value);
                        const colors = readStatusColors(value);
                        // Each task's urgency is worked out from `settings`, so the same settings
                        // read again must not stand in for them.
                        keepEqual(settings, parsed.settings);
                        keepEqual(statusColors, colors.colors);
                        keepEqual(problems, [...parsed.problems, ...(parsed.settings.lead_time_by_tag === undefined ? [] : untextTagKeys(source)), ...colors.problems]);
                        readAt.value = commit;
                    }
                    catch (error) {
                        keepEqual(settings, {});
                        keepEqual(statusColors, {});
                        keepEqual(problems, isMissing(error) ? [] : [String(error)]);
                        readAt.value = axios.isAxiosError(error) && !isMissing(error) ? null : commit;
                    }
                }
            }
            finally {
                loading = null;
            }
        });
        return loading;
    }
    /// Reads the file unless the last read began at `commit` and reached it, once a read under way
    /// has ended: what needs the settings as of a commit, as the health checks do, nearly always
    /// finds them read by the reload at each commit below.
    async function loadAt(commit: string): Promise<void> {
        await loading;
        if (readAt.value !== commit) {
            await load();
        }
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
    return { settings, statusColors, resolvedStatusColors, problems, readAt, load, loadAt, saveStatusColors };
});

/// A problem for each key of `lead_time_by_tag` that YAML reads as something other than text, such
/// as `2024:` or `true:`. The web app matches it by its spelling, as JavaScript makes every key a
/// string, but `read_settings` in moried takes only a key that is text, so `list_tasks` would
/// work out another urgency for the tasks it tags.
export function untextTagKeys(source: string): string[] {
    const tags = YAML.parseDocument(source).get('lead_time_by_tag', true);
    if (!YAML.isMap(tags)) {
        return [];
    }
    return tags.items
        .filter(({ key }) => !(YAML.isScalar(key) && typeof key.value === 'string'))
        .map(({ key }) => {
            const spelling = String(key);
            return `Tag ${spelling} in lead_time_by_tag is not text, so moried's list_tasks ignores its lead time; quote it, as "${spelling}".`;
        });
}

function isMissing(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 404;
}
