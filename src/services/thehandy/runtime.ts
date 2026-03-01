import "./configureClient";
import {
  getDeviceInfo,
  getHspState,
  getStroke,
  getServerTime,
  hspAdd,
  hspFlush,
  hspPause,
  hspPlay,
  hspSetup,
  hspStop,
  isConnected,
  issueToken,
  setHspPaybackRate,
  setHspTime,
  setStroke,
} from "./index";
import type { FunscriptAction } from "../../game/media/playback";
import type { HapticsSyncOptions } from "../haptics/types";
import { normalizeHandyStrokeState, type HandyStrokeState } from "../theHandyConfig";

export type HandyAuthBundle = {
  connectionKey: string;
  appApiKey: string;
};

export type HandySession = {
  mode: "token" | "appId";
  clientToken: string | null;
  expiresAtMs: number;
  serverTimeOffsetMs: number;
  serverTimeOffsetMeasuredAtMs: number;
  loadedScriptId: string | null;
  activeScriptId: string | null;
  lastSyncAtMs: number;
  lastPlaybackRate: number;
  maxBufferPoints: number;
  streamedPoints: Array<{ t: number; x: number }> | null;
  nextStreamPointIndex: number;
  tailPointStreamIndex: number;
  uploadedUntilMs: number;
  lastHspAddAtMs: number;
  hspAddBackoffUntilMs: number;
  hspModeActive: boolean;
  lastHspStateAtMs?: number;
  reportedBufferPoints?: number | null;
  reportedBufferedUntilMs?: number | null;
  hspTopupFailureCount?: number;
  /** Set when the device pauses HSP playback because its point buffer ran dry. */
  hspStarved?: boolean;
  streamId?: number;
  serverTimeRefreshPromise?: Promise<void> | null;
};

export class HandyDeviceError extends Error {
  readonly code: number | null;
  readonly errorName: string | null;
  readonly connected: boolean | null;

  constructor(input: {
    message: string;
    code?: number | null;
    name?: string | null;
    connected?: boolean | null;
  }) {
    super(input.message);
    this.name = "HandyDeviceError";
    this.code = input.code ?? null;
    this.errorName = input.name ?? null;
    this.connected = input.connected ?? null;
  }
}

const HSP_CHUNK_SIZE = 100;
const DEFAULT_HSP_MAX_POINTS = 4000;
const HSP_INITIAL_PREFETCH_MS = 30_000;
const HSP_INITIAL_BUFFER_RATIO = 0.75;
const HSP_PREFETCH_MS = 180_000;
const HSP_TOPUP_TRIGGER_MS = 45_000;
const HSP_TOPUP_TRIGGER_POINT_RATIO = 0.55;
const HSP_TOPUP_TARGET_POINT_RATIO = 0.85;
const HSP_TOPUP_APPEND_MIN_INTERVAL_MS = 350;
const HSP_TOPUP_MAX_POINTS_PER_SYNC = HSP_CHUNK_SIZE;
const SERVER_TIME_SAMPLE_COUNT = 3;
const SERVER_TIME_SAMPLE_KEEP_COUNT = 2;
const SERVER_TIME_OFFSET_TTL_MS = 5 * 60_000;
const HSP_ADD_MAX_RETRIES = 2;
const HSP_ADD_RETRY_BASE_DELAY_MS = 200;
const HSP_MODE_MAX_RETRIES = 2;
const HSP_MODE_RETRY_BASE_DELAY_MS = 300;

async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        const delayMs = baseDelayMs * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

function requireConnectionRef(value: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error("Connection key is missing. Enter your device Connection Key.");
  }
  return normalized;
}

function requireAppCredential(value: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error("Application ID/API key is missing.");
  }
  return normalized;
}

function createAuthResolver(appApiKey: string, clientToken: string | null) {
  return (auth: { name?: string; type: "apiKey" | "http" }) => {
    if (auth.type === "apiKey" || auth.name === "X-Api-Key") {
      return appApiKey;
    }
    if (!clientToken) return undefined;
    return clientToken;
  };
}

type HandyPayload<T> = T | { data?: T } | undefined;

function unwrapPayload<T>(payload: HandyPayload<T>): T | undefined {
  if (!payload) return undefined;
  if (typeof payload === "object" && "data" in payload) {
    return (payload as { data?: T }).data;
  }
  return payload as T;
}

function assertDeviceResponse<T>(payload: HandyPayload<T>): T {
  const value = unwrapPayload(payload);
  if (!value || typeof value !== "object") {
    throw new HandyDeviceError({ message: "TheHandy returned an empty response." });
  }
  const error = "error" in value ? (value as { error?: unknown }).error : undefined;
  if (error && typeof error === "object") {
    const details = error as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
      connected?: unknown;
    };
    throw new HandyDeviceError({
      message:
        typeof details.message === "string" && details.message.trim()
          ? details.message
          : "TheHandy rejected the command.",
      code: typeof details.code === "number" ? details.code : null,
      name: typeof details.name === "string" ? details.name : null,
      connected: typeof details.connected === "boolean" ? details.connected : null,
    });
  }
  return value;
}

function createStreamId(): number {
  const bytes = new Uint32Array(1);
  globalThis.crypto?.getRandomValues?.(bytes);
  const generated = bytes[0] ?? 0;
  return generated === 0 ? Math.max(1, Math.floor(Math.random() * 0xffff_ffff)) : generated;
}

function toScriptId(sourceId: string, actions: FunscriptAction[]): string {
  const first = actions[0]?.at ?? 0;
  const last = actions[actions.length - 1]?.at ?? 0;
  return `${sourceId}:${actions.length}:${first}:${last}`;
}

function toHspPoints(actions: FunscriptAction[]): Array<{ t: number; x: number }> {
  return actions
    .map((action) => ({
      t: Math.max(0, Math.floor(action.at)),
      // Keep 0..100 stroke positions for compatibility with existing playback.
      x: Math.max(0, Math.min(100, Math.round(action.pos))),
    }))
    .sort((a, b) => a.t - b.t);
}

function extractServerTimeMs(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const serverTime =
    "server_time" in payload ? (payload as { server_time?: unknown }).server_time : undefined;
  return typeof serverTime === "number" && Number.isFinite(serverTime) ? serverTime : null;
}

async function refreshServerTimeOffset(
  auth: HandyAuthBundle,
  session: HandySession
): Promise<void> {
  const now = Date.now();
  if (
    session.serverTimeOffsetMeasuredAtMs > 0 &&
    now - session.serverTimeOffsetMeasuredAtMs < SERVER_TIME_OFFSET_TTL_MS
  ) {
    return;
  }

  if (session.serverTimeRefreshPromise) return session.serverTimeRefreshPromise;

  const refreshPromise = (async () => {
    const appCredential = requireAppCredential(auth.appApiKey);
    const samples: Array<{ offsetMs: number; roundTripMs: number }> = [];

    for (let index = 0; index < SERVER_TIME_SAMPLE_COUNT; index += 1) {
      try {
        const sentAtMs = Date.now();
        const sentAtMonotonicMs = globalThis.performance?.now?.() ?? sentAtMs;
        const response = unwrapPayload(
          await getServerTime({
            auth: appCredential,
            responseStyle: "data",
            requestValidator: undefined,
            responseValidator: undefined,
          })
        );
        const receivedAtMs = Date.now();
        const receivedAtMonotonicMs = globalThis.performance?.now?.() ?? receivedAtMs;
        const serverTimeMs = extractServerTimeMs(response);
        if (serverTimeMs === null) continue;
        const roundTripMs = Math.max(0, receivedAtMonotonicMs - sentAtMonotonicMs);
        const estimatedServerTimeAtReceiveMs = serverTimeMs + roundTripMs / 2;
        samples.push({
          offsetMs: estimatedServerTimeAtReceiveMs - receivedAtMs,
          roundTripMs,
        });
      } catch {
        // Time sampling is an accuracy improvement, not a hard dependency.
      }
    }

    if (samples.length === 0) {
      if (session.serverTimeOffsetMeasuredAtMs === 0) session.serverTimeOffsetMs = 0;
      session.serverTimeOffsetMeasuredAtMs = now;
      return;
    }

    samples.sort((left, right) => left.roundTripMs - right.roundTripMs);
    const bestSamples = samples.slice(0, Math.min(SERVER_TIME_SAMPLE_KEEP_COUNT, samples.length));
    const offsetSum = bestSamples.reduce((sum, sample) => sum + sample.offsetMs, 0);

    session.serverTimeOffsetMs = offsetSum / bestSamples.length;
    session.serverTimeOffsetMeasuredAtMs = now;
  })();

  session.serverTimeRefreshPromise = refreshPromise;
  try {
    await refreshPromise;
  } finally {
    if (session.serverTimeRefreshPromise === refreshPromise) {
      session.serverTimeRefreshPromise = null;
    }
  }
}

function getEstimatedServerTimeMs(session: HandySession): number {
  return Date.now() + session.serverTimeOffsetMs;
}

function clampMaxBufferPoints(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = Math.floor(value);
    if (normalized >= 2) return normalized;
  }
  return DEFAULT_HSP_MAX_POINTS;
}

function unwrapStrokeResult(
  payload: unknown,
  fallback?: Partial<HandyStrokeState>
): HandyStrokeState {
  if (!payload || typeof payload !== "object" || !("result" in payload)) {
    if (fallback) {
      return normalizeHandyStrokeState(fallback);
    }
    throw new Error("Stroke settings unavailable.");
  }

  const result = (
    payload as {
      result?: { min?: unknown; max?: unknown; min_absolute?: unknown; max_absolute?: unknown };
    }
  ).result;
  if (!fallback && (!result || typeof result.min !== "number" || typeof result.max !== "number")) {
    throw new Error("Stroke settings unavailable.");
  }

  return normalizeHandyStrokeState({
    min: typeof result?.min === "number" ? result.min : fallback?.min,
    max: typeof result?.max === "number" ? result.max : fallback?.max,
    minAbsolute:
      typeof result?.min_absolute === "number" ? result.min_absolute : fallback?.minAbsolute,
    maxAbsolute:
      typeof result?.max_absolute === "number" ? result.max_absolute : fallback?.maxAbsolute,
  });
}

export function resolveInitialPreloadTargetMs(
  points: Array<{ t: number; x: number }>,
  seededPointIndex: number,
  startTimeMs: number
): number {
  const normalizedStartTimeMs = Math.max(0, Math.floor(startTimeMs));
  const seededPointTimeMs = points[seededPointIndex]?.t ?? 0;
  let targetTimeMs = Math.max(normalizedStartTimeMs, seededPointTimeMs) + HSP_INITIAL_PREFETCH_MS;

  for (let index = seededPointIndex + 1; index < points.length; index += 1) {
    const point = points[index];
    if (!point) continue;
    if (point.t > normalizedStartTimeMs) {
      targetTimeMs = Math.max(targetTimeMs, point.t);
      break;
    }
  }

  return targetTimeMs;
}

export async function issueHandySession(auth: HandyAuthBundle): Promise<HandySession> {
  const connectionRef = requireConnectionRef(auth.connectionKey);
  const appCredential = requireAppCredential(auth.appApiKey);

  try {
    const response = unwrapPayload(
      await issueToken({
        auth: appCredential,
        responseStyle: "data",
        query: {
          ttl: 3600,
          to: connectionRef,
        },
      })
    );

    const token = response?.result?.token;
    if (token) {
      const expiresAtRaw = response.result?.expires_at;
      const expiresAtMs = expiresAtRaw ? Date.parse(expiresAtRaw) : Date.now() + 45 * 60_000;
      const session: HandySession = {
        mode: "token",
        clientToken: token,
        expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : Date.now() + 45 * 60_000,
        serverTimeOffsetMs: 0,
        serverTimeOffsetMeasuredAtMs: 0,
        loadedScriptId: null,
        activeScriptId: null,
        lastSyncAtMs: 0,
        lastPlaybackRate: 1,
        maxBufferPoints: DEFAULT_HSP_MAX_POINTS,
        streamedPoints: null,
        nextStreamPointIndex: 0,
        tailPointStreamIndex: 0,
        uploadedUntilMs: 0,
        lastHspAddAtMs: 0,
        hspAddBackoffUntilMs: 0,
        hspModeActive: false,
        streamId: createStreamId(),
        serverTimeRefreshPromise: null,
      };
      await refreshServerTimeOffset(auth, session);
      return session;
    }
  } catch {
    // Fallback for Application ID style auth without client token.
  }

  const session: HandySession = {
    mode: "appId",
    clientToken: null,
    expiresAtMs: Date.now() + 60 * 60_000,
    serverTimeOffsetMs: 0,
    serverTimeOffsetMeasuredAtMs: 0,
    loadedScriptId: null,
    activeScriptId: null,
    lastSyncAtMs: 0,
    lastPlaybackRate: 1,
    maxBufferPoints: DEFAULT_HSP_MAX_POINTS,
    streamedPoints: null,
    nextStreamPointIndex: 0,
    tailPointStreamIndex: 0,
    uploadedUntilMs: 0,
    lastHspAddAtMs: 0,
    hspAddBackoffUntilMs: 0,
    hspModeActive: false,
    streamId: createStreamId(),
    serverTimeRefreshPromise: null,
  };
  await refreshServerTimeOffset(auth, session);
  return session;
}

export async function verifyHandyV3Connection(
  auth: HandyAuthBundle
): Promise<{ connected: boolean; firmwareVersion: string | null }> {
  const connectionRef = requireConnectionRef(auth.connectionKey);
  const appCredential = requireAppCredential(auth.appApiKey);
  const session = await issueHandySession(auth);
  const authResolver = createAuthResolver(appCredential, session.clientToken);
  const headers = { "X-Connection-Key": connectionRef };
  const query = { timeout: 5000 };

  const [connectionResponse, infoResponse] = await Promise.all([
    isConnected({
      auth: authResolver,
      responseStyle: "data",
      requestValidator: undefined,
      headers,
      query,
    }),
    getDeviceInfo({
      auth: authResolver,
      responseStyle: "data",
      requestValidator: undefined,
      responseValidator: undefined,
      headers,
      query,
    }),
  ]);

  const connectionPayload = assertDeviceResponse(connectionResponse) as {
    result?: { connected?: unknown };
  };
  const connected = Boolean(connectionPayload.result?.connected);
  const infoPayload = connected
    ? (assertDeviceResponse(infoResponse) as { result?: { fw_version?: string } })
    : null;
  return {
    connected,
    firmwareVersion: connected ? (infoPayload?.result?.fw_version ?? null) : null,
  };
}

export async function getHandyStroke(auth: HandyAuthBundle): Promise<HandyStrokeState> {
  const connectionRef = requireConnectionRef(auth.connectionKey);
  const appCredential = requireAppCredential(auth.appApiKey);
  const session = await issueHandySession(auth);
  const response = assertDeviceResponse(
    await getStroke({
      auth: createAuthResolver(appCredential, session.clientToken),
      responseStyle: "data",
      requestValidator: undefined,
      responseValidator: undefined,
      headers: {
        "X-Connection-Key": connectionRef,
      },
      query: { timeout: 5000 },
    })
  );

  return unwrapStrokeResult(response);
}

export async function updateHandyStroke(
  auth: HandyAuthBundle,
  input: Pick<HandyStrokeState, "min" | "max">
): Promise<HandyStrokeState> {
  const connectionRef = requireConnectionRef(auth.connectionKey);
  const appCredential = requireAppCredential(auth.appApiKey);
  const session = await issueHandySession(auth);
  const normalizedInput = normalizeHandyStrokeState(input);
  const response = assertDeviceResponse(
    await setStroke({
      auth: createAuthResolver(appCredential, session.clientToken),
      responseStyle: "data",
      requestValidator: undefined,
      responseValidator: undefined,
      headers: {
        "X-Connection-Key": connectionRef,
      },
      body: {
        min: normalizedInput.min,
        max: normalizedInput.max,
      },
      query: { timeout: 5000 },
    })
  );

  return unwrapStrokeResult(response, normalizedInput);
}

async function prepareHspMode(auth: HandyAuthBundle, session: HandySession): Promise<void> {
  const connectionRef = requireConnectionRef(auth.connectionKey);
  const appCredential = requireAppCredential(auth.appApiKey);
  const authResolver = createAuthResolver(appCredential, session.clientToken);
  const headers = { "X-Connection-Key": connectionRef };

  const streamId = session.streamId ?? createStreamId();
  session.streamId = streamId;
  const setupResponse = assertDeviceResponse(
    await withRetry(
      async () =>
        assertDeviceResponse(
          await hspSetup({
            auth: authResolver,
            responseStyle: "data",
            requestValidator: undefined,
            responseValidator: undefined,
            headers,
            body: { stream_id: streamId },
            query: { timeout: 5000 },
          })
        ),
      HSP_MODE_MAX_RETRIES,
      HSP_MODE_RETRY_BASE_DELAY_MS
    )
  ) as { result?: { max_points?: number; stream_id?: number } };

  if (
    typeof setupResponse.result?.stream_id === "number" &&
    setupResponse.result.stream_id !== streamId
  ) {
    throw new HandyDeviceError({ message: "TheHandy HSP session was replaced by another stream." });
  }

  const flushResponse = assertDeviceResponse(
    await withRetry(
      async () =>
        assertDeviceResponse(
          await hspFlush({
            auth: authResolver,
            responseStyle: "data",
            requestValidator: undefined,
            responseValidator: undefined,
            headers,
            query: { timeout: 5000 },
          })
        ),
      HSP_MODE_MAX_RETRIES,
      HSP_MODE_RETRY_BASE_DELAY_MS
    )
  ) as { result?: { max_points?: number } };

  const maxPoints = clampMaxBufferPoints(
    flushResponse?.result?.max_points ?? setupResponse?.result?.max_points
  );
  session.maxBufferPoints = maxPoints;
  session.lastHspAddAtMs = 0;
  session.hspAddBackoffUntilMs = 0;
  session.hspModeActive = true;
}

type AppendHspPointsOptions = {
  paced?: boolean;
};

async function appendPointsUpToTime(
  auth: HandyAuthBundle,
  session: HandySession,
  targetTimeMs: number,
  maxPointsToSend: number,
  options: AppendHspPointsOptions = {}
): Promise<number> {
  const points = session.streamedPoints;
  if (!points || points.length === 0) return 0;
  if (maxPointsToSend <= 0) return 0;

  const now = Date.now();
  if (options.paced) {
    if (now < session.hspAddBackoffUntilMs) return 0;
    if (
      session.lastHspAddAtMs > 0 &&
      now - session.lastHspAddAtMs < HSP_TOPUP_APPEND_MIN_INTERVAL_MS
    ) {
      return 0;
    }
  }

  const connectionRef = requireConnectionRef(auth.connectionKey);
  const appCredential = requireAppCredential(auth.appApiKey);
  let sent = 0;

  while (
    session.nextStreamPointIndex < points.length &&
    sent < maxPointsToSend &&
    points[session.nextStreamPointIndex]!.t <= targetTimeMs
  ) {
    const remainingBudget = maxPointsToSend - sent;
    const chunkLimit = Math.min(HSP_CHUNK_SIZE, remainingBudget);
    const chunk: Array<{ t: number; x: number }> = [];
    let cursor = session.nextStreamPointIndex;

    while (
      chunk.length < chunkLimit &&
      cursor < points.length &&
      points[cursor]!.t <= targetTimeMs
    ) {
      const point = points[cursor];
      if (!point) break;
      chunk.push(point);
      cursor += 1;
    }

    if (chunk.length === 0) break;

    const nextTailPointStreamIndex = session.tailPointStreamIndex + chunk.length;
    try {
      await withRetry(
        async () =>
          assertDeviceResponse(
            await hspAdd({
              auth: createAuthResolver(appCredential, session.clientToken),
              responseStyle: "data",
              requestValidator: undefined,
              responseValidator: undefined,
              headers: {
                "X-Connection-Key": connectionRef,
              },
              body: {
                points: chunk,
                tail_point_stream_index: nextTailPointStreamIndex,
                flush: false,
              },
              query: {
                timeout: 5000,
              },
            })
          ),
        HSP_ADD_MAX_RETRIES,
        HSP_ADD_RETRY_BASE_DELAY_MS
      );
    } catch (error) {
      session.hspAddBackoffUntilMs = Date.now() + HSP_TOPUP_APPEND_MIN_INTERVAL_MS;
      throw error;
    }

    session.nextStreamPointIndex = cursor;
    session.tailPointStreamIndex = nextTailPointStreamIndex;
    session.lastHspAddAtMs = Date.now();
    sent += chunk.length;
    const lastPoint = chunk[chunk.length - 1];
    if (lastPoint) {
      session.uploadedUntilMs = lastPoint.t;
    }
  }

  return sent;
}

async function refreshHspState(auth: HandyAuthBundle, session: HandySession): Promise<void> {
  const now = Date.now();
  if (session.lastHspStateAtMs && now - session.lastHspStateAtMs < 1000) return;
  session.lastHspStateAtMs = now;
  try {
    const response = assertDeviceResponse(
      await getHspState({
        auth: createAuthResolver(requireAppCredential(auth.appApiKey), session.clientToken),
        responseStyle: "data",
        requestValidator: undefined,
        responseValidator: undefined,
        headers: { "X-Connection-Key": requireConnectionRef(auth.connectionKey) },
        query: { timeout: 5000 },
      })
    ) as {
      result?: {
        points?: number;
        max_points?: number;
        last_point_time?: number;
        tail_point_stream_index?: number;
        play_state?: number;
      };
    };
    const state = response.result;
    if (!state) return;
    if (typeof state.points === "number") session.reportedBufferPoints = state.points;
    if (typeof state.max_points === "number") {
      session.maxBufferPoints = clampMaxBufferPoints(state.max_points);
    }
    if (typeof state.last_point_time === "number") {
      session.reportedBufferedUntilMs = state.last_point_time;
    }
    if (state.play_state === 4) {
      // A starved HSP stream remains paused even after more points are added. Mark
      // it inactive so the next regular sync restarts playback at the current
      // media time instead of requiring a full reconnect.
      session.hspStarved = true;
      session.activeScriptId = null;
      console.debug("[haptics] Direct Handy HSP is paused on starvation", {
        bufferedPoints: session.reportedBufferPoints,
      });
    }
  } catch (error) {
    console.debug("[haptics] Could not refresh direct Handy HSP state", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function preloadScript(
  auth: HandyAuthBundle,
  session: HandySession,
  sourceId: string,
  actions: FunscriptAction[],
  skipToMs: number = 0
): Promise<void> {
  const scriptId = toScriptId(sourceId, actions);
  if (session.loadedScriptId === scriptId) return;

  const points = toHspPoints(actions);
  if (points.length === 0) return;

  await prepareHspMode(auth, session);

  session.streamedPoints = points;

  // Fast-forward to skip unneeded history points
  let nextIdx = 0;
  if (skipToMs > 0) {
    // Keep 1 point before skipToMs to help TheHandy interpolate the first movement properly
    while (nextIdx < points.length - 1 && points[nextIdx]!.t < skipToMs) {
      nextIdx++;
    }
    if (nextIdx > 0) nextIdx--;
  }

  session.nextStreamPointIndex = nextIdx;
  session.tailPointStreamIndex = 0;
  session.uploadedUntilMs = points[nextIdx]?.t ?? 0;
  session.lastHspAddAtMs = 0;
  session.hspAddBackoffUntilMs = 0;
  session.lastHspStateAtMs = 0;
  session.reportedBufferPoints = null;
  session.reportedBufferedUntilMs = null;
  session.hspTopupFailureCount = 0;
  session.hspStarved = false;

  // Seed enough data for startup to include the first point after the requested
  // start time, even when the script begins inside a long interpolation gap.
  const initialTargetMs = resolveInitialPreloadTargetMs(points, nextIdx, skipToMs);
  const maxSafeInitialPoints = Math.max(1, session.maxBufferPoints - 10);
  const preferredPoints = Math.max(
    HSP_CHUNK_SIZE,
    Math.floor(session.maxBufferPoints * HSP_INITIAL_BUFFER_RATIO)
  );
  const initialBudget = Math.min(maxSafeInitialPoints, preferredPoints);
  await appendPointsUpToTime(auth, session, initialTargetMs, initialBudget);

  session.loadedScriptId = scriptId;
  session.activeScriptId = null;
  session.lastSyncAtMs = 0;
  session.lastPlaybackRate = 1;
}

export async function preloadHspScript(
  auth: HandyAuthBundle,
  session: HandySession,
  sourceId: string,
  actions: FunscriptAction[],
  skipToMs: number = 0
): Promise<void> {
  if (actions.length === 0) return;
  await preloadScript(auth, session, sourceId, actions, skipToMs);
}

export async function sendHspSync(
  auth: HandyAuthBundle,
  session: HandySession,
  timeMs: number,
  playbackRate: number,
  sourceId: string,
  actions: FunscriptAction[],
  options: HapticsSyncOptions = {}
): Promise<void> {
  if (actions.length === 0) return;

  const connectionRef = requireConnectionRef(auth.connectionKey);
  const appCredential = requireAppCredential(auth.appApiKey);
  const scriptId = toScriptId(sourceId, actions);
  if (Date.now() - session.serverTimeOffsetMeasuredAtMs >= SERVER_TIME_OFFSET_TTL_MS) {
    await refreshServerTimeOffset(auth, session);
  }
  await preloadScript(auth, session, sourceId, actions, timeMs);

  if (session.streamedPoints && session.nextStreamPointIndex < session.streamedPoints.length) {
    // State polling is advisory and must not delay the time-sensitive sync/top-up path.
    void refreshHspState(auth, session);
    let playingIdx = session.nextStreamPointIndex - 1;
    while (playingIdx > 0 && session.streamedPoints[playingIdx]!.t > timeMs) {
      playingIdx -= 1;
    }
    const estimatedPointsInBuffer = session.nextStreamPointIndex - Math.max(0, playingIdx);
    const pointsInBuffer = session.reportedBufferPoints ?? estimatedPointsInBuffer;

    const bufferedUntilMs = session.reportedBufferedUntilMs ?? session.uploadedUntilMs;
    const shouldTopUpByTime = bufferedUntilMs - timeMs <= HSP_TOPUP_TRIGGER_MS;
    const shouldTopUpByPoints =
      pointsInBuffer <= session.maxBufferPoints * HSP_TOPUP_TRIGGER_POINT_RATIO;
    if (shouldTopUpByTime || shouldTopUpByPoints) {
      const targetMs = Math.max(timeMs + HSP_PREFETCH_MS, session.uploadedUntilMs);
      const targetPointCount = Math.floor(session.maxBufferPoints * HSP_TOPUP_TARGET_POINT_RATIO);
      const pointBudget = Math.max(0, targetPointCount - pointsInBuffer);
      const fetchBudget = Math.min(HSP_TOPUP_MAX_POINTS_PER_SYNC, pointBudget);
      if (fetchBudget > 0) {
        try {
          const appended = await appendPointsUpToTime(auth, session, targetMs, fetchBudget, {
            paced: true,
          });
          if (appended > 0) {
            if ((session.hspTopupFailureCount ?? 0) > 0) {
              console.debug("[haptics] Direct Handy HSP top-up recovered", { appended });
            }
            session.hspTopupFailureCount = 0;
          }
        } catch (error) {
          session.hspTopupFailureCount = (session.hspTopupFailureCount ?? 0) + 1;
          console.warn("[haptics] Direct Handy HSP top-up will be retried", {
            attempt: session.hspTopupFailureCount,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  const nextRate = Math.max(0.25, Math.min(3, playbackRate));
  const authResolver = createAuthResolver(appCredential, session.clientToken);
  const headers = { "X-Connection-Key": connectionRef };

  if (session.activeScriptId !== scriptId) {
    assertDeviceResponse(
      await hspPlay({
        auth: authResolver,
        responseStyle: "data",
        requestValidator: undefined,
        responseValidator: undefined,
        headers,
        body: {
          start_time: Math.max(0, Math.floor(timeMs)),
          server_time: Math.round(getEstimatedServerTimeMs(session)),
          playback_rate: nextRate,
          pause_on_starving: true,
          loop: false,
        },
        query: { timeout: 5000 },
      })
    );
    session.activeScriptId = scriptId;
    session.hspStarved = false;
    session.lastSyncAtMs = 0;
    session.lastPlaybackRate = nextRate;
  }

  const now = Date.now();
  const needsRateUpdate = Math.abs(nextRate - session.lastPlaybackRate) > 0.02;
  const needsTimeSync = options.forceTimeSync === true || now - session.lastSyncAtMs >= 2000;
  const timeBody = {
    current_time: Math.max(0, Math.floor(timeMs)),
    server_time: Math.round(getEstimatedServerTimeMs(session)),
    ...(options.timeFilter === null ? {} : { filter: options.timeFilter ?? 0.12 }),
  };

  if (needsRateUpdate && needsTimeSync) {
    await Promise.all([
      setHspPaybackRate({
        auth: authResolver,
        responseStyle: "data",
        requestValidator: undefined,
        responseValidator: undefined,
        headers,
        body: { playback_rate: nextRate },
        query: { timeout: 5000 },
      }).then(assertDeviceResponse),
      setHspTime({
        auth: authResolver,
        responseStyle: "data",
        requestValidator: undefined,
        responseValidator: undefined,
        headers,
        body: timeBody,
        query: { timeout: 5000 },
      }).then(assertDeviceResponse),
    ]);
    session.lastPlaybackRate = nextRate;
    session.lastSyncAtMs = Date.now();
  } else if (needsRateUpdate) {
    assertDeviceResponse(
      await setHspPaybackRate({
        auth: authResolver,
        responseStyle: "data",
        requestValidator: undefined,
        responseValidator: undefined,
        headers,
        body: { playback_rate: nextRate },
        query: { timeout: 5000 },
      })
    );
    session.lastPlaybackRate = nextRate;
  } else if (needsTimeSync) {
    assertDeviceResponse(
      await setHspTime({
        auth: authResolver,
        responseStyle: "data",
        requestValidator: undefined,
        responseValidator: undefined,
        headers,
        body: timeBody,
        query: { timeout: 5000 },
      })
    );
    session.lastSyncAtMs = Date.now();
  }
}

export async function pauseHandyPlayback(
  auth: HandyAuthBundle,
  session: HandySession | null
): Promise<void> {
  if (!session) return;

  const connectionRef = requireConnectionRef(auth.connectionKey);
  const appCredential = requireAppCredential(auth.appApiKey);

  // Use the native HSP pause endpoint instead of hspStop.
  // hspPause keeps the current position AND the entire point buffer intact
  // on the device, so a subsequent hspResume is near-instant.
  assertDeviceResponse(
    await hspPause({
      auth: createAuthResolver(appCredential, session.clientToken),
      responseStyle: "data",
      requestValidator: undefined,
      responseValidator: undefined,
      headers: {
        "X-Connection-Key": connectionRef,
      },
    })
  );

  // Keep ALL session state intact — loadedScriptId, streamedPoints, buffer
  // indices, etc. Only mark activeScriptId as paused so the next sync knows
  // it needs to resume (not start from scratch).
  session.activeScriptId = null;
  session.lastSyncAtMs = 0;
  session.lastPlaybackRate = 1;
}

export async function resumeHandyPlayback(
  auth: HandyAuthBundle,
  session: HandySession,
  resumeAtMs: number,
  playbackRate: number = 1
): Promise<void> {
  const connectionRef = requireConnectionRef(auth.connectionKey);
  const appCredential = requireAppCredential(auth.appApiKey);
  const authResolver = createAuthResolver(appCredential, session.clientToken);
  const headers = { "X-Connection-Key": connectionRef };

  if (Date.now() - session.serverTimeOffsetMeasuredAtMs >= SERVER_TIME_OFFSET_TTL_MS) {
    await refreshServerTimeOffset(auth, session);
  }

  const nextRate = Math.max(0.25, Math.min(3, playbackRate));

  // Starting the retained HSP buffer at an explicit media timestamp is more
  // reliable than hspResume after a timed gameplay pause. Some devices accept
  // hspResume but remain paused until the connection is recreated. hspPlay
  // performs the same recovery as a reconnect without discarding the buffer.
  assertDeviceResponse(
    await hspPlay({
      auth: authResolver,
      responseStyle: "data",
      requestValidator: undefined,
      responseValidator: undefined,
      headers,
      body: {
        start_time: Math.max(0, Math.floor(resumeAtMs)),
        server_time: Math.round(getEstimatedServerTimeMs(session)),
        playback_rate: nextRate,
        pause_on_starving: true,
        loop: false,
      },
      query: { timeout: 5000 },
    })
  );

  const now = Date.now();
  session.activeScriptId = session.loadedScriptId;
  session.lastSyncAtMs = now;
  session.lastPlaybackRate = nextRate;
  session.hspStarved = false;
}

export async function stopHandyPlayback(
  auth: HandyAuthBundle,
  session: HandySession | null
): Promise<void> {
  if (!session) return;

  const connectionRef = requireConnectionRef(auth.connectionKey);
  const appCredential = requireAppCredential(auth.appApiKey);

  // CRITICAL: We modify local state BEFORE the network request so that
  // if network fails/timeouts, we don't end up with desynchronized tracking state.
  session.loadedScriptId = null;
  session.activeScriptId = null;
  session.lastSyncAtMs = 0;
  session.lastPlaybackRate = 1;
  session.streamedPoints = null;
  session.nextStreamPointIndex = 0;
  session.tailPointStreamIndex = 0;
  session.uploadedUntilMs = 0;
  session.lastHspAddAtMs = 0;
  session.hspAddBackoffUntilMs = 0;
  session.hspModeActive = false;
  session.hspStarved = false;

  await hspStop({
    auth: createAuthResolver(appCredential, session.clientToken),
    responseStyle: "data",
    requestValidator: undefined,
    responseValidator: undefined,
    headers: {
      "X-Connection-Key": connectionRef,
    },
    query: {
      timeout: 5000,
    },
  }).catch(() => {});
}
