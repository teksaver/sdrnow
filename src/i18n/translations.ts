import translationsData from './translations.json';

export const languages = {
  fr: 'Français',
  en: 'English',
};

export const defaultLang = 'fr';

export const schema = translationsData.schema;

export const ui = {
  fr: translationsData.fr,
  en: translationsData.en,
};

export type TranslationKey = keyof typeof translationsData.fr;

export function useTranslations(lang: 'fr' | 'en' | string) {
  const selectedLang = lang === 'en' ? 'en' : 'fr';
  const dict = ui[selectedLang];
  const fallback = ui[defaultLang];

  return function t(key: string): string {
    return (dict as Record<string, string>)[key] ?? (fallback as Record<string, string>)[key] ?? '';
  };
}
