import axios from 'axios';
import type { AxiosResponse, AxiosError } from 'axios';
import type { RefreshResponse } from '@/api';

const customAxios = axios.create({
  baseURL: import.meta.env.VITE_APP_API_URL,
});

let isRefreshing = false;
let failedQueue: Array<{ resolve: (token: string) => void; reject: (error: any) => void }> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
    }
  });
  
  failedQueue = [];
};

const refreshAccessToken = async (): Promise<string> => {
  const refreshToken = JSON.parse(localStorage.getItem('refresh_token') || 'null');
  
  if (!refreshToken) {
    throw new Error('No refresh token available');
  }

  const response: AxiosResponse<RefreshResponse> = await axios.post(
    `${import.meta.env.VITE_APP_API_URL}/refresh`,
    { refresh_token: refreshToken }
  );

  const { access_token, expires_in } = response.data;
  
  // Update localStorage
  localStorage.setItem('access_token', JSON.stringify(access_token));
  localStorage.setItem('token_expires_at', JSON.stringify(Date.now() + (expires_in * 1000)));
  
  return access_token;
};

// Response interceptor for automatic token refresh
customAxios.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as any;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          return customAxios(originalRequest);
        }).catch(err => {
          return Promise.reject(err);
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const newToken = await refreshAccessToken();
        processQueue(null, newToken);
        
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return customAxios(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        
        // Clear tokens and redirect to login
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('token_expires_at');
        
        // Force a page refresh to show login screen
        window.location.reload();
        
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

export function getAxios() {
  const accessToken = JSON.parse(localStorage.getItem('access_token') || 'null');
  if (accessToken === null) {
    delete customAxios.defaults.headers.common['Authorization'];
  }
  else {
    customAxios.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
  }
  return customAxios;
}
