import { shell } from "electron";

export function openExternalSafe(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:" &&
      parsed.protocol !== "mailto:"
    ) {
      return false;
    }
    void shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
}
