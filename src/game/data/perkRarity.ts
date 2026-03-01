import type { PerkDefinition, PerkRarity } from "../types";

type PerkRarityMeta = {
  label: string;
  pixi: {
    stroke: number;
    glow: number;
    nameText: number;
    effectText: number;
    badgeFill: number;
    badgeStroke: number;
    badgeText: number;
  };
  tailwind: {
    badge: string;
    setupSelected: string;
    setupIdle: string;
    inventorySelected: string;
    inventoryIdle: string;
    chip: string;
    feed: string;
  };
};

export const PERK_RARITY_META: Record<PerkRarity, PerkRarityMeta> = {
  common: {
    label: "COMMON",
    pixi: {
      stroke: 0xa7b2c7,
      glow: 0x3f4b60,
      nameText: 0xe7edf8,
      effectText: 0xc9d6f0,
      badgeFill: 0x1f2937,
      badgeStroke: 0x94a3b8,
      badgeText: 0xf1f5f9,
    },
    tailwind: {
      badge: "border-slate-300/55 bg-slate-500/20 text-slate-100",
      setupSelected: "border-slate-300/70 bg-slate-500/20 text-slate-100",
      setupIdle: "border-slate-500/45 bg-slate-500/10 text-slate-100 hover:border-slate-300/55 hover:bg-slate-500/16",
      inventorySelected: "border-slate-300/80 bg-slate-500/18",
      inventoryIdle: "border-slate-500/50 bg-zinc-900/70 hover:border-slate-300/65",
      chip: "border-slate-300/40 bg-slate-500/20 text-slate-50",
      feed: "border-slate-400/45 bg-slate-500/8",
    },
  },
  rare: {
    label: "RARE",
    pixi: {
      stroke: 0x5fd9ff,
      glow: 0x0a6a91,
      nameText: 0xd9f7ff,
      effectText: 0x8ae9ff,
      badgeFill: 0x08394a,
      badgeStroke: 0x67e8f9,
      badgeText: 0xe0fcff,
    },
    tailwind: {
      badge: "border-cyan-300/55 bg-cyan-500/20 text-cyan-100",
      setupSelected: "border-cyan-300/70 bg-cyan-500/20 text-cyan-100",
      setupIdle: "border-cyan-500/45 bg-cyan-500/10 text-cyan-100 hover:border-cyan-300/60 hover:bg-cyan-500/16",
      inventorySelected: "border-cyan-300/80 bg-cyan-500/18",
      inventoryIdle: "border-cyan-500/45 bg-zinc-900/70 hover:border-cyan-300/65",
      chip: "border-cyan-300/40 bg-cyan-500/16 text-cyan-50",
      feed: "border-cyan-400/45 bg-cyan-500/8",
    },
  },
  epic: {
    label: "EPIC",
    pixi: {
      stroke: 0xf08dff,
      glow: 0x8010a3,
      nameText: 0xfbe0ff,
      effectText: 0xf2a5ff,
      badgeFill: 0x3f0f5d,
      badgeStroke: 0xf0abfc,
      badgeText: 0xfdf4ff,
    },
    tailwind: {
      badge: "border-fuchsia-300/55 bg-fuchsia-500/20 text-fuchsia-100",
      setupSelected: "border-fuchsia-300/70 bg-fuchsia-500/20 text-fuchsia-100",
      setupIdle: "border-fuchsia-500/45 bg-fuchsia-500/10 text-fuchsia-100 hover:border-fuchsia-300/60 hover:bg-fuchsia-500/16",
      inventorySelected: "border-fuchsia-300/80 bg-fuchsia-500/18",
      inventoryIdle: "border-fuchsia-500/45 bg-zinc-900/70 hover:border-fuchsia-300/65",
      chip: "border-fuchsia-300/40 bg-fuchsia-500/16 text-fuchsia-50",
      feed: "border-fuchsia-400/45 bg-fuchsia-500/8",
    },
  },
  legendary: {
    label: "LEGENDARY",
    pixi: {
      stroke: 0xffd66f,
      glow: 0xa45d06,
      nameText: 0xfff3c7,
      effectText: 0xffdd8d,
      badgeFill: 0x4f2d07,
      badgeStroke: 0xfcd34d,
      badgeText: 0xfffbeb,
    },
    tailwind: {
      badge: "border-amber-300/55 bg-amber-500/20 text-amber-100",
      setupSelected: "border-amber-300/70 bg-amber-500/20 text-amber-100",
      setupIdle: "border-amber-500/45 bg-amber-500/10 text-amber-100 hover:border-amber-300/60 hover:bg-amber-500/16",
      inventorySelected: "border-amber-300/80 bg-amber-500/18",
      inventoryIdle: "border-amber-500/45 bg-zinc-900/70 hover:border-amber-300/65",
      chip: "border-amber-300/40 bg-amber-500/16 text-amber-50",
      feed: "border-amber-400/45 bg-amber-500/8",
    },
  },
};

export function fallbackRarityFromCost(cost: number): PerkRarity {
  const normalizedCost = Number.isFinite(cost) ? Math.max(0, Math.floor(cost)) : 0;
  if (normalizedCost < 180) return "common";
  if (normalizedCost < 240) return "rare";
  if (normalizedCost < 300) return "epic";
  return "legendary";
}

export function resolvePerkRarity(perk: Pick<PerkDefinition, "rarity" | "cost">): PerkRarity {
  if (perk.rarity) return perk.rarity;
  return fallbackRarityFromCost(perk.cost);
}
