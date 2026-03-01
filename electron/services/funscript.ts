import fs from "node:fs/promises";
import { fromLocalMediaUri } from "./localMedia";

type FunscriptAction = {
  at: number;
  pos: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeActions(input: unknown): FunscriptAction[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const at = "at" in entry ? Number((entry as { at: unknown }).at) : Number.NaN;
      const pos = "pos" in entry ? Number((entry as { pos: unknown }).pos) : Number.NaN;
      if (!Number.isFinite(at) || !Number.isFinite(pos)) return null;
      return { at, pos };
    })
    .filter((entry): entry is FunscriptAction => entry !== null)
    .sort((a, b) => a.at - b.at);
}

function calculateDifficulty(actions: FunscriptAction[]): number | null {
  if (actions.length < 2) return null;

  const durationMs = actions[actions.length - 1].at - actions[0].at;
  if (!(durationMs > 0)) return null;

  const durationSec = durationMs / 1000;
  const pointRate = actions.length / durationSec;

  let velocitySamples = 0;
  let velocitySum = 0;
  for (let index = 1; index < actions.length; index += 1) {
    const previous = actions[index - 1];
    const current = actions[index];
    if (!previous || !current) continue;
    const deltaTimeSec = (current.at - previous.at) / 1000;
    if (deltaTimeSec <= 0) continue;
    const deltaPos = Math.abs(current.pos - previous.pos);
    velocitySum += deltaPos / deltaTimeSec;
    velocitySamples += 1;
  }

  if (velocitySamples === 0) return null;

  const avgVelocity = velocitySum / velocitySamples;
  const pointNorm = clamp(Math.log1p(pointRate) / Math.log1p(8), 0, 1);
  const velocityNorm = clamp(Math.log1p(avgVelocity) / Math.log1p(400), 0, 1);
  const lengthNorm = clamp(durationSec / 60 / 3, 0, 1);
  const score = 0.55 * velocityNorm + 0.35 * pointNorm + 0.1 * lengthNorm;
  return clamp(Math.round(1 + score * 4), 1, 5);
}

async function readFunscriptContent(uri: string): Promise<string | null> {
  const localPath = fromLocalMediaUri(uri);
  if (localPath) {
    return await fs.readFile(localPath, "utf8");
  }

  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    const response = await fetch(uri);
    if (!response.ok) return null;
    return await response.text();
  }

  return null;
}

export async function calculateFunscriptDifficultyFromUri(
  uri: string | null | undefined
): Promise<number | null> {
  const trimmedUri = typeof uri === "string" ? uri.trim() : "";
  if (!trimmedUri) return null;

  try {
    const content = await readFunscriptContent(trimmedUri);
    if (!content) return null;
    const parsed = JSON.parse(content) as { actions?: unknown };
    return calculateDifficulty(normalizeActions(parsed.actions));
  } catch {
    return null;
  }
}
