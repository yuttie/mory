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
