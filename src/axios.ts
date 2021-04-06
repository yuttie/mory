import axios from 'axios';

const customAxios = axios.create({
  baseURL: process.env.VUE_APP_API_URL,
});

export function getAxios() {
  const token = localStorage.getItem('token');
  if (token === null) {
    delete axios.defaults.headers.common['Authorization'];
  }
  else {
    customAxios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }
  return customAxios;
}
