// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScreenTools, formatScreenResult } from "./screenControl";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createControlServer } from "./protocol";
import { router } from "../trpc/trpc";

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const png = (width: number, height: number) => {
    const buffer = Buffer.alloc(24);
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    return buffer;
  };
  const resized = { toPNG: () => png(1600, 1067) };
  const bitmap = {
    isEmpty: () => false,
    getSize: () => ({ width: 2400, height: 1600 }),
    resize: vi.fn(() => resized),
    toPNG: () => png(2400, 1600),
  };
  const window = {
    isDestroyed: () => false,
    getContentSize: vi.fn(() => [1200, 800]),
    isMinimized: () => false,
    restore: vi.fn(),
    focus: vi.fn(),
    webContents: {
      id: 7,
      isDestroyed: () => false,
      getZoomFactor: vi.fn(() => 1.5),
      getURL: vi.fn(() => "app://renderer/#/map-editor"),
      getTitle: () => "F-Land",
      capturePage: vi.fn(async () => bitmap),
      focus: vi.fn(),
      sendInputEvent: vi.fn(),
      insertText: vi.fn(async () => {}),
    },
  };
  const tools = createScreenTools(() => window as never);
  const run = async (name: string, input: unknown) => {
    const tool = tools.find((tool) => tool.name === name)!;
    return (await tool.run(tool.schema.parse(input) as never)) as Record<string, unknown>;
  };
  return { tools, window, bitmap, run, capture: () => run("fland_screenshot", {}) };
}
describe("visual app control", () => {
  it("returns native image content with an explicit coordinate system and scaled dimensions", async () => {
    const { capture, bitmap } = fixture();
    const result = await capture();
    expect(result).toMatchObject({
      imageWidth: 1600,
      imageHeight: 1067,
      viewportWidth: 1200,
      viewportHeight: 800,
      zoomFactor: 1.5,
    });
    expect(bitmap.resize).toHaveBeenCalledWith({ width: 1600, height: 1067 });
    const formatted = formatScreenResult("fland_screenshot", result)!;
    expect(formatted.content[1]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect((formatted.content[0] as { text: string }).text).not.toContain("resized-png");
  });
  it("maps screenshot pixels to viewport coordinates at high DPI and dispatches actual double-click pairs", async () => {
    const { capture, run, window } = fixture();
    const screenshot = await capture();
    await run("fland_ui_input", {
      action: "click",
      screenshotId: screenshot.screenshotId,
      point: { x: 800, y: 533.5 },
      clickCount: 2,
      settleMs: 0,
    });
    expect(window.focus).toHaveBeenCalled();
    const events = window.webContents.sendInputEvent.mock.calls.map(([event]) => event);
    expect(events.map((event) => event.type)).toEqual([
      "mouseMove",
      "mouseDown",
      "mouseUp",
      "mouseDown",
      "mouseUp",
    ]);
    expect(events[1]).toMatchObject({ x: 600, y: 400, clickCount: 1 });
    expect(events[3].clickCount).toBe(2);
    expect(window.webContents.capturePage).toHaveBeenCalledTimes(2);
  });
  it("rejects stale geometry, navigation and expired screenshot IDs before sending input", async () => {
    const { capture, run, window } = fixture();
    const snapshot = await capture();
    const click = () =>
      run("fland_ui_input", {
        action: "click",
        screenshotId: snapshot.screenshotId,
        point: { x: 1, y: 1 },
      });
    window.getContentSize.mockReturnValueOnce([900, 600]);
    await expect(click()).rejects.toThrow("fresh screenshot");
    window.webContents.getZoomFactor.mockReturnValueOnce(2);
    await expect(click()).rejects.toThrow("fresh screenshot");
    window.webContents.getURL.mockReturnValueOnce("app://renderer/#/rounds");
    await expect(click()).rejects.toThrow("fresh screenshot");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 121000);
    await expect(click()).rejects.toThrow("expired");
    expect(window.webContents.sendInputEvent).not.toHaveBeenCalled();
  });
  it("rejects missing and off-image coordinates before focusing or clicking", async () => {
    const { capture, run, window } = fixture();
    const snapshot = await capture();
    await expect(
      run("fland_ui_input", { action: "click", screenshotId: snapshot.screenshotId })
    ).rejects.toThrow("point");
    await expect(
      run("fland_ui_input", {
        action: "drag",
        screenshotId: snapshot.screenshotId,
        point: { x: 1, y: 1 },
        to: { x: 1600, y: 1 },
      })
    ).rejects.toThrow("outside");
    expect(window.focus).not.toHaveBeenCalled();
  });
  it("supports Unicode text, real keyboard shortcuts and downward scroll", async () => {
    const { capture, run, window } = fixture();
    const { screenshotId } = await capture();
    await run("fland_ui_input", {
      action: "type",
      screenshotId,
      text: "Runde – 日本語",
      screenshotAfter: false,
      settleMs: 0,
    });
    expect(window.webContents.insertText).toHaveBeenCalledWith("Runde – 日本語");
    await run("fland_ui_input", {
      action: "key",
      screenshotId,
      key: "A",
      modifiers: ["control"],
      screenshotAfter: false,
      settleMs: 0,
    });
    expect(window.webContents.sendInputEvent).toHaveBeenCalledWith({
      type: "keyDown",
      keyCode: "A",
      modifiers: ["control"],
    });
    await run("fland_ui_input", {
      action: "scroll",
      screenshotId,
      point: { x: 100, y: 100 },
      scrollY: 200,
      screenshotAfter: false,
      settleMs: 0,
    });
    expect(window.webContents.sendInputEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "mouseWheel", deltaY: -150 })
    );
  });
  it("drags with a held button and always releases it at the destination", async () => {
    const { capture, run, window } = fixture();
    const { screenshotId } = await capture();
    await run("fland_ui_input", {
      action: "drag",
      screenshotId,
      point: { x: 0, y: 0 },
      to: { x: 800, y: 533.5 },
      durationMs: 100,
      settleMs: 0,
      screenshotAfter: false,
    });
    const events = window.webContents.sendInputEvent.mock.calls.map(([event]) => event);
    expect(
      events.some(
        (event) => event.type === "mouseMove" && event.modifiers.includes("leftbuttondown")
      )
    ).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "mouseUp", x: 600, y: 400 });
  });
  it("serializes competing input operations", async () => {
    const { capture, run, window } = fixture();
    const { screenshotId } = await capture();
    await Promise.all([
      run("fland_ui_input", {
        action: "drag",
        screenshotId,
        point: { x: 0, y: 0 },
        to: { x: 100, y: 100 },
        durationMs: 100,
        settleMs: 0,
        screenshotAfter: false,
      }),
      run("fland_ui_input", {
        action: "key",
        screenshotId,
        key: "Enter",
        settleMs: 0,
        screenshotAfter: false,
      }),
    ]);
    const types = window.webContents.sendInputEvent.mock.calls.map(([event]) => event.type);
    expect(types.lastIndexOf("mouseUp")).toBeLessThan(types.indexOf("keyDown"));
  });
  it("returns screenshots as images through a real MCP client and follows input with a fresh screenshot", async () => {
    const { tools, window } = fixture();
    const server = createControlServer({
      router: router({}),
      context: () => ({ source: "mcp" }),
      tools,
      formatResult: formatScreenResult,
    });
    const client = new Client({ name: "visual-test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const screenshot = await client.callTool({ name: "fland_screenshot", arguments: {} });
      const metadata = JSON.parse((screenshot.content as Array<{ text: string }>)[0].text);
      expect(screenshot.content).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "image", mimeType: "image/png" })])
      );
      const action = await client.callTool({
        name: "fland_ui_input",
        arguments: {
          action: "click",
          screenshotId: metadata.screenshotId,
          point: { x: 20, y: 20 },
          settleMs: 0,
        },
      });
      const after = JSON.parse((action.content as Array<{ text: string }>)[0].text);
      expect(after.observation.screenshotId).not.toBe(metadata.screenshotId);
      expect(action.content).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "image", mimeType: "image/png" })])
      );
      expect(window.webContents.sendInputEvent).toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
