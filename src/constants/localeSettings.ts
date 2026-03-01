export const APP_LOCALE_KEY = "app.locale";
export const APP_LOCALE_EVENT = "fland:app-locale";
export const DEFAULT_APP_LOCALE = "en";

export type AppLocale = "en" | "de" | "es" | "fr" | "zh";

export function normalizeAppLocale(value: unknown): AppLocale {
  return value === "en" || value === "de" || value === "es" || value === "fr" || value === "zh"
    ? value
    : DEFAULT_APP_LOCALE;
}
