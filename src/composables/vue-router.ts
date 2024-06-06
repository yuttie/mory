import { getCurrentInstance } from 'vue';

export function useRouter() {
  const vm = getCurrentInstance();
  return vm?.proxy.$router;
}

export function useRoute() {
  const vm = getCurrentInstance();
  return vm?.proxy.$route;
}
