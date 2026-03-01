type OverlayOpenListener = () => void;

const openListeners = new Set<OverlayOpenListener>();
let pendingOpen = false;

let saveOffsetCallback: (() => void) | null = null;

export function openGlobalHandyOverlay() {
  if (openListeners.size === 0) {
    pendingOpen = true;
    return;
  }

  pendingOpen = false;
  for (const listener of openListeners) {
    listener();
  }
}

export function subscribeToGlobalHandyOverlayOpen(listener: OverlayOpenListener) {
  openListeners.add(listener);

  if (pendingOpen) {
    pendingOpen = false;
    listener();
  }

  return () => {
    openListeners.delete(listener);
  };
}

export function registerSaveOffsetToRound(callback: (() => void) | null) {
  saveOffsetCallback = callback;
}

export function getSaveOffsetToRoundCallback(): (() => void) | null {
  return saveOffsetCallback;
}
