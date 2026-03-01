import { I18nProvider as LinguiProvider } from "@lingui/react";
import {
  createContext,
  startTransition,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  APP_LOCALE_EVENT,
  APP_LOCALE_KEY,
  DEFAULT_APP_LOCALE,
  normalizeAppLocale,
  type AppLocale,
} from "../constants/localeSettings";
import {
  DEFAULT_SYSTEM_LANGUAGE_ENABLED,
  normalizeSystemLanguageEnabled,
  SYSTEM_LANGUAGE_ENABLED_KEY,
} from "../constants/experimentalFeatures";
import { trpc } from "../services/trpc";
import { i18n, getSupportedLocale, SUPPORTED_LOCALES } from "./config";
import { detectInitialLocale } from "./detectLocale";
import { getSfwRulesForLocale, type SfwRuleSet } from "./sfwRules";

type I18nContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => Promise<void>;
  sfwRules: SfwRuleSet;
  locales: Array<{ code: AppLocale; label: string }>;
};

export const I18nContext = createContext<I18nContextValue | null>(null);

async function loadLocale(locale: AppLocale) {
  const entry = getSupportedLocale(locale) ?? getSupportedLocale(DEFAULT_APP_LOCALE);
  if (!entry) {
    throw new Error(`Unsupported locale: ${locale}`);
  }

  const catalog = await entry.loadCatalog();
  i18n.loadAndActivate({ locale: entry.code, messages: catalog.messages });
}

function readCachedLocale(): AppLocale | null {
  if (typeof window === "undefined") return null;
  const cached = window.localStorage.getItem(APP_LOCALE_KEY);
  return cached ? normalizeAppLocale(cached) : null;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const cachedLocale = readCachedLocale();
  const [locale, setLocaleState] = useState<AppLocale>(cachedLocale ?? DEFAULT_APP_LOCALE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      let nextLocale = cachedLocale;
      if (!nextLocale) {
        try {
          const storedLocale = await trpc.store.get.query({ key: APP_LOCALE_KEY });
          if (storedLocale) {
            nextLocale = normalizeAppLocale(storedLocale);
          } else {
            const rawSystemLanguageEnabled = await trpc.store.get.query({
              key: SYSTEM_LANGUAGE_ENABLED_KEY,
            });
            const systemLanguageEnabled = normalizeSystemLanguageEnabled(
              typeof rawSystemLanguageEnabled === "boolean"
                ? rawSystemLanguageEnabled
                : rawSystemLanguageEnabled === "true"
                  ? true
                  : rawSystemLanguageEnabled === "false"
                    ? false
                    : DEFAULT_SYSTEM_LANGUAGE_ENABLED
            );
            nextLocale = systemLanguageEnabled ? detectInitialLocale() : DEFAULT_APP_LOCALE;
          }
        } catch {
          nextLocale = DEFAULT_APP_LOCALE;
        }
      }

      const normalizedLocale = normalizeAppLocale(nextLocale);
      await loadLocale(normalizedLocale);
      if (cancelled) return;

      window.localStorage.setItem(APP_LOCALE_KEY, normalizedLocale);
      document.documentElement.lang = normalizedLocale;
      startTransition(() => {
        setLocaleState(normalizedLocale);
        setReady(true);
      });
    };

    void initialize().catch((error) => {
      console.error("Failed to initialize i18n", error);
      void loadLocale(DEFAULT_APP_LOCALE).finally(() => {
        if (cancelled) return;
        startTransition(() => {
          setLocaleState(DEFAULT_APP_LOCALE);
          setReady(true);
        });
      });
    });

    const handleLocaleEvent = (event: Event) => {
      const customEvent = event as CustomEvent<AppLocale>;
      const nextLocale = normalizeAppLocale(customEvent.detail);
      startTransition(() => {
        setLocaleState(nextLocale);
      });
    };

    window.addEventListener(APP_LOCALE_EVENT, handleLocaleEvent);
    return () => {
      cancelled = true;
      window.removeEventListener(APP_LOCALE_EVENT, handleLocaleEvent);
    };
  }, [cachedLocale]);

  const setLocale = async (nextLocale: AppLocale) => {
    const normalized = normalizeAppLocale(nextLocale);
    await loadLocale(normalized);
    window.localStorage.setItem(APP_LOCALE_KEY, normalized);
    document.documentElement.lang = normalized;
    await trpc.store.set.mutate({ key: APP_LOCALE_KEY, value: normalized });
    window.dispatchEvent(new CustomEvent<AppLocale>(APP_LOCALE_EVENT, { detail: normalized }));
    startTransition(() => {
      setLocaleState(normalized);
    });
  };

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      sfwRules: getSfwRulesForLocale(locale),
      locales: SUPPORTED_LOCALES.map(({ code, label }) => ({ code, label })),
    }),
    [locale]
  );

  if (!ready) return null;

  return (
    <I18nContext.Provider value={value}>
      <LinguiProvider i18n={i18n}>{children}</LinguiProvider>
    </I18nContext.Provider>
  );
}
