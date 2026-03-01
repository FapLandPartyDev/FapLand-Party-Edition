import { useCallback, useEffect, useState } from "react";
import type { GraphRoadPalette } from "../../game/playlistSchema";
import {
  CUSTOM_ROAD_PALETTES_KEY,
  type CustomRoadPalette,
  normalizeCustomPalettes,
} from "../../constants/customPaletteSettings";
import { trpc } from "../../services/trpc";

export interface UseCustomRoadPalettesReturn {
  customPalettes: CustomRoadPalette[];
  isLoading: boolean;
  saveCurrentAsCustom: (name: string, palette: GraphRoadPalette) => Promise<void>;
  updateCustomPalette: (
    id: string,
    patch: { name?: string; palette?: GraphRoadPalette }
  ) => Promise<void>;
  deleteCustomPalette: (id: string) => Promise<void>;
}

const generateId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `custom-palette-${crypto.randomUUID()}`;
  }
  return `custom-palette-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export function useCustomRoadPalettes(): UseCustomRoadPalettesReturn {
  const [customPalettes, setCustomPalettes] = useState<CustomRoadPalette[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    trpc.store.getMany
      .query({ keys: [CUSTOM_ROAD_PALETTES_KEY] })
      .then((result) => {
        if (!mounted) return;
        const raw = result[CUSTOM_ROAD_PALETTES_KEY];
        setCustomPalettes(normalizeCustomPalettes(raw));
      })
      .catch((error: unknown) => {
        console.error("Failed to load custom road palettes", error);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const persist = useCallback(async (next: CustomRoadPalette[]): Promise<void> => {
    await trpc.store.set.mutate({ key: CUSTOM_ROAD_PALETTES_KEY, value: next });
  }, []);

  const saveCurrentAsCustom = useCallback(
    async (name: string, palette: GraphRoadPalette): Promise<void> => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("Palette name cannot be empty");
      const newEntry: CustomRoadPalette = { id: generateId(), name: trimmedName, palette };
      const next = [...customPalettes, newEntry];
      await persist(next);
      setCustomPalettes(next);
    },
    [customPalettes, persist]
  );

  const updateCustomPalette = useCallback(
    async (id: string, patch: { name?: string; palette?: GraphRoadPalette }): Promise<void> => {
      const next = customPalettes.map((entry) => {
        if (entry.id !== id) return entry;
        return {
          ...entry,
          ...(patch.name !== undefined ? { name: patch.name.trim() || entry.name } : {}),
          ...(patch.palette !== undefined ? { palette: patch.palette } : {}),
        };
      });
      await persist(next);
      setCustomPalettes(next);
    },
    [customPalettes, persist]
  );

  const deleteCustomPalette = useCallback(
    async (id: string): Promise<void> => {
      const next = customPalettes.filter((entry) => entry.id !== id);
      await persist(next);
      setCustomPalettes(next);
    },
    [customPalettes, persist]
  );

  return { customPalettes, isLoading, saveCurrentAsCustom, updateCustomPalette, deleteCustomPalette };
}
