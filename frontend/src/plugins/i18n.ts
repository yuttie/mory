import Vue from 'vue';
import VueI18n from 'vue-i18n';
import en from '@/locales/en.json';
import ja from '@/locales/ja.json';
import { loadConfigValue, saveConfigValue } from '@/config';

Vue.use(VueI18n);

const messages = {
  en,
  ja,
};

// Get the saved locale or fall back to browser language, then to 'en'
const savedLocale = loadConfigValue('locale', null);
const browserLocale = navigator.language.split('-')[0];
const defaultLocale = savedLocale || (messages[browserLocale as keyof typeof messages] ? browserLocale : 'en');

export const i18n = new VueI18n({
  locale: defaultLocale,
  fallbackLocale: 'en',
  messages,
});

// Function to change language and save it
export function setLocale(locale: string) {
  i18n.locale = locale;
  saveConfigValue('locale', locale);
  
  // Update HTML lang attribute
  document.documentElement.setAttribute('lang', locale);
}

// Available locales
export const availableLocales = [
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
];

// Helper function for use in Composition API or outside components
export function useI18n() {
  return {
    t: i18n.t.bind(i18n),
    locale: i18n.locale,
    setLocale,
    availableLocales,
  };
}

// Set initial HTML lang attribute
document.documentElement.setAttribute('lang', defaultLocale);