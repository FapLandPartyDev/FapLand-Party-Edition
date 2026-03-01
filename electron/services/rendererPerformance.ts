export type RendererActivity = "critical" | "interactive" | "idle";

type RendererPerformanceState = {
  route: string;
  visible: boolean;
  activity: RendererActivity;
  updatedAt: number;
};

let rendererPerformanceState: RendererPerformanceState = {
  route: "unknown",
  visible: false,
  activity: "idle",
  updatedAt: Date.now(),
};

export function getRendererPerformanceState(): RendererPerformanceState {
  return rendererPerformanceState;
}

export function setRendererPerformanceState(
  nextState: Partial<Omit<RendererPerformanceState, "updatedAt">>
): RendererPerformanceState {
  rendererPerformanceState = {
    ...rendererPerformanceState,
    ...nextState,
    updatedAt: Date.now(),
  };

  return rendererPerformanceState;
}

export function shouldDeferBackgroundWork(): boolean {
  // Never let automatic indexing/FFmpeg work compete with an active renderer.
  // Critical routes remain protected when hidden because video, haptics, and
  // multiplayer activity can intentionally continue in the background.
  return rendererPerformanceState.activity === "critical" || rendererPerformanceState.visible;
}
