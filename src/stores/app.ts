// Utilities
import { Ref, ref, computed, watch, onMounted, onUnmounted, nextTick, defineProps, defineEmits, defineExpose } from 'vue';
import { defineStore } from 'pinia'

import { useLocalStorage } from '@/composables/localStorage';

import * as api from '@/api';

export const useAppStore = defineStore('app', () => {
  // States
  const token = useLocalStorage<string | null>('token', null);
  const loginCallbacks: Ref<(() => void)[]> = ref([]);
  const isLoggingIn = ref(false);
  const loginError: Ref<null | string> = ref(null);
  const serviceWorker: Ref<null | ServiceWorker> = ref(null);
  const serviceWorkerConfigured = ref(false);
  const serviceWorkerHasToken = ref(false);

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
    }).catch(error => {
      isLoggingIn.value = false;
      loginError.value = "Incorrect username or password";
    });
  }

  function logout() {
    // Delete the current token
    token.value = null;

    // Let service worker know it
    if (serviceWorker.value) {  // FIXME This should be executed after service worker get ready
      serviceWorker.value.postMessage({
        type: 'update-api-token',
        value: token.value,
      });
    }
  }

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`).then((registration) => {
      console.log('Service worker registration succeeded:', registration);
    }).catch((error) => {
      console.error(`Service worker registration failed: ${error}`);
    });

    navigator.serviceWorker.ready
      .then((registration) => {
        console.log(`A service worker is active: ${registration.active}`);
        serviceWorker.value = registration.active!;
        serviceWorker.value.postMessage({
          type: 'configure',
          value: {
            apiUrl: new URL(import.meta.env.VITE_APP_API_URL!, window.location.href).href,
            apiToken: token.value,
          },
        });
      });

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data === 'configured') {
        serviceWorkerConfigured.value = true;
        serviceWorkerHasToken.value = token.value !== null;
      }
      else if (event.data === 'api-token-updated') {
        serviceWorkerHasToken.value = token.value !== null;

        if (serviceWorkerHasToken.value) {
          for (const callback of loginCallbacks.value) {
            callback();
          }
          loginCallbacks.value.length = 0;
        }
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
    serviceWorkerHasToken,
    // Getters
    hasToken,
    // Actions
    invalidateToken,
    login,
    logout,
  };
});
