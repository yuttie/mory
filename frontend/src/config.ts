// Defaults live here, next to the loader, because every setting is otherwise duplicated between
// Config.vue and its consumer -- which has already drifted once: `editor-font-size` defaults to 10
// in one place and 14 in the other.

// How many rows the note tree shows before "Show older" is pressed, and how many each press adds.
export const NOTE_TREE_INITIAL_ROWS = 10;
export const NOTE_TREE_ROW_INCREMENT = 10;

export function loadConfigValue(key: string, default_: any): any {
  const value = localStorage.getItem(key);
  if (value === null) {
    return default_;
  }
  else {
    return JSON.parse(value);
  }
}

export function saveConfigValue(key: string, value: any) {
  localStorage.setItem(key, JSON.stringify(value));
}
