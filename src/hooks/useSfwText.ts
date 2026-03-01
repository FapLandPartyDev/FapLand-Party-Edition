import { useLocale } from "../i18n";
import { useSfwMode } from "./useSfwMode";
import { abbreviateNsfwText } from "../utils/sfwText";

export function useSfwText() {
  const sfwMode = useSfwMode();
  const { sfwRules } = useLocale();

  return (text: string) => abbreviateNsfwText(text, sfwRules, sfwMode);
}
