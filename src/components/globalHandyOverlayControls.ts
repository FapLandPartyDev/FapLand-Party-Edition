type OverlayOpenListener = () => void;

const openListeners = new Set<OverlayOpenListener>();
let pendingOpen = false;

let saveOffsetCallback: (() => void) | null = null;
const saveOffsetAvailabilityListeners = new Set<(available: boolean) => void>();

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
  for (const listener of saveOffsetAvailabilityListeners) listener(callback !== null);
}

export function getSaveOffsetToRoundCallback(): (() => void) | null {
  return saveOffsetCallback;
}

export function subscribeToSaveOffsetAvailability(listener: (available: boolean) => void) {
  saveOffsetAvailabilityListeners.add(listener);
  listener(saveOffsetCallback !== null);
  return () => saveOffsetAvailabilityListeners.delete(listener);
}
