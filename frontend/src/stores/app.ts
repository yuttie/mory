// Utilities
import { ref, computed } from 'vue';
import type { Ref } from 'vue';
import { defineStore } from 'pinia'

import { useLocalStorage } from '@/composables/localStorage';

import * as api from '@/api';

export const useAppStore = defineStore('app', () => {
  // States
  const accessToken = useLocalStorage<string | null>('access_token', null);
  const refreshToken = useLocalStorage<string | null>('refresh_token', null);
  const tokenExpiresAt = useLocalStorage<number | null>('token_expires_at', null);
  const loginCallbacks: Ref<(() => void)[]> = ref([]);
  const isLoggingIn = ref(false);
  const loginError: Ref<null | string> = ref(null);
  const serviceWorker: Ref<null | ServiceWorker> = ref(null);
  const serviceWorkerConfigured = ref(false);
  const serviceWorkerHasToken = ref(false);
  const draggingViewerContent = ref(false);

  // Getters
  const hasToken = computed(() => !!accessToken.value);
  
  // Legacy getter for backward compatibility
  const token = computed(() => accessToken.value);

  // Actions
  function invalidateToken(callback: () => void) {
    loginCallbacks.value.push(callback);

    // Delete the tokens and let a user to login again
    logout();
  }

  async function refreshAccessToken(): Promise<boolean> {
    if (!refreshToken.value) {
      return false;
    }

    try {
      const res = await api.refreshToken(refreshToken.value);
      const refreshResponse: api.RefreshResponse = res.data;
      
      accessToken.value = refreshResponse.access_token;
      tokenExpiresAt.value = Date.now() + (refreshResponse.expires_in * 1000);
      
      if (serviceWorker.value) {
        serviceWorker.value.postMessage({
          type: 'update-api-token',
          value: accessToken.value,
        });
      }
      
      return true;
    } catch (error) {
      console.error('Token refresh failed:', error);
      logout();
      return false;
    }
  }

  function isTokenExpiringSoon(): boolean {
    if (!tokenExpiresAt.value) return false;
    // Check if token expires in next 5 minutes
    return (tokenExpiresAt.value - Date.now()) < 5 * 60 * 1000;
  }

  async function ensureValidToken(): Promise<boolean> {
    if (!accessToken.value) {
      return false;
    }
    
    if (isTokenExpiringSoon()) {
      return await refreshAccessToken();
    }
    
    return true;
  }

  function login(username: string, password: string) {
    isLoggingIn.value = true;

    api.login(
      username,
      password,
    ).then(res => {
      const loginResponse: api.LoginResponse = res.data;
      
      accessToken.value = loginResponse.access_token;
      refreshToken.value = loginResponse.refresh_token;
      tokenExpiresAt.value = Date.now() + (loginResponse.expires_in * 1000);

      isLoggingIn.value = false;
      loginError.value = null;

      if (serviceWorker.value) {  // FIXME This should be executed after service worker get ready
        serviceWorker.value.postMessage({
          type: 'update-api-token',
          value: accessToken.value,
        });
      }
    }).catch(_error => {
      isLoggingIn.value = false;
      loginError.value = "Incorrect username or password";
    });
  }

  function logout() {
    // Delete the current tokens
    accessToken.value = null;
    refreshToken.value = null;
    tokenExpiresAt.value = null;

    // Let service worker know it
    if (serviceWorker.value) {  // FIXME This should be executed after service worker get ready
      serviceWorker.value.postMessage({
        type: 'update-api-token',
        value: null,
      });
    }
  }

  // Service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}service-worker.js`).then((registration) => {
      console.log('Service worker registration succeeded.');
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
            apiToken: accessToken.value,
            appRoot: import.meta.env.VITE_APP_APPLICATION_ROOT,
          },
        });
      });

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data === 'configured') {
        serviceWorkerConfigured.value = true;
        serviceWorkerHasToken.value = accessToken.value !== null;
      }
      else if (event.data === 'api-token-updated') {
        serviceWorkerHasToken.value = accessToken.value !== null;

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
    accessToken,
    refreshToken,
    tokenExpiresAt,
    loginCallbacks,
    isLoggingIn,
    loginError,
    serviceWorker,
    serviceWorkerConfigured,
    serviceWorkerHasToken,
    draggingViewerContent,
    // Getters
    hasToken,
    token, // Legacy compatibility
    // Actions
    invalidateToken,
    refreshAccessToken,
    ensureValidToken,
    login,
    logout,
  };
});
