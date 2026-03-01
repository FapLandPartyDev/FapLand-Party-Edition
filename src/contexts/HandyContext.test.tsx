import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HandyProvider, useHandy } from "./HandyContext";
import type { HapticsConnectionResult } from "../services/haptics/types";

const mocks = vi.hoisted(() => ({
  verifyConnection: vi.fn(async (): Promise<HapticsConnectionResult> => ({
    success: true,
    provider: "thehandy",
  })),
  issueHandySession: vi.fn(async () => ({
    provider: "thehandy" as const,
    mode: "appId" as const,
    clientToken: null,
    expiresAtMs: Date.now() + 60_000,
    serverTimeOffsetMs: 0,
    serverTimeOffsetMeasuredAtMs: 0,
    loadedScriptId: null,
    activeScriptId: null,
    lastSyncAtMs: 0,
    lastPlaybackRate: 1,
    maxBufferPoints: 4000,
    streamedPoints: null,
    nextStreamPointIndex: 0,
    tailPointStreamIndex: 0,
    uploadedUntilMs: 0,
    lastHspAddAtMs: 0,
    hspAddBackoffUntilMs: 0,
    hspModeActive: false,
  })),
  sendHapticsSync: vi.fn(async () => undefined),
  stopHandyPlayback: vi.fn(async () => undefined),
  getHandyStroke: vi.fn(async () => ({ min: 0, max: 1, minAbsolute: 0, maxAbsolute: 200 })),
  updateHandyStroke: vi.fn(async (_auth: unknown, input: { min: number; max: number }) => ({
    min: input.min,
    max: input.max,
    minAbsolute: null,
    maxAbsolute: null,
  })),
  getQuery: vi.fn(async () => null),
  setMutate: vi.fn(async () => undefined),
}));

vi.mock("../services/handyApi", () => ({
  verifyConnection: mocks.verifyConnection,
}));

vi.mock("../services/haptics/runtime", () => ({
  verifyHapticsConnection: mocks.verifyConnection,
  getHapticsStroke: mocks.getHandyStroke,
  createHapticsSession: mocks.issueHandySession,
  sendHapticsSync: mocks.sendHapticsSync,
  stopHapticsPlayback: mocks.stopHandyPlayback,
  disconnectHapticsSession: mocks.stopHandyPlayback,
  updateHapticsStroke: mocks.updateHandyStroke,
}));

vi.mock("../services/trpc", () => ({
  trpc: {
    store: {
      get: {
        query: mocks.getQuery,
      },
      set: {
        mutate: mocks.setMutate,
      },
    },
  },
}));

function Consumer() {
  const handy = useHandy();

  return (
    <div>
      <div data-testid="connected">{String(handy.connected)}</div>
      <div data-testid="device-count">{handy.deviceSlots.length}</div>
      <div data-testid="active-device-count">{handy.activeDeviceTargets.length}</div>
      <div data-testid="provider">{handy.provider}</div>
      <div data-testid="intiface-url">{handy.intifaceWebsocketUrl}</div>
      <div data-testid="tcode-host">{handy.tcodeWebsocketHost}</div>
      <div data-testid="tcode-url">{handy.tcodeWebsocketUrl}</div>
      <div data-testid="manually-stopped">{String(handy.manuallyStopped)}</div>
      <div data-testid="synced">{String(handy.synced)}</div>
      <div data-testid="stroke-percent">{String(handy.strokePercent)}</div>
      <div data-testid="stroke-min">{String(handy.strokeMin)}</div>
      <div data-testid="stroke-max">{String(handy.strokeMax)}</div>
      <div data-testid="stroke-error">{handy.strokeError ?? ""}</div>
      <div data-testid="offset-ms">{String(handy.offsetMs)}</div>
      <button
        type="button"
        onClick={() => {
          void handy.connect("conn-key", "", "app-key");
        }}
      >
        connect
      </button>
      <button
        type="button"
        onClick={() => {
          void handy.connectIntiface("ws://127.0.0.1:12345");
        }}
      >
        connect-intiface
      </button>
      <button
        type="button"
        onClick={() => {
          void handy.connectTCode({ transport: "websocket", websocketInput: "192.168.1.42" });
        }}
      >
        connect-tcode
      </button>
      <button
        type="button"
        onClick={() => {
          void handy.forceStop();
        }}
      >
        force-stop
      </button>
      <button
        type="button"
        onClick={() => {
          void handy.toggleManualStop();
        }}
      >
        toggle-stop
      </button>
      <button
        type="button"
        onClick={() => {
          void handy.setStrokeBounds(20, 80);
        }}
      >
        set-stroke
      </button>
      <button
        type="button"
        onClick={() => {
          void handy.disconnect();
        }}
      >
        disconnect
      </button>
      <button
        type="button"
        onClick={() => {
          void handy.adjustOffset(25);
        }}
      >
        adjust-offset
      </button>
      <button
        type="button"
        onClick={() => {
          void handy.resetOffset();
        }}
      >
        reset-offset
      </button>
      <button
        type="button"
        onClick={() => {
          handy.setResourceOffsetOverride(100);
        }}
      >
        set-resource-override
      </button>
      <button
        type="button"
        onClick={() => {
          handy.setResourceOffsetOverride(null);
        }}
      >
        clear-resource-override
      </button>
    </div>
  );
}

describe("HandyContext", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.verifyConnection.mockResolvedValue({ success: true, provider: "thehandy" });
    mocks.issueHandySession.mockResolvedValue({
      provider: "thehandy",
      mode: "appId",
      clientToken: null,
      expiresAtMs: Date.now() + 60_000,
      serverTimeOffsetMs: 0,
      serverTimeOffsetMeasuredAtMs: 0,
      loadedScriptId: null,
      activeScriptId: null,
      lastSyncAtMs: 0,
      lastPlaybackRate: 1,
      maxBufferPoints: 4000,
      streamedPoints: null,
      nextStreamPointIndex: 0,
      tailPointStreamIndex: 0,
      uploadedUntilMs: 0,
      lastHspAddAtMs: 0,
      hspAddBackoffUntilMs: 0,
      hspModeActive: false,
    });
    mocks.stopHandyPlayback.mockResolvedValue(undefined);
    mocks.getHandyStroke.mockResolvedValue({
      min: 0,
      max: 1,
      minAbsolute: 0,
      maxAbsolute: 200,
    });
    mocks.updateHandyStroke.mockImplementation(async (_auth, input) => ({
      min: input.min,
      max: input.max,
      minAbsolute: null,
      maxAbsolute: null,
    }));
    mocks.getQuery.mockResolvedValue(null);
    mocks.setMutate.mockResolvedValue(undefined);
  });

  it("keeps the connection active but marks TheHandy manually stopped after force stop", async () => {
    render(
      <HandyProvider>
        <Consumer />
      </HandyProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "connect" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("true");
      expect(screen.getByTestId("manually-stopped").textContent).toBe("false");
      expect(screen.getByTestId("stroke-percent").textContent).toBe("100");
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "force-stop" }));
    });

    await waitFor(() => {
      expect(mocks.issueHandySession).toHaveBeenCalled();
      expect(mocks.stopHandyPlayback).toHaveBeenCalled();
      expect(screen.getByTestId("connected").textContent).toBe("true");
      expect(screen.getByTestId("manually-stopped").textContent).toBe("true");
      expect(screen.getByTestId("synced").textContent).toBe("false");
    });
  });

  it("keeps multiple providers configured and active at the same time", async () => {
    render(
      <HandyProvider>
        <Consumer />
      </HandyProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "connect" }));
    });
    await waitFor(() => expect(screen.getByTestId("device-count").textContent).toBe("1"));

    mocks.verifyConnection.mockResolvedValueOnce({
      success: true,
      provider: "intiface",
      deviceName: "Vibrator",
      deviceIndex: 3,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "connect-intiface" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("true");
      expect(screen.getByTestId("device-count").textContent).toBe("2");
      expect(screen.getByTestId("active-device-count").textContent).toBe("2");
    });
    expect(mocks.setMutate).toHaveBeenCalledWith(
      expect.objectContaining({ key: "haptics.deviceSlots.v1" })
    );
  });

  it("keeps manual stop engaged even if the remote stop request fails", async () => {
    mocks.stopHandyPlayback.mockRejectedValueOnce(new Error("stop failed"));

    render(
      <HandyProvider>
        <Consumer />
      </HandyProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "connect" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("true");
      expect(screen.getByTestId("manually-stopped").textContent).toBe("false");
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "toggle-stop" }));
    });

    await waitFor(() => {
      expect(mocks.stopHandyPlayback).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("manually-stopped").textContent).toBe("true");
      expect(screen.getByTestId("synced").textContent).toBe("false");
    });
  });

  it("resumes after a manual stop toggle", async () => {
    render(
      <HandyProvider>
        <Consumer />
      </HandyProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "connect" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "toggle-stop" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("manually-stopped").textContent).toBe("true");
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "toggle-stop" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("manually-stopped").textContent).toBe("false");
      expect(screen.getByTestId("synced").textContent).toBe("false");
    });
  });

  it("loads stroke state after connecting", async () => {
    render(
      <HandyProvider>
        <Consumer />
      </HandyProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "connect" }));
    });

    await waitFor(() => {
      expect(mocks.getHandyStroke).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("stroke-min").textContent).toBe("0");
      expect(screen.getByTestId("stroke-max").textContent).toBe("1");
      expect(screen.getByTestId("stroke-percent").textContent).toBe("100");
    });
  });

  it("persists and connects the Intiface provider", async () => {
    mocks.verifyConnection.mockResolvedValueOnce({
      success: true,
      provider: "intiface",
      deviceName: "Linear Device",
      deviceIndex: 2,
    });

    render(
      <HandyProvider>
        <Consumer />
      </HandyProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "connect-intiface" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("true");
      expect(screen.getByTestId("provider").textContent).toBe("intiface");
      expect(mocks.verifyConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "intiface",
          websocketUrl: "ws://127.0.0.1:12345",
        })
      );
      expect(mocks.setMutate).toHaveBeenCalledWith({
        key: "haptics.provider",
        value: "intiface",
      });
    });
  });

  it("updates Intiface stroke state app-side", async () => {
    mocks.verifyConnection.mockResolvedValueOnce({
      success: true,
      provider: "intiface",
      deviceName: "Linear Device",
      deviceIndex: 2,
    });

    render(
      <HandyProvider>
        <Consumer />
      </HandyProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "connect-intiface" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "set-stroke" }));
    });

    await waitFor(() => {
      expect(mocks.updateHandyStroke).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "intiface",
          stroke: expect.objectContaining({ min: 0.2, max: 0.8 }),
        }),
        expect.objectContaining({ min: 0.2, max: 0.8 })
      );
      expect(screen.getByTestId("stroke-percent").textContent).toBe("60");
    });
  });

  it("persists and connects the TCode provider with a normalized websocket host", async () => {
    mocks.verifyConnection.mockResolvedValueOnce({
      success: true,
      provider: "tcode",
      deviceName: "192.168.1.42",
    });

    render(
      <HandyProvider>
        <Consumer />
      </HandyProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "connect-tcode" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("true");
      expect(screen.getByTestId("provider").textContent).toBe("tcode");
      expect(screen.getByTestId("tcode-host").textContent).toBe("192.168.1.42");
      expect(screen.getByTestId("tcode-url").textContent).toBe("ws://192.168.1.42/ws");
      expect(mocks.verifyConnection).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "tcode",
          websocketHost: "192.168.1.42",
          websocketUrl: "ws://192.168.1.42/ws",
        })
      );
      expect(mocks.setMutate).toHaveBeenCalledWith({
        key: "haptics.provider",
        value: "tcode",
      });
      expect(mocks.setMutate).toHaveBeenCalledWith({
        key: "tcode.websocketHost",
        value: "192.168.1.42",
      });
    });
  });

  it("updates stroke percent optimistically and commits the device result", async () => {
    render(
      <HandyProvider>
        <Consumer />
      </HandyProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "connect" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "set-stroke" }));
    });

    await waitFor(() => {
      expect(mocks.updateHandyStroke).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("stroke-percent").textContent).toBe("60");
      expect(screen.getByTestId("stroke-min").textContent).toBe("0.2");
      expect(screen.getByTestId("stroke-max").textContent).toBe("0.8");
    });
  });

  it("rolls stroke state back if updating the device fails", async () => {
    mocks.updateHandyStroke.mockRejectedValueOnce(
      new Error("Failed to update TheHandy stroke settings.")
    );

    render(
      <HandyProvider>
        <Consumer />
      </HandyProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "connect" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "set-stroke" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("stroke-percent").textContent).toBe("100");
      expect(screen.getByTestId("stroke-error").textContent).toBe(
        "Failed to update TheHandy stroke settings."
      );
    });
  });

  it("clears stroke state after disconnecting", async () => {
    render(
      <HandyProvider>
        <Consumer />
      </HandyProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "connect" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "disconnect" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("false");
      expect(screen.getByTestId("stroke-percent").textContent).toBe("100");
      expect(screen.getByTestId("stroke-error").textContent).toBe("");
    });
  });

  it("uses the resource offset override instead of the global offset", async () => {
    render(
      <HandyProvider>
        <Consumer />
      </HandyProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "adjust-offset" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("offset-ms").textContent).toBe("25");
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "set-resource-override" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("offset-ms").textContent).toBe("100");
    });
  });

  it("adjusts the resource override instead of the global offset when override is active", async () => {
    render(
      <HandyProvider>
        <Consumer />
      </HandyProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "set-resource-override" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("offset-ms").textContent).toBe("100");
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "adjust-offset" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("offset-ms").textContent).toBe("125");
    });

    expect(mocks.setMutate).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: expect.stringContaining("theHandyOffset") })
    );
  });

  it("resets the resource override to zero while override is active", async () => {
    render(
      <HandyProvider>
        <Consumer />
      </HandyProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "set-resource-override" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("offset-ms").textContent).toBe("100");
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "reset-offset" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("offset-ms").textContent).toBe("0");
    });
  });

  it("returns to the global offset after clearing the resource override", async () => {
    render(
      <HandyProvider>
        <Consumer />
      </HandyProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "adjust-offset" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("offset-ms").textContent).toBe("25");
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "set-resource-override" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("offset-ms").textContent).toBe("100");
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "clear-resource-override" }));
    });

    await waitFor(() => {
      expect(screen.getByTestId("offset-ms").textContent).toBe("25");
    });
  });
});
