import { getCurrentInstance } from 'vue';

export function useVuetify() {
  const vm = getCurrentInstance();
  return vm?.proxy.$vuetify;
}
