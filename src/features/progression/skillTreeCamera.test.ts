import { describe, expect, it, vi } from "vitest";
import {
  MAX_SKILL_TREE_SCALE,
  MIN_SKILL_TREE_SCALE,
  clampSkillTreeScale,
  createLatestFrameScheduler,
  getReadableSkillTreeScale,
  measureSkillTreeViewport,
  skillTreeScreenDeltaToWorld,
  skillTreeScreenToWorld,
  zoomSkillTreeAt,
} from "./skillTreeCamera";

describe("skill tree camera", () => {
  it("clamps zoom to the supported range", () => {
    expect(clampSkillTreeScale(0.1)).toBe(MIN_SKILL_TREE_SCALE);
    expect(clampSkillTreeScale(8)).toBe(MAX_SKILL_TREE_SCALE);
    expect(clampSkillTreeScale(1.25)).toBe(1.25);
  });

  it("keeps the world-space cursor anchor fixed while zooming", () => {
    const camera = { x: 40, y: -25, scale: 1 };
    const anchor = { x: 180, y: 90 };
    const zoomed = zoomSkillTreeAt(camera, anchor, 2);
    expect((anchor.x - zoomed.x) * zoomed.scale).toBe((anchor.x - camera.x) * camera.scale);
    expect((anchor.y - zoomed.y) * zoomed.scale).toBe((anchor.y - camera.y) * camera.scale);
  });

  it("converts screen points and deltas using the measured viewport", () => {
    const viewport = measureSkillTreeViewport({ left: 10, top: 20, width: 1000, height: 500 });
    expect(viewport).not.toBeNull();
    expect(skillTreeScreenToWorld(510, 270, viewport!, { x: 25, y: -15, scale: 2 })).toEqual({
      x: 25,
      y: -15,
    });
    expect(skillTreeScreenDeltaToWorld(10, -20, viewport!, { x: 0, y: 0, scale: 2 })).toEqual({
      x: 19,
      y: -38,
    });
  });

  it("recomputes readable framing from resized measurements", () => {
    const small = measureSkillTreeViewport({ left: 0, top: 0, width: 500, height: 500 })!;
    const large = measureSkillTreeViewport({ left: 0, top: 0, width: 1200, height: 900 })!;
    expect(getReadableSkillTreeScale(small.rendered)).toBe(MAX_SKILL_TREE_SCALE);
    expect(getReadableSkillTreeScale(large.rendered)).toBeCloseTo(2.0056, 3);
  });

  it("coalesces queued camera updates to the latest value", () => {
    let frame: FrameRequestCallback | undefined;
    const apply = vi.fn();
    const scheduler = createLatestFrameScheduler(
      (callback) => {
        frame = callback;
        return 1;
      },
      vi.fn(),
      apply
    );
    scheduler.schedule({ x: 1 });
    scheduler.schedule({ x: 2 });
    expect(apply).not.toHaveBeenCalled();
    frame?.(0);
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith({ x: 2 });
  });
});
