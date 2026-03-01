import type { AppLocale } from "../constants/localeSettings";

export type SfwRule = {
  match: RegExp;
  replace: (match: string) => string;
};

export type SfwRuleSet = {
  patterns: SfwRule[];
};

const ENGLISH_NSFW_WORDS = [
  "cumming",
  "cumload",
  "cum",
  "cums",
  "came",
  "orgasmic",
  "orgasms",
  "orgasm",
  "fapping",
  "fapped",
  "fap",
  "faps",
] as const;

const ENGLISH_SFW_RULES: SfwRuleSet = {
  patterns: [
    {
      match: new RegExp(`\\b(?:${ENGLISH_NSFW_WORDS.join("|")})\\b`, "giu"),
      replace: (match) => match[0] ?? match,
    },
  ],
};

export function getSfwRulesForLocale(locale: AppLocale): SfwRuleSet {
  switch (locale) {
    case "de":
      return ENGLISH_SFW_RULES;
    case "es":
      return ENGLISH_SFW_RULES;
    case "fr":
      return ENGLISH_SFW_RULES;
    case "zh":
      return ENGLISH_SFW_RULES;
    case "en":
    default:
      return ENGLISH_SFW_RULES;
  }
}
