// Type definitions for i18n
export interface LocaleOption {
  code: string;
  name: string;
}

export interface I18nComposable {
  t: (key: string, ...args: any[]) => string;
  locale: string;
  setLocale: (locale: string) => void;
  availableLocales: LocaleOption[];
}

declare module '@vue/runtime-core' {
  interface ComponentCustomProperties {
    $t: (key: string, ...args: any[]) => string;
  }
}