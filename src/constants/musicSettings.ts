export const MUSIC_ENABLED_KEY = "music.enabled";
export const MUSIC_QUEUE_KEY = "music.queue";
export const MUSIC_VOLUME_KEY = "music.volume";
export const MUSIC_SHUFFLE_KEY = "music.shuffle";
export const MUSIC_LOOP_MODE_KEY = "music.loopMode";
export const MUSIC_CURRENT_INDEX_KEY = "music.currentIndex";
export const MUSIC_CACHE_ROOT_PATH_KEY = "music.cacheRootPath";

export const DEFAULT_MUSIC_ENABLED = true;
export const DEFAULT_MUSIC_VOLUME = 0.45;
export const DEFAULT_MUSIC_SHUFFLE = false;
export const DEFAULT_MUSIC_LOOP_MODE = "queue" as const;

export type MusicLoopMode = "off" | "queue" | "track";

export type MusicQueueEntry = {
  id: string;
  filePath: string;
  name: string;
  sourceUrl?: string;
};

export function clampMusicVolume(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_MUSIC_VOLUME;
  return Math.max(0, Math.min(1, parsed));
}

export function normalizeMusicLoopMode(value: unknown): MusicLoopMode {
  return value === "off" || value === "track" || value === "queue"
    ? value
    : DEFAULT_MUSIC_LOOP_MODE;
}

export function normalizeMusicQueue(value: unknown): MusicQueueEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Partial<MusicQueueEntry>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const filePath = typeof candidate.filePath === "string" ? candidate.filePath.trim() : "";
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const sourceUrl =
      typeof candidate.sourceUrl === "string" ? candidate.sourceUrl.trim() : undefined;
    if (id.length === 0 || filePath.length === 0 || name.length === 0) return [];
    return [{ id, filePath, name, ...(sourceUrl ? { sourceUrl } : {}) }];
  });
}

export function normalizeMusicCurrentIndex(value: unknown, queueLength: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || queueLength <= 0) return 0;
  return Math.max(0, Math.min(queueLength - 1, Math.floor(parsed)));
}
