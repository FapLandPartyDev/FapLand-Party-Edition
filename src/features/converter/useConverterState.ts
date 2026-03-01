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
import { buildDetectedSegments } from "./detection";
import { applyAutoMetadataToSegments } from "./metadata";
import {
    clamp,
    CONVERTER_MIN_ROUND_KEY,
    CONVERTER_PAUSE_GAP_KEY,
    CONVERTER_ZOOM_KEY,
    createSegmentId,
    DEFAULT_MIN_ROUND_MS,
    DEFAULT_PAUSE_GAP_MS,
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
    type SegmentDraft,
    type SegmentType,
} from "./types";
import { usePlayableVideoFallback } from "../../hooks/usePlayableVideoFallback";

type ConverterSearchParams = {
    sourceRoundId: string;
    heroName: string;
};

export type ConverterState = ReturnType<typeof useConverterState>;

export function useConverterState(searchParams: ConverterSearchParams) {
    const { sourceRoundId: preselectedSourceRoundId, heroName: prefilledHeroName } = searchParams;

    const videoRef = useRef<HTMLVideoElement>(null);
    const timelineScrollRef = useRef<HTMLDivElement>(null);
    const lastZoomSoundAtRef = useRef(0);
    const dragStateRef = useRef<DragState | null>(null);
    const pendingInstalledLoadMessageRef = useRef<string | null>(null);
    const pendingInstalledSegmentsRef = useRef<SegmentDraft[] | null>(null);

    const [sourceMode, setSourceMode] = useState<"local" | "installed">("local");
    const [videoUri, setVideoUri] = useState("");
    const [funscriptUri, setFunscriptUri] = useState<string | null>(null);
    const [installedSourceOptions, setInstalledSourceOptions] = useState<InstalledSourceOption[]>([]);
    const [selectedInstalledId, setSelectedInstalledId] = useState("");
    const [heroOptions, setHeroOptions] = useState<HeroOption[]>([]);
    const [selectedHeroId, setSelectedHeroId] = useState("");

    const [durationMs, setDurationMs] = useState(0);
    const [currentTimeMs, setCurrentTimeMs] = useState(0);
    const [markInMs, setMarkInMs] = useState<number | null>(null);
    const [markOutMs, setMarkOutMs] = useState<number | null>(null);

    const [segments, setSegments] = useState<SegmentDraft[]>([]);
    const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
    const [detectedSegments, setDetectedSegments] = useState<SegmentDraft[]>([]);
    const [funscriptActions, setFunscriptActions] = useState<FunscriptAction[]>([]);

    const [zoomPxPerSec, setZoomPxPerSec] = useState(DEFAULT_ZOOM_PX_PER_SEC);
    const [pauseGapMs, setPauseGapMs] = useState(DEFAULT_PAUSE_GAP_MS);
    const [minRoundMs, setMinRoundMs] = useState(DEFAULT_MIN_ROUND_MS);
    const [pauseGapDraft, setPauseGapDraft] = useState(`${DEFAULT_PAUSE_GAP_MS}`);
    const [minRoundDraft, setMinRoundDraft] = useState(`${DEFAULT_MIN_ROUND_MS}`);

    const [heroName, setHeroName] = useState("");
    const [heroAuthor, setHeroAuthor] = useState("");
    const [heroDescription, setHeroDescription] = useState("");
    const [deleteSourceRound, setDeleteSourceRound] = useState(true);

    const [isSaving, setIsSaving] = useState(false);
    const [isDetecting, setIsDetecting] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [showHotkeys, setShowHotkeys] = useState(false);
    const { getVideoSrc, ensurePlayableVideo, handleVideoError } = usePlayableVideoFallback();

    const sortedSegments = useMemo(() => sortSegments(segments), [segments]);
    const selectedSegment = useMemo(
        () => sortedSegments.find((segment) => segment.id === selectedSegmentId) ?? null,
        [sortedSegments, selectedSegmentId],
    );

    const timelineWidthPx = useMemo(() => {
        if (durationMs <= 0) return 1200;
        return Math.max(1200, Math.ceil((durationMs / 1000) * zoomPxPerSec));
    }, [durationMs, zoomPxPerSec]);

    const canSave = heroName.trim().length > 0 && videoUri.trim().length > 0 && sortedSegments.length > 0 && durationMs > 0;
    const sourceSummary = sourceMode === "installed" ? "Installed source" : "Local source";

    const createDraftFromInstalledRound = useCallback((option: InstalledSourceOption): SegmentDraft | null => {
        if (option.startTimeMs === null || option.endTimeMs === null) return null;
        if (!Number.isFinite(option.startTimeMs) || !Number.isFinite(option.endTimeMs)) return null;
        if (option.endTimeMs <= option.startTimeMs) return null;
        return {
            id: createSegmentId(),
            startTimeMs: option.startTimeMs,
            endTimeMs: option.endTimeMs,
            type: option.type,
            customName: option.roundName,
            bpm: option.bpm,
            difficulty: option.difficulty,
            bpmOverride: option.bpm !== null,
            difficultyOverride: option.difficulty !== null,
        };
    }, []);

    /* ─── Data loading ─────────────────────────────────────────────── */

    const loadInstalledSources = useCallback(async () => {
        const rounds = await db.round.findInstalled(true);
        const options: InstalledSourceOption[] = rounds
            .flatMap((round: InstalledRound) => {
                const resource = round.resources.find((entry) => !entry.disabled && entry.videoUri.trim().length > 0)
                    ?? round.resources.find((entry) => entry.videoUri.trim().length > 0);
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
        setInstalledSourceOptions(options);
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
                const [storedZoom, storedPauseGap, storedMinRound] = await Promise.all([
                    trpc.store.get.query({ key: CONVERTER_ZOOM_KEY }),
                    trpc.store.get.query({ key: CONVERTER_PAUSE_GAP_KEY }),
                    trpc.store.get.query({ key: CONVERTER_MIN_ROUND_KEY }),
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
        }, 300);
        return () => window.clearTimeout(handle);
    }, [minRoundMs, pauseGapMs]);

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

    /* ─── Pointer drag for segment edges ───────────────────────────── */

    useEffect(() => {
        const onPointerMove = (event: PointerEvent) => {
            const drag = dragStateRef.current;
            if (!drag || durationMs <= 0) return;

            event.preventDefault();
            const deltaPx = event.clientX - drag.pointerX;
            const deltaMs = Math.round((deltaPx / zoomPxPerSec) * 1000);

            setSegments((previous) => {
                const sorted = sortSegments(previous);
                const index = sorted.findIndex((segment) => segment.id === drag.segmentId);
                if (index < 0) return previous;

                const segment = sorted[index];
                if (!segment) return previous;

                const prev = sorted[index - 1];
                const next = sorted[index + 1];
                const prevEnd = prev?.endTimeMs ?? 0;
                const nextStart = next?.startTimeMs ?? durationMs;

                if (drag.edge === "start") {
                    segment.startTimeMs = clamp(
                        drag.initialStartTimeMs + deltaMs,
                        prevEnd,
                        segment.endTimeMs - MIN_SEGMENT_MS,
                    );
                } else {
                    segment.endTimeMs = clamp(
                        drag.initialEndTimeMs + deltaMs,
                        segment.startTimeMs + MIN_SEGMENT_MS,
                        nextStart,
                    );
                }

                return [...sorted];
            });
        };

        const onPointerUp = () => {
            dragStateRef.current = null;
        };

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);

        return () => {
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
        };
    }, [durationMs, zoomPxPerSec]);

    /* ─── Zoom helpers ─────────────────────────────────────────────── */

    const setZoomWithSfx = useCallback((next: number) => {
        const clamped = clamp(Math.floor(next), MIN_ZOOM_PX_PER_SEC, MAX_ZOOM_PX_PER_SEC);
        if (clamped === zoomPxPerSec) return;

        const now = Date.now();
        if (now - lastZoomSoundAtRef.current > 120) {
            playConverterZoomSound();
            lastZoomSoundAtRef.current = now;
        }

        setZoomPxPerSec(clamped);
    }, [zoomPxPerSec]);

    const zoomByFactor = useCallback((factor: number) => {
        const next = clamp(Math.floor(zoomPxPerSec * factor), MIN_ZOOM_PX_PER_SEC, MAX_ZOOM_PX_PER_SEC);
        setZoomWithSfx(next);
    }, [setZoomWithSfx, zoomPxPerSec]);

    /* ─── Seek / playback ──────────────────────────────────────────── */

    const seekToMs = useCallback((timeMs: number) => {
        const safe = clamp(Math.floor(timeMs), 0, Math.max(0, durationMs));
        const video = videoRef.current;
        if (video) {
            video.currentTime = safe / 1000;
        }
        setCurrentTimeMs(safe);
    }, [durationMs]);

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
        [funscriptActions],
    );

    useEffect(() => {
        setSegments((previous) => sortSegments(withAutoMetadata(previous)));
    }, [withAutoMetadata]);

    /* ─── Segment CRUD ─────────────────────────────────────────────── */

    const applySegments = useCallback((nextSegments: SegmentDraft[]) => {
        if (durationMs <= 0) {
            setError("Load a source video before editing segments.");
            playConverterValidationErrorSound();
            return false;
        }

        const issue = validateSegments(nextSegments, durationMs);
        if (issue) {
            setError(issue);
            playConverterValidationErrorSound();
            return false;
        }

        setError(null);
        setSegments(sortSegments(withAutoMetadata(nextSegments)));
        return true;
    }, [durationMs, withAutoMetadata]);

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
            type: "Normal",
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

    const removeSegment = useCallback((segmentId: string) => {
        const next = segments.filter((segment) => segment.id !== segmentId);
        setSegments(sortSegments(withAutoMetadata(next)));
        if (selectedSegmentId === segmentId) {
            setSelectedSegmentId(next[0]?.id ?? null);
        }
        playConverterSegmentDeleteSound();
    }, [segments, selectedSegmentId, withAutoMetadata]);

    const setSegmentType = useCallback((segmentId: string, type: SegmentType) => {
        setSegments((previous) =>
            previous.map((segment) => (segment.id === segmentId ? { ...segment, type } : segment)),
        );
    }, []);

    const setSegmentCustomName = useCallback((segmentId: string, customName: string) => {
        setSegments((previous) =>
            previous.map((segment) =>
                segment.id === segmentId ? { ...segment, customName } : segment,
            ),
        );
    }, []);

    const setSegmentBpm = useCallback((segmentId: string, rawValue: string) => {
        const bpm = normalizeOptionalNumberInput(rawValue, 1, 400, true);
        setSegments((previous) =>
            previous.map((segment) =>
                segment.id === segmentId ? { ...segment, bpm, bpmOverride: true } : segment,
            ),
        );
    }, []);

    const resetSegmentBpm = useCallback((segmentId: string) => {
        setSegments((previous) =>
            sortSegments(
                withAutoMetadata(
                    previous.map((segment) =>
                        segment.id === segmentId ? { ...segment, bpmOverride: false } : segment,
                    ),
                ),
            ),
        );
    }, [withAutoMetadata]);

    const setSegmentDifficulty = useCallback((segmentId: string, rawValue: string) => {
        const difficulty = normalizeOptionalNumberInput(rawValue, 1, 5, true);
        setSegments((previous) =>
            previous.map((segment) =>
                segment.id === segmentId ? { ...segment, difficulty, difficultyOverride: true } : segment,
            ),
        );
    }, []);

    const resetSegmentDifficulty = useCallback((segmentId: string) => {
        setSegments((previous) =>
            sortSegments(
                withAutoMetadata(
                    previous.map((segment) =>
                        segment.id === segmentId ? { ...segment, difficultyOverride: false } : segment,
                    ),
                ),
            ),
        );
    }, [withAutoMetadata]);

    const updateSegmentTiming = useCallback((segmentId: string, startTimeMs: number, endTimeMs: number) => {
        const next = segments.map((segment) =>
            segment.id === segmentId
                ? { ...segment, startTimeMs: Math.floor(startTimeMs), endTimeMs: Math.floor(endTimeMs) }
                : segment,
        );
        void applySegments(next);
    }, [applySegments, segments]);

    const nudgeSelectedSegment = useCallback((amountMs: number) => {
        if (!selectedSegment) return;
        updateSegmentTiming(
            selectedSegment.id,
            selectedSegment.startTimeMs,
            selectedSegment.endTimeMs + amountMs,
        );
    }, [selectedSegment, updateSegmentTiming]);

    const mergeSegmentWithNext = useCallback((segmentId: string) => {
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

        const merged: SegmentDraft = { ...current, endTimeMs: next.endTimeMs };
        const nextSegments = [...sorted.slice(0, index), merged, ...sorted.slice(index + 2)];
        if (!applySegments(nextSegments)) return;

        setSelectedSegmentId(merged.id);
        setMessage(`Merged round ${index + 1} with round ${index + 2}.`);
        setError(null);
        playConverterSegmentAddSound();
    }, [applySegments, segments]);

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
            const timeline = await loadFunscriptTimeline(funscriptUri);
            setFunscriptActions(timeline?.actions ?? []);
            const suggestions = buildDetectedSegments({
                actions: timeline?.actions ?? [],
                durationMs,
                pauseGapMs: effectivePauseGapMs,
                minRoundMs: effectiveMinRoundMs,
                defaultType: "Normal",
            }).map((segment) => ({
                ...segment,
                id: createSegmentId(),
                bpm: null,
                difficulty: null,
                bpmOverride: false,
                difficultyOverride: false,
            }));

            setDetectedSegments(applyAutoMetadataToSegments(suggestions, timeline?.actions ?? []) as SegmentDraft[]);
            setMessage(`Detected ${suggestions.length} candidate rounds.`);
            playConverterAutoDetectSound();
        } catch (detectError) {
            console.error("Auto-detection failed", detectError);
            setError("Failed to detect round boundaries from funscript.");
            playConverterValidationErrorSound();
        } finally {
            setIsDetecting(false);
        }
    }, [commitMinRoundDraft, commitPauseGapDraft, durationMs, funscriptUri]);

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

    /* ─── Source selection ─────────────────────────────────────────── */

    const chooseLocalVideo = useCallback(async () => {
        const path = await window.electronAPI.dialog.selectConverterVideoFile();
        if (!path) return;

        const converted = window.electronAPI.file.convertFileSrc(path);
        setSourceMode("local");
        setDeleteSourceRound(false);
        setSelectedInstalledId("");
        setVideoUri(converted);
        setFunscriptUri(null);
        setCurrentTimeMs(0);
        setDurationMs(0);
        setSegments([]);
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

        setIsSaving(true);
        setError(null);

        try {
            let segmentsToSave = sortSegments(withAutoMetadata(segments));
            if (funscriptUri && funscriptActions.length === 0) {
                const timeline = await loadFunscriptTimeline(funscriptUri);
                const loadedActions = timeline?.actions ?? [];
                setFunscriptActions(loadedActions);
                segmentsToSave = sortSegments(applyAutoMetadataToSegments(segmentsToSave, loadedActions) as SegmentDraft[]);
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
                    removeSourceRound:
                        sourceMode === "installed" && selectedInstalledId.trim().length > 0 && deleteSourceRound,
                },
                segments: segmentsToSave.map((segment) => ({
                    startTimeMs: segment.startTimeMs,
                    endTimeMs: segment.endTimeMs,
                    type: segment.type,
                    customName: segment.customName?.trim() ? segment.customName.trim() : null,
                    bpm: segment.bpm ?? null,
                    difficulty: segment.difficulty ?? null,
                })),
            });

            setMessage(
                `Saved ${result.stats.created} new and ${result.stats.updated} updated rounds${result.removedSourceRound ? ", source round removed." : "."}`,
            );
            playConverterSaveSuccessSound();
            await Promise.all([loadInstalledSources(), loadHeroes()]);
            if (result.removedSourceRound) {
                setSelectedInstalledId("");
            }
        } catch (saveError) {
            console.error("Failed to save converted rounds", saveError);
            setError(saveError instanceof Error ? saveError.message : "Failed to save converted rounds.");
            playConverterValidationErrorSound();
        } finally {
            setIsSaving(false);
        }
    }, [
        canSave,
        funscriptUri,
        heroAuthor,
        heroDescription,
        heroName,
        loadHeroes,
        loadInstalledSources,
        deleteSourceRound,
        selectedInstalledId,
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
                MAX_ZOOM_PX_PER_SEC,
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
        [currentTimeMs, setZoomWithSfx, zoomPxPerSec],
    );

    const onTimelineClick = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest("button")) return;
            if (durationMs <= 0) return;

            const rect = event.currentTarget.getBoundingClientRect();
            const localX = clamp(event.clientX - rect.left, 0, rect.width);
            const ratio = rect.width > 0 ? localX / rect.width : 0;
            seekToMs(Math.floor(ratio * durationMs));
            setError(null);
        },
        [durationMs, seekToMs],
    );

    /* ─── Computed selections ──────────────────────────────────────── */

    const selectedInstalledOption = useMemo(
        () => installedSourceOptions.find((option) => option.id === selectedInstalledId) ?? null,
        [installedSourceOptions, selectedInstalledId],
    );
    const selectedHeroOption = useMemo(
        () => heroOptions.find((option) => option.id === selectedHeroId) ?? null,
        [heroOptions, selectedHeroId],
    );

    /* ─── Installed source auto-apply ──────────────────────────────── */

    useEffect(() => {
        if (!selectedInstalledOption) return;
        if (sourceMode !== "installed") return;

        setVideoUri(selectedInstalledOption.videoUri);
        setFunscriptUri(selectedInstalledOption.funscriptUri ?? null);
        setHeroName(selectedInstalledOption.heroName ?? prefilledHeroName ?? "");
        setHeroAuthor(selectedInstalledOption.heroAuthor ?? "");
        setHeroDescription(selectedInstalledOption.heroDescription ?? "");
        setCurrentTimeMs(0);
        setDurationMs(0);
        const pendingSegments = pendingInstalledSegmentsRef.current;
        pendingInstalledSegmentsRef.current = null;
        setSegments(pendingSegments ?? []);
        setSelectedSegmentId(pendingSegments?.[0]?.id ?? null);
        setDetectedSegments([]);
        setMarkInMs(null);
        setMarkOutMs(null);
        const nextMessage = pendingInstalledLoadMessageRef.current ?? "Installed source loaded with existing metadata.";
        pendingInstalledLoadMessageRef.current = null;
        setMessage(nextMessage);
        setError(null);
    }, [prefilledHeroName, selectedInstalledOption, sourceMode]);

    const loadSelectedHero = useCallback(() => {
        if (!selectedHeroOption) {
            setError("Select an existing hero first.");
            playConverterValidationErrorSound();
            return;
        }

        const candidateSources = installedSourceOptions
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
                .filter((segment): segment is SegmentDraft => segment !== null),
        );
        pendingInstalledLoadMessageRef.current = `Loaded hero "${selectedHeroOption.name}" from attached round "${sourceOption.label}".`;
        setSourceMode("installed");
        setDeleteSourceRound(true);
        setSelectedInstalledId(sourceOption.id);
        setHeroName(selectedHeroOption.name);
        setHeroAuthor(selectedHeroOption.author ?? "");
        setHeroDescription(selectedHeroOption.description ?? "");
        setError(null);
        playSelectSound();
    }, [createDraftFromInstalledRound, installedSourceOptions, selectedHeroOption]);

    /* ─── Preselect from search params ─────────────────────────────── */

    useEffect(() => {
        if (!preselectedSourceRoundId) return;
        if (installedSourceOptions.length === 0) return;
        if (!installedSourceOptions.some((option) => option.id === preselectedSourceRoundId)) return;

        setSourceMode("installed");
        setDeleteSourceRound(true);
        setSelectedInstalledId(preselectedSourceRoundId);
    }, [installedSourceOptions, preselectedSourceRoundId]);

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

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
                return;
            }
            if (event.repeat) return;

            const key = event.key;

            if (key === "?") {
                event.preventDefault();
                setShowHotkeys((prev) => !prev);
                return;
            }

            if (key === " ") {
                event.preventDefault();
                void togglePlayback();
                return;
            }

            if (key.toLowerCase() === "i") {
                event.preventDefault();
                setMarkInMs(currentTimeMs);
                playConverterMarkInSound();
                return;
            }

            if (key.toLowerCase() === "o") {
                event.preventDefault();
                setMarkOutMs(currentTimeMs);
                playConverterMarkOutSound();
                return;
            }

            if (key === "Enter") {
                event.preventDefault();
                addSegmentFromMarks();
                return;
            }

            if (key === "Delete" || key === "Backspace") {
                if (!selectedSegmentId) return;
                event.preventDefault();
                removeSegment(selectedSegmentId);
                return;
            }

            if (key === "1" || key === "2" || key === "3") {
                if (!selectedSegmentId) return;
                event.preventDefault();
                const type: SegmentType = key === "1" ? "Normal" : key === "2" ? "Interjection" : "Cum";
                setSegmentType(selectedSegmentId, type);
                return;
            }

            if (key === "ArrowLeft" || key === "ArrowRight") {
                event.preventDefault();
                const amount = event.shiftKey ? 5000 : 1000;
                const next = key === "ArrowLeft" ? currentTimeMs - amount : currentTimeMs + amount;
                seekToMs(next);
                return;
            }

            if (key === ",") {
                event.preventDefault();
                nudgeSelectedSegment(-100);
                return;
            }

            if (key === ".") {
                event.preventDefault();
                nudgeSelectedSegment(100);
                return;
            }

            if (key === "=" || key === "+") {
                event.preventDefault();
                zoomByFactor(1.1);
                return;
            }

            if (key === "-") {
                event.preventDefault();
                zoomByFactor(0.9);
                return;
            }

            if (key === "0") {
                event.preventDefault();
                setZoomWithSfx(DEFAULT_ZOOM_PX_PER_SEC);
                return;
            }

            if (key.toLowerCase() === "r") {
                event.preventDefault();
                jumpToRandomPoint();
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
        };
    });

    return {
        // Refs
        videoRef,
        timelineScrollRef,
        dragStateRef,

        // Source
        sourceMode,
        setSourceMode,
        videoUri,
        funscriptUri,
        installedSourceOptions,
        selectedInstalledId,
        setSelectedInstalledId,
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
        onTimelineClick,

        // Segments
        sortedSegments,
        selectedSegmentId,
        setSelectedSegmentId,
        selectedSegment,
        addSegmentFromMarks,
        removeSegment,
        setSegmentType,
        setSegmentCustomName,
        setSegmentBpm,
        resetSegmentBpm,
        setSegmentDifficulty,
        resetSegmentDifficulty,
        updateSegmentTiming,
        mergeSegmentWithNext,

        // Detection
        detectedSegments,
        pauseGapDraft,
        setPauseGapDraft,
        minRoundDraft,
        setMinRoundDraft,
        commitPauseGapDraft,
        commitMinRoundDraft,
        isDetecting,
        runAutoDetect,
        applyDetectedSuggestions,

        // Save
        canSave,
        isSaving,
        saveConvertedRounds,

        // UI
        sourceSummary,
        message,
        error,
        showHotkeys,
    };
}
