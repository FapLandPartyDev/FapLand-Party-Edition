import { createTRPCProxyClient } from "@trpc/client";
import { describe, expect, it } from "vitest";
import { ipcLink } from "trpc-electron/renderer";
import superjson from "superjson";
import type { AppRouter } from "../../electron/trpc/router";

describe("tRPC Electron link", () => {
  it("serializes renderer requests through trpc-electron without crashing", async () => {
    const sentMessages: unknown[] = [];
    let onMessage: ((message: unknown) => void) | null = null;

    (
      globalThis as typeof globalThis & {
        electronTRPC?: {
          sendMessage: (message: unknown) => void;
          onMessage: (callback: (message: unknown) => void) => void;
        };
      }
    ).electronTRPC = {
      sendMessage: (message: unknown) => {
        sentMessages.push(message);

        if (
          !onMessage ||
          typeof message !== "object" ||
          message === null ||
          !("method" in message) ||
          message.method !== "request" ||
          !("operation" in message) ||
          typeof message.operation !== "object" ||
          message.operation === null ||
          !("id" in message.operation)
        ) {
          return;
        }

        queueMicrotask(() => {
          const op = message.operation as { id: unknown };
          onMessage?.({
            id: op.id,
            result: {
              type: "data",
              data: superjson.serialize(null),
            },
          });
        });
      },
      onMessage: (callback) => {
        onMessage = callback;
      },
    };

    const client = createTRPCProxyClient<AppRouter>({
      links: [ipcLink<AppRouter>({ transformer: superjson as never })],
    });

    await expect(client.store.get.query({ key: "single-player" })).resolves.toBeNull();
    expect(sentMessages).toHaveLength(1);
  });
});
