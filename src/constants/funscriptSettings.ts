export const AUTOFIX_BROKEN_FUNSCRIPTS_KEY = "game.funscript.autofixBrokenFunscripts";
export const DEFAULT_AUTOFIX_BROKEN_FUNSCRIPTS = true;

export const STASH_REATTACH_FUNSCRIPTS_ENABLED_KEY =
  "integrations.stash.reattachFunscriptsInRounds";
export type StashReattachFunscriptsMode = "off" | "stashOnly" | "always";
export const DEFAULT_STASH_REATTACH_FUNSCRIPTS_MODE: StashReattachFunscriptsMode = "off";

export function normalizeAutofixBrokenFunscripts(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return DEFAULT_AUTOFIX_BROKEN_FUNSCRIPTS;
}

export function normalizeStashReattachFunscriptsMode(value: unknown): StashReattachFunscriptsMode {
  if (value === true) return "stashOnly";
  if (value === false) return "off";
  if (value === "stashOnly" || value === "always" || value === "off") return value;
  return DEFAULT_STASH_REATTACH_FUNSCRIPTS_MODE;
}
