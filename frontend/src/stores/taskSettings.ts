import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import axios from 'axios';
import YAML from 'yaml';
import { readTaskSettings, type TaskSettings } from '@/urgency';
import { useFilesStore } from '@/stores/files';

export const TASK_SETTINGS_PATH = '.mory/tasks.yaml';
export const useTaskSettingsStore = defineStore('task-settings', () => {
    const files = useFilesStore();
    const settings = ref<TaskSettings>({});
    const problems = ref<string[]>([]);
    let loading: Promise<void> | null = null;
    async function load(): Promise<void> {
        if (loading) {
            return loading;
        }
        loading = (async () => {
            try {
                const parsed = readTaskSettings(YAML.parse(await files.read(TASK_SETTINGS_PATH)));
                settings.value = parsed.settings;
                problems.value = parsed.problems;
            }
            catch (error) {
                settings.value = {};
                problems.value = axios.isAxiosError(error) && error.response?.status === 404 ? [] : [String(error)];
            }
        })();
        try {
            await loading;
        }
        finally {
            loading = null;
        }
    }
    watch(() => files.entries.find((entry) => entry.path === TASK_SETTINGS_PATH)?.time, () => {
        void load();
    }, { immediate: true });
    return { settings, problems, load };
});
