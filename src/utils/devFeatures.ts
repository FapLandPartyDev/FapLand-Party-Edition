type DevFeatureEnv = {
  DEV: boolean;
  FLAND_ENABLE_DEV_FEATURES?: string;
  VITE_GAME_ENV?: string;
};

function readFlag(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  return value === "1" || value.toLowerCase() === "true";
}

export function areDevFeaturesEnabled(env: DevFeatureEnv = import.meta.env): boolean {
  return env.DEV || readFlag(env.FLAND_ENABLE_DEV_FEATURES);
}

export function isGameDevelopmentMode(env: DevFeatureEnv = import.meta.env): boolean {
  return areDevFeaturesEnabled(env) || env.VITE_GAME_ENV === "development";
}
