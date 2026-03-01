import { ZMcpUiRequest, type McpUiRequest } from "./types";
import { controlMapEditor, mapEditorAvailable } from "./mapEditorControl";

export function createUiControl(navigate: (path: string) => Promise<unknown>) {
  const ids = new WeakMap<Element, string>();
  let sequence = 0;
  let targets = new Map<string, HTMLElement>();
  const visible = (element: HTMLElement) => {
    const style = getComputedStyle(element);
    return (
      !element.closest('[hidden], [aria-hidden="true"], [inert]') &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getClientRects().length > 0
    );
  };
  const inspect = () => {
    targets = new Map();
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        'button, a[href], input, textarea, select, [role="button"], [role="slider"], [contenteditable="true"], video, audio'
      ),
    ]
      .filter(visible)
      .map((element) => {
        let id = ids.get(element);
        if (!id) {
          id = `control-${++sequence}`;
          ids.set(element, id);
        }
        targets.set(id, element);
        const input = element as HTMLInputElement;
        const rect = element.getBoundingClientRect();
        const media =
          element instanceof HTMLMediaElement
            ? {
                paused: element.paused,
                currentTime: element.currentTime,
                duration: Number.isFinite(element.duration) ? element.duration : null,
                volume: element.volume,
                muted: element.muted,
              }
            : undefined;
        return {
          targetId: id,
          bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          inViewport:
            rect.right > 0 &&
            rect.bottom > 0 &&
            rect.left < window.innerWidth &&
            rect.top < window.innerHeight,
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role"),
          label:
            element.getAttribute("aria-label") ??
            input.labels?.[0]?.textContent?.trim() ??
            element.getAttribute("title") ??
            element.textContent?.trim().slice(0, 250),
          type: input.type,
          disabled: input.disabled ?? element.getAttribute("aria-disabled") === "true",
          ...(input.type === "password" ? {} : { value: input.value }),
          ...(input.type === "checkbox" || input.type === "radio"
            ? { checked: input.checked }
            : {}),
          ...(element instanceof HTMLSelectElement
            ? {
                options: [...element.options].map((option) => ({
                  value: option.value,
                  label: option.label,
                })),
              }
            : {}),
          ...(media ? { media } : {}),
        };
      });
    return {
      url: location.href,
      title: document.title,
      text: document.body.innerText?.slice(0, 16000),
      controls,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        boundsUnit:
          "CSS viewport pixels; scale by screenshot imageWidth / viewport.width to map to screenshot pixels",
      },
      canvases: [...document.querySelectorAll("canvas")].filter(visible).map((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return {
          label: canvas.getAttribute("aria-label") ?? canvas.id,
          bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      }),
    };
  };
  return async (raw: McpUiRequest) => {
    const input = ZMcpUiRequest.parse(raw);
    if (input.action === "mapEditor") {
      if (!input.editor) throw new Error("Provide a map editor request.");
      return controlMapEditor(input.editor);
    }
    if (input.action === "inspect")
      return { ...inspect(), liveMapEditorAvailable: mapEditorAvailable() };
    if (input.action === "navigate") {
      if (!input.path || input.path.startsWith("//"))
        throw new Error("Provide an internal app path starting with a single slash.");
      await navigate(input.path);
      return { success: true, path: input.path };
    }
    const element = input.targetId
      ? targets.get(input.targetId)
      : input.action === "key"
        ? (document.activeElement as HTMLElement)
        : undefined;
    if (!element || !element.isConnected || (input.targetId && !visible(element)))
      throw new Error("Control is unavailable. Inspect the UI again.");
    if ((element as HTMLButtonElement).disabled || element.getAttribute("aria-disabled") === "true")
      throw new Error("Control is disabled.");
    if (input.action === "click") element.click();
    else if (input.action === "key") {
      if (!input.key) throw new Error("Provide a keyboard key.");
      element.focus();
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: input.key,
          code: input.key === " " ? "Space" : input.key,
          bubbles: true,
          cancelable: true,
        })
      );
      element.dispatchEvent(new KeyboardEvent("keyup", { key: input.key, bubbles: true }));
    } else if (input.action === "set") {
      element.focus();
      if (
        element instanceof HTMLInputElement &&
        (element.type === "checkbox" || element.type === "radio")
      ) {
        if (typeof input.value !== "boolean") throw new Error("Checkbox values must be boolean.");
        if (element.checked !== input.value) element.click();
      } else if (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
      ) {
        if (input.value === undefined) throw new Error("Provide a value.");
        if (element instanceof HTMLInputElement && element.type === "file")
          throw new Error("Use backend import tools with a file path for files.");
        const prototype =
          element instanceof HTMLInputElement
            ? HTMLInputElement.prototype
            : element instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLSelectElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
          element,
          String(input.value)
        );
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (element.isContentEditable) {
        element.textContent = String(input.value ?? "");
        element.dispatchEvent(new Event("input", { bubbles: true }));
      } else throw new Error("This control does not accept a value.");
      element.blur();
    } else if (input.action === "media") {
      if (!(element instanceof HTMLMediaElement))
        throw new Error("Target must be a video or audio element.");
      if (input.mediaAction === "play") await element.play();
      else if (input.mediaAction === "pause") element.pause();
      else if (input.mediaAction === "mute" && typeof input.value === "boolean")
        element.muted = input.value;
      else if (
        input.mediaAction === "seek" &&
        typeof input.value === "number" &&
        input.value >= 0 &&
        Number.isFinite(element.duration) &&
        input.value <= element.duration
      )
        element.currentTime = input.value;
      else if (
        input.mediaAction === "volume" &&
        typeof input.value === "number" &&
        input.value >= 0 &&
        input.value <= 1
      )
        element.volume = input.value;
      else throw new Error("Invalid media action or value.");
    }
    return { success: true, action: input.action, targetId: input.targetId };
  };
}
