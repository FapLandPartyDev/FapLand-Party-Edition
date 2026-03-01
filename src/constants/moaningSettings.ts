export const MOANING_ENABLED_KEY = "moaning.enabled";
export const MOANING_QUEUE_KEY = "moaning.queue";
export const MOANING_VOLUME_KEY = "moaning.volume";
export const MOANING_CACHE_ROOT_PATH_KEY = "moaning.cacheRootPath";

export const DEFAULT_MOANING_ENABLED = true;
export const DEFAULT_MOANING_VOLUME = 0.3;

export type MoaningQueueEntry = {
  id: string;
  filePath: string;
  name: string;
  sourceUrl?: string;
};

export function clampMoaningVolume(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MOANING_VOLUME;
  return Math.max(0, Math.min(1, parsed));
}

export function normalizeMoaningQueue(value: unknown): MoaningQueueEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Partial<MoaningQueueEntry>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const filePath = typeof candidate.filePath === "string" ? candidate.filePath.trim() : "";
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const sourceUrl =
      typeof candidate.sourceUrl === "string" ? candidate.sourceUrl.trim() : undefined;
    if (id.length === 0 || filePath.length === 0 || name.length === 0) return [];
    return [{ id, filePath, name, ...(sourceUrl ? { sourceUrl } : {}) }];
  });
}
