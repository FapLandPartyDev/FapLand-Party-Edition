import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadFunscriptTimeline, type FunscriptAction } from "../../game/media/playback";
import { converter } from "../../services/converter";
import { db, type InstalledRound } from "../../services/db";
import { trpc } from "../../services/trpc";
import {
  playConverterAutoDetectSound,
  playConverterMarkInSound,
  playConverterMarkOutSound,
  playConverterSaveSuccessSound,
  playConverterSegmentAddSound,
  playConverterSegmentDeleteSound,
  playConverterValidationErrorSound,
  playConverterZoomSound,
  playSelectSound,
} from "../../utils/audio";
import {
  buildDetectedSegments,
  findAdaptiveDetectionSettings,
  findDetectionSettingsForTargetCount,
  getActionTrimRange,
} from "./detection";
import { applyAutoMetadataToSegments } from "./metadata";
import { CONVERTER_SHORTCUTS, type ConverterShortcutContext } from "./shortcuts";
import {
  clamp,
  CONVERTER_AUTO_TRIM_ROUNDS_KEY,
  CONVERTER_MIN_ROUND_KEY,
  CONVERTER_PAUSE_GAP_KEY,
  CONVERTER_TRIM_ALLOWANCE_KEY,
  CONVERTER_ZOOM_KEY,
  createSegmentId,
  DEFAULT_MIN_ROUND_MS,
  DEFAULT_PAUSE_GAP_MS,
  DEFAULT_TRIM_ALLOWANCE_MS,
  DEFAULT_ZOOM_PX_PER_SEC,
  formatMs,
  MAX_ZOOM_PX_PER_SEC,
  MIN_SEGMENT_MS,
  MIN_ZOOM_PX_PER_SEC,
  normalizeDetectionInput,
  normalizeOptionalNumberInput,
  sortSegments,
  validateSegments,
  type DragState,
  type HeroOption,
  type InstalledSourceOption,
  type SegmentCutMarkDraft,
  type SegmentDraft,
  type SegmentType,
} from "./types";
import { usePlayableVideoFallback } from "../../hooks/usePlayableVideoFallback";
import { UndoManager } from "../map-editor/UndoManager";
import {
  MIN_ROUND_CUT_MS,
  normalizeRoundCutRanges,
  parseRoundCutRangesJson,
  skipCutIfNeeded,
} from "../../utils/roundCuts";
import { getRoundVideoDurationMs, meetsMinimumVideoLength } from "./sourceFilter";

type ConverterSearchParams = {
  sourceRoundId: string;
  heroName: string;
  minimumVideoLengthMinutes: number;
};

export type ConverterStep = "select" | "caching" | "edit";

export type SelectedSourceInfo = {
  kind: "round" | "hero" | "local" | "url";
  id: string;
  name: string;
} | null;

function toWebsiteSourceLabel(videoUri: string): string {
  try {
    const parsed = new URL(videoUri);
    const host = parsed.hostname.replace(/^www\./i, "");
    return host || videoUri;
  } catch {
    return videoUri;
  }
}

export type ConverterState = ReturnType<typeof useConverterState>;

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

function toCutDrafts(
  cutRangesJson: string | null | undefined,
  startTimeMs: number,
  endTimeMs: number
) {
  return parseRoundCutRangesJson(cutRangesJson, startTimeMs, endTimeMs).map((cut) => ({
    ...cut,
    id: createSegmentId(),
  }));
}

function toCustomRoundName(roundName: string, heroName: string | null | undefined): string | null {
  const normalizedHeroName = heroName?.trim();
  if (!normalizedHeroName) return roundName;
  const escapedHeroName = normalizedHeroName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedHeroName}\\s+-\\s+round\\s+\\d+$`, "i").test(roundName.trim())
    ? null
    : roundName;
}

function segmentOverlapsRange(
  segment: Pick<SegmentDraft, "startTimeMs" | "endTimeMs">,
  startTimeMs: number,
  endTimeMs: number
): boolean {
  return startTimeMs < segment.endTimeMs && endTimeMs > segment.startTimeMs;
}

function clampTimeToSegment(
  timeMs: number,
  segment: Pick<SegmentDraft, "startTimeMs" | "endTimeMs">
): number {
  return clamp(timeMs, segment.startTimeMs, segment.endTimeMs);
}

function clampSegmentCutMarkDraft(
  marks: SegmentCutMarkDraft,
  segment: Pick<SegmentDraft, "startTimeMs" | "endTimeMs">
): SegmentCutMarkDraft {
  return {
    markInMs: marks.markInMs === null ? null : clampTimeToSegment(marks.markInMs, segment),
    markOutMs: marks.markOutMs === null ? null : clampTimeToSegment(marks.markOutMs, segment),
  };
}

function getSkippedPreviewTimeSec(timeMs: number, segments: SegmentDraft[]): number | null {
  for (const segment of segments) {
    const skippedToSec = skipCutIfNeeded(timeMs / 1000, segment.cutRanges);
    if (skippedToSec !== null) {
      return skippedToSec;
    }
  }

  return null;
}

function getDefaultSegmentCutMarkDraft(): SegmentCutMarkDraft {
  return {
    markInMs: null,
    markOutMs: null,
  };
}

export function useConverterState(searchParams: ConverterSearchParams) {
  const {
    sourceRoundId: preselectedSourceRoundId,
    heroName: prefilledHeroName,
    minimumVideoLengthMinutes,
  } = searchParams;

  const [step, setStep] = useState<ConverterStep>(
    preselectedSourceRoundId || prefilledHeroName ? "edit" : "select"
  );
  const [selectedSourceInfo, setSelectedSourceInfo] = useState<SelectedSourceInfo>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const targetSegmentCountInputRef = useRef<HTMLInputElement>(null);
  const lastZoomSoundAtRef = useRef(0);
  const dragStateRef = useRef<DragState | null>(null);
  const dragAutoScrollFrameRef = useRef<number | null>(null);
  const pendingInstalledLoadMessageRef = useRef<string | null>(null);
  const pendingInstalledSegmentsRef = useRef<SegmentDraft[] | null>(null);
  const hasAppliedPreselectedSourceRef = useRef(false);
  const sourceLoadTokenRef = useRef(0);

  const [sourceMode, setSourceMode] = useState<"local" | "installed">("installed");
  const [videoUri, setVideoUri] = useState("");
  const [funscriptUri, setFunscriptUri] = useState<string | null>(null);
  const [allInstalledSourceOptions, setAllInstalledSourceOptions] = useState<
    InstalledSourceOption[]
  >([]);
  const [selectedInstalledId, setSelectedInstalledId] = useState("");
  const [heroOptions, setHeroOptions] = useState<HeroOption[]>([]);
  const [selectedHeroId, setSelectedHeroId] = useState("");

  const [durationMs, setDurationMs] = useState(0);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [markInMs, setMarkInMs] = useState<number | null>(null);
  const [markOutMs, setMarkOutMs] = useState<number | null>(null);
  const [segmentCutMarks, setSegmentCutMarks] = useState<Record<string, SegmentCutMarkDraft>>({});

  const [segments, setSegments] = useState<SegmentDraft[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [detectedSegments, setDetectedSegments] = useState<SegmentDraft[]>([]);
  const [funscriptActions, setFunscriptActions] = useState<FunscriptAction[]>([]);
  const [allowOverlappingSegments, setAllowOverlappingSegments] = useState(false);
  const [previewSkipsCuts, setPreviewSkipsCuts] = useState(true);

  const latestSegmentsRef = useRef<SegmentDraft[]>([]);

  const [canUndoState, setCanUndoState] = useState(false);
  const [canRedoState, setCanRedoState] = useState(false);
  const undoManagerRef = useRef(
    new UndoManager<SegmentDraft[]>([], {
      isEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    })
  );
  const syncUndoState = useCallback(() => {
    const manager = undoManagerRef.current;
    setCanUndoState(manager.canUndo());
    setCanRedoState(manager.canRedo());
  }, []);

  const [zoomPxPerSec, setZoomPxPerSec] = useState(DEFAULT_ZOOM_PX_PER_SEC);
  const [pauseGapMs, setPauseGapMs] = useState(DEFAULT_PAUSE_GAP_MS);
  const [minRoundMs, setMinRoundMs] = useState(DEFAULT_MIN_ROUND_MS);
  const [pauseGapDraft, setPauseGapDraft] = useState(`${DEFAULT_PAUSE_GAP_MS}`);
  const [minRoundDraft, setMinRoundDraft] = useState(`${DEFAULT_MIN_ROUND_MS}`);
  const [autoTrimRounds, setAutoTrimRounds] = useState(false);
  const [trimAllowanceMs, setTrimAllowanceMs] = useState(DEFAULT_TRIM_ALLOWANCE_MS);
  const [trimAllowanceDraft, setTrimAllowanceDraft] = useState(`${DEFAULT_TRIM_ALLOWANCE_MS}`);
  const [targetSegmentCountDraft, setTargetSegmentCountDraft] = useState("");
  const [targetDetectionResultSummary, setTargetDetectionResultSummary] = useState<string | null>(
    null
  );

  const [heroName, setHeroName] = useState("");
  const [heroAuthor, setHeroAuthor] = useState("");
  const [heroDescription, setHeroDescription] = useState("");
  const [deleteSourceRound, setDeleteSourceRound] = useState(true);
  const [sourceRoundIdsToReplace, setSourceRoundIdsToReplace] = useState<string[]>([]);

  const [isSaving, setIsSaving] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHotkeys, setShowHotkeys] = useState(true);
  const { getVideoSrc, ensurePlayableVideo, handleVideoError } = usePlayableVideoFallback();

  const [cachingUrl, setCachingUrl] = useState<string | null>(null);
  const [cachingProgress, setCachingProgress] = useState<{
    percent: number;
    speedBytesPerSec: number | null;
    etaSeconds: number | null;
    totalBytes: number | null;
    downloadedBytes: number | null;
  } | null>(null);
  const [cachingError, setCachingError] = useState<string | null>(null);
  const cachingAbortRef = useRef(false);

  const goToSelectStep = useCallback(() => {
    sourceLoadTokenRef.current += 1;
    setStep("select");
    setSelectedSourceInfo(null);
    setVideoUri("");
    setFunscriptUri(null);
    setSelectedInstalledId("");
    setSourceRoundIdsToReplace([]);
    setSegments([]);
    setSegmentCutMarks({});
    setSelectedSegmentId(null);
    setDetectedSegments([]);
    setMarkInMs(null);
    setMarkOutMs(null);
    setDurationMs(0);
    setCurrentTimeMs(0);
    setHeroName("");
    setHeroAuthor("");
    setHeroDescription("");
    setMessage(null);
    setError(null);
    undoManagerRef.current.reset([]);
    syncUndoState();
  }, [syncUndoState]);

  const selectRoundAndEdit = useCallback(
    async (roundId: string, options?: { silent?: boolean }) => {
      const rounds = await db.round.findInstalled(true);
      const round = rounds.find((r) => r.id === roundId);
      if (!round) {
        setError("Round not found.");
        return;
      }

      const resource =
        round.resources.find((entry) => !entry.disabled && entry.videoUri.trim().length > 0) ??
        round.resources.find((entry) => entry.videoUri.trim().length > 0);
      if (!resource) {
        setError("Round has no usable video resource.");
        return;
      }

      setSelectedSourceInfo({ kind: "round", id: roundId, name: round.name });
      setSourceMode("installed");
      setDeleteSourceRound(true);
      setSelectedInstalledId(roundId);
      setSourceRoundIdsToReplace([roundId]);
      setVideoUri(resource.videoUri);
      setFunscriptUri(resource.funscriptUri ?? null);
      setHeroName(round.hero?.name ?? round.name);
      setHeroAuthor(round.hero?.author ?? round.author ?? "");
      setHeroDescription(round.hero?.description ?? round.description ?? "");

      let resetSegments: SegmentDraft[] = [];
      if (round.startTime != null && round.endTime != null) {
        const draft: SegmentDraft = {
          id: createSegmentId(),
          startTimeMs: round.startTime,
          endTimeMs: round.endTime,
          cutRanges: toCutDrafts(round.cutRangesJson ?? null, round.startTime, round.endTime),
          type: round.type ?? "Normal",
          customName: toCustomRoundName(round.name, round.hero?.name),
          excludeFromNumbering: round.excludeFromNumbering ?? false,
          bpm: round.bpm ?? null,
          difficulty: round.difficulty ?? null,
          bpmOverride: round.bpm != null,
          difficultyOverride: round.difficulty != null,
        };
        resetSegments = [draft];
        setSegments(resetSegments);
        setSegmentCutMarks({});
        setSelectedSegmentId(draft.id);
      } else {
        setSegments([]);
        setSegmentCutMarks({});
        setSelectedSegmentId(null);
      }
      pendingInstalledSegmentsRef.current = resetSegments;
      sourceLoadTokenRef.current += 1;
      pendingInstalledLoadMessageRef.current = null;

      setDetectedSegments([]);
      setMarkInMs(null);
      setMarkOutMs(null);
      setCurrentTimeMs(0);
      setDurationMs(0);
      setMessage(null);
      setError(null);
      undoManagerRef.current.reset(resetSegments);
      syncUndoState();
      if (!options?.silent) {
        playSelectSound();
      }
      setStep("edit");
    },
    [syncUndoState]
  );

  const selectHeroAndEdit = useCallback(
    async (heroId: string) => {
      const heroes = await db.hero.findMany();
      const hero = heroes.find((h) => h.id === heroId);
      if (!hero) {
        setError("Hero not found.");
        return;
      }

      const rounds = await db.round.findInstalled(true);
      const heroRounds = rounds.filter((r) => r.heroId === heroId && r.resources.length > 0);

      if (heroRounds.length === 0) {
        setError("Hero has no rounds with usable resources.");
        return;
      }

      const firstRound = heroRounds[0];
      const resource =
        firstRound?.resources.find(
          (entry) => !entry.disabled && entry.videoUri.trim().length > 0
        ) ?? firstRound?.resources.find((entry) => entry.videoUri.trim().length > 0);
      if (!resource || !firstRound) {
        setError("Hero rounds have no usable video resource.");
        return;
      }

      setSelectedSourceInfo({ kind: "hero", id: heroId, name: hero.name });
      setSourceMode("installed");
      setDeleteSourceRound(true);
      setSelectedInstalledId(firstRound.id);
      setSourceRoundIdsToReplace(heroRounds.map((round) => round.id));
      setVideoUri(resource.videoUri);
      setFunscriptUri(resource.funscriptUri ?? null);
      setHeroName(hero.name);
      setHeroAuthor(hero.author ?? "");
      setHeroDescription(hero.description ?? "");

      const segmentDrafts: SegmentDraft[] = heroRounds
        .filter((round) => round.startTime != null && round.endTime != null)
        .map((round) => ({
          id: createSegmentId(),
          startTimeMs: round.startTime!,
          endTimeMs: round.endTime!,
          cutRanges: toCutDrafts(round.cutRangesJson ?? null, round.startTime!, round.endTime!),
          type: round.type ?? "Normal",
          customName: toCustomRoundName(round.name, hero.name),
          excludeFromNumbering: round.excludeFromNumbering ?? false,
          bpm: round.bpm ?? null,
          difficulty: round.difficulty ?? null,
          bpmOverride: round.bpm != null,
          difficultyOverride: round.difficulty != null,
        }));
      const sortedSegmentDrafts = sortSegments(segmentDrafts);
      pendingInstalledSegmentsRef.current = sortedSegmentDrafts;
      sourceLoadTokenRef.current += 1;
      pendingInstalledLoadMessageRef.current = `Loaded hero "${hero.name}" from installed rounds.`;
      setSegments(sortedSegmentDrafts);
      setSegmentCutMarks({});
      setSelectedSegmentId(sortedSegmentDrafts[0]?.id ?? null);

      setDetectedSegments([]);
      setMarkInMs(null);
      setMarkOutMs(null);
      setCurrentTimeMs(0);
      setDurationMs(0);
      setMessage(null);
      setError(null);
      undoManagerRef.current.reset(sortedSegmentDrafts);
      syncUndoState();
      playSelectSound();
      setStep("edit");
    },
    [syncUndoState]
  );

  const selectLocalAndEdit = useCallback(async () => {
    const path = await window.electronAPI.dialog.selectConverterVideoFile();
    if (!path) return;
    sourceLoadTokenRef.current += 1;

    const converted = window.electronAPI.file.convertFileSrc(path);
    setSelectedSourceInfo({
      kind: "local",
      id: path,
      name: path.split(/[/\\]/).pop() ?? "Local file",
    });
    setSourceMode("local");
    setDeleteSourceRound(false);
    setSelectedInstalledId("");
    setSourceRoundIdsToReplace([]);
    setVideoUri(converted);
    setHeroName("");
    setHeroAuthor("");
    setHeroDescription("");
    setSegments([]);
    setSegmentCutMarks({});
    setSelectedSegmentId(null);
    setDetectedSegments([]);
    setMarkInMs(null);
    setMarkOutMs(null);
    setCurrentTimeMs(0);
    setDurationMs(0);
    setMessage("Local video loaded. Add funscript for auto-detection.");
    setError(null);
    undoManagerRef.current.reset([]);
    syncUndoState();
    playSelectSound();
    setStep("edit");
  }, [syncUndoState]);

  const attachLocalFunscript = useCallback(async () => {
    const path = await window.electronAPI.dialog.selectConverterFunscriptFile();
    if (!path) return;
    const converted = window.electronAPI.file.convertFileSrc(path);
    setFunscriptUri(converted);
    setMessage("Funscript attached.");
  }, []);

  const selectWebsiteAndEdit = useCallback(
    async (nextVideoUri: string, nextFunscriptUri: string | null) => {
      const normalizedVideoUri = nextVideoUri.trim();
      const normalizedFunscriptUri = nextFunscriptUri?.trim() || null;
      if (!normalizedVideoUri) {
        setError("Website video URL is required.");
        return;
      }
      sourceLoadTokenRef.current += 1;

      setSelectedSourceInfo({
        kind: "url",
        id: normalizedVideoUri,
        name: toWebsiteSourceLabel(normalizedVideoUri),
      });
      setSourceMode("local");
      setDeleteSourceRound(false);
      setSelectedInstalledId("");
      setSourceRoundIdsToReplace([]);
      setVideoUri(normalizedVideoUri);
      setFunscriptUri(normalizedFunscriptUri);
      setHeroName("");
      setHeroAuthor("");
      setHeroDescription("");
      setSegments([]);
      setSegmentCutMarks({});
      setSelectedSegmentId(null);
      setDetectedSegments([]);
      setMarkInMs(null);
      setMarkOutMs(null);
      setCurrentTimeMs(0);
      setDurationMs(0);
      setError(null);
      playSelectSound();

      setCachingUrl(normalizedVideoUri);
      setCachingProgress(null);
      setCachingError(null);
      cachingAbortRef.current = false;
      setStep("caching");

      try {
        await trpc.db.ensureWebsiteVideoCachedForConverter.mutate({ url: normalizedVideoUri });
        if (!cachingAbortRef.current) {
          setCachingUrl(null);
          setCachingProgress(null);
          setMessage("Website source loaded. Add segments and save as usual.");
          setStep("edit");
        }
      } catch (error) {
        if (!cachingAbortRef.current) {
          const message = error instanceof Error ? error.message : "Failed to cache website video.";
          setCachingError(message);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (step !== "caching" || !cachingUrl) return;

    let active = true;

    const poll = async () => {
      if (!active || !cachingUrl) return;
      try {
        const progress = await trpc.db.getWebsiteVideoDownloadProgressForUrl.query({
          url: cachingUrl,
        });
        if (active && progress) {
          setCachingProgress({
            percent: progress.percent,
            speedBytesPerSec: progress.speedBytesPerSec,
            etaSeconds: progress.etaSeconds,
            totalBytes: progress.totalBytes,
            downloadedBytes: progress.downloadedBytes,
          });
        }
      } catch {
        // polling error is non-critical
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), 500);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [step, cachingUrl]);

  const cancelCaching = useCallback(async () => {
    cachingAbortRef.current = true;
    if (cachingUrl) {
      try {
        await trpc.db.cancelWebsiteVideoCache.mutate({ url: cachingUrl });
      } catch {
        // cancellation cleanup is best-effort
      }
    }
    setCachingUrl(null);
    setCachingProgress(null);
    setCachingError(null);
    setStep("select");
    setSelectedSourceInfo(null);
    setVideoUri("");
    setFunscriptUri(null);
    setSelectedInstalledId("");
    setSourceRoundIdsToReplace([]);
    setSegments([]);
    setSegmentCutMarks({});
    setSelectedSegmentId(null);
    setDetectedSegments([]);
    setMarkInMs(null);
    setMarkOutMs(null);
    setDurationMs(0);
    setCurrentTimeMs(0);
    setMessage(null);
    setError(null);
  }, [cachingUrl]);

  const retryCaching = useCallback(() => {
    if (!cachingUrl) return;
    setCachingError(null);
    setCachingProgress(null);
    cachingAbortRef.current = false;
    void (async () => {
      try {
        await trpc.db.ensureWebsiteVideoCachedForConverter.mutate({ url: cachingUrl });
        if (!cachingAbortRef.current) {
          setCachingUrl(null);
          setCachingProgress(null);
          setMessage("Website source loaded. Add segments and save as usual.");
          setStep("edit");
        }
      } catch (error) {
        if (!cachingAbortRef.current) {
          const message = error instanceof Error ? error.message : "Failed to cache website video.";
          setCachingError(message);
        }
      }
    })();
  }, [cachingUrl]);

  const sortedSegments = useMemo(() => sortSegments(segments), [segments]);

  useEffect(() => {
    latestSegmentsRef.current = sortedSegments;
  }, [sortedSegments]);
  const selectedSegment = useMemo(
    () => sortedSegments.find((segment) => segment.id === selectedSegmentId) ?? null,
    [sortedSegments, selectedSegmentId]
  );

  const clearSegmentCutMarks = useCallback((segmentId: string) => {
    setSegmentCutMarks((previous) => {
      if (!(segmentId in previous)) return previous;
      const next = { ...previous };
      delete next[segmentId];
      return next;
    });
  }, []);

  const setSegmentCutMark = useCallback(
    (segmentId: string, edge: "markInMs" | "markOutMs") => {
      const segment = sortedSegments.find((entry) => entry.id === segmentId);
      if (!segment) return;

      setSegmentCutMarks((previous) => ({
        ...previous,
        [segmentId]: {
          ...(previous[segmentId] ?? getDefaultSegmentCutMarkDraft()),
          [edge]: clampTimeToSegment(currentTimeMs, segment),
        },
      }));
      setSelectedSegmentId(segmentId);
      setError(null);
    },
    [currentTimeMs, sortedSegments]
  );

  useEffect(() => {
    setSegmentCutMarks((previous) => {
      const next: Record<string, SegmentCutMarkDraft> = {};
      let changed = false;

      for (const segment of sortedSegments) {
        const marks = previous[segment.id];
        if (!marks) continue;
        const clamped = clampSegmentCutMarkDraft(marks, segment);
        next[segment.id] = clamped;
        if (clamped.markInMs !== marks.markInMs || clamped.markOutMs !== marks.markOutMs) {
          changed = true;
        }
      }

      if (!changed && Object.keys(previous).length === Object.keys(next).length) {
        return previous;
      }

      return next;
    });
  }, [sortedSegments]);

  const resolveCutTarget = useCallback(
    (
      startTimeMs: number,
      endTimeMs: number
    ): { segment: SegmentDraft | null; reason: string | null } => {
      const overlappingSegments = sortedSegments.filter((segment) =>
        segmentOverlapsRange(segment, startTimeMs, endTimeMs)
      );

      if (selectedSegmentId) {
        const explicitSegment =
          sortedSegments.find((segment) => segment.id === selectedSegmentId) ?? null;
        if (!explicitSegment) {
          return { segment: null, reason: "Select a segment before adding a cut." };
        }
        if (!segmentOverlapsRange(explicitSegment, startTimeMs, endTimeMs)) {
          return { segment: null, reason: "Cut marks must overlap the selected segment." };
        }
        return { segment: explicitSegment, reason: null };
      }

      if (overlappingSegments.length === 1) {
        return { segment: overlappingSegments[0] ?? null, reason: null };
      }

      if (overlappingSegments.length > 1) {
        return {
          segment: null,
          reason:
            "Select a segment before adding a cut when multiple segments overlap the cut marks.",
        };
      }

      return { segment: null, reason: "Cut marks must overlap the selected segment." };
    },
    [selectedSegmentId, sortedSegments]
  );

  const timelineWidthPx = useMemo(() => {
    if (durationMs <= 0) return 1200;
    return Math.max(1200, Math.ceil((durationMs / 1000) * zoomPxPerSec));
  }, [durationMs, zoomPxPerSec]);

  const canSave =
    heroName.trim().length > 0 &&
    videoUri.trim().length > 0 &&
    sortedSegments.length > 0 &&
    durationMs > 0;
  const sourceSummary =
    sourceMode === "installed"
      ? "Installed source"
      : videoUri.startsWith("http://") || videoUri.startsWith("https://")
        ? "Website source"
        : "Local source";

  const createDraftFromInstalledRound = useCallback(
    (option: InstalledSourceOption): SegmentDraft | null => {
      if (option.startTimeMs === null || option.endTimeMs === null) return null;
      if (!Number.isFinite(option.startTimeMs) || !Number.isFinite(option.endTimeMs)) return null;
      if (option.endTimeMs <= option.startTimeMs) return null;
      return {
        id: createSegmentId(),
        startTimeMs: option.startTimeMs,
        endTimeMs: option.endTimeMs,
        cutRanges: toCutDrafts(option.cutRangesJson, option.startTimeMs, option.endTimeMs),
        type: option.type,
        customName: toCustomRoundName(option.roundName, option.heroName),
        excludeFromNumbering: option.excludeFromNumbering,
        bpm: option.bpm,
        difficulty: option.difficulty,
        bpmOverride: option.bpm !== null,
        difficultyOverride: option.difficulty !== null,
      };
    },
    []
  );

  /* ─── Data loading ─────────────────────────────────────────────── */

  const loadInstalledSources = useCallback(async () => {
    const rounds = await db.round.findInstalled(true);
    const options: InstalledSourceOption[] = rounds
      .flatMap((round: InstalledRound) => {
        const resource =
          round.resources.find((entry) => !entry.disabled && entry.videoUri.trim().length > 0) ??
          round.resources.find((entry) => entry.videoUri.trim().length > 0);
        if (!resource) return [];
        const heroLabel = round.hero?.name ? ` [${round.hero.name}]` : "";
        return [
          {
            id: round.id,
            heroId: round.heroId ?? null,
            label: `${round.name}${heroLabel}`,
            roundName: round.name,
            startTimeMs: round.startTime ?? null,
            endTimeMs: round.endTime ?? null,
            type: round.type,
            bpm: round.bpm ?? null,
            difficulty: round.difficulty ?? null,
            excludeFromNumbering: round.excludeFromNumbering ?? false,
            cutRangesJson: round.cutRangesJson ?? null,
            videoDurationMs: getRoundVideoDurationMs(round),
            videoUri: resource.videoUri,
            funscriptUri: resource.funscriptUri,
            heroName: round.hero?.name ?? null,
            heroAuthor: round.hero?.author ?? round.author ?? null,
            heroDescription: round.hero?.description ?? round.description ?? null,
            createdAt: round.createdAt,
            updatedAt: round.updatedAt,
          } satisfies InstalledSourceOption,
        ];
      })
      .sort((a, b) => a.label.localeCompare(b.label));
    setAllInstalledSourceOptions(options);
  }, []);

  const loadHeroes = useCallback(async () => {
    const heroes = await db.hero.findMany();
    const options = heroes
      .map((hero) => ({
        id: hero.id,
        label: hero.author?.trim() ? `${hero.name} - ${hero.author}` : hero.name,
        name: hero.name,
        author: hero.author ?? null,
        description: hero.description ?? null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    setHeroOptions(options);
  }, []);

  /* ─── Init effect ──────────────────────────────────────────────── */

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const [
          storedZoom,
          storedPauseGap,
          storedMinRound,
          storedAutoTrimRounds,
          storedTrimAllowance,
        ] = await Promise.all([
          trpc.store.get.query({ key: CONVERTER_ZOOM_KEY }),
          trpc.store.get.query({ key: CONVERTER_PAUSE_GAP_KEY }),
          trpc.store.get.query({ key: CONVERTER_MIN_ROUND_KEY }),
          trpc.store.get.query({ key: CONVERTER_AUTO_TRIM_ROUNDS_KEY }),
          trpc.store.get.query({ key: CONVERTER_TRIM_ALLOWANCE_KEY }),
        ]);

        if (!mounted) return;

        const parsedZoom = Number(storedZoom);
        if (Number.isFinite(parsedZoom)) {
          setZoomPxPerSec(clamp(Math.floor(parsedZoom), MIN_ZOOM_PX_PER_SEC, MAX_ZOOM_PX_PER_SEC));
        }

        const parsedPauseGap = Number(storedPauseGap);
        const resolvedPauseGap = Number.isFinite(parsedPauseGap)
          ? Math.max(100, Math.floor(parsedPauseGap))
          : DEFAULT_PAUSE_GAP_MS;
        setPauseGapMs(resolvedPauseGap);
        setPauseGapDraft(`${resolvedPauseGap}`);

        const parsedMinRound = Number(storedMinRound);
        const resolvedMinRound = Number.isFinite(parsedMinRound)
          ? Math.max(500, Math.floor(parsedMinRound))
          : DEFAULT_MIN_ROUND_MS;
        setMinRoundMs(resolvedMinRound);
        setMinRoundDraft(`${resolvedMinRound}`);

        setAutoTrimRounds(storedAutoTrimRounds === true || storedAutoTrimRounds === "true");

        const parsedTrimAllowance =
          storedTrimAllowance === null || storedTrimAllowance === undefined
            ? Number.NaN
            : Number(storedTrimAllowance);
        const resolvedTrimAllowance = Number.isFinite(parsedTrimAllowance)
          ? Math.max(0, Math.floor(parsedTrimAllowance))
          : DEFAULT_TRIM_ALLOWANCE_MS;
        setTrimAllowanceMs(resolvedTrimAllowance);
        setTrimAllowanceDraft(`${resolvedTrimAllowance}`);
      } catch {
        // Keep defaults.
      }

      try {
        await Promise.all([loadInstalledSources(), loadHeroes()]);
      } catch (loadError) {
        console.error("Failed to load converter selections", loadError);
      }
    };

    void load();

    return () => {
      mounted = false;
    };
  }, [loadHeroes, loadInstalledSources]);

  /* ─── Funscript timeline ───────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false;

    const loadTimeline = async () => {
      if (!funscriptUri) {
        setFunscriptActions([]);
        return;
      }

      try {
        const timeline = await loadFunscriptTimeline(funscriptUri);
        if (cancelled) return;
        setFunscriptActions(timeline?.actions ?? []);
      } catch {
        if (cancelled) return;
        setFunscriptActions([]);
      }
    };

    void loadTimeline();

    return () => {
      cancelled = true;
    };
  }, [funscriptUri]);

  /* ─── Persistence effects ──────────────────────────────────────── */

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void trpc.store.set
        .mutate({ key: CONVERTER_ZOOM_KEY, value: zoomPxPerSec })
        .catch((storeError) => console.warn("Failed to persist converter zoom", storeError));
    }, 250);
    return () => window.clearTimeout(handle);
  }, [zoomPxPerSec]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void trpc.store.set
        .mutate({ key: CONVERTER_PAUSE_GAP_KEY, value: pauseGapMs })
        .catch((storeError) => console.warn("Failed to persist pause gap", storeError));
      void trpc.store.set
        .mutate({ key: CONVERTER_MIN_ROUND_KEY, value: minRoundMs })
        .catch((storeError) => console.warn("Failed to persist min round", storeError));
      void trpc.store.set
        .mutate({ key: CONVERTER_AUTO_TRIM_ROUNDS_KEY, value: autoTrimRounds })
        .catch((storeError) => console.warn("Failed to persist auto trim rounds", storeError));
      void trpc.store.set
        .mutate({ key: CONVERTER_TRIM_ALLOWANCE_KEY, value: trimAllowanceMs })
        .catch((storeError) => console.warn("Failed to persist trim allowance", storeError));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [autoTrimRounds, minRoundMs, pauseGapMs, trimAllowanceMs]);

  /* ─── Draft commit helpers ─────────────────────────────────────── */

  const commitPauseGapDraft = useCallback(() => {
    const normalized = normalizeDetectionInput(pauseGapDraft, 100, DEFAULT_PAUSE_GAP_MS);
    setPauseGapMs(normalized);
    setPauseGapDraft(`${normalized}`);
    return normalized;
  }, [pauseGapDraft]);

  const commitMinRoundDraft = useCallback(() => {
    const normalized = normalizeDetectionInput(minRoundDraft, 500, DEFAULT_MIN_ROUND_MS);
    setMinRoundMs(normalized);
    setMinRoundDraft(`${normalized}`);
    return normalized;
  }, [minRoundDraft]);

  const commitTrimAllowanceDraft = useCallback(() => {
    const normalized = normalizeDetectionInput(trimAllowanceDraft, 0, DEFAULT_TRIM_ALLOWANCE_MS);
    setTrimAllowanceMs(normalized);
    setTrimAllowanceDraft(`${normalized}`);
    return normalized;
  }, [trimAllowanceDraft]);

  /* ─── Pointer drag for segment edges ───────────────────────────── */

  useEffect(() => {
    const stopAutoScroll = () => {
      if (dragAutoScrollFrameRef.current === null) return;
      window.cancelAnimationFrame(dragAutoScrollFrameRef.current);
      dragAutoScrollFrameRef.current = null;
    };

    const syncDraggedSegment = () => {
      const drag = dragStateRef.current;
      if (!drag || durationMs <= 0) return;

      const scrollLeft = timelineScrollRef.current?.scrollLeft ?? drag.initialScrollLeft;
      const deltaPx = drag.currentPointerX - drag.pointerX + (scrollLeft - drag.initialScrollLeft);
      const deltaMs = Math.round((deltaPx / zoomPxPerSec) * 1000);

      setSegments((previous) => {
        const sorted = sortSegments(previous);
        const index = sorted.findIndex((segment) => segment.id === drag.segmentId);
        if (index < 0) return previous;

        const segment = sorted[index];
        if (!segment) return previous;

        const prev = sorted[index - 1];
        const next = sorted[index + 1];
        const prevEnd = allowOverlappingSegments ? 0 : (prev?.endTimeMs ?? 0);
        const nextStart = allowOverlappingSegments ? durationMs : (next?.startTimeMs ?? durationMs);

        if (drag.edge === "start") {
          const firstCutStart = segment.cutRanges[0]?.startTimeMs ?? segment.endTimeMs;
          segment.startTimeMs = clamp(
            drag.initialStartTimeMs + deltaMs,
            prevEnd,
            Math.min(segment.endTimeMs - MIN_SEGMENT_MS, firstCutStart - MIN_SEGMENT_MS)
          );
        } else {
          const lastCutEnd =
            segment.cutRanges[segment.cutRanges.length - 1]?.endTimeMs ?? segment.startTimeMs;
          segment.endTimeMs = clamp(
            drag.initialEndTimeMs + deltaMs,
            Math.max(segment.startTimeMs + MIN_SEGMENT_MS, lastCutEnd + MIN_SEGMENT_MS),
            nextStart
          );
        }

        return [...sorted];
      });
    };

    const stepAutoScroll = () => {
      const drag = dragStateRef.current;
      const scrollContainer = timelineScrollRef.current;
      if (!drag || !scrollContainer || durationMs <= 0) {
        stopAutoScroll();
        return;
      }

      const rect = scrollContainer.getBoundingClientRect();
      const edgeThresholdPx = 64;
      const maxStepPx = 18;

      let scrollDelta = 0;
      if (drag.currentPointerX < rect.left + edgeThresholdPx) {
        const ratio = (rect.left + edgeThresholdPx - drag.currentPointerX) / edgeThresholdPx;
        scrollDelta = -Math.ceil(Math.min(1, ratio) * maxStepPx);
      } else if (drag.currentPointerX > rect.right - edgeThresholdPx) {
        const ratio = (drag.currentPointerX - (rect.right - edgeThresholdPx)) / edgeThresholdPx;
        scrollDelta = Math.ceil(Math.min(1, ratio) * maxStepPx);
      }

      if (scrollDelta !== 0) {
        const maxScrollLeft = Math.max(
          0,
          scrollContainer.scrollWidth - scrollContainer.clientWidth
        );
        const nextScrollLeft = clamp(scrollContainer.scrollLeft + scrollDelta, 0, maxScrollLeft);
        if (nextScrollLeft !== scrollContainer.scrollLeft) {
          scrollContainer.scrollLeft = nextScrollLeft;
          syncDraggedSegment();
          dragAutoScrollFrameRef.current = window.requestAnimationFrame(stepAutoScroll);
          return;
        }
      }

      stopAutoScroll();
    };

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag || durationMs <= 0) return;

      event.preventDefault();
      drag.currentPointerX = event.clientX;
      syncDraggedSegment();
      if (dragAutoScrollFrameRef.current === null) {
        dragAutoScrollFrameRef.current = window.requestAnimationFrame(stepAutoScroll);
      }
    };

    const onPointerUp = () => {
      stopAutoScroll();
      if (dragStateRef.current) {
        undoManagerRef.current.push(latestSegmentsRef.current);
        syncUndoState();
      }
      dragStateRef.current = null;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      stopAutoScroll();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [allowOverlappingSegments, durationMs, syncUndoState, zoomPxPerSec]);

  /* ─── Zoom helpers ─────────────────────────────────────────────── */

  const setZoomWithSfx = useCallback(
    (next: number) => {
      const clamped = clamp(Math.floor(next), MIN_ZOOM_PX_PER_SEC, MAX_ZOOM_PX_PER_SEC);
      if (clamped === zoomPxPerSec) return;

      const now = Date.now();
      if (now - lastZoomSoundAtRef.current > 120) {
        playConverterZoomSound();
        lastZoomSoundAtRef.current = now;
      }

      setZoomPxPerSec(clamped);
    },
    [zoomPxPerSec]
  );

  const zoomByFactor = useCallback(
    (factor: number) => {
      const next = clamp(
        Math.floor(zoomPxPerSec * factor),
        MIN_ZOOM_PX_PER_SEC,
        MAX_ZOOM_PX_PER_SEC
      );
      setZoomWithSfx(next);
    },
    [setZoomWithSfx, zoomPxPerSec]
  );

  /* ─── Seek / playback ──────────────────────────────────────────── */

  const seekToMs = useCallback(
    (timeMs: number) => {
      const safe = clamp(Math.floor(timeMs), 0, Math.max(0, durationMs));
      const video = videoRef.current;
      if (video) {
        video.currentTime = safe / 1000;
      }
      setCurrentTimeMs(safe);
    },
    [durationMs]
  );

  const syncPreviewTimeMs = useCallback(
    (timeMs: number) => {
      const video = videoRef.current;
      const skippedToSec = previewSkipsCuts
        ? getSkippedPreviewTimeSec(timeMs, sortedSegments)
        : null;
      if (video && skippedToSec !== null && !video.paused) {
        video.currentTime = skippedToSec;
        const skippedToMs = Math.floor(skippedToSec * 1000);
        setCurrentTimeMs(skippedToMs);
        return;
      }

      setCurrentTimeMs(timeMs);
    },
    [previewSkipsCuts, sortedSegments]
  );

  const jumpToRandomPoint = useCallback(() => {
    if (durationMs <= 0) {
      setError("Load a source video before jumping.");
      playConverterValidationErrorSound();
      return;
    }

    const targetMs = Math.floor(Math.random() * durationMs);
    seekToMs(targetMs);
    setError(null);
    setMessage(`Jumped to ${formatMs(targetMs)}.`);
    playSelectSound();
  }, [durationMs, seekToMs]);

  const togglePlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      try {
        await video.play();
      } catch (playError) {
        console.error("Failed to play converter video", playError);
      }
      return;
    }

    video.pause();
  }, []);

  /* ─── Segment auto-metadata ────────────────────────────────────── */

  const withAutoMetadata = useCallback(
    <T extends SegmentDraft>(nextSegments: T[]): T[] =>
      applyAutoMetadataToSegments(nextSegments, funscriptActions) as T[],
    [funscriptActions]
  );

  useEffect(() => {
    setSegments((previous) => sortSegments(withAutoMetadata(previous)));
  }, [withAutoMetadata]);

  /* ─── Segment CRUD ─────────────────────────────────────────────── */

  const applySegments = useCallback(
    (nextSegments: SegmentDraft[], pushUndo = true) => {
      if (durationMs <= 0) {
        setError("Load a source video before editing segments.");
        playConverterValidationErrorSound();
        return false;
      }

      const issue = validateSegments(nextSegments, durationMs, {
        allowOverlaps: allowOverlappingSegments,
      });
      if (issue) {
        setError(issue);
        playConverterValidationErrorSound();
        return false;
      }

      setError(null);
      const sorted = sortSegments(withAutoMetadata(nextSegments));
      if (pushUndo) {
        undoManagerRef.current.push(sorted);
        syncUndoState();
      }
      setSegments(sorted);
      return true;
    },
    [allowOverlappingSegments, durationMs, syncUndoState, withAutoMetadata]
  );

  const addSegmentFromMarks = useCallback(() => {
    if (markInMs === null || markOutMs === null) {
      setError("Set both IN and OUT marks before adding a segment.");
      playConverterValidationErrorSound();
      return;
    }

    const startTimeMs = Math.min(markInMs, markOutMs);
    const endTimeMs = Math.max(markInMs, markOutMs);
    if (endTimeMs - startTimeMs < MIN_SEGMENT_MS) {
      setError("Segment is too short.");
      playConverterValidationErrorSound();
      return;
    }

    const candidate: SegmentDraft = {
      id: createSegmentId(),
      startTimeMs,
      endTimeMs,
      cutRanges: [],
      type: "Normal",
      customName: null,
      excludeFromNumbering: false,
      bpm: null,
      difficulty: null,
      bpmOverride: false,
      difficultyOverride: false,
    };

    const next = [...segments, candidate];
    if (!applySegments(next)) return;

    setSelectedSegmentId(candidate.id);
    setMessage(`Segment added (${formatMs(startTimeMs)} - ${formatMs(endTimeMs)}).`);
    playConverterSegmentAddSound();
  }, [applySegments, markInMs, markOutMs, segments]);

  const applyCutToSegment = useCallback(
    (segmentId: string, startTimeMs: number, endTimeMs: number, source: "global" | "local") => {
      const targetSegment = segments.find((segment) => segment.id === segmentId) ?? null;
      if (!targetSegment) {
        setError(
          source === "local"
            ? "Segment timeline is no longer available."
            : "Select a segment before adding a cut."
        );
        playConverterValidationErrorSound();
        return false;
      }

      const boundedStartTimeMs = clamp(
        startTimeMs,
        targetSegment.startTimeMs,
        targetSegment.endTimeMs
      );
      const boundedEndTimeMs = clamp(endTimeMs, targetSegment.startTimeMs, targetSegment.endTimeMs);

      if (
        boundedStartTimeMs <= targetSegment.startTimeMs &&
        boundedEndTimeMs >= targetSegment.endTimeMs
      ) {
        const next = segments.filter((segment) => segment.id !== targetSegment.id);
        const sorted = sortSegments(withAutoMetadata(next));
        undoManagerRef.current.push(sorted);
        syncUndoState();
        setSegments(sorted);
        setSegmentCutMarks((previous) => {
          if (!(targetSegment.id in previous)) return previous;
          const nextMarks = { ...previous };
          delete nextMarks[targetSegment.id];
          return nextMarks;
        });
        if (selectedSegmentId === targetSegment.id) {
          setSelectedSegmentId(sorted[0]?.id ?? null);
        }
        setMessage(
          `Segment cut out (${formatMs(targetSegment.startTimeMs)} - ${formatMs(targetSegment.endTimeMs)}).`
        );
        setError(null);
        playConverterSegmentDeleteSound();
        return true;
      }

      let nextSelectedSegment: SegmentDraft = targetSegment;
      if (boundedStartTimeMs <= targetSegment.startTimeMs) {
        nextSelectedSegment = {
          ...targetSegment,
          startTimeMs: boundedEndTimeMs,
          cutRanges: targetSegment.cutRanges.filter((cut) => cut.endTimeMs > boundedEndTimeMs),
        };
      } else if (boundedEndTimeMs >= targetSegment.endTimeMs) {
        nextSelectedSegment = {
          ...targetSegment,
          endTimeMs: boundedStartTimeMs,
          cutRanges: targetSegment.cutRanges.filter((cut) => cut.startTimeMs < boundedStartTimeMs),
        };
      } else {
        const normalizedCuts = normalizeRoundCutRanges(
          [
            ...targetSegment.cutRanges,
            { id: createSegmentId(), startTimeMs: boundedStartTimeMs, endTimeMs: boundedEndTimeMs },
          ],
          targetSegment.startTimeMs,
          targetSegment.endTimeMs
        ).map((cut) => ({ ...cut, id: createSegmentId() }));
        nextSelectedSegment = { ...targetSegment, cutRanges: normalizedCuts };
      }

      const next = segments.map((segment) =>
        segment.id === targetSegment.id ? nextSelectedSegment : segment
      );
      if (!applySegments(next)) return false;

      setMessage(`Cut added (${formatMs(boundedStartTimeMs)} - ${formatMs(boundedEndTimeMs)}).`);
      setError(null);
      playConverterSegmentAddSound();
      return true;
    },
    [applySegments, segments, selectedSegmentId, syncUndoState, withAutoMetadata]
  );

  const addCutFromMarks = useCallback(() => {
    if (markInMs === null || markOutMs === null) {
      setError("Set both IN and OUT marks before adding a cut.");
      playConverterValidationErrorSound();
      return;
    }

    const startTimeMs = Math.min(markInMs, markOutMs);
    const endTimeMs = Math.max(markInMs, markOutMs);
    if (endTimeMs - startTimeMs < MIN_ROUND_CUT_MS) {
      setError("Cut is too short.");
      playConverterValidationErrorSound();
      return;
    }

    const { segment: targetSegment, reason } = resolveCutTarget(startTimeMs, endTimeMs);
    if (!targetSegment || reason) {
      setError(reason ?? "Select a segment before adding a cut.");
      playConverterValidationErrorSound();
      return;
    }

    void applyCutToSegment(targetSegment.id, startTimeMs, endTimeMs, "global");
  }, [applyCutToSegment, markInMs, markOutMs, resolveCutTarget]);

  const addCutToSegmentFromLocalMarks = useCallback(
    (segmentId: string) => {
      const marks = segmentCutMarks[segmentId] ?? getDefaultSegmentCutMarkDraft();
      if (marks.markInMs === null || marks.markOutMs === null) {
        setError("Set both local cut IN and OUT marks before cutting this segment.");
        playConverterValidationErrorSound();
        return;
      }

      const startTimeMs = Math.min(marks.markInMs, marks.markOutMs);
      const endTimeMs = Math.max(marks.markInMs, marks.markOutMs);
      if (endTimeMs - startTimeMs < MIN_ROUND_CUT_MS) {
        setError("Cut is too short.");
        playConverterValidationErrorSound();
        return;
      }

      const applied = applyCutToSegment(segmentId, startTimeMs, endTimeMs, "local");
      if (!applied) return;

      clearSegmentCutMarks(segmentId);
    },
    [applyCutToSegment, clearSegmentCutMarks, segmentCutMarks]
  );

  const removeCut = useCallback(
    (segmentId: string, cutId: string) => {
      const next = segments.map((segment) =>
        segment.id === segmentId
          ? { ...segment, cutRanges: segment.cutRanges.filter((cut) => cut.id !== cutId) }
          : segment
      );
      if (!applySegments(next)) return;
      setMessage("Cut removed.");
      setError(null);
      playConverterSegmentDeleteSound();
    },
    [applySegments, segments]
  );

  const removeSegment = useCallback(
    (segmentId: string) => {
      const next = segments.filter((segment) => segment.id !== segmentId);
      const sorted = sortSegments(withAutoMetadata(next));
      undoManagerRef.current.push(sorted);
      syncUndoState();
      setSegments(sorted);
      clearSegmentCutMarks(segmentId);
      if (selectedSegmentId === segmentId) {
        setSelectedSegmentId(next[0]?.id ?? null);
      }
      playConverterSegmentDeleteSound();
    },
    [clearSegmentCutMarks, segments, selectedSegmentId, syncUndoState, withAutoMetadata]
  );

  const setSegmentType = useCallback(
    (segmentId: string, type: SegmentType) => {
      setSegments((previous) => {
        const next = previous.map((segment) =>
          segment.id === segmentId ? { ...segment, type } : segment
        );
        undoManagerRef.current.push(next);
        syncUndoState();
        return next;
      });
    },
    [syncUndoState]
  );

  const setSegmentCustomName = useCallback(
    (segmentId: string, customName: string) => {
      setSegments((previous) => {
        const next = previous.map((segment) =>
          segment.id === segmentId ? { ...segment, customName } : segment
        );
        undoManagerRef.current.push(next);
        syncUndoState();
        return next;
      });
    },
    [syncUndoState]
  );

  const setSegmentExcludeFromNumbering = useCallback(
    (segmentId: string, excludeFromNumbering: boolean) => {
      setSegments((previous) => {
        const next = previous.map((segment) =>
          segment.id === segmentId ? { ...segment, excludeFromNumbering } : segment
        );
        undoManagerRef.current.push(next);
        syncUndoState();
        return next;
      });
    },
    [syncUndoState]
  );

  const setSegmentBpm = useCallback(
    (segmentId: string, rawValue: string) => {
      const bpm = normalizeOptionalNumberInput(rawValue, 1, 400, true);
      setSegments((previous) => {
        const next = previous.map((segment) =>
          segment.id === segmentId ? { ...segment, bpm, bpmOverride: true } : segment
        );
        undoManagerRef.current.push(next);
        syncUndoState();
        return next;
      });
    },
    [syncUndoState]
  );

  const resetSegmentBpm = useCallback(
    (segmentId: string) => {
      setSegments((previous) => {
        const next = sortSegments(
          withAutoMetadata(
            previous.map((segment) =>
              segment.id === segmentId ? { ...segment, bpmOverride: false } : segment
            )
          )
        );
        undoManagerRef.current.push(next);
        syncUndoState();
        return next;
      });
    },
    [syncUndoState, withAutoMetadata]
  );

  const setSegmentDifficulty = useCallback(
    (segmentId: string, rawValue: string) => {
      const difficulty = normalizeOptionalNumberInput(rawValue, 1, 5, true);
      setSegments((previous) => {
        const next = previous.map((segment) =>
          segment.id === segmentId ? { ...segment, difficulty, difficultyOverride: true } : segment
        );
        undoManagerRef.current.push(next);
        syncUndoState();
        return next;
      });
    },
    [syncUndoState]
  );

  const resetSegmentDifficulty = useCallback(
    (segmentId: string) => {
      setSegments((previous) => {
        const next = sortSegments(
          withAutoMetadata(
            previous.map((segment) =>
              segment.id === segmentId ? { ...segment, difficultyOverride: false } : segment
            )
          )
        );
        undoManagerRef.current.push(next);
        syncUndoState();
        return next;
      });
    },
    [syncUndoState, withAutoMetadata]
  );

  const updateSegmentTiming = useCallback(
    (segmentId: string, startTimeMs: number, endTimeMs: number) => {
      const next = segments.map((segment) =>
        segment.id === segmentId
          ? { ...segment, startTimeMs: Math.floor(startTimeMs), endTimeMs: Math.floor(endTimeMs) }
          : segment
      );
      void applySegments(next);
    },
    [applySegments, segments]
  );

  const nudgeSelectedSegment = useCallback(
    (amountMs: number) => {
      if (!selectedSegment) return;
      updateSegmentTiming(
        selectedSegment.id,
        selectedSegment.startTimeMs,
        selectedSegment.endTimeMs + amountMs
      );
    },
    [selectedSegment, updateSegmentTiming]
  );

  const moveSelectedSegmentStartToPlayhead = useCallback(() => {
    if (!selectedSegment) return;

    const sorted = sortSegments(segments);
    const index = sorted.findIndex((segment) => segment.id === selectedSegment.id);
    if (index < 0) return;

    const previousSegment = sorted[index - 1];
    const nextStartTimeMs = clamp(
      currentTimeMs,
      allowOverlappingSegments ? 0 : (previousSegment?.endTimeMs ?? 0),
      selectedSegment.endTimeMs - MIN_SEGMENT_MS
    );

    updateSegmentTiming(selectedSegment.id, nextStartTimeMs, selectedSegment.endTimeMs);
  }, [allowOverlappingSegments, currentTimeMs, segments, selectedSegment, updateSegmentTiming]);

  const moveSelectedSegmentEndToPlayhead = useCallback(() => {
    if (!selectedSegment) return;

    const sorted = sortSegments(segments);
    const index = sorted.findIndex((segment) => segment.id === selectedSegment.id);
    if (index < 0) return;

    const nextSegment = sorted[index + 1];
    const nextEndTimeMs = clamp(
      currentTimeMs,
      selectedSegment.startTimeMs + MIN_SEGMENT_MS,
      allowOverlappingSegments ? durationMs : (nextSegment?.startTimeMs ?? durationMs)
    );

    updateSegmentTiming(selectedSegment.id, selectedSegment.startTimeMs, nextEndTimeMs);
  }, [
    allowOverlappingSegments,
    currentTimeMs,
    durationMs,
    segments,
    selectedSegment,
    updateSegmentTiming,
  ]);

  const mergeSegmentWithNext = useCallback(
    (segmentId: string) => {
      const sorted = sortSegments(segments);
      const index = sorted.findIndex((segment) => segment.id === segmentId);
      if (index < 0 || index >= sorted.length - 1) {
        setError("This segment has no next segment to merge with.");
        playConverterValidationErrorSound();
        return;
      }

      const current = sorted[index];
      const next = sorted[index + 1];
      if (!current || !next) {
        setError("Failed to resolve adjacent segments.");
        playConverterValidationErrorSound();
        return;
      }

      const merged: SegmentDraft = {
        ...current,
        endTimeMs: next.endTimeMs,
        cutRanges: [...current.cutRanges, ...next.cutRanges],
      };
      const nextSegments = [...sorted.slice(0, index), merged, ...sorted.slice(index + 2)];
      if (!applySegments(nextSegments)) return;

      clearSegmentCutMarks(current.id);
      clearSegmentCutMarks(next.id);
      setSelectedSegmentId(merged.id);
      setMessage(`Merged round ${index + 1} with round ${index + 2}.`);
      setError(null);
      playConverterSegmentAddSound();
    },
    [applySegments, clearSegmentCutMarks, segments]
  );

  const splitSegmentAtPlayhead = useCallback(() => {
    const containingSelectedSegment =
      selectedSegment &&
      currentTimeMs > selectedSegment.startTimeMs &&
      currentTimeMs < selectedSegment.endTimeMs
        ? selectedSegment
        : null;
    const segmentToSplit =
      containingSelectedSegment ??
      segments.find(
        (segment) => currentTimeMs > segment.startTimeMs && currentTimeMs < segment.endTimeMs
      ) ??
      null;

    if (!segmentToSplit) {
      setError("Move the playhead inside a segment to split it.");
      playConverterValidationErrorSound();
      return;
    }

    if (
      segmentToSplit.cutRanges.some(
        (cut) => currentTimeMs > cut.startTimeMs && currentTimeMs < cut.endTimeMs
      )
    ) {
      setError("Move the playhead outside a cut before splitting.");
      playConverterValidationErrorSound();
      return;
    }

    const leftDurationMs = currentTimeMs - segmentToSplit.startTimeMs;
    const rightDurationMs = segmentToSplit.endTimeMs - currentTimeMs;
    if (leftDurationMs < MIN_SEGMENT_MS || rightDurationMs < MIN_SEGMENT_MS) {
      setError("Both split segments must be at least 100 ms long.");
      playConverterValidationErrorSound();
      return;
    }

    const splitSegment: SegmentDraft = {
      ...segmentToSplit,
      id: createSegmentId(),
      startTimeMs: currentTimeMs,
      cutRanges: segmentToSplit.cutRanges.filter((cut) => cut.startTimeMs >= currentTimeMs),
    };
    const nextSegments = segments.flatMap((segment) =>
      segment.id === segmentToSplit.id
        ? [
            {
              ...segment,
              endTimeMs: currentTimeMs,
              cutRanges: segment.cutRanges.filter((cut) => cut.endTimeMs <= currentTimeMs),
            },
            splitSegment,
          ]
        : [segment]
    );
    if (!applySegments(nextSegments)) return;

    clearSegmentCutMarks(segmentToSplit.id);
    setSelectedSegmentId(splitSegment.id);
    setMessage(`Split segment at ${formatMs(currentTimeMs)}.`);
    setError(null);
    playConverterSegmentAddSound();
  }, [applySegments, clearSegmentCutMarks, currentTimeMs, segments, selectedSegment]);

  const focusTargetSegmentCountInput = useCallback(() => {
    const input = targetSegmentCountInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  const focusTargetSegmentCountInputSoon = useCallback(() => {
    window.setTimeout(() => focusTargetSegmentCountInput(), 0);
  }, [focusTargetSegmentCountInput]);

  const clearMarks = useCallback(() => {
    if (markInMs === null && markOutMs === null) return false;
    setMarkInMs(null);
    setMarkOutMs(null);
    setMessage("Cleared IN/OUT marks.");
    setError(null);
    return true;
  }, [markInMs, markOutMs]);

  const clearSelection = useCallback(() => {
    if (!selectedSegmentId) return false;
    setSelectedSegmentId(null);
    setMessage("Cleared selected segment.");
    setError(null);
    return true;
  }, [selectedSegmentId]);

  const setSegmentCutMarkIn = useCallback(
    (segmentId: string) => {
      setSegmentCutMark(segmentId, "markInMs");
      playConverterMarkInSound();
    },
    [setSegmentCutMark]
  );

  const setSegmentCutMarkOut = useCallback(
    (segmentId: string) => {
      setSegmentCutMark(segmentId, "markOutMs");
      playConverterMarkOutSound();
    },
    [setSegmentCutMark]
  );

  const handleUndo = useCallback(() => {
    const nextState = undoManagerRef.current.undo();
    if (!nextState) {
      playConverterValidationErrorSound();
      return;
    }
    setSegments(nextState);
    setSegmentCutMarks((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([segmentId]) =>
          nextState.some((segment) => segment.id === segmentId)
        )
      )
    );
    syncUndoState();
    setMessage("Undo.");
    setError(null);
    playSelectSound();
  }, [syncUndoState]);

  const handleRedo = useCallback(() => {
    const nextState = undoManagerRef.current.redo();
    if (!nextState) {
      playConverterValidationErrorSound();
      return;
    }
    setSegments(nextState);
    setSegmentCutMarks((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([segmentId]) =>
          nextState.some((segment) => segment.id === segmentId)
        )
      )
    );
    syncUndoState();
    setMessage("Redo.");
    setError(null);
    playSelectSound();
  }, [syncUndoState]);

  const toggleHotkeys = useCallback(() => {
    setShowHotkeys((previous) => {
      const next = !previous;
      setMessage(next ? "Shortcut overlay shown." : "Shortcut overlay hidden.");
      setError(null);
      return next;
    });
  }, []);

  const showHotkeysOverlay = useCallback(() => {
    setShowHotkeys(true);
    setMessage("Shortcut overlay shown.");
    setError(null);
  }, []);

  const hideHotkeysOverlay = useCallback(() => {
    setShowHotkeys(false);
    setMessage("Shortcut overlay hidden.");
    setError(null);
  }, []);

  const clearTransientEditorState = useCallback(() => {
    if (showHotkeys) {
      hideHotkeysOverlay();
      return;
    }

    if (clearMarks()) return;
    clearSelection();
  }, [clearMarks, clearSelection, hideHotkeysOverlay, showHotkeys]);

  const selectNextSegment = useCallback(() => {
    if (sortedSegments.length === 0) {
      setError("No segments available to select.");
      playConverterValidationErrorSound();
      return;
    }

    const currentIndex = sortedSegments.findIndex((segment) => segment.id === selectedSegmentId);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % sortedSegments.length;
    const nextSegment = sortedSegments[nextIndex];
    if (!nextSegment) return;
    setSelectedSegmentId(nextSegment.id);
    setMessage(`Selected segment ${nextIndex + 1} of ${sortedSegments.length}.`);
    setError(null);
  }, [selectedSegmentId, sortedSegments]);

  const selectPreviousSegment = useCallback(() => {
    if (sortedSegments.length === 0) {
      setError("No segments available to select.");
      playConverterValidationErrorSound();
      return;
    }

    const currentIndex = sortedSegments.findIndex((segment) => segment.id === selectedSegmentId);
    const nextIndex =
      currentIndex < 0
        ? sortedSegments.length - 1
        : (currentIndex - 1 + sortedSegments.length) % sortedSegments.length;
    const nextSegment = sortedSegments[nextIndex];
    if (!nextSegment) return;
    setSelectedSegmentId(nextSegment.id);
    setMessage(`Selected segment ${nextIndex + 1} of ${sortedSegments.length}.`);
    setError(null);
  }, [selectedSegmentId, sortedSegments]);

  const selectSegmentAtPlayhead = useCallback(() => {
    if (
      selectedSegment &&
      currentTimeMs >= selectedSegment.startTimeMs &&
      currentTimeMs < selectedSegment.endTimeMs
    ) {
      const index = sortedSegments.findIndex((entry) => entry.id === selectedSegment.id);
      setMessage(`Selected segment ${index + 1} at ${formatMs(currentTimeMs)}.`);
      setError(null);
      return;
    }

    const segment = sortedSegments.find(
      (entry) => currentTimeMs >= entry.startTimeMs && currentTimeMs < entry.endTimeMs
    );
    if (!segment) {
      setError("No segment found at the current playhead position.");
      playConverterValidationErrorSound();
      return;
    }

    const index = sortedSegments.findIndex((entry) => entry.id === segment.id);
    setSelectedSegmentId(segment.id);
    setMessage(`Selected segment ${index + 1} at ${formatMs(currentTimeMs)}.`);
    setError(null);
  }, [currentTimeMs, selectedSegment, sortedSegments]);

  const seekToSelectedSegmentStart = useCallback(() => {
    if (!selectedSegment) {
      setError("Select a segment first.");
      playConverterValidationErrorSound();
      return;
    }

    seekToMs(selectedSegment.startTimeMs);
    setMessage(`Jumped to selected segment start (${formatMs(selectedSegment.startTimeMs)}).`);
    setError(null);
  }, [seekToMs, selectedSegment]);

  const seekToSelectedSegmentEnd = useCallback(() => {
    if (!selectedSegment) {
      setError("Select a segment first.");
      playConverterValidationErrorSound();
      return;
    }

    seekToMs(selectedSegment.endTimeMs);
    setMessage(`Jumped to selected segment end (${formatMs(selectedSegment.endTimeMs)}).`);
    setError(null);
  }, [seekToMs, selectedSegment]);

  /* ─── Auto-detection ───────────────────────────────────────────── */

  const runAutoDetect = useCallback(async () => {
    if (!funscriptUri) {
      setError("Attach a funscript to use automatic detection.");
      playConverterValidationErrorSound();
      return;
    }

    if (!durationMs) {
      setError("Load source video first.");
      playConverterValidationErrorSound();
      return;
    }

    setIsDetecting(true);
    setError(null);
    try {
      const effectivePauseGapMs = commitPauseGapDraft();
      const effectiveMinRoundMs = commitMinRoundDraft();
      const effectiveTrimAllowanceMs = commitTrimAllowanceDraft();
      const timeline = await loadFunscriptTimeline(funscriptUri);
      setFunscriptActions(timeline?.actions ?? []);
      const suggestions = buildDetectedSegments({
        actions: timeline?.actions ?? [],
        durationMs,
        pauseGapMs: effectivePauseGapMs,
        minRoundMs: effectiveMinRoundMs,
        autoTrimRounds,
        trimAllowanceMs: effectiveTrimAllowanceMs,
        defaultType: "Normal",
      }).map((segment) => ({
        ...segment,
        id: createSegmentId(),
        cutRanges: [],
        bpm: null,
        difficulty: null,
        excludeFromNumbering: false,
        bpmOverride: false,
        difficultyOverride: false,
      }));

      setDetectedSegments(
        applyAutoMetadataToSegments(suggestions, timeline?.actions ?? []) as SegmentDraft[]
      );
      setMessage(`Detected ${suggestions.length} candidate rounds.`);
      playConverterAutoDetectSound();
    } catch (detectError) {
      console.error("Auto-detection failed", detectError);
      setError("Failed to detect round boundaries from funscript.");
      playConverterValidationErrorSound();
    } finally {
      setIsDetecting(false);
    }
  }, [
    autoTrimRounds,
    commitMinRoundDraft,
    commitPauseGapDraft,
    commitTrimAllowanceDraft,
    durationMs,
    funscriptUri,
  ]);

  const runThreeMinutePauseDetectAndApply = useCallback(async () => {
    if (!funscriptUri) {
      setError("Attach a funscript to use automatic detection.");
      playConverterValidationErrorSound();
      return;
    }

    if (!durationMs) {
      setError("Load source video first.");
      playConverterValidationErrorSound();
      return;
    }

    setIsDetecting(true);
    setError(null);
    try {
      const effectivePauseGapMs = commitPauseGapDraft();
      const effectiveMinRoundMs = 60_000;
      const effectiveTrimAllowanceMs = commitTrimAllowanceDraft();
      setMinRoundMs(effectiveMinRoundMs);
      setMinRoundDraft(`${effectiveMinRoundMs}`);

      const timeline = await loadFunscriptTimeline(funscriptUri);
      const actions = timeline?.actions ?? [];
      setFunscriptActions(actions);
      const suggestions = buildDetectedSegments({
        actions,
        durationMs,
        pauseGapMs: effectivePauseGapMs,
        minRoundMs: effectiveMinRoundMs,
        autoTrimRounds,
        trimAllowanceMs: effectiveTrimAllowanceMs,
        defaultType: "Normal",
      }).map((segment) => ({
        ...segment,
        id: createSegmentId(),
        cutRanges: [],
        bpm: null,
        difficulty: null,
        excludeFromNumbering: false,
        bpmOverride: false,
        difficultyOverride: false,
      }));
      const nextSegments = applyAutoMetadataToSegments(suggestions, actions) as SegmentDraft[];

      setDetectedSegments(nextSegments);
      if (nextSegments.length === 0) {
        setMessage("Detected 0 candidate rounds with a 60 second minimum.");
        playConverterAutoDetectSound();
        return;
      }

      if (!applySegments(nextSegments)) return;
      setSelectedSegmentId(nextSegments[0]?.id ?? null);
      setMessage(`Applied ${nextSegments.length} detected segments with a 60 second minimum.`);
      playConverterSegmentAddSound();
    } catch (detectError) {
      console.error("Auto-detection failed", detectError);
      setError("Failed to detect round boundaries from funscript.");
      playConverterValidationErrorSound();
    } finally {
      setIsDetecting(false);
    }
  }, [
    applySegments,
    autoTrimRounds,
    commitPauseGapDraft,
    commitTrimAllowanceDraft,
    durationMs,
    funscriptUri,
  ]);

  const applyDetectedSuggestions = useCallback(() => {
    if (detectedSegments.length === 0) {
      setError("No detection suggestions available.");
      playConverterValidationErrorSound();
      return;
    }

    if (!applySegments(detectedSegments)) return;
    setSelectedSegmentId(detectedSegments[0]?.id ?? null);
    setMessage(`Applied ${detectedSegments.length} detected segments.`);
    playConverterSegmentAddSound();
  }, [applySegments, detectedSegments]);

  const trimExistingSegmentsToActions = useCallback(async () => {
    if (!funscriptUri) {
      setError("Attach a funscript before trimming existing sections.");
      playConverterValidationErrorSound();
      return;
    }
    if (durationMs <= 0 || segments.length === 0) {
      setError("Add at least one section before trimming.");
      playConverterValidationErrorSound();
      return;
    }

    setIsDetecting(true);
    setError(null);
    try {
      const allowanceMs = commitTrimAllowanceDraft();
      const timeline = await loadFunscriptTimeline(funscriptUri);
      const actions = timeline?.actions ?? [];
      setFunscriptActions(actions);
      let trimmedCount = 0;
      const nextSegments = segments.map((segment) => {
        const range = getActionTrimRange({
          actions,
          startTimeMs: segment.startTimeMs,
          endTimeMs: segment.endTimeMs,
          allowanceMs,
        });
        if (
          !range ||
          (range.startTimeMs === segment.startTimeMs && range.endTimeMs === segment.endTimeMs)
        ) {
          return segment;
        }

        trimmedCount += 1;
        const cutRanges = normalizeRoundCutRanges(
          segment.cutRanges.map((cut) => ({
            startTimeMs: Math.max(range.startTimeMs, cut.startTimeMs),
            endTimeMs: Math.min(range.endTimeMs, cut.endTimeMs),
          })),
          range.startTimeMs,
          range.endTimeMs
        ).map((cut) => ({ ...cut, id: createSegmentId() }));

        return {
          ...segment,
          ...range,
          cutRanges,
        };
      });

      if (trimmedCount === 0) {
        setMessage("Existing sections already match their action boundaries.");
        playConverterAutoDetectSound();
        return;
      }
      if (!applySegments(nextSegments)) return;

      setMessage(
        `Trimmed ${trimmedCount} existing ${trimmedCount === 1 ? "section" : "sections"}.`
      );
      playConverterSegmentAddSound();
    } catch (trimError) {
      console.error("Failed to trim existing converter sections", trimError);
      setError("Failed to trim existing sections from the funscript.");
      playConverterValidationErrorSound();
    } finally {
      setIsDetecting(false);
    }
  }, [applySegments, commitTrimAllowanceDraft, durationMs, funscriptUri, segments]);

  const runTargetCountAutoDetect = useCallback(async () => {
    if (!funscriptUri) {
      setError("Attach a funscript to use target detection.");
      playConverterValidationErrorSound();
      return;
    }

    if (!durationMs) {
      setError("Load source video first.");
      playConverterValidationErrorSound();
      return;
    }

    const targetCount = Number(targetSegmentCountDraft.trim());
    if (!Number.isFinite(targetCount) || targetCount < 1) {
      setError("Enter a target segment count before detecting.");
      playConverterValidationErrorSound();
      focusTargetSegmentCountInput();
      return;
    }

    setIsDetecting(true);
    setError(null);
    setTargetDetectionResultSummary(null);
    try {
      const timeline = await loadFunscriptTimeline(funscriptUri);
      const actions = timeline?.actions ?? [];
      setFunscriptActions(actions);
      const result = findDetectionSettingsForTargetCount({
        actions,
        durationMs,
        targetCount: Math.floor(targetCount),
        currentPauseGapMs: pauseGapMs,
        currentMinRoundMs: minRoundMs,
        autoTrimRounds,
        trimAllowanceMs,
        defaultType: "Normal",
      });

      if (result.status === "failure") {
        const closestText = result.closest
          ? ` Closest result was ${result.closest.segmentCount} segments.`
          : "";
        setError(
          `Could not detect exactly ${Math.floor(targetCount)} segments after ${result.evaluations} attempts.${closestText}`
        );
        setTargetDetectionResultSummary(
          result.closest
            ? `No exact match. Closest: ${result.closest.segmentCount} segments.`
            : "No exact match."
        );
        playConverterValidationErrorSound();
        return;
      }

      const suggestions = result.segments.map((segment) => ({
        ...segment,
        id: createSegmentId(),
        cutRanges: [],
        bpm: null,
        difficulty: null,
        excludeFromNumbering: false,
        bpmOverride: false,
        difficultyOverride: false,
      }));
      const nextSuggestions = applyAutoMetadataToSegments(suggestions, actions) as SegmentDraft[];
      setPauseGapMs(result.pauseGapMs);
      setPauseGapDraft(`${result.pauseGapMs}`);
      setMinRoundMs(result.minRoundMs);
      setMinRoundDraft(`${result.minRoundMs}`);
      setDetectedSegments(nextSuggestions);
      setTargetDetectionResultSummary(
        `Matched ${result.segments.length} segments with ${result.pauseGapMs} ms pause and ${result.minRoundMs} ms minimum.`
      );
      setMessage(
        `Detected exactly ${result.segments.length} target segments after ${result.evaluations} attempts.`
      );
      setError(null);
      playConverterAutoDetectSound();
    } catch (detectError) {
      console.error("Target auto-detection failed", detectError);
      setError("Failed to detect target round count from funscript.");
      playConverterValidationErrorSound();
    } finally {
      setIsDetecting(false);
    }
  }, [
    durationMs,
    autoTrimRounds,
    focusTargetSegmentCountInput,
    funscriptUri,
    minRoundMs,
    pauseGapMs,
    trimAllowanceMs,
    targetSegmentCountDraft,
  ]);

  const runAdaptiveAutoDetectAndApply = useCallback(async () => {
    if (!funscriptUri || durationMs <= 0) {
      setError("Load a source video with a funscript before detecting rounds.");
      playConverterValidationErrorSound();
      return;
    }

    const token = sourceLoadTokenRef.current;
    setIsDetecting(true);
    setError(null);
    try {
      const timeline = await loadFunscriptTimeline(funscriptUri);
      if (sourceLoadTokenRef.current !== token) return;
      const actions = timeline?.actions ?? [];
      const result = findAdaptiveDetectionSettings({
        actions,
        durationMs,
        currentPauseGapMs: pauseGapMs,
        currentMinRoundMs: minRoundMs,
        autoTrimRounds,
        trimAllowanceMs,
        defaultType: "Normal",
      });
      if (sourceLoadTokenRef.current !== token) return;
      setFunscriptActions(actions);
      if (result.segments.length < 2) {
        setMessage("Adaptive detection found no meaningful round split.");
        playConverterAutoDetectSound();
        return;
      }

      const nextSegments = applyAutoMetadataToSegments(
        result.segments.map((segment) => ({
          ...segment,
          id: createSegmentId(),
          cutRanges: [],
          customName: null,
          excludeFromNumbering: false,
          bpm: null,
          difficulty: null,
          bpmOverride: false,
          difficultyOverride: false,
        })),
        actions
      ) as SegmentDraft[];
      if (sourceLoadTokenRef.current !== token || !applySegments(nextSegments)) return;
      setPauseGapMs(result.pauseGapMs);
      setPauseGapDraft(`${result.pauseGapMs}`);
      setMinRoundMs(result.minRoundMs);
      setMinRoundDraft(`${result.minRoundMs}`);
      setSelectedSegmentId(nextSegments[0]?.id ?? null);
      setMessage(`Adaptively detected and applied ${nextSegments.length} rounds.`);
      playConverterSegmentAddSound();
    } catch (autoDetectError) {
      if (sourceLoadTokenRef.current !== token) return;
      console.error("Adaptive round detection failed", autoDetectError);
      setError("Adaptive detection could not read this round's funscript.");
      playConverterValidationErrorSound();
    } finally {
      if (sourceLoadTokenRef.current === token) setIsDetecting(false);
    }
  }, [
    applySegments,
    autoTrimRounds,
    durationMs,
    funscriptUri,
    minRoundMs,
    pauseGapMs,
    trimAllowanceMs,
  ]);

  /* ─── Source selection ─────────────────────────────────────────── */

  const chooseLocalVideo = useCallback(async () => {
    const path = await window.electronAPI.dialog.selectConverterVideoFile();
    if (!path) return;
    sourceLoadTokenRef.current += 1;

    const converted = window.electronAPI.file.convertFileSrc(path);
    setSourceMode("local");
    setDeleteSourceRound(false);
    setSelectedInstalledId("");
    setSourceRoundIdsToReplace([]);
    setVideoUri(converted);
    setFunscriptUri(null);
    setCurrentTimeMs(0);
    setDurationMs(0);
    setSegments([]);
    setSegmentCutMarks({});
    setDetectedSegments([]);
    setMarkInMs(null);
    setMarkOutMs(null);
    setMessage("Local source video selected.");
    setError(null);
  }, []);

  const chooseLocalFunscript = useCallback(async () => {
    const path = await window.electronAPI.dialog.selectConverterFunscriptFile();
    if (!path) return;
    const converted = window.electronAPI.file.convertFileSrc(path);
    setSourceMode("local");
    setDeleteSourceRound(false);
    setSourceRoundIdsToReplace([]);
    setFunscriptUri(converted);
    setMessage("Funscript attached.");
    setError(null);
  }, []);

  /* ─── Save ─────────────────────────────────────────────────────── */

  const saveConvertedRounds = useCallback(async () => {
    if (!canSave) {
      setError("Provide hero name, valid source, and at least one segment before saving.");
      playConverterValidationErrorSound();
      return;
    }
    if (segments.some((segment) => segment.excludeFromNumbering && !segment.customName?.trim())) {
      setError("Excluded segments need a custom round name before saving.");
      playConverterValidationErrorSound();
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      let segmentsToSave = sortSegments(withAutoMetadata(segments));
      if (funscriptUri && funscriptActions.length === 0) {
        const timeline = await loadFunscriptTimeline(funscriptUri);
        const loadedActions = timeline?.actions ?? [];
        setFunscriptActions(loadedActions);
        segmentsToSave = sortSegments(
          applyAutoMetadataToSegments(segmentsToSave, loadedActions) as SegmentDraft[]
        );
      }

      setSegments(segmentsToSave);

      const result = await converter.saveSegments({
        hero: {
          name: heroName.trim(),
          author: heroAuthor.trim() || null,
          description: heroDescription.trim() || null,
        },
        source: {
          videoUri,
          funscriptUri,
          sourceRoundId: sourceMode === "installed" ? selectedInstalledId || null : null,
          sourceRoundIds: sourceMode === "installed" ? sourceRoundIdsToReplace : [],
          removeSourceRound:
            sourceMode === "installed" && sourceRoundIdsToReplace.length > 0 && deleteSourceRound,
        },
        allowOverlaps: allowOverlappingSegments,
        segments: segmentsToSave.map((segment) => ({
          startTimeMs: segment.startTimeMs,
          endTimeMs: segment.endTimeMs,
          type: segment.type,
          customName: segment.customName?.trim() ? segment.customName.trim() : null,
          excludeFromNumbering: segment.excludeFromNumbering,
          bpm: segment.bpm ?? null,
          difficulty: segment.difficulty ?? null,
          cutRanges: segment.cutRanges.map((cut) => ({
            startTimeMs: cut.startTimeMs,
            endTimeMs: cut.endTimeMs,
          })),
        })),
      });

      const removedSourceCount = result.stats.removedSources ?? (result.removedSourceRound ? 1 : 0);
      const removedSourceText =
        removedSourceCount === 0
          ? "."
          : `, ${removedSourceCount} source round${removedSourceCount === 1 ? "" : "s"} removed.`;
      setMessage(
        `Saved ${result.stats.created} new and ${result.stats.updated} updated rounds${removedSourceText}`
      );
      playConverterSaveSuccessSound();
      await Promise.all([loadInstalledSources(), loadHeroes()]);
      if (result.removedSourceRound) {
        setSelectedInstalledId("");
        setSourceRoundIdsToReplace([]);
      }
    } catch (saveError) {
      console.error("Failed to save converted rounds", saveError);
      setError(saveError instanceof Error ? saveError.message : "Failed to save converted rounds.");
      playConverterValidationErrorSound();
    } finally {
      setIsSaving(false);
    }
  }, [
    allowOverlappingSegments,
    canSave,
    funscriptUri,
    heroAuthor,
    heroDescription,
    heroName,
    loadHeroes,
    loadInstalledSources,
    deleteSourceRound,
    selectedInstalledId,
    sourceRoundIdsToReplace,
    segments,
    sourceMode,
    funscriptActions,
    videoUri,
    withAutoMetadata,
  ]);

  /* ─── Timeline interaction helpers ─────────────────────────────── */

  const onTimelineWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey) return;
      event.preventDefault();

      const nextZoom = clamp(
        Math.floor(zoomPxPerSec * (event.deltaY < 0 ? 1.12 : 0.9)),
        MIN_ZOOM_PX_PER_SEC,
        MAX_ZOOM_PX_PER_SEC
      );
      if (nextZoom === zoomPxPerSec) return;

      const scrollContainer = timelineScrollRef.current;
      const previousPlayheadX = (currentTimeMs / 1000) * zoomPxPerSec;
      const nextPlayheadX = (currentTimeMs / 1000) * nextZoom;

      setZoomWithSfx(nextZoom);

      if (scrollContainer) {
        scrollContainer.scrollLeft += nextPlayheadX - previousPlayheadX;
      }
    },
    [currentTimeMs, setZoomWithSfx, zoomPxPerSec]
  );

  const onTimelinePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("button")) return;
      if (durationMs <= 0) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const localX = clamp(event.clientX - rect.left, 0, rect.width);
      const ratio = rect.width > 0 ? localX / rect.width : 0;
      seekToMs(Math.floor(ratio * durationMs));
      setError(null);
    },
    [durationMs, seekToMs]
  );

  /* ─── Computed selections ──────────────────────────────────────── */

  const selectedInstalledOption = useMemo(
    () => allInstalledSourceOptions.find((option) => option.id === selectedInstalledId) ?? null,
    [allInstalledSourceOptions, selectedInstalledId]
  );
  const installedSourceOptions = useMemo(
    () => allInstalledSourceOptions.filter((option) => option.heroId === null),
    [allInstalledSourceOptions]
  );
  const unconvertedSourceOptions = useMemo(
    () =>
      installedSourceOptions.filter((option) =>
        meetsMinimumVideoLength(option.videoDurationMs, minimumVideoLengthMinutes)
      ),
    [installedSourceOptions, minimumVideoLengthMinutes]
  );
  const currentUnconvertedIndex = useMemo(
    () => unconvertedSourceOptions.findIndex((option) => option.id === selectedInstalledId),
    [selectedInstalledId, unconvertedSourceOptions]
  );
  const unconvertedPositionLabel =
    currentUnconvertedIndex >= 0
      ? `Unconverted ${currentUnconvertedIndex + 1}/${unconvertedSourceOptions.length}`
      : unconvertedSourceOptions.length > 0
        ? `Unconverted ${unconvertedSourceOptions.length}`
        : null;
  const canLoadPreviousUnconverted = unconvertedSourceOptions.length > 0;
  const canLoadNextUnconverted = unconvertedSourceOptions.length > 0;
  const selectedHeroOption = useMemo(
    () => heroOptions.find((option) => option.id === selectedHeroId) ?? null,
    [heroOptions, selectedHeroId]
  );

  /* ─── Installed source auto-apply ──────────────────────────────── */

  useEffect(() => {
    if (!selectedInstalledOption) return;
    if (sourceMode !== "installed") return;

    setVideoUri(selectedInstalledOption.videoUri);
    setFunscriptUri(selectedInstalledOption.funscriptUri ?? null);
    setHeroName(selectedInstalledOption.heroName ?? selectedInstalledOption.roundName);
    setHeroAuthor(selectedInstalledOption.heroAuthor ?? "");
    setHeroDescription(selectedInstalledOption.heroDescription ?? "");
    setCurrentTimeMs(0);
    setDurationMs(0);
    const pendingSegments = pendingInstalledSegmentsRef.current;
    pendingInstalledSegmentsRef.current = null;
    setSegments(pendingSegments ?? []);
    setSegmentCutMarks({});
    setSelectedSegmentId(pendingSegments?.[0]?.id ?? null);
    setDetectedSegments([]);
    setMarkInMs(null);
    setMarkOutMs(null);
    const nextMessage =
      pendingInstalledLoadMessageRef.current ?? "Installed source loaded with existing metadata.";
    pendingInstalledLoadMessageRef.current = null;
    setMessage(nextMessage);
    setError(null);
  }, [selectedInstalledOption, sourceMode]);

  const loadSelectedHero = useCallback(() => {
    if (!selectedHeroOption) {
      setError("Select an existing hero first.");
      playConverterValidationErrorSound();
      return;
    }

    const candidateSources = allInstalledSourceOptions
      .filter((option) => option.heroId === selectedHeroOption.id)
      .sort((a, b) => {
        const createdAtDelta = a.createdAt.getTime() - b.createdAt.getTime();
        if (createdAtDelta !== 0) return createdAtDelta;
        return a.id.localeCompare(b.id);
      });

    const sourceOption = candidateSources[0];
    if (!sourceOption) {
      setError(`Hero "${selectedHeroOption.name}" has no attached round with usable resources.`);
      playConverterValidationErrorSound();
      return;
    }

    pendingInstalledSegmentsRef.current = sortSegments(
      candidateSources
        .map((option) => createDraftFromInstalledRound(option))
        .filter((segment): segment is SegmentDraft => segment !== null)
    );
    pendingInstalledLoadMessageRef.current = `Loaded hero "${selectedHeroOption.name}" from attached round "${sourceOption.label}".`;
    setSourceMode("installed");
    setDeleteSourceRound(true);
    setSelectedInstalledId(sourceOption.id);
    setSourceRoundIdsToReplace(candidateSources.map((option) => option.id));
    setHeroName(selectedHeroOption.name);
    setHeroAuthor(selectedHeroOption.author ?? "");
    setHeroDescription(selectedHeroOption.description ?? "");
    setError(null);
    playSelectSound();
  }, [allInstalledSourceOptions, createDraftFromInstalledRound, selectedHeroOption]);

  const setSelectedInstalledIdForReplacement = useCallback((id: string) => {
    setSelectedInstalledId(id);
    setSourceRoundIdsToReplace(id.trim().length > 0 ? [id] : []);
  }, []);

  const setSourceModeForReplacement = useCallback((mode: "local" | "installed") => {
    setSourceMode(mode);
    if (mode === "local") {
      setSourceRoundIdsToReplace([]);
    }
  }, []);

  const loadAdjacentUnconvertedRound = useCallback(
    async (direction: "next" | "previous", options?: { focusTargetInput?: boolean }) => {
      if (unconvertedSourceOptions.length === 0) {
        setError("No unconverted rounds are available.");
        playConverterValidationErrorSound();
        return;
      }

      const currentIndex = currentUnconvertedIndex;
      if (unconvertedSourceOptions.length === 1 && currentIndex >= 0) {
        setError("No other unconverted rounds.");
        playConverterValidationErrorSound();
        return;
      }

      const fallbackIndex = direction === "next" ? 0 : unconvertedSourceOptions.length - 1;
      const nextIndex =
        currentIndex < 0
          ? fallbackIndex
          : direction === "next"
            ? (currentIndex + 1) % unconvertedSourceOptions.length
            : (currentIndex - 1 + unconvertedSourceOptions.length) %
              unconvertedSourceOptions.length;
      const nextOption = unconvertedSourceOptions[nextIndex];
      if (!nextOption) return;

      await selectRoundAndEdit(nextOption.id);
      setMessage(
        `Loaded ${direction === "next" ? "next" : "previous"} unconverted round (${nextIndex + 1}/${unconvertedSourceOptions.length}).`
      );
      setError(null);
      if (options?.focusTargetInput) {
        focusTargetSegmentCountInputSoon();
      }
    },
    [
      currentUnconvertedIndex,
      focusTargetSegmentCountInputSoon,
      selectRoundAndEdit,
      unconvertedSourceOptions,
    ]
  );

  const loadNextUnconvertedRound = useCallback(
    (options?: { focusTargetInput?: boolean }) => loadAdjacentUnconvertedRound("next", options),
    [loadAdjacentUnconvertedRound]
  );

  const loadPreviousUnconvertedRound = useCallback(
    (options?: { focusTargetInput?: boolean }) => loadAdjacentUnconvertedRound("previous", options),
    [loadAdjacentUnconvertedRound]
  );

  /* ─── Preselect from search params ─────────────────────────────── */

  useEffect(() => {
    if (!preselectedSourceRoundId) return;
    if (hasAppliedPreselectedSourceRef.current) return;
    if (installedSourceOptions.length === 0) return;
    if (!installedSourceOptions.some((option) => option.id === preselectedSourceRoundId)) return;

    hasAppliedPreselectedSourceRef.current = true;
    void selectRoundAndEdit(preselectedSourceRoundId, { silent: true });
  }, [installedSourceOptions, preselectedSourceRoundId, selectRoundAndEdit]);

  /* ─── Timeline auto-scroll ─────────────────────────────────────── */

  useEffect(() => {
    const scrollContainer = timelineScrollRef.current;
    const video = videoRef.current;
    if (!scrollContainer || !video) return;
    if (durationMs <= 0 || timelineWidthPx <= 0) return;
    if (video.paused) return;

    const playheadX = (currentTimeMs / durationMs) * timelineWidthPx;
    const viewportWidth = scrollContainer.clientWidth;
    const followOffsetPx = viewportWidth * 0.45;
    const maxScrollLeft = Math.max(0, timelineWidthPx - viewportWidth);
    const targetScrollLeft = clamp(playheadX - followOffsetPx, 0, maxScrollLeft);

    scrollContainer.scrollLeft = targetScrollLeft;
  }, [currentTimeMs, durationMs, timelineWidthPx]);

  /* ─── Keyboard shortcuts ───────────────────────────────────────── */

  const shortcutContext = useMemo<ConverterShortcutContext>(
    () => ({
      showHotkeys,
      toggleHotkeys,
      clearTransientEditorState,
      togglePlayback,
      setMarkInAtPlayhead: () => {
        setMarkInMs(currentTimeMs);
        playConverterMarkInSound();
      },
      setMarkOutAtPlayhead: () => {
        setMarkOutMs(currentTimeMs);
        playConverterMarkOutSound();
      },
      addSegmentFromMarks,
      addCutFromMarks,
      deleteSelectedSegment: () => {
        if (!selectedSegmentId) return;
        removeSegment(selectedSegmentId);
      },
      setSelectedSegmentType: (type) => {
        if (!selectedSegmentId) return;
        setSegmentType(selectedSegmentId, type);
      },
      seekByMs: (amountMs) => seekToMs(currentTimeMs + amountMs),
      nudgeSelectedSegment,
      moveSelectedSegmentStartToPlayhead,
      moveSelectedSegmentEndToPlayhead,
      zoomByFactor,
      resetZoom: () => setZoomWithSfx(DEFAULT_ZOOM_PX_PER_SEC),
      jumpToRandomPoint,
      splitSegmentAtPlayhead,
      selectNextSegment,
      selectPreviousSegment,
      selectSegmentAtPlayhead,
      seekToSelectedSegmentStart,
      seekToSelectedSegmentEnd,
      mergeSelectedSegmentWithNext: () => {
        if (!selectedSegmentId) return;
        mergeSegmentWithNext(selectedSegmentId);
      },
      runAutoDetect,
      runTargetCountAutoDetect,
      focusTargetSegmentCountInput,
      loadNextUnconvertedRound,
      loadPreviousUnconvertedRound,
      applyDetectedSuggestions,
      saveConvertedRounds,
      undo: handleUndo,
      redo: handleRedo,
    }),
    [
      addSegmentFromMarks,
      addCutFromMarks,
      applyDetectedSuggestions,
      clearTransientEditorState,
      currentTimeMs,
      focusTargetSegmentCountInput,
      handleUndo,
      handleRedo,
      jumpToRandomPoint,
      loadNextUnconvertedRound,
      loadPreviousUnconvertedRound,
      mergeSegmentWithNext,
      moveSelectedSegmentEndToPlayhead,
      moveSelectedSegmentStartToPlayhead,
      nudgeSelectedSegment,
      removeSegment,
      runAutoDetect,
      runTargetCountAutoDetect,
      saveConvertedRounds,
      seekToMs,
      seekToSelectedSegmentEnd,
      seekToSelectedSegmentStart,
      selectNextSegment,
      selectPreviousSegment,
      selectSegmentAtPlayhead,
      selectedSegmentId,
      setSegmentType,
      setZoomWithSfx,
      showHotkeys,
      splitSegmentAtPlayhead,
      toggleHotkeys,
      togglePlayback,
      zoomByFactor,
    ]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isExplicitAltConverterShortcut =
        event.altKey &&
        (event.key === "t" ||
          event.key === "T" ||
          event.key === "ArrowLeft" ||
          event.key === "ArrowRight");
      const isTargetCountInput = event.target === targetSegmentCountInputRef.current;
      const isTargetCountActionShortcut =
        isTargetCountInput &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        (event.key === "a" || event.key === "A" || event.key === "t" || event.key === "T");
      if (
        isEditableTarget(event.target) &&
        !isExplicitAltConverterShortcut &&
        !isTargetCountActionShortcut
      ) {
        return;
      }
      if (event.repeat) return;

      const shortcut = CONVERTER_SHORTCUTS.find((candidate) => candidate.matches(event));
      if (!shortcut) return;

      event.preventDefault();
      shortcut.trigger(shortcutContext);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [shortcutContext]);

  return {
    // Refs
    videoRef,
    timelineScrollRef,
    targetSegmentCountInputRef,
    dragStateRef,

    // Step navigation
    step,
    selectedSourceInfo,
    goToSelectStep,
    selectRoundAndEdit,
    selectHeroAndEdit,
    selectLocalAndEdit,
    selectWebsiteAndEdit,
    attachLocalFunscript,

    // Caching
    cachingUrl,
    cachingProgress,
    cachingError,
    cancelCaching,
    retryCaching,

    // Source
    sourceMode,
    setSourceMode: setSourceModeForReplacement,
    videoUri,
    funscriptUri,
    setVideoUri,
    setFunscriptUri,
    installedSourceOptions,
    selectedInstalledId,
    setSelectedInstalledId: setSelectedInstalledIdForReplacement,
    selectedInstalledOption,
    deleteSourceRound,
    setDeleteSourceRound,
    chooseLocalVideo,
    chooseLocalFunscript,

    // Hero
    heroOptions,
    selectedHeroId,
    setSelectedHeroId,
    selectedHeroOption,
    heroName,
    setHeroName,
    heroAuthor,
    setHeroAuthor,
    heroDescription,
    setHeroDescription,
    loadSelectedHero,

    // Video / timeline
    durationMs,
    setDurationMs,
    currentTimeMs,
    setCurrentTimeMs,
    syncPreviewTimeMs,
    previewSkipsCuts,
    setPreviewSkipsCuts,
    markInMs,
    setMarkInMs,
    markOutMs,
    setMarkOutMs,
    zoomPxPerSec,
    timelineWidthPx,
    funscriptActions,
    getVideoSrc,
    ensurePlayableVideo,
    handleVideoError,
    togglePlayback,
    seekToMs,
    jumpToRandomPoint,
    setZoomWithSfx,
    onTimelineWheel,
    onTimelinePointerDown,

    // Segments
    sortedSegments,
    selectedSegmentId,
    setSelectedSegmentId,
    selectedSegment,
    allowOverlappingSegments,
    setAllowOverlappingSegments,
    addSegmentFromMarks,
    addCutFromMarks,
    segmentCutMarks,
    setSegmentCutMarkIn,
    setSegmentCutMarkOut,
    clearSegmentCutMarks,
    addCutToSegmentFromLocalMarks,
    removeSegment,
    removeCut,
    setSegmentType,
    setSegmentCustomName,
    setSegmentExcludeFromNumbering,
    setSegmentBpm,
    resetSegmentBpm,
    setSegmentDifficulty,
    resetSegmentDifficulty,
    updateSegmentTiming,
    nudgeSelectedSegment,
    moveSelectedSegmentStartToPlayhead,
    moveSelectedSegmentEndToPlayhead,
    selectNextSegment,
    selectPreviousSegment,
    selectSegmentAtPlayhead,
    seekToSelectedSegmentStart,
    seekToSelectedSegmentEnd,
    clearMarks,
    clearSelection,
    clearTransientEditorState,
    mergeSegmentWithNext,
    splitSegmentAtPlayhead,

    // Detection
    detectedSegments,
    pauseGapDraft,
    setPauseGapDraft,
    minRoundDraft,
    setMinRoundDraft,
    autoTrimRounds,
    setAutoTrimRounds,
    trimAllowanceDraft,
    setTrimAllowanceDraft,
    commitPauseGapDraft,
    commitMinRoundDraft,
    commitTrimAllowanceDraft,
    isDetecting,
    runAutoDetect,
    runAdaptiveAutoDetectAndApply,
    runTargetCountAutoDetect,
    runThreeMinutePauseDetectAndApply,
    targetSegmentCountDraft,
    setTargetSegmentCountDraft,
    targetDetectionResultSummary,
    applyDetectedSuggestions,
    trimExistingSegmentsToActions,

    // Save
    canSave,
    isSaving,
    saveConvertedRounds,

    // UI
    sourceSummary,
    message,
    error,
    showHotkeys,
    toggleHotkeys,
    showHotkeysOverlay,
    hideHotkeysOverlay,
    canLoadPreviousUnconverted,
    canLoadNextUnconverted,
    unconvertedPositionLabel,
    loadNextUnconvertedRound,
    loadPreviousUnconvertedRound,
    focusTargetSegmentCountInput,

    // Undo/Redo
    canUndo: canUndoState,
    canRedo: canRedoState,
    undo: handleUndo,
    redo: handleRedo,
  };
}
