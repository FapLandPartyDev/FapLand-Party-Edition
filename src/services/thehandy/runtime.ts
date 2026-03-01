import {
  getDeviceInfo,
  getServerTime,
  hspAdd,
  hspFlush,
  hspPause,
  hspPlay,
  hspResume,
  hspSetup,
  hspStop,
  isConnected,
  issueToken,
  setHspPaybackRate,
  setHspTime,
  setMode,
} from "./index";
import type { FunscriptAction } from "../../game/media/playback";

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
};

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

  const appCredential = requireAppCredential(auth.appApiKey);
  const samples: Array<{ offsetMs: number; roundTripMs: number }> = [];

  for (let index = 0; index < SERVER_TIME_SAMPLE_COUNT; index += 1) {
    try {
      const sentAtMs = Date.now();
      const response = unwrapPayload(
        await getServerTime({
          auth: appCredential,
          responseStyle: "data",
          requestValidator: undefined,
          responseValidator: undefined,
        })
      );
      const receivedAtMs = Date.now();
      const serverTimeMs = extractServerTimeMs(response);
      if (serverTimeMs === null) continue;
      const roundTripMs = Math.max(0, receivedAtMs - sentAtMs);
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
    session.serverTimeOffsetMs = 0;
    session.serverTimeOffsetMeasuredAtMs = now;
    return;
  }

  samples.sort((left, right) => left.roundTripMs - right.roundTripMs);
  const bestSamples = samples.slice(0, Math.min(SERVER_TIME_SAMPLE_KEEP_COUNT, samples.length));
  const offsetSum = bestSamples.reduce((sum, sample) => sum + sample.offsetMs, 0);

  session.serverTimeOffsetMs = offsetSum / bestSamples.length;
  session.serverTimeOffsetMeasuredAtMs = now;
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

  const connected = Boolean(unwrapPayload(connectionResponse)?.result?.connected);
  return {
    connected,
    firmwareVersion: connected ? (unwrapPayload(infoResponse)?.result?.fw_version ?? null) : null,
  };
}

async function prepareHspMode(auth: HandyAuthBundle, session: HandySession): Promise<void> {
  const connectionRef = requireConnectionRef(auth.connectionKey);
  const appCredential = requireAppCredential(auth.appApiKey);
  const authResolver = createAuthResolver(appCredential, session.clientToken);
  const headers = { "X-Connection-Key": connectionRef };

  if (!session.hspModeActive) {
    await setMode({
      auth: authResolver,
      responseStyle: "data",
      requestValidator: undefined,
      responseValidator: undefined,
      headers,
      body: { mode: 4 },
    });
  }

  const setupResponse = unwrapPayload(
    await hspSetup({
      auth: authResolver,
      responseStyle: "data",
      requestValidator: undefined,
      responseValidator: undefined,
      headers,
      body: { stream_id: 1 },
      query: { timeout: 5000 },
    })
  ) as { result?: { max_points?: number } } | undefined;

  const flushResponse = unwrapPayload(
    await hspFlush({
      auth: authResolver,
      responseStyle: "data",
      requestValidator: undefined,
      responseValidator: undefined,
      headers,
      query: { timeout: 5000 },
    })
  ) as { result?: { max_points?: number } } | undefined;

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
      });
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
  actions: FunscriptAction[]
): Promise<void> {
  if (actions.length === 0) return;

  const connectionRef = requireConnectionRef(auth.connectionKey);
  const appCredential = requireAppCredential(auth.appApiKey);
  const scriptId = toScriptId(sourceId, actions);
  if (Date.now() - session.serverTimeOffsetMeasuredAtMs >= SERVER_TIME_OFFSET_TTL_MS) {
    void refreshServerTimeOffset(auth, session);
  }
  await preloadScript(auth, session, sourceId, actions, timeMs);

  if (session.streamedPoints && session.nextStreamPointIndex < session.streamedPoints.length) {
    let playingIdx = session.nextStreamPointIndex - 1;
    while (playingIdx > 0 && session.streamedPoints[playingIdx]!.t > timeMs) {
      playingIdx -= 1;
    }
    const pointsInBuffer = session.nextStreamPointIndex - Math.max(0, playingIdx);

    const shouldTopUpByTime = session.uploadedUntilMs - timeMs <= HSP_TOPUP_TRIGGER_MS;
    const shouldTopUpByPoints =
      pointsInBuffer <= session.maxBufferPoints * HSP_TOPUP_TRIGGER_POINT_RATIO;
    if (shouldTopUpByTime || shouldTopUpByPoints) {
      const targetMs = Math.max(timeMs + HSP_PREFETCH_MS, session.uploadedUntilMs);
      const targetPointCount = Math.floor(session.maxBufferPoints * HSP_TOPUP_TARGET_POINT_RATIO);
      const pointBudget = Math.max(0, targetPointCount - pointsInBuffer);
      const fetchBudget = Math.min(HSP_TOPUP_MAX_POINTS_PER_SYNC, pointBudget);
      if (fetchBudget > 0) {
        await appendPointsUpToTime(auth, session, targetMs, fetchBudget, { paced: true });
      }
    }
  }

  const nextRate = Math.max(0.25, Math.min(3, playbackRate));
  const authResolver = createAuthResolver(appCredential, session.clientToken);
  const headers = { "X-Connection-Key": connectionRef };

  if (session.activeScriptId !== scriptId) {
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
        pause_on_starving: false,
        loop: false,
      },
      query: { timeout: 5000 },
    });
    session.activeScriptId = scriptId;
    session.lastSyncAtMs = 0;
    session.lastPlaybackRate = nextRate;
  }

  const now = Date.now();
  const needsRateUpdate = Math.abs(nextRate - session.lastPlaybackRate) > 0.02;
  const needsTimeSync = now - session.lastSyncAtMs >= 2000;

  if (needsRateUpdate) session.lastPlaybackRate = nextRate;
  if (needsTimeSync) session.lastSyncAtMs = now;

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
      }),
      setHspTime({
        auth: authResolver,
        responseStyle: "data",
        requestValidator: undefined,
        responseValidator: undefined,
        headers,
        body: {
          current_time: Math.max(0, Math.floor(timeMs)),
          server_time: Math.round(getEstimatedServerTimeMs(session)),
          filter: 0.12,
        },
        query: { timeout: 5000 },
      }),
    ]);
  } else if (needsRateUpdate) {
    await setHspPaybackRate({
      auth: authResolver,
      responseStyle: "data",
      requestValidator: undefined,
      responseValidator: undefined,
      headers,
      body: { playback_rate: nextRate },
      query: { timeout: 5000 },
    });
  } else if (needsTimeSync) {
    await setHspTime({
      auth: authResolver,
      responseStyle: "data",
      requestValidator: undefined,
      responseValidator: undefined,
      headers,
      body: {
        current_time: Math.max(0, Math.floor(timeMs)),
        server_time: Math.round(getEstimatedServerTimeMs(session)),
        filter: 0.12,
      },
      query: { timeout: 5000 },
    });
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
  await hspPause({
    auth: createAuthResolver(appCredential, session.clientToken),
    responseStyle: "data",
    requestValidator: undefined,
    responseValidator: undefined,
    headers: {
      "X-Connection-Key": connectionRef,
    },
  });

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
    void refreshServerTimeOffset(auth, session);
  }

  await hspResume({
    auth: authResolver,
    responseStyle: "data",
    requestValidator: undefined,
    responseValidator: undefined,
    headers,
    body: { pick_up: true },
  });

  const now = Date.now();
  const nextRate = Math.max(0.25, Math.min(3, playbackRate));
  const needsRateUpdate = Math.abs(nextRate - session.lastPlaybackRate) > 0.02;

  session.activeScriptId = session.loadedScriptId;
  session.lastSyncAtMs = now;
  if (needsRateUpdate) session.lastPlaybackRate = nextRate;

  const pending: Promise<void>[] = [
    setHspTime({
      auth: authResolver,
      responseStyle: "data",
      requestValidator: undefined,
      responseValidator: undefined,
      headers,
      body: {
        current_time: Math.max(0, Math.floor(resumeAtMs)),
        server_time: Math.round(getEstimatedServerTimeMs(session)),
        filter: 0.12,
      },
      query: { timeout: 5000 },
    }).then(() => { }),
  ];

  if (needsRateUpdate) {
    pending.push(
      setHspPaybackRate({
        auth: authResolver,
        responseStyle: "data",
        requestValidator: undefined,
        responseValidator: undefined,
        headers,
        body: { playback_rate: nextRate },
        query: { timeout: 5000 },
      }).then(() => { })
    );
  }

  await Promise.all(pending);
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
  }).catch(() => { });
}
