type OverlayOpenListener = () => void;

const listeners = new Set<OverlayOpenListener>();
let pendingOpen = false;

export function openGlobalMusicOverlay() {
  if (listeners.size === 0) {
    pendingOpen = true;
    return;
  }

  pendingOpen = false;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeToGlobalMusicOverlayOpen(listener: OverlayOpenListener) {
  listeners.add(listener);

  if (pendingOpen) {
    pendingOpen = false;
    listener();
  }

  return () => {
    listeners.delete(listener);
  };
}
