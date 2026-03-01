import type { ToastVariant } from "../components/ui/ToastHost";

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

  const preventFileDropNavigation = (event: DragEvent) => {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (event.type === "dragover") {
      event.dataTransfer.dropEffect = "copy";
    }
  };

  const handleDrop = (event: DragEvent) => {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();

    void openDroppedFiles(event.dataTransfer.files).catch((error) => {
      console.error("Failed to open dropped files", error);
      options.showToast?.(
        error instanceof Error ? error.message : "Failed to open dropped files.",
        "error"
      );
    });
  };

  target.addEventListener("dragenter", preventFileDropNavigation);
  target.addEventListener("dragover", preventFileDropNavigation);
  target.addEventListener("drop", handleDrop);

  return () => {
    target.removeEventListener("dragenter", preventFileDropNavigation);
    target.removeEventListener("dragover", preventFileDropNavigation);
    target.removeEventListener("drop", handleDrop);
  };
}
