import { randomUUID } from "node:crypto";
import type { BrowserWindow, MouseInputEvent } from "electron";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ControlTool } from "./protocol";

const point = z.object({ x: z.number().nonnegative(), y: z.number().nonnegative() });
export const ZScreenshot = z.object({
  maxWidth: z.number().int().min(320).max(2560).default(1600),
  maxHeight: z.number().int().min(240).max(2560).default(1200),
});
export const ZScreenInput = z
  .object({
    action: z.enum(["click", "move", "drag", "scroll", "type", "key"]),
    screenshotId: z
      .string()
      .min(1)
      .describe(
        "ID returned by fland_screenshot or the previous visual action. Coordinates are pixels in that image."
      ),
    point: point.optional(),
    to: point.optional().describe("Drag destination in screenshot image pixels."),
    button: z.enum(["left", "middle", "right"]).default("left"),
    clickCount: z.number().int().min(1).max(3).default(1),
    scrollX: z.number().min(-10000).max(10000).default(0),
    scrollY: z
      .number()
      .min(-10000)
      .max(10000)
      .default(0)
      .describe("Positive scrolls down; negative scrolls up. Units are screenshot pixels."),
    text: z.string().max(20000).optional(),
    key: z
      .string()
      .min(1)
      .max(40)
      .optional()
      .describe(
        "Electron key name, e.g. Enter, Tab, Escape, Backspace, ArrowLeft or A. Supply shortcut modifiers separately."
      ),
    modifiers: z
      .array(z.enum(["shift", "control", "alt", "meta"]))
      .max(4)
      .default([]),
    durationMs: z.number().int().min(100).max(2000).default(400),
    settleMs: z.number().int().min(0).max(2000).default(150),
    screenshotAfter: z.boolean().default(true),
  })
  .superRefine((input, ctx) => {
    if (["click", "move", "drag", "scroll"].includes(input.action) && !input.point)
      ctx.addIssue({ code: "custom", message: "point is required for this mouse action." });
    if (input.action === "drag" && !input.to)
      ctx.addIssue({ code: "custom", message: "to is required for dragging." });
    if (input.action === "type" && input.text === undefined)
      ctx.addIssue({ code: "custom", message: "text is required for typing." });
    if (input.action === "key" && !input.key)
      ctx.addIssue({ code: "custom", message: "key is required for keyboard input." });
  });

type Observation = {
  screenshotId: string;
  capturedAt: string;
  url: string;
  title: string;
  imageWidth: number;
  imageHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  zoomFactor: number;
  coordinateSystem: string;
  image: { data: string; mimeType: "image/png" };
};
type Snapshot = Observation & {
  contentsId: number;
  created: number;
  maxWidth: number;
  maxHeight: number;
};
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createScreenTools(getWindow: () => BrowserWindow | null): ControlTool[] {
  const snapshots = new Map<string, Snapshot>();
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const task = queue.then(operation);
    queue = task.catch(() => {});
    return task;
  };
  const windowNow = () => {
    const window = getWindow();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed())
      throw new Error("The app window is unavailable.");
    return window;
  };
  const capture = async (input: z.infer<typeof ZScreenshot>): Promise<Observation> => {
    const window = windowNow();
    const [viewportWidth, viewportHeight] = window.getContentSize();
    const zoomFactor = window.webContents.getZoomFactor();
    const bitmap = await (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await window.webContents.capturePage();
        } catch (error) {
          if (attempt >= 2 || window.isDestroyed() || window.webContents.isDestroyed()) throw error;
          await delay(100 * (attempt + 1));
        }
      }
    })();
    if (bitmap.isEmpty())
      throw new Error("No app image is available. Restore the app window and retry.");
    const current = window.getContentSize();
    if (
      current[0] !== viewportWidth ||
      current[1] !== viewportHeight ||
      window.webContents.getZoomFactor() !== zoomFactor
    )
      throw new Error("The window changed while capturing. Take another screenshot.");
    const size = bitmap.getSize();
    const scale = Math.min(1, input.maxWidth / size.width, input.maxHeight / size.height);
    const imageWidth = Math.max(1, Math.round(size.width * scale));
    const imageHeight = Math.max(1, Math.round(size.height * scale));
    const image = scale < 1 ? bitmap.resize({ width: imageWidth, height: imageHeight }) : bitmap;
    const png = image.toPNG();
    const observation: Observation = {
      screenshotId: randomUUID(),
      capturedAt: new Date().toISOString(),
      url: window.webContents.getURL(),
      title: window.webContents.getTitle(),
      // NativeImage can carry high-DPI representations. The encoded PNG's
      // dimensions are the coordinate space the agent actually sees.
      imageWidth: png.readUInt32BE(16),
      imageHeight: png.readUInt32BE(20),
      viewportWidth,
      viewportHeight,
      zoomFactor,
      coordinateSystem:
        "Use image pixels with origin (0,0) at the top-left of this screenshot. Inputs map image pixels to the app viewport automatically, including display scaling and zoom.",
      image: { data: png.toString("base64"), mimeType: "image/png" },
    };
    const now = Date.now();
    for (const [id, snapshot] of snapshots)
      if (now - snapshot.created > 120000) snapshots.delete(id);
    while (snapshots.size >= 8) snapshots.delete(snapshots.keys().next().value!);
    snapshots.set(observation.screenshotId, {
      ...observation,
      contentsId: window.webContents.id,
      created: now,
      ...input,
    });
    return observation;
  };
  const input = async (request: z.infer<typeof ZScreenInput>) => {
    const window = windowNow();
    const snapshot = snapshots.get(request.screenshotId);
    if (!snapshot || Date.now() - snapshot.created > 120000)
      throw new Error("Screenshot expired or unknown. Take a fresh screenshot before acting.");
    const [width, height] = window.getContentSize();
    const contents = window.webContents;
    if (
      snapshot.contentsId !== contents.id ||
      width !== snapshot.viewportWidth ||
      height !== snapshot.viewportHeight ||
      contents.getZoomFactor() !== snapshot.zoomFactor ||
      contents.getURL() !== snapshot.url
    )
      throw new Error(
        "The app navigated, resized or changed zoom. Take a fresh screenshot before acting."
      );
    const map = (p: z.infer<typeof point>) => {
      if (p.x >= snapshot.imageWidth || p.y >= snapshot.imageHeight)
        throw new Error("Point is outside the screenshot.");
      return {
        x: Math.floor((p.x * width) / snapshot.imageWidth),
        y: Math.floor((p.y * height) / snapshot.imageHeight),
      };
    };
    // Validate every coordinate before any input is sent.
    const start = request.point ? map(request.point) : undefined;
    const end = request.to ? map(request.to) : undefined;
    if (window.isMinimized()) window.restore();
    window.focus();
    contents.focus();
    const heldModifiers = {
      left: "leftbuttondown",
      middle: "middlebuttondown",
      right: "rightbuttondown",
    } as const;
    const mouse = (
      type: MouseInputEvent["type"],
      position: { x: number; y: number },
      held = false,
      clickCount = request.clickCount
    ) =>
      contents.sendInputEvent({
        type,
        ...position,
        button: request.button,
        clickCount,
        modifiers: [...request.modifiers, ...(held ? [heldModifiers[request.button]] : [])],
      });
    if (request.action === "click") {
      mouse("mouseMove", start!);
      // Real consecutive down/up pairs are required for browser double-clicks.
      for (let count = 1; count <= request.clickCount; count++) {
        mouse("mouseDown", start!, false, count);
        mouse("mouseUp", start!, false, count);
      }
    } else if (request.action === "move") mouse("mouseMove", start!);
    else if (request.action === "drag") {
      mouse("mouseMove", start!);
      mouse("mouseDown", start!, false, 1);
      let last = start!;
      try {
        const steps = Math.max(8, Math.min(60, Math.ceil(request.durationMs / 16)));
        for (let step = 1; step <= steps; step++) {
          await delay(request.durationMs / steps);
          last = {
            x: Math.round(start!.x + ((end!.x - start!.x) * step) / steps),
            y: Math.round(start!.y + ((end!.y - start!.y) * step) / steps),
          };
          mouse("mouseMove", last, true, 1);
        }
      } finally {
        if (!contents.isDestroyed()) mouse("mouseUp", last, false, 1);
      }
    } else if (request.action === "scroll") {
      mouse("mouseMove", start!);
      contents.sendInputEvent({
        type: "mouseWheel",
        ...start!,
        deltaX: -Math.round((request.scrollX * width) / snapshot.imageWidth),
        deltaY: -Math.round((request.scrollY * height) / snapshot.imageHeight),
        canScroll: true,
        modifiers: request.modifiers,
      });
    } else if (request.action === "type") await contents.insertText(request.text!);
    else if (request.action === "key") {
      const aliases: Record<string, string> = {
        ArrowLeft: "Left",
        ArrowRight: "Right",
        ArrowUp: "Up",
        ArrowDown: "Down",
        " ": "Space",
      };
      const keyCode = aliases[request.key!] ?? request.key!;
      contents.sendInputEvent({ type: "keyDown", keyCode, modifiers: request.modifiers });
      contents.sendInputEvent({ type: "keyUp", keyCode, modifiers: request.modifiers });
    }
    await delay(request.settleMs);
    return {
      success: true,
      action: request.action,
      ...(request.screenshotAfter
        ? {
            observation: await capture({
              maxWidth: snapshot.maxWidth,
              maxHeight: snapshot.maxHeight,
            }),
          }
        : {}),
    };
  };
  return [
    {
      name: "fland_screenshot",
      description:
        "See the running app exactly as rendered, including video, canvas maps, dialogs and menus. Returns a PNG image plus screenshotId and image dimensions. Use fland_ui_input with this screenshotId and image-pixel coordinates to click, drag, scroll, type and press keys. Captures only the app content, not other desktop apps or OS dialogs.",
      schema: ZScreenshot,
      readOnly: true,
      run: (input: z.infer<typeof ZScreenshot>) => serialized(() => capture(input)),
    },
    {
      name: "fland_ui_input",
      description:
        "Drive the app visually with real browser input: click (clickCount 2 for double-click), move/hover, drag, scroll (positive scrollY down), Unicode type into the focused field, or keyboard keys/shortcuts with modifiers. First use fland_screenshot; coordinates are pixels in that returned image. Returns a fresh screenshot after the action by default. For DOM controls you can also use fland_ui inspect/click/set. Input focuses the app window.",
      schema: ZScreenInput,
      run: (request: z.infer<typeof ZScreenInput>) => serialized(() => input(request)),
    },
  ];
}

export function formatScreenResult(name: string, result: unknown): CallToolResult | undefined {
  if (name !== "fland_screenshot" && name !== "fland_ui_input") return;
  const value = result as { observation?: Observation } & Partial<Observation>;
  const observation = name === "fland_screenshot" ? (value as Observation) : value.observation;
  if (!observation) return;
  const { image, ...metadata } = observation;
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          name === "fland_screenshot"
            ? metadata
            : {
                success: true,
                action: (result as { action: string }).action,
                observation: metadata,
              }
        ),
      },
      { type: "image", data: image.data, mimeType: image.mimeType },
    ],
  };
}
