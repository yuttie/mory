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
                        const parsed = readTaskSettings(YAML.parse(await files.read(TASK_SETTINGS_PATH)));
                        settings.value = parsed.settings;
                        problems.value = parsed.problems;
                    }
                    catch (error) {
                        settings.value = {};
                        problems.value = axios.isAxiosError(error) && error.response?.status === 404 ? [] : [String(error)];
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
    return { settings, problems, load };
});
