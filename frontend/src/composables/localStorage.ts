import { ref, watch, onMounted, onUnmounted } from 'vue';
import type { Ref } from 'vue';

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

  // Listen for storage events to react to external localStorage changes
  function handleStorageChange(e: StorageEvent) {
    if (e.key === key && e.newValue !== null) {
      try {
        const newValue = JSON.parse(e.newValue);
        value.value = newValue;
      } catch (error) {
        console.warn(`Failed to parse localStorage value for key "${key}":`, error);
      }
    }
  }

  // Add event listener when component is mounted
  onMounted(() => {
    window.addEventListener('storage', handleStorageChange);
  });

  // Cleanup event listener when component is unmounted
  onUnmounted(() => {
    window.removeEventListener('storage', handleStorageChange);
  });

  return value;
}
