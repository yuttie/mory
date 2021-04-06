import axios from 'axios';

export function getAxios() {
  const customAxios = axios.create({
    baseURL: process.env.VUE_APP_API_URL,
  });
  const token = localStorage.getItem('token');
  customAxios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  return customAxios;
}
