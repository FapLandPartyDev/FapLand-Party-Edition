import { describe, expect, it } from "vitest";
import {
  DEFAULT_DATABASE_BACKUP_FREQUENCY_DAYS,
  DEFAULT_DATABASE_BACKUP_RETENTION_DAYS,
  MAX_DATABASE_BACKUP_FREQUENCY_DAYS,
  MAX_DATABASE_BACKUP_RETENTION_DAYS,
  MIN_DATABASE_BACKUP_FREQUENCY_DAYS,
  MIN_DATABASE_BACKUP_RETENTION_DAYS,
  normalizeDatabaseBackupEnabled,
  normalizeDatabaseBackupFrequencyDays,
  normalizeDatabaseBackupRetentionDays,
} from "./databaseBackupSettings";

describe("database backup settings", () => {
  it("normalizes backup enabled values", () => {
    expect(normalizeDatabaseBackupEnabled(true)).toBe(true);
    expect(normalizeDatabaseBackupEnabled(false)).toBe(false);
    expect(normalizeDatabaseBackupEnabled("false")).toBe(true);
    expect(normalizeDatabaseBackupEnabled(undefined)).toBe(true);
  });

  it("normalizes backup frequency days", () => {
    expect(normalizeDatabaseBackupFrequencyDays(3.8)).toBe(3);
    expect(normalizeDatabaseBackupFrequencyDays("14")).toBe(14);
    expect(normalizeDatabaseBackupFrequencyDays(0)).toBe(MIN_DATABASE_BACKUP_FREQUENCY_DAYS);
    expect(normalizeDatabaseBackupFrequencyDays(9999)).toBe(MAX_DATABASE_BACKUP_FREQUENCY_DAYS);
    expect(normalizeDatabaseBackupFrequencyDays("bad")).toBe(
      DEFAULT_DATABASE_BACKUP_FREQUENCY_DAYS
    );
  });

  it("normalizes backup retention days", () => {
    expect(normalizeDatabaseBackupRetentionDays(10.9)).toBe(10);
    expect(normalizeDatabaseBackupRetentionDays("30")).toBe(30);
    expect(normalizeDatabaseBackupRetentionDays(0)).toBe(MIN_DATABASE_BACKUP_RETENTION_DAYS);
    expect(normalizeDatabaseBackupRetentionDays(99999)).toBe(MAX_DATABASE_BACKUP_RETENTION_DAYS);
    expect(normalizeDatabaseBackupRetentionDays(null)).toBe(DEFAULT_DATABASE_BACKUP_RETENTION_DAYS);
  });
});
