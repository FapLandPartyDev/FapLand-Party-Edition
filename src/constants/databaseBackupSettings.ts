export const DATABASE_BACKUP_ENABLED_KEY = "database.backup.enabled";
export const DATABASE_BACKUP_FREQUENCY_DAYS_KEY = "database.backup.frequencyDays";
export const DATABASE_BACKUP_RETENTION_DAYS_KEY = "database.backup.retentionDays";
export const DATABASE_BACKUP_LAST_BACKUP_AT_KEY = "database.backup.lastBackupAt";

export const DEFAULT_DATABASE_BACKUP_ENABLED = true;
export const DEFAULT_DATABASE_BACKUP_FREQUENCY_DAYS = 1;
export const MIN_DATABASE_BACKUP_FREQUENCY_DAYS = 1;
export const MAX_DATABASE_BACKUP_FREQUENCY_DAYS = 365;
export const DEFAULT_DATABASE_BACKUP_RETENTION_DAYS = 7;
export const MIN_DATABASE_BACKUP_RETENTION_DAYS = 1;
export const MAX_DATABASE_BACKUP_RETENTION_DAYS = 3650;

function normalizeWholeDays(value: unknown, fallback: number, min: number, max: number): number {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;

  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function normalizeDatabaseBackupEnabled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return DEFAULT_DATABASE_BACKUP_ENABLED;
}

export function normalizeDatabaseBackupFrequencyDays(value: unknown): number {
  return normalizeWholeDays(
    value,
    DEFAULT_DATABASE_BACKUP_FREQUENCY_DAYS,
    MIN_DATABASE_BACKUP_FREQUENCY_DAYS,
    MAX_DATABASE_BACKUP_FREQUENCY_DAYS
  );
}

export function normalizeDatabaseBackupRetentionDays(value: unknown): number {
  return normalizeWholeDays(
    value,
    DEFAULT_DATABASE_BACKUP_RETENTION_DAYS,
    MIN_DATABASE_BACKUP_RETENTION_DAYS,
    MAX_DATABASE_BACKUP_RETENTION_DAYS
  );
}
