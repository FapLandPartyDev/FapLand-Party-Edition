import { DEFAULT_APP_LOCALE, type AppLocale } from "../constants/localeSettings";
import { useContext } from "react";
import { I18nContext } from "./I18nProvider";
import { SUPPORTED_LOCALES } from "./config";
import { getSfwRulesForLocale } from "./sfwRules";

const FALLBACK_LOCALE_VALUE = {
  locale: DEFAULT_APP_LOCALE as AppLocale,
  setLocale: async () => {},
  sfwRules: getSfwRulesForLocale(DEFAULT_APP_LOCALE),
  locales: SUPPORTED_LOCALES.map(({ code, label }) => ({ code, label })),
};

export function useLocale() {
  return useContext(I18nContext) ?? FALLBACK_LOCALE_VALUE;
}
