import {
  DEFAULT_APP_LOCALE,
  normalizeAppLocale,
  type AppLocale,
} from "../constants/localeSettings";
import { getSupportedLocale } from "./config";

export function detectInitialLocale(): AppLocale {
  if (typeof window === "undefined") return DEFAULT_APP_LOCALE;

  const preferredLocales = [
    ...(Array.isArray(window.navigator.languages) ? window.navigator.languages : []),
    window.navigator.language,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const locale of preferredLocales) {
    const normalized = locale.toLowerCase();
    const base = normalized.split("-")[0];
    if (getSupportedLocale(normalized)) {
      return normalizeAppLocale(normalized);
    }
    if (base && getSupportedLocale(base)) {
      return normalizeAppLocale(base);
    }
  }

  return DEFAULT_APP_LOCALE;
}
