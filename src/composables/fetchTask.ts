import { ref, watch, onMounted } from 'vue';
import type { Ref } from 'vue';

import { type Task, getTask } from '@/api/task';

export function useFetchTask(taskPath: Ref<string>) {
    const task = ref<Task | undefined | null>(null);
    const loading = ref(false);
    const error = ref<unknown>(null);

    let current = 0;  // Prevents race conditions

    const load = async () => {
        const req = ++current;
        task.value = null;
        loading.value = true;
        error.value = null;

        try {
            const [_etag, data] = await getTask(taskPath.value);
            if (req === current) {
                task.value = data;
            }
        }
        catch (e) {
            if (req === current) {
                if (e?.response?.status === 404) {
                    task.value = undefined;
                }
                else {
                    error.value = e;
                }
            }
        }
        finally {
            if (req === current) {
                loading.value = false;
            }
        }
    };

    onMounted(load);
    watch(taskPath, load, { immediate: true });

    const refresh = () => load();

    return { task, loading, error, refresh };
}
