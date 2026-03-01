export const ALWAYS_RECOVERY_MODE_KEY = "startup.alwaysRecoveryMode";

export const START_NORMALLY_ONCE_KEY = "fland:start-normally-once";

export function normalizeAlwaysRecoveryMode(value: unknown): boolean {
  return value === true;
}

export function consumeStartNormallyOnce(): boolean {
  try {
    if (window.sessionStorage.getItem(START_NORMALLY_ONCE_KEY) === "1") {
      window.sessionStorage.removeItem(START_NORMALLY_ONCE_KEY);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function setStartNormallyOnce(): void {
  try {
    window.sessionStorage.setItem(START_NORMALLY_ONCE_KEY, "1");
  } catch {
    return;
  }
}

export function clearStartNormallyOnce(): void {
  try {
    window.sessionStorage.removeItem(START_NORMALLY_ONCE_KEY);
  } catch {
    return;
  }
}
