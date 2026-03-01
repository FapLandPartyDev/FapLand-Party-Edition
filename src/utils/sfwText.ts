import type { SfwRuleSet } from "../i18n";
import { getSfwRulesForLocale } from "../i18n";

export function abbreviateNsfwText(
  text: string,
  rulesOrEnabled: SfwRuleSet | boolean,
  enabled = typeof rulesOrEnabled === "boolean" ? rulesOrEnabled : false
): string {
  if (!enabled || text.length === 0) return text;

  const rules = typeof rulesOrEnabled === "boolean" ? getSfwRulesForLocale("en") : rulesOrEnabled;

  let nextText = text;
  for (const pattern of rules.patterns) {
    nextText = nextText.replace(pattern.match, (match) => pattern.replace(match));
  }
  return nextText;
}
