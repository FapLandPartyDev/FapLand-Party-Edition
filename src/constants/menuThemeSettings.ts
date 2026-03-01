export const MENU_THEME_KEY = "display.mainMenuTheme";
export const MENU_THEME_CHANGED_EVENT = "f-land:main-menu-theme-change";
export const DEFAULT_MENU_THEME_ID = "classic";

export const MAIN_MENU_THEME_IDS = [
  "classic",
  "neon-noir",
  "ember",
  "verdant",
  "monochrome",
  "sunset",
] as const;

export type MainMenuThemeId = (typeof MAIN_MENU_THEME_IDS)[number];

export type MainMenuTheme = {
  id: MainMenuThemeId;
  label: string;
  description: string;
  preview: {
    from: string;
    via: string;
    to: string;
  };
  cssVars: Record<string, string>;
};

const classicCssVars = {
  "--main-menu-bg": "#050508",
  "--main-menu-orb-a":
    "radial-gradient(circle, rgba(139,92,246,0.35) 0%, rgba(139,92,246,0.08) 60%, transparent 80%)",
  "--main-menu-orb-b":
    "radial-gradient(circle, rgba(99,102,241,0.28) 0%, rgba(99,102,241,0.06) 60%, transparent 80%)",
  "--main-menu-orb-c":
    "radial-gradient(circle, rgba(236,72,153,0.18) 0%, rgba(236,72,153,0.04) 60%, transparent 80%)",
  "--main-menu-orb-d": "radial-gradient(circle, rgba(167,139,250,0.2) 0%, transparent 70%)",
  "--main-menu-particle-1": "rgba(139,92,246,0.7)",
  "--main-menu-particle-2": "rgba(99,102,241,0.6)",
  "--main-menu-particle-3": "rgba(167,139,250,0.5)",
  "--main-menu-particle-4": "rgba(236,72,153,0.4)",
  "--main-menu-particle-5": "rgba(255,255,255,0.3)",
  "--main-menu-eyebrow": "rgba(192,132,252,0.7)",
  "--main-menu-title-gradient":
    "linear-gradient(135deg, #e8d5ff 0%, #a78bfa 20%, #f5f3ff 40%, #818cf8 60%, #c4b5fd 80%, #f0f9ff 100%)",
  "--main-menu-title-shadow":
    "drop-shadow(0 0 40px rgba(139,92,246,0.5)) drop-shadow(0 0 80px rgba(139,92,246,0.2))",
  "--main-menu-divider":
    "linear-gradient(to right, transparent, rgba(139,92,246,0.8), rgba(99,102,241,0.6), transparent)",
  "--main-menu-primary-gradient":
    "linear-gradient(to right, rgba(124,58,237,0.8), rgba(147,51,234,0.8), rgba(79,70,229,0.8))",
  "--main-menu-primary-gradient-active":
    "linear-gradient(to right, rgb(139,92,246), rgb(168,85,247), rgb(99,102,241))",
  "--main-menu-primary-border": "rgba(147,51,234,0.4)",
  "--main-menu-primary-border-active": "rgba(167,139,250,0.6)",
  "--main-menu-primary-glow": "rgba(139,92,246,0.65)",
  "--main-menu-primary-glow-soft": "rgba(139,92,246,0.2)",
  "--main-menu-primary-text": "rgb(237,233,254)",
  "--main-menu-primary-text-active": "rgb(255,255,255)",
  "--main-menu-primary-arrow": "rgb(221,214,254)",
  "--main-menu-focus-ring": "rgba(192,132,252,0.6)",
  "--main-menu-focus-ring-rgb": "192, 132, 252",
  "--main-menu-secondary-active-bg": "rgba(39,39,42,0.8)",
  "--main-menu-secondary-bg": "rgba(24,24,27,0.6)",
  "--main-menu-secondary-border-active": "rgba(113,113,122,0.5)",
  "--main-menu-secondary-border": "rgba(63,63,70,0.3)",
  "--main-menu-secondary-glow": "rgba(255,255,255,0.12)",
  "--main-menu-system-panel-bg":
    "linear-gradient(to bottom right, rgba(24,24,27,0.3), rgba(24,24,27,0.25), rgba(39,39,42,0.2))",
  "--main-menu-system-panel-border": "rgba(255,255,255,0.1)",
  "--main-menu-system-divider":
    "linear-gradient(to right, transparent, rgba(167,139,250,0.4), transparent)",
  "--main-menu-system-label": "rgba(221,214,254,0.8)",
  "--main-menu-system-card-bg": "rgba(49,46,129,0.08)",
  "--main-menu-system-card-border": "rgba(165,180,252,0.2)",
  "--main-menu-system-accent": "rgba(165,180,252,0.8)",
  "--main-menu-system-accent-muted": "rgba(199,210,254,0.7)",
  "--main-menu-system-text": "rgba(224,231,255,0.9)",
  "--main-menu-system-text-muted": "rgba(199,210,254,0.6)",
};

export const MAIN_MENU_THEMES: readonly MainMenuTheme[] = [
  {
    id: "classic",
    label: "Classic",
    description: "The original violet and indigo main menu.",
    preview: { from: "#7c3aed", via: "#a855f7", to: "#4f46e5" },
    cssVars: classicCssVars,
  },
  {
    id: "neon-noir",
    label: "Neon Noir",
    description: "Magenta, hot pink, orange, and deep black.",
    preview: { from: "#ff2d95", via: "#f97316", to: "#111827" },
    cssVars: {
      ...classicCssVars,
      "--main-menu-bg":
        "radial-gradient(circle at 18% 12%, rgba(255,45,149,0.22), transparent 34%), radial-gradient(circle at 82% 2%, rgba(249,115,22,0.18), transparent 32%), radial-gradient(circle at 58% 92%, rgba(251,191,36,0.1), transparent 38%), #050305",
      "--main-menu-orb-a":
        "radial-gradient(circle, rgba(255,45,149,0.34) 0%, rgba(255,45,149,0.08) 60%, transparent 80%)",
      "--main-menu-orb-b":
        "radial-gradient(circle, rgba(249,115,22,0.3) 0%, rgba(249,115,22,0.07) 60%, transparent 80%)",
      "--main-menu-orb-c":
        "radial-gradient(circle, rgba(251,191,36,0.18) 0%, rgba(251,191,36,0.04) 60%, transparent 80%)",
      "--main-menu-orb-d": "radial-gradient(circle, rgba(244,63,94,0.2) 0%, transparent 70%)",
      "--main-menu-particle-1": "rgba(255,45,149,0.72)",
      "--main-menu-particle-2": "rgba(249,115,22,0.62)",
      "--main-menu-particle-3": "rgba(251,191,36,0.48)",
      "--main-menu-particle-4": "rgba(244,63,94,0.48)",
      "--main-menu-eyebrow": "rgba(251,113,133,0.78)",
      "--main-menu-title-gradient":
        "linear-gradient(135deg, #fff1f7 0%, #ff5ab3 22%, #fff7ed 42%, #f97316 62%, #fb7185 82%, #fffaf0 100%)",
      "--main-menu-title-shadow":
        "drop-shadow(0 0 40px rgba(255,45,149,0.5)) drop-shadow(0 0 80px rgba(249,115,22,0.24))",
      "--main-menu-divider":
        "linear-gradient(to right, transparent, rgba(255,45,149,0.78), rgba(249,115,22,0.65), transparent)",
      "--main-menu-primary-gradient":
        "linear-gradient(to right, rgba(219,39,119,0.84), rgba(244,63,94,0.82), rgba(249,115,22,0.82))",
      "--main-menu-primary-gradient-active":
        "linear-gradient(to right, rgb(236,72,153), rgb(244,63,94), rgb(249,115,22))",
      "--main-menu-primary-border": "rgba(244,114,182,0.44)",
      "--main-menu-primary-border-active": "rgba(251,146,60,0.68)",
      "--main-menu-primary-glow": "rgba(236,72,153,0.65)",
      "--main-menu-primary-glow-soft": "rgba(249,115,22,0.23)",
      "--main-menu-primary-text": "rgb(255,228,240)",
      "--main-menu-primary-arrow": "rgb(254,205,211)",
      "--main-menu-focus-ring": "rgba(251,113,133,0.64)",
      "--main-menu-focus-ring-rgb": "251, 113, 133",
      "--main-menu-system-divider":
        "linear-gradient(to right, transparent, rgba(251,113,133,0.45), transparent)",
      "--main-menu-system-label": "rgba(254,205,211,0.82)",
      "--main-menu-system-card-bg": "rgba(136,19,55,0.14)",
      "--main-menu-system-card-border": "rgba(251,113,133,0.24)",
      "--main-menu-system-accent": "rgba(251,113,133,0.84)",
      "--main-menu-system-accent-muted": "rgba(254,205,211,0.72)",
      "--main-menu-system-text": "rgba(255,241,242,0.92)",
      "--main-menu-system-text-muted": "rgba(254,205,211,0.62)",
    },
  },
  {
    id: "ember",
    label: "Ember",
    description: "Red, amber, gold, and charcoal.",
    preview: { from: "#b91c1c", via: "#f59e0b", to: "#27272a" },
    cssVars: {
      ...classicCssVars,
      "--main-menu-bg":
        "radial-gradient(circle at 18% 10%, rgba(220,38,38,0.24), transparent 34%), radial-gradient(circle at 86% 4%, rgba(245,158,11,0.2), transparent 34%), radial-gradient(circle at 54% 92%, rgba(251,191,36,0.12), transparent 40%), #080403",
      "--main-menu-orb-a":
        "radial-gradient(circle, rgba(220,38,38,0.34) 0%, rgba(220,38,38,0.08) 60%, transparent 80%)",
      "--main-menu-orb-b":
        "radial-gradient(circle, rgba(245,158,11,0.3) 0%, rgba(245,158,11,0.07) 60%, transparent 80%)",
      "--main-menu-orb-c":
        "radial-gradient(circle, rgba(251,191,36,0.2) 0%, rgba(251,191,36,0.05) 60%, transparent 80%)",
      "--main-menu-orb-d": "radial-gradient(circle, rgba(248,113,113,0.2) 0%, transparent 70%)",
      "--main-menu-particle-1": "rgba(248,113,113,0.72)",
      "--main-menu-particle-2": "rgba(245,158,11,0.64)",
      "--main-menu-particle-3": "rgba(251,191,36,0.54)",
      "--main-menu-particle-4": "rgba(185,28,28,0.46)",
      "--main-menu-eyebrow": "rgba(252,165,165,0.78)",
      "--main-menu-title-gradient":
        "linear-gradient(135deg, #fff1f2 0%, #f87171 20%, #fef3c7 42%, #f59e0b 62%, #fbbf24 82%, #fff7ed 100%)",
      "--main-menu-title-shadow":
        "drop-shadow(0 0 40px rgba(220,38,38,0.5)) drop-shadow(0 0 80px rgba(245,158,11,0.22))",
      "--main-menu-divider":
        "linear-gradient(to right, transparent, rgba(239,68,68,0.78), rgba(245,158,11,0.68), transparent)",
      "--main-menu-primary-gradient":
        "linear-gradient(to right, rgba(185,28,28,0.84), rgba(217,119,6,0.82), rgba(202,138,4,0.82))",
      "--main-menu-primary-gradient-active":
        "linear-gradient(to right, rgb(220,38,38), rgb(245,158,11), rgb(234,179,8))",
      "--main-menu-primary-border": "rgba(248,113,113,0.42)",
      "--main-menu-primary-border-active": "rgba(251,191,36,0.68)",
      "--main-menu-primary-glow": "rgba(220,38,38,0.62)",
      "--main-menu-primary-glow-soft": "rgba(245,158,11,0.24)",
      "--main-menu-primary-text": "rgb(255,237,213)",
      "--main-menu-primary-arrow": "rgb(254,215,170)",
      "--main-menu-focus-ring": "rgba(251,191,36,0.64)",
      "--main-menu-focus-ring-rgb": "251, 191, 36",
      "--main-menu-system-divider":
        "linear-gradient(to right, transparent, rgba(251,191,36,0.45), transparent)",
      "--main-menu-system-label": "rgba(254,215,170,0.82)",
      "--main-menu-system-card-bg": "rgba(127,29,29,0.14)",
      "--main-menu-system-card-border": "rgba(251,191,36,0.24)",
      "--main-menu-system-accent": "rgba(251,191,36,0.84)",
      "--main-menu-system-accent-muted": "rgba(254,215,170,0.72)",
      "--main-menu-system-text": "rgba(255,247,237,0.92)",
      "--main-menu-system-text-muted": "rgba(254,215,170,0.62)",
    },
  },
  {
    id: "verdant",
    label: "Verdant",
    description: "Emerald, lime, teal, and near-black.",
    preview: { from: "#059669", via: "#84cc16", to: "#0f766e" },
    cssVars: {
      ...classicCssVars,
      "--main-menu-bg":
        "radial-gradient(circle at 18% 10%, rgba(16,185,129,0.22), transparent 34%), radial-gradient(circle at 84% 4%, rgba(132,204,22,0.18), transparent 34%), radial-gradient(circle at 54% 92%, rgba(20,184,166,0.13), transparent 40%), #020705",
      "--main-menu-orb-a":
        "radial-gradient(circle, rgba(16,185,129,0.32) 0%, rgba(16,185,129,0.08) 60%, transparent 80%)",
      "--main-menu-orb-b":
        "radial-gradient(circle, rgba(132,204,22,0.28) 0%, rgba(132,204,22,0.07) 60%, transparent 80%)",
      "--main-menu-orb-c":
        "radial-gradient(circle, rgba(20,184,166,0.2) 0%, rgba(20,184,166,0.05) 60%, transparent 80%)",
      "--main-menu-orb-d": "radial-gradient(circle, rgba(190,242,100,0.2) 0%, transparent 70%)",
      "--main-menu-particle-1": "rgba(52,211,153,0.7)",
      "--main-menu-particle-2": "rgba(132,204,22,0.62)",
      "--main-menu-particle-3": "rgba(45,212,191,0.52)",
      "--main-menu-particle-4": "rgba(190,242,100,0.42)",
      "--main-menu-eyebrow": "rgba(134,239,172,0.78)",
      "--main-menu-title-gradient":
        "linear-gradient(135deg, #ecfdf5 0%, #34d399 20%, #f7fee7 42%, #84cc16 62%, #2dd4bf 82%, #f0fdfa 100%)",
      "--main-menu-title-shadow":
        "drop-shadow(0 0 40px rgba(16,185,129,0.48)) drop-shadow(0 0 80px rgba(132,204,22,0.2))",
      "--main-menu-divider":
        "linear-gradient(to right, transparent, rgba(16,185,129,0.76), rgba(132,204,22,0.66), transparent)",
      "--main-menu-primary-gradient":
        "linear-gradient(to right, rgba(5,150,105,0.84), rgba(13,148,136,0.82), rgba(101,163,13,0.82))",
      "--main-menu-primary-gradient-active":
        "linear-gradient(to right, rgb(16,185,129), rgb(20,184,166), rgb(132,204,22))",
      "--main-menu-primary-border": "rgba(52,211,153,0.42)",
      "--main-menu-primary-border-active": "rgba(190,242,100,0.62)",
      "--main-menu-primary-glow": "rgba(16,185,129,0.58)",
      "--main-menu-primary-glow-soft": "rgba(132,204,22,0.2)",
      "--main-menu-primary-text": "rgb(220,252,231)",
      "--main-menu-primary-arrow": "rgb(187,247,208)",
      "--main-menu-focus-ring": "rgba(134,239,172,0.62)",
      "--main-menu-focus-ring-rgb": "134, 239, 172",
      "--main-menu-system-divider":
        "linear-gradient(to right, transparent, rgba(52,211,153,0.42), transparent)",
      "--main-menu-system-label": "rgba(187,247,208,0.82)",
      "--main-menu-system-card-bg": "rgba(6,78,59,0.14)",
      "--main-menu-system-card-border": "rgba(52,211,153,0.24)",
      "--main-menu-system-accent": "rgba(52,211,153,0.84)",
      "--main-menu-system-accent-muted": "rgba(187,247,208,0.72)",
      "--main-menu-system-text": "rgba(236,253,245,0.92)",
      "--main-menu-system-text-muted": "rgba(187,247,208,0.62)",
    },
  },
  {
    id: "monochrome",
    label: "Monochrome",
    description: "Zinc, white, silver, and subtle neutral glow.",
    preview: { from: "#fafafa", via: "#a1a1aa", to: "#18181b" },
    cssVars: {
      ...classicCssVars,
      "--main-menu-bg":
        "radial-gradient(circle at 18% 10%, rgba(244,244,245,0.14), transparent 34%), radial-gradient(circle at 84% 4%, rgba(161,161,170,0.12), transparent 34%), radial-gradient(circle at 54% 92%, rgba(212,212,216,0.08), transparent 40%), #050505",
      "--main-menu-orb-a":
        "radial-gradient(circle, rgba(244,244,245,0.24) 0%, rgba(244,244,245,0.06) 60%, transparent 80%)",
      "--main-menu-orb-b":
        "radial-gradient(circle, rgba(161,161,170,0.22) 0%, rgba(161,161,170,0.05) 60%, transparent 80%)",
      "--main-menu-orb-c":
        "radial-gradient(circle, rgba(212,212,216,0.16) 0%, rgba(212,212,216,0.04) 60%, transparent 80%)",
      "--main-menu-orb-d": "radial-gradient(circle, rgba(250,250,250,0.14) 0%, transparent 70%)",
      "--main-menu-particle-1": "rgba(250,250,250,0.62)",
      "--main-menu-particle-2": "rgba(212,212,216,0.54)",
      "--main-menu-particle-3": "rgba(161,161,170,0.48)",
      "--main-menu-particle-4": "rgba(113,113,122,0.42)",
      "--main-menu-eyebrow": "rgba(212,212,216,0.78)",
      "--main-menu-title-gradient":
        "linear-gradient(135deg, #ffffff 0%, #d4d4d8 22%, #fafafa 42%, #a1a1aa 62%, #e4e4e7 82%, #ffffff 100%)",
      "--main-menu-title-shadow":
        "drop-shadow(0 0 36px rgba(244,244,245,0.26)) drop-shadow(0 0 78px rgba(161,161,170,0.18))",
      "--main-menu-divider":
        "linear-gradient(to right, transparent, rgba(244,244,245,0.62), rgba(161,161,170,0.5), transparent)",
      "--main-menu-primary-gradient":
        "linear-gradient(to right, rgba(63,63,70,0.86), rgba(113,113,122,0.82), rgba(39,39,42,0.84))",
      "--main-menu-primary-gradient-active":
        "linear-gradient(to right, rgb(82,82,91), rgb(161,161,170), rgb(63,63,70))",
      "--main-menu-primary-border": "rgba(212,212,216,0.32)",
      "--main-menu-primary-border-active": "rgba(244,244,245,0.62)",
      "--main-menu-primary-glow": "rgba(244,244,245,0.26)",
      "--main-menu-primary-glow-soft": "rgba(161,161,170,0.18)",
      "--main-menu-primary-text": "rgb(244,244,245)",
      "--main-menu-primary-arrow": "rgb(228,228,231)",
      "--main-menu-focus-ring": "rgba(244,244,245,0.58)",
      "--main-menu-focus-ring-rgb": "244, 244, 245",
      "--main-menu-system-divider":
        "linear-gradient(to right, transparent, rgba(212,212,216,0.38), transparent)",
      "--main-menu-system-label": "rgba(228,228,231,0.82)",
      "--main-menu-system-card-bg": "rgba(39,39,42,0.28)",
      "--main-menu-system-card-border": "rgba(212,212,216,0.2)",
      "--main-menu-system-accent": "rgba(228,228,231,0.84)",
      "--main-menu-system-accent-muted": "rgba(212,212,216,0.72)",
      "--main-menu-system-text": "rgba(250,250,250,0.92)",
      "--main-menu-system-text-muted": "rgba(212,212,216,0.62)",
    },
  },
  {
    id: "sunset",
    label: "Sunset",
    description: "Coral, peach, rose, and warm evening accents.",
    preview: { from: "#fb7185", via: "#fdba74", to: "#7f1d1d" },
    cssVars: {
      ...classicCssVars,
      "--main-menu-bg":
        "radial-gradient(circle at 18% 10%, rgba(251,113,133,0.24), transparent 34%), radial-gradient(circle at 84% 4%, rgba(253,186,116,0.2), transparent 34%), radial-gradient(circle at 54% 92%, rgba(244,114,182,0.1), transparent 40%), #090405",
      "--main-menu-orb-a":
        "radial-gradient(circle, rgba(251,113,133,0.34) 0%, rgba(251,113,133,0.08) 60%, transparent 80%)",
      "--main-menu-orb-b":
        "radial-gradient(circle, rgba(253,186,116,0.3) 0%, rgba(253,186,116,0.07) 60%, transparent 80%)",
      "--main-menu-orb-c":
        "radial-gradient(circle, rgba(244,114,182,0.16) 0%, rgba(244,114,182,0.04) 60%, transparent 80%)",
      "--main-menu-orb-d": "radial-gradient(circle, rgba(254,202,202,0.18) 0%, transparent 70%)",
      "--main-menu-particle-1": "rgba(251,113,133,0.7)",
      "--main-menu-particle-2": "rgba(253,186,116,0.62)",
      "--main-menu-particle-3": "rgba(254,202,202,0.5)",
      "--main-menu-particle-4": "rgba(244,114,182,0.4)",
      "--main-menu-eyebrow": "rgba(253,164,175,0.78)",
      "--main-menu-title-gradient":
        "linear-gradient(135deg, #fff1f2 0%, #fb7185 20%, #ffedd5 42%, #fdba74 62%, #f9a8d4 82%, #fff7ed 100%)",
      "--main-menu-title-shadow":
        "drop-shadow(0 0 40px rgba(251,113,133,0.46)) drop-shadow(0 0 80px rgba(253,186,116,0.22))",
      "--main-menu-divider":
        "linear-gradient(to right, transparent, rgba(251,113,133,0.76), rgba(253,186,116,0.66), transparent)",
      "--main-menu-primary-gradient":
        "linear-gradient(to right, rgba(225,29,72,0.82), rgba(251,113,133,0.82), rgba(249,115,22,0.78))",
      "--main-menu-primary-gradient-active":
        "linear-gradient(to right, rgb(244,63,94), rgb(251,113,133), rgb(251,146,60))",
      "--main-menu-primary-border": "rgba(253,164,175,0.42)",
      "--main-menu-primary-border-active": "rgba(253,186,116,0.66)",
      "--main-menu-primary-glow": "rgba(251,113,133,0.58)",
      "--main-menu-primary-glow-soft": "rgba(253,186,116,0.22)",
      "--main-menu-primary-text": "rgb(255,228,230)",
      "--main-menu-primary-arrow": "rgb(254,205,211)",
      "--main-menu-focus-ring": "rgba(253,164,175,0.62)",
      "--main-menu-focus-ring-rgb": "253, 164, 175",
      "--main-menu-system-divider":
        "linear-gradient(to right, transparent, rgba(253,164,175,0.44), transparent)",
      "--main-menu-system-label": "rgba(254,205,211,0.82)",
      "--main-menu-system-card-bg": "rgba(127,29,29,0.12)",
      "--main-menu-system-card-border": "rgba(253,186,116,0.22)",
      "--main-menu-system-accent": "rgba(253,164,175,0.84)",
      "--main-menu-system-accent-muted": "rgba(254,205,211,0.72)",
      "--main-menu-system-text": "rgba(255,241,242,0.92)",
      "--main-menu-system-text-muted": "rgba(254,205,211,0.62)",
    },
  },
] as const;

export function normalizeMainMenuThemeId(value: unknown): MainMenuThemeId {
  if (typeof value !== "string") return DEFAULT_MENU_THEME_ID;
  const trimmed = value.trim();
  return MAIN_MENU_THEME_IDS.find((themeId) => themeId === trimmed) ?? DEFAULT_MENU_THEME_ID;
}

export function getMainMenuTheme(id: unknown): MainMenuTheme {
  const themeId = normalizeMainMenuThemeId(id);
  return MAIN_MENU_THEMES.find((theme) => theme.id === themeId) ?? MAIN_MENU_THEMES[0]!;
}
