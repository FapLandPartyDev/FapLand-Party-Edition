import { TREE_VIEWBOX } from "./skillTree";

export const MIN_SKILL_TREE_SCALE = 0.5;
export const MAX_SKILL_TREE_SCALE = 2.4;
export const READABLE_SKILL_TREE_PX_PER_UNIT = 0.95;

export type SkillTreeCamera = { x: number; y: number; scale: number };

export type SkillTreeViewport = {
  left: number;
  top: number;
  width: number;
  height: number;
  rendered: number;
  worldUnitsPerPixel: number;
};

export function clampSkillTreeScale(scale: number): number {
  return Math.min(MAX_SKILL_TREE_SCALE, Math.max(MIN_SKILL_TREE_SCALE, scale));
}

export function getReadableSkillTreeScale(rendered: number): number {
  if (rendered <= 0) return 1.4;
  return clampSkillTreeScale((TREE_VIEWBOX.size * READABLE_SKILL_TREE_PX_PER_UNIT) / rendered);
}

export function measureSkillTreeViewport(rect: {
  left: number;
  top: number;
  width: number;
  height: number;
}): SkillTreeViewport | null {
  const rendered = Math.min(rect.width, rect.height);
  if (rendered <= 0) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    rendered,
    worldUnitsPerPixel: TREE_VIEWBOX.size / rendered,
  };
}

export function skillTreeScreenToWorld(
  clientX: number,
  clientY: number,
  viewport: SkillTreeViewport,
  camera: SkillTreeCamera
): { x: number; y: number } {
  const viewX =
    TREE_VIEWBOX.minX +
    (clientX - viewport.left - (viewport.width - viewport.rendered) / 2) *
      viewport.worldUnitsPerPixel;
  const viewY =
    TREE_VIEWBOX.minY +
    (clientY - viewport.top - (viewport.height - viewport.rendered) / 2) *
      viewport.worldUnitsPerPixel;
  return { x: viewX / camera.scale + camera.x, y: viewY / camera.scale + camera.y };
}

export function skillTreeScreenDeltaToWorld(
  deltaX: number,
  deltaY: number,
  viewport: SkillTreeViewport,
  camera: SkillTreeCamera
): { x: number; y: number } {
  const unit = viewport.worldUnitsPerPixel / camera.scale;
  return { x: deltaX * unit, y: deltaY * unit };
}

export function zoomSkillTreeAt(
  camera: SkillTreeCamera,
  anchor: { x: number; y: number },
  nextScale: number
): SkillTreeCamera {
  const scale = clampSkillTreeScale(nextScale);
  const viewX = (anchor.x - camera.x) * camera.scale;
  const viewY = (anchor.y - camera.y) * camera.scale;
  return {
    x: anchor.x - viewX / scale,
    y: anchor.y - viewY / scale,
    scale,
  };
}

export function createLatestFrameScheduler<T>(
  requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (handle: number) => void,
  apply: (value: T) => void
): {
  schedule: (value: T) => void;
  flush: () => void;
  cancel: () => void;
} {
  let handle = 0;
  let pending: T | undefined;

  const applyPending = (): void => {
    handle = 0;
    if (pending === undefined) return;
    const value = pending;
    pending = undefined;
    apply(value);
  };

  return {
    schedule(value) {
      pending = value;
      if (handle === 0) handle = requestFrame(applyPending);
    },
    flush() {
      if (handle !== 0) cancelFrame(handle);
      applyPending();
    },
    cancel() {
      if (handle !== 0) cancelFrame(handle);
      handle = 0;
      pending = undefined;
    },
  };
}
