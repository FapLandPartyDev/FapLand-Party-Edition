import { afterEach, describe, expect, it } from "vitest";
import {
  ALWAYS_RECOVERY_MODE_KEY,
  START_NORMALLY_ONCE_KEY,
  clearStartNormallyOnce,
  consumeStartNormallyOnce,
  normalizeAlwaysRecoveryMode,
  setStartNormallyOnce,
} from "./startupSettings";

describe("startupSettings", () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("uses a stable store key", () => {
    expect(ALWAYS_RECOVERY_MODE_KEY).toBe("startup.alwaysRecoveryMode");
  });

  it("only treats literal true as enabled", () => {
    expect(normalizeAlwaysRecoveryMode(true)).toBe(true);
    expect(normalizeAlwaysRecoveryMode(false)).toBe(false);
    expect(normalizeAlwaysRecoveryMode(undefined)).toBe(false);
    expect(normalizeAlwaysRecoveryMode("true")).toBe(false);
    expect(normalizeAlwaysRecoveryMode(1)).toBe(false);
  });

  it("sets, consumes once, and clears the start-normally flag", () => {
    expect(consumeStartNormallyOnce()).toBe(false);

    setStartNormallyOnce();
    expect(window.sessionStorage.getItem(START_NORMALLY_ONCE_KEY)).toBe("1");
    expect(consumeStartNormallyOnce()).toBe(true);
    expect(consumeStartNormallyOnce()).toBe(false);

    setStartNormallyOnce();
    clearStartNormallyOnce();
    expect(window.sessionStorage.getItem(START_NORMALLY_ONCE_KEY)).toBeNull();
  });
});
