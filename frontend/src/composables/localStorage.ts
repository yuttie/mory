import { ref, watch } from 'vue';
import type { Ref } from 'vue';

/**
 * Serializer interface for custom data transformation
 */
export interface Serializer<T> {
    read: (value: string) => T;
    write: (value: T) => string;
}

/**
 * Options for the useLocalStorage composable
 */
export interface UseLocalStorageOptions<T> {
    /**
     * Custom serializer for data transformation
     */
    serializer?: Serializer<T>;
    /**
     * Function to call when localStorage operations fail
     */
    onError?: (error: Error) => void;
    /**
     * Whether to sync changes immediately (default: true)
     */
    syncDefaults?: boolean;
}

/**
 * Default JSON serializer
 */
const defaultSerializer: Serializer<any> = {
    read: (value: string) => JSON.parse(value),
    write: (value: any) => JSON.stringify(value),
};

/**
 * Check if localStorage is available
 */
function isLocalStorageAvailable(): boolean {
    try {
        if (typeof window === 'undefined' || !window.localStorage) {
            return false;
        }
        // Test if we can actually use localStorage
        const testKey = '__localStorage_test__';
        localStorage.setItem(testKey, 'test');
        localStorage.removeItem(testKey);
        return true;
    } catch {
        return false;
    }
}

/**
 * Reactive localStorage composable with enhanced error handling and customization
 * 
 * @param key - The localStorage key
 * @param initialValue - The initial value to use if no stored value exists
 * @param options - Configuration options
 * @returns A reactive ref that syncs with localStorage
 */
export function useLocalStorage<T>(
    key: string, 
    initialValue: T, 
    options: UseLocalStorageOptions<T> = {}
): Ref<T> {
    const {
        serializer = defaultSerializer,
        onError = (error) => console.warn(`localStorage error for key "${key}":`, error),
        syncDefaults = true,
    } = options;

    // Check if localStorage is available
    if (!isLocalStorageAvailable()) {
        onError(new Error('localStorage is not available'));
        return ref(initialValue) as Ref<T>;
    }

    // Initialize the ref with stored value or initial value
    const value = ref(initialValue) as Ref<T>;

    try {
        const storedValue = localStorage.getItem(key);
        if (storedValue !== null) {
            value.value = serializer.read(storedValue);
        } else if (syncDefaults) {
            // Store the initial value if it doesn't exist
            localStorage.setItem(key, serializer.write(initialValue));
        }
    } catch (error) {
        onError(error as Error);
    }

    // Watch for changes and sync to localStorage
    watch(value, (newValue) => {
        try {
            if (isLocalStorageAvailable()) {
                localStorage.setItem(key, serializer.write(newValue));
            }
        } catch (error) {
            onError(error as Error);
        }
    }, {
        deep: true,
    });

    return value;
}

/**
 * Utility function to read a value from localStorage without reactivity
 * 
 * @param key - The localStorage key
 * @param defaultValue - The default value if key doesn't exist or parsing fails
 * @param serializer - Custom serializer (defaults to JSON)
 * @returns The parsed value or default value
 */
export function getLocalStorageItem<T>(
    key: string, 
    defaultValue: T, 
    serializer: Serializer<T> = defaultSerializer
): T {
    if (!isLocalStorageAvailable()) {
        return defaultValue;
    }

    try {
        const value = localStorage.getItem(key);
        return value !== null ? serializer.read(value) : defaultValue;
    } catch {
        return defaultValue;
    }
}

/**
 * Utility function to write a value to localStorage without reactivity
 * 
 * @param key - The localStorage key
 * @param value - The value to store
 * @param serializer - Custom serializer (defaults to JSON)
 * @returns Whether the operation was successful
 */
export function setLocalStorageItem<T>(
    key: string, 
    value: T, 
    serializer: Serializer<T> = defaultSerializer
): boolean {
    if (!isLocalStorageAvailable()) {
        return false;
    }

    try {
        localStorage.setItem(key, serializer.write(value));
        return true;
    } catch {
        return false;
    }
}

/**
 * Utility function to remove an item from localStorage
 * 
 * @param key - The localStorage key to remove
 * @returns Whether the operation was successful
 */
export function removeLocalStorageItem(key: string): boolean {
    if (!isLocalStorageAvailable()) {
        return false;
    }

    try {
        localStorage.removeItem(key);
        return true;
    } catch {
        return false;
    }
}
