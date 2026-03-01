import { i18n, type Messages } from "@lingui/core";
import { DEFAULT_APP_LOCALE, type AppLocale } from "../constants/localeSettings";
import { messages as defaultMessages } from "../locales/en/messages.mjs";
import { getSfwRulesForLocale, type SfwRuleSet } from "./sfwRules";

export type SupportedLocale = {
  code: AppLocale;
  label: string;
  loadCatalog: () => Promise<{ messages: Messages }>;
  sfwRules: SfwRuleSet;
};

// Use Lingui's shared singleton so macro-expanded translations and the React
// provider both talk to the same active locale state.
i18n.loadAndActivate({
  locale: DEFAULT_APP_LOCALE,
  messages: defaultMessages,
});

export { i18n };

export const SUPPORTED_LOCALES: SupportedLocale[] = [
  {
    code: "en",
    label: "English",
    loadCatalog: () => import("../locales/en/messages.mjs"),
    sfwRules: getSfwRulesForLocale("en"),
  },
  {
    code: "de",
    label: "Deutsch",
    loadCatalog: () => import("../locales/de/messages.mjs"),
    sfwRules: getSfwRulesForLocale("de"),
  },
  {
    code: "es",
    label: "Español",
    loadCatalog: () => import("../locales/es/messages.mjs"),
    sfwRules: getSfwRulesForLocale("es"),
  },
  {
    code: "fr",
    label: "Français",
    loadCatalog: () => import("../locales/fr/messages.mjs"),
    sfwRules: getSfwRulesForLocale("fr"),
  },
  {
    code: "zh",
    label: "中文",
    loadCatalog: () => import("../locales/zh/messages.mjs"),
    sfwRules: getSfwRulesForLocale("zh"),
  },
];

export function getSupportedLocale(code: string): SupportedLocale | undefined {
  return SUPPORTED_LOCALES.find((locale) => locale.code === code);
}
