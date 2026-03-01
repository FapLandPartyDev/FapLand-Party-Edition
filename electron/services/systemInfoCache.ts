import si from "systeminformation";

const SYSTEM_INFO_TIMEOUT_MS = 5000;

export type AvailableGpu = {
  index: number;
  name: string;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

type GraphicsInfo = Awaited<ReturnType<typeof si.graphics>>;

let cachedGraphics: GraphicsInfo | null = null;
let graphicsPromise: Promise<GraphicsInfo | null> | null = null;
let cachedAvailableGpus: AvailableGpu[] | null = null;

export async function getGraphicsInfo(): Promise<GraphicsInfo | null> {
  if (cachedGraphics) return cachedGraphics;
  if (graphicsPromise) return graphicsPromise;

  graphicsPromise = withTimeout(si.graphics(), SYSTEM_INFO_TIMEOUT_MS)
    .then((info) => {
      cachedGraphics = info;
      return info;
    })
    .catch(() => null)
    .finally(() => {
      graphicsPromise = null;
    });

  return graphicsPromise;
}

export async function listAvailableGpus(): Promise<AvailableGpu[]> {
  if (cachedAvailableGpus !== null) return cachedAvailableGpus;
  const graphics = await getGraphicsInfo();
  if (!graphics) {
    cachedAvailableGpus = [];
    return cachedAvailableGpus;
  }
  cachedAvailableGpus = graphics.controllers.map((controller, index) => ({
    index,
    name: [controller.vendor, controller.model].filter(Boolean).join(" ") || `GPU ${index}`,
  }));
  return cachedAvailableGpus;
}

export async function getCpuInfo(): Promise<Awaited<ReturnType<typeof si.cpu>> | null> {
  try {
    return await withTimeout(si.cpu(), SYSTEM_INFO_TIMEOUT_MS);
  } catch {
    return null;
  }
}

export async function getMemInfo(): Promise<Awaited<ReturnType<typeof si.mem>> | null> {
  try {
    return await withTimeout(si.mem(), SYSTEM_INFO_TIMEOUT_MS);
  } catch {
    return null;
  }
}

export async function getOsInfo(): Promise<Awaited<ReturnType<typeof si.osInfo>> | null> {
  try {
    return await withTimeout(si.osInfo(), SYSTEM_INFO_TIMEOUT_MS);
  } catch {
    return null;
  }
}

export function __resetSystemInfoCacheForTests(): void {
  cachedGraphics = null;
  cachedAvailableGpus = null;
  graphicsPromise = null;
}
