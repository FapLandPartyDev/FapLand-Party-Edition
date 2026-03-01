import { client } from "./client.gen";

const HANDY_HTTP_TIMEOUT_MS = 8_000;

function createTimeoutFetch(timeoutMs: number): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const existingSignal = init?.signal;
    if (existingSignal) {
      if (existingSignal.aborted) {
        clearTimeout(timeoutId);
        controller.abort();
      } else {
        existingSignal.addEventListener(
          "abort",
          () => controller.abort(),
          { once: true }
        );
      }
    }

    try {
      return await globalThis.fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

client.setConfig({ fetch: createTimeoutFetch(HANDY_HTTP_TIMEOUT_MS) });
