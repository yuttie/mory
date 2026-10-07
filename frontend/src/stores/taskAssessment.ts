import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import axios from 'axios';

import { useFilesStore } from '@/stores/files';
import { DEFAULT_TASK_ASSESSMENT_PROMPT, TASK_ASSESSMENT_PROMPT_PATH, readTaskAssessmentPrompt } from '@/task-assessment';

export const useTaskAssessmentStore = defineStore('task-assessment', () => {
    const files = useFilesStore();
    // As the file holds it, or `null` when there is none and the default applies.
    const custom = ref<string | null>(null);
    const prompt = computed(() => custom.value ?? DEFAULT_TASK_ASSESSMENT_PROMPT);
    // The version of the file `custom` was read from, `absent` for none: named to the server so an
    // unchanged file is not fetched again.
    const version = ref('absent');
    const error = ref('');
    // Until a read succeeds, `prompt` is only the default standing in for whatever the file says.
    let hasRead = false;
    // The commit the last read was of, and whether it failed: either way, a later read may differ.
    let readOf: string | null | undefined;
    let failed = false;
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
                        const file = await files.readVersion(
                            TASK_ASSESSMENT_PROMPT_PATH,
                            version.value === 'absent' ? undefined : version.value,
                        );
                        // `null` is the version already held, unchanged by this commit.
                        if (file.content !== null) {
                            custom.value = readTaskAssessmentPrompt(file.content);
                            version.value = file.etag;
                        }
                        hasRead = true;
                        failed = false;
                        error.value = '';
                    }
                    catch (err) {
                        if (isMissing(err)) {
                            custom.value = null;
                            version.value = 'absent';
                            hasRead = true;
                            failed = false;
                            error.value = '';
                        }
                        else {
                            // What was read before still stands: assessing with the default would
                            // quietly answer a different question.
                            failed = true;
                            error.value = String(err);
                        }
                    }
                    readOf = commit;
                }
            }
            finally {
                loading = null;
            }
        });
        return loading;
    }
    /// Settled once the prompt of the latest commit is read. A read that failed is tried again, and
    /// a commit not yet read is read now, rather than when its watcher gets round to it.
    function ready(): Promise<void> {
        if (!loading && (failed || readOf !== files.commitId)) {
            return load();
        }
        return loading ?? Promise.resolve();
    }
    /// The prompt to assess with, once the latest commit's is read. Refused while no read has
    /// succeeded, since the default would quietly answer a different question than the user's own.
    async function current(): Promise<string> {
        await ready();
        if (!hasRead) {
            throw new Error(`${TASK_ASSESSMENT_PROMPT_PATH} could not be read: ${error.value}`);
        }
        return prompt.value;
    }
    watch(() => files.commitId, () => {
        void load();
    }, { immediate: true });
    return { custom, prompt, version, error, load, ready, current };
});

function isMissing(error: unknown): boolean {
    return axios.isAxiosError(error) && error.response?.status === 404;
}
