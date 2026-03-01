import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerGlobalOpenedFileDropHandler } from "./openedFileDrop";

const originalElectronAPI = window.electronAPI;
let cleanup: UpdateUnsubscribe | undefined;

function createFileEvent(type: string, dataTransfer: Partial<DataTransfer>): DragEvent {
  const event = new Event(type, { cancelable: true }) as DragEvent;
  Object.defineProperty(event, "dataTransfer", {
    value: dataTransfer,
  });
  return event;
}

describe("registerGlobalOpenedFileDropHandler", () => {
  beforeEach(() => {
    window.electronAPI = {
      appOpen: {
        consumePendingFiles: vi.fn(async () => []),
        openDroppedFiles: vi.fn(async () => {}),
        subscribe: vi.fn(() => () => {}),
      },
    } as never;
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    window.electronAPI = originalElectronAPI;
  });

  it("prevents browser navigation and opens dropped files", () => {
    cleanup = registerGlobalOpenedFileDropHandler();
    const files = [new File(["content"], "demo.fpack")];
    const event = createFileEvent("drop", {
      types: ["Files"],
      files: files as unknown as FileList,
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(window.electronAPI.appOpen.openDroppedFiles).toHaveBeenCalledWith(files);

  });

  it("sets copy drop effect while dragging files over the app", () => {
    cleanup = registerGlobalOpenedFileDropHandler();
    const dataTransfer = {
      types: ["Files"],
      dropEffect: "none" as DataTransfer["dropEffect"],
      files: [] as unknown as FileList,
    };
    const event = createFileEvent("dragover", dataTransfer);

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe("copy");

  });

  it("does not intercept non-file drops", () => {
    cleanup = registerGlobalOpenedFileDropHandler();
    const event = createFileEvent("drop", {
      types: ["text/plain"],
      files: [] as unknown as FileList,
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(window.electronAPI.appOpen.openDroppedFiles).not.toHaveBeenCalled();

  });
});
