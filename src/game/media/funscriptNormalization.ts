type Action = { at: number; pos: number };

/** Shared by playback and converter inspection/detection. */
export function normalizeFunscriptTimelineDocument(
  raw: { actions?: unknown; range?: unknown; inverted?: unknown },
  autofixBrokenFunscripts: boolean
): Action[] {
  const number = (value: unknown) => {
    if (typeof value !== "number" && typeof value !== "string") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const range = number(raw.range);
  const effectiveRange = autofixBrokenFunscripts && range === 90 ? 100 : range;
  const scale = effectiveRange !== null && effectiveRange > 0 ? effectiveRange : 100;
  const actions = (Array.isArray(raw.actions) ? raw.actions : [])
    .flatMap((action): Action[] => {
      if (!action || typeof action !== "object") return [];
      const at = number(action.at);
      const pos = number(action.pos);
      if (at === null || pos === null) return [];
      const normalized = Math.max(0, Math.min(100, (pos / scale) * 100));
      return [{ at: Math.max(0, at), pos: raw.inverted === true ? 100 - normalized : normalized }];
    })
    .sort((a, b) => a.at - b.at);
  const first = actions[0];
  if (first && first.at > 0) actions.unshift({ at: 0, pos: first.pos });
  return actions;
}
