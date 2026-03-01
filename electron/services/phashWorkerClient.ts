import { utilityProcess, type UtilityProcess } from "electron";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import type { NormalizedVideoHashRange } from "./phash/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEBUG = process.env.FLAND_DEBUG_LOGGING === "1";

function debugLog(...args: unknown[]): void {
  if (DEBUG) console.log(...args);
}

function debugError(...args: unknown[]): void {
  if (DEBUG) console.error(...args);
}

type PhashTask = {
  taskId: string;
  payload: {
    ffmpegPath: string;
    videoPath: string;
    range: NormalizedVideoHashRange;
    options?: { lowPriority?: boolean; headers?: Record<string, string> };
  };
  resolve: (phash: string) => void;
  reject: (error: Error) => void;
};

let workerReadyPromise: Promise<UtilityProcess> | null = null;
const pendingTasks = new Map<string, PhashTask>();
let taskCounter = 0;

const TASK_TIMEOUT_MS = 60_000 * 3; // 3 minutes

function getWorkerPath(): string {
  return path.join(__dirname, "phashWorker.js");
}

let currentWorker: UtilityProcess | null = null;

function killWorker(): void {
  if (currentWorker) {
    try {
      currentWorker.kill();
    } catch {
      // Best effort
    }
    currentWorker = null;
  }
  workerReadyPromise = null;
}

function ensureWorker(): Promise<UtilityProcess> {
  if (workerReadyPromise) {
    return workerReadyPromise;
  }

  workerReadyPromise = new Promise((resolve, reject) => {
    const workerPath = getWorkerPath();
    debugLog(`[PhashWorkerClient] Spawning worker: ${workerPath}`);

    const w = utilityProcess.fork(workerPath, [], {
      stdio: "inherit",
      serviceName: "phash-worker",
    });
    currentWorker = w;

    const startTimeout = setTimeout(() => {
      debugError(`[PhashWorkerClient] Worker failed to send ready message within timeout`);
      workerReadyPromise = null;
      currentWorker = null;
      w.kill();
      reject(new Error("Worker initialization timed out"));
    }, 30000);

    w.on("message", (message: Record<string, unknown>) => {
      debugLog(`[PhashWorkerClient] DEBUG: Received message:`, JSON.stringify(message));
      if (!message || typeof message !== "object") return;

      const { type, taskId, payload } = message;
      const msgPayload = payload as Record<string, unknown> | undefined;

      if (type === "worker-log" && msgPayload) {
        if (msgPayload.isError) {
          console.error(msgPayload.message);
        } else {
          console.log(msgPayload.message);
        }
        return;
      }

      if (type === "worker-ready") {
        debugLog(`[PhashWorkerClient] Worker reported ready`);
        clearTimeout(startTimeout);
        resolve(w);
        return;
      }

      const task = pendingTasks.get(taskId as string);
      if (!task) return;

      if (type === "phash-result" && msgPayload) {
        debugLog(`[PhashWorkerClient] [${taskId}] Received result`);
        pendingTasks.delete(taskId as string);
        task.resolve(msgPayload.phash as string);
      } else if (type === "phash-error" && msgPayload) {
        debugError(`[PhashWorkerClient] [${taskId}] Received error: ${msgPayload.message}`);
        pendingTasks.delete(taskId as string);
        const error = new Error(msgPayload.message as string);
        error.stack = msgPayload.stack as string | undefined;
        task.reject(error);
      }
    });

    w.on("exit", (code) => {
      debugLog(`[PhashWorkerClient] Worker exited with code ${code}`);
      clearTimeout(startTimeout);
      workerReadyPromise = null;
      currentWorker = null;

      for (const [taskId, task] of pendingTasks.entries()) {
        task.reject(new Error(`Worker exited unexpectedly with code ${code}`));
        pendingTasks.delete(taskId);
      }

      reject(new Error(`Worker exited with code ${code}`));
    });

    w.on("error", (err) => {
      debugError(`[PhashWorkerClient] Worker error:`, err);
      reject(err);
    });
  });

  return workerReadyPromise;
}

export async function computePhashInWorker(
  ffmpegPath: string,
  videoPath: string,
  range: NormalizedVideoHashRange,
  options?: { lowPriority?: boolean; headers?: Record<string, string> }
): Promise<string> {
  const w = await ensureWorker();
  const taskId = `${Date.now()}-${taskCounter++}`;

  if (options?.lowPriority && w.pid) {
    try {
      os.setPriority(w.pid, os.constants.priority.PRIORITY_LOW);
    } catch {
      // Best effort
    }
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pendingTasks.has(taskId)) {
        debugError(`[PhashWorkerClient] [${taskId}] Task timed out after ${TASK_TIMEOUT_MS}ms`);
        pendingTasks.delete(taskId);
        killWorker();
        reject(new Error(`Phash computation timed out after ${TASK_TIMEOUT_MS}ms`));
      }
    }, TASK_TIMEOUT_MS);

    pendingTasks.set(taskId, {
      taskId,
      payload: { ffmpegPath, videoPath, range, options },
      resolve: (phash) => {
        clearTimeout(timeout);
        resolve(phash);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    });

    debugLog(`[PhashWorkerClient] [${taskId}] Sending task to worker`);
    w.postMessage({
      type: "compute-phash",
      taskId,
      payload: { ffmpegPath, videoPath, range, options },
    });
  });
}
