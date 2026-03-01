import type { ToastVariant } from "../components/ui/ToastHost";
import { setDragActive, requestDropConfirmation } from "../components/GlobalDragOverlay";

type ToastHandler = (message: string, variant: ToastVariant) => void;

type DropTarget = Pick<Window, "addEventListener" | "removeEventListener">;

type RegisterOpenedFileDropOptions = {
  target?: DropTarget;
  showToast?: ToastHandler;
};

function hasFiles(dataTransfer: DataTransfer | null): dataTransfer is DataTransfer {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes("Files"));
}

export function registerGlobalOpenedFileDropHandler(
  options: RegisterOpenedFileDropOptions = {}
): UpdateUnsubscribe | undefined {
  if (typeof window === "undefined" || !window.electronAPI?.appOpen?.openDroppedFiles) {
    return undefined;
  }

  const { openDroppedFiles } = window.electronAPI.appOpen;
  const target = options.target ?? window;

  let dragCounter = 0;

  const handleDragEnter = (event: DragEvent) => {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragCounter++;
    setDragActive(true);
  };

  const handleDragOver = (event: DragEvent) => {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: DragEvent) => {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      setDragActive(false);
    }
  };

  const handleDrop = (event: DragEvent) => {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragCounter = 0;
    setDragActive(false);

    const files = Array.from(event.dataTransfer.files);
    const fileNames = files.map((f) => f.name);

    void requestDropConfirmation(fileNames).then((confirmed) => {
      if (!confirmed) return;
      return openDroppedFiles(files).catch((error) => {
        console.error("Failed to open dropped files", error);
        options.showToast?.(
          error instanceof Error ? error.message : "Failed to open dropped files.",
          "error"
        );
      });
    });
  };

  target.addEventListener("dragenter", handleDragEnter);
  target.addEventListener("dragover", handleDragOver);
  target.addEventListener("dragleave", handleDragLeave);
  target.addEventListener("drop", handleDrop);

  return () => {
    target.removeEventListener("dragenter", handleDragEnter);
    target.removeEventListener("dragover", handleDragOver);
    target.removeEventListener("dragleave", handleDragLeave);
    target.removeEventListener("drop", handleDrop);
  };
}
