// Utilities
import { ref, computed, watch } from 'vue';
import type { Ref } from 'vue';
import { defineStore } from 'pinia';

import { useLocalStorage } from '@/composables/localStorage';
import { useFilesStore } from '@/stores/files';

import * as api from '@/api';

export const useAppStore = defineStore('app', () => {
    // States
    const token = useLocalStorage<string | null>('token', null);
    const loginCallbacks: Ref<(() => void)[]> = ref([]);
    const isLoggingIn = ref(false);
    const loginError: Ref<null | string> = ref(null);
    const serviceWorker: Ref<null | ServiceWorker> = ref(null);
    const serviceWorkerConfigured = ref(false);
    const draggingViewerContent = ref(false);
    // How many mounted views are showing their own controls in the app bar, through <AppBarContent>.
    // While any is, the app bar leaves out its generic title.
    const appBarClaims = ref(0);

    // Getters
    const hasToken = computed(() => !!token.value);

    // Actions
    function invalidateToken(callback: () => void) {
        loginCallbacks.value.push(callback);

        // Delete the token and let a user to login again
        logout();
    }

    function login(username: string, password: string) {
        isLoggingIn.value = true;

        api.login(
            username,
            password,
        ).then(res => {
            token.value = res.data;

            isLoggingIn.value = false;
            loginError.value = null;

            if (serviceWorker.value) {  // FIXME This should be executed after service worker get ready
                serviceWorker.value.postMessage({
                    type: 'update-api-token',
                    value: token.value,
                });
            }
        }).catch(_error => {
            isLoggingIn.value = false;
            loginError.value = "Incorrect username or password";
        });
    }

    function logout() {
        // Delete the current token
        token.value = null;

        // The cached listing describes a private repository, so it must not outlive the
        // session that fetched it.
        useFilesStore().clear();

        // Let service worker know it
        if (serviceWorker.value) {  // FIXME This should be executed after service worker get ready
            serviceWorker.value.postMessage({
                type: 'update-api-token',
                value: token.value,
            });
        }
    }

    // Watchers
    // Retries what failed for want of a token once the page has one again, from a login here or
    // in another tab. After the flush, so that `useLocalStorage` has stored the token that
    // `getAxios()` reads.
    watch(token, (newToken, oldToken) => {
        if (oldToken === null && newToken !== null) {
            for (const callback of loginCallbacks.value.splice(0)) {
                callback();
            }
        }
    }, { flush: 'post' });

    // Service worker
    if ('serviceWorker' in navigator) {
        const apiUrl = new URL(import.meta.env.VITE_APP_API_URL!, window.location.href).href;

        // The API URL goes in the script's URL, where every copy of the worker the browser starts
        // can read it; see `filesUrl` in the worker.
        const scriptUrl = `${import.meta.env.BASE_URL}service-worker.js?${new URLSearchParams({ api: apiUrl })}`;
        navigator.serviceWorker.register(scriptUrl).then(() => {
            console.log('Service worker registration succeeded.');
        }).catch((error) => {
            console.error(`Service worker registration failed: ${error}`);
        });

        // Also records the worker as the one to tell when the token changes.
        function configure(worker: ServiceWorker) {
            serviceWorker.value = worker;
            worker.postMessage({
                type: 'configure',
                value: {
                    apiUrl: apiUrl,
                    apiToken: token.value,
                    appRoot: import.meta.env.VITE_APP_APPLICATION_ROOT,
                },
            });
        }

        navigator.serviceWorker.ready
            .then((registration) => {
                console.log(`A service worker is active: ${registration.active}`);
                configure(registration.active!);
            });

        // A new version of the worker takes over the page as soon as it is installed, which can be
        // while the page is still waiting for the old one to answer `configure`. The old one is
        // then discarded without answering, and the page, which shows nothing until it hears back,
        // would stay blank.
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (navigator.serviceWorker.controller !== null) {
                configure(navigator.serviceWorker.controller);
            }
        });

        navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data === 'configured') {
                serviceWorkerConfigured.value = true;
            }
            else if (event.data === 'request-api-token') {
                // The worker asks with each file it loads; see `requestToken` there for why.
                event.ports[0].postMessage(token.value);
            }
        });
    } else {
        console.error('Service workers are not supported.');
    }

    return {
        // States
        token,
        loginCallbacks,
        isLoggingIn,
        loginError,
        serviceWorker,
        serviceWorkerConfigured,
        draggingViewerContent,
        appBarClaims,
        // Getters
        hasToken,
        // Actions
        invalidateToken,
        login,
        logout,
    };
});
