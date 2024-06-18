import { Ref, ref, watch } from 'vue';

export function useLocalStorage<T>(key: string, initialValue: T): Ref<T> {
  const storedJson = localStorage.getItem(key);
  const value = ref(storedJson !== null ? JSON.parse(storedJson) : initialValue);
  if (storedJson === null) {
    localStorage.setItem(key, JSON.stringify(initialValue));
  }

  watch(value, (newValue) => {
    localStorage.setItem(key, JSON.stringify(newValue));
  }, {
    deep: true,
  });

  return value;
}
