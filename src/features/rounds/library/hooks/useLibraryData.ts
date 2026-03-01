import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "@/services/db";
import { playlists } from "@/services/playlists";
import { trpc } from "@/services/trpc";
import {
  DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC,
  DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC,
  INTERMEDIARY_LOADING_DURATION_KEY,
  INTERMEDIARY_LOADING_PROMPT_KEY,
  INTERMEDIARY_RETURN_PAUSE_KEY,
  PLAYLISTS_QUERY_KEY,
  PREVIEW_SETTINGS_QUERY_KEY,
  ROUNDS_CATALOG_QUERY_KEY,
  ROUNDS_DISABLED_QUERY_KEY,
  WEB_INSTALL_SETTINGS_QUERY_KEY,
} from "../constants";
import { DEFAULT_INTERMEDIARY_LOADING_PROMPT } from "@/constants/booruSettings";
import { normalizeRoundProgressBarAlwaysVisible } from "@/constants/roundVideoOverlaySettings";
import {
  DEFAULT_CONTROLLER_SUPPORT_ENABLED,
  DEFAULT_INSTALL_WEB_FUNSCRIPT_URL_ENABLED,
  INSTALL_WEB_FUNSCRIPT_URL_ENABLED_KEY,
  normalizeControllerSupportEnabled,
  normalizeInstallWebFunscriptUrlEnabled,
} from "@/constants/experimentalFeatures";
import type { PreviewSettings } from "../types";

/** Invalidate every query tied to the installed library. */
export function useInvalidateLibrary() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ROUNDS_CATALOG_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ROUNDS_DISABLED_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: PLAYLISTS_QUERY_KEY }),
    ]);
}

export function useInstalledRoundsCatalog(includeDisabled: boolean, includeTemplates = true) {
  return useQuery({
    queryKey: [...ROUNDS_CATALOG_QUERY_KEY, { includeDisabled, includeTemplates }],
    queryFn: () => db.round.findInstalledCatalog(includeDisabled, includeTemplates),
    staleTime: 15_000,
  });
}

export function useDisabledRoundIds() {
  return useQuery({
    queryKey: ROUNDS_DISABLED_QUERY_KEY,
    queryFn: () => db.round.getDisabledIds(),
    staleTime: 15_000,
  });
}

export function useAvailablePlaylists(enabled = true) {
  return useQuery({
    queryKey: PLAYLISTS_QUERY_KEY,
    queryFn: () => playlists.list(),
    enabled,
    staleTime: 30_000,
  });
}

export function usePreviewSettings() {
  return useQuery<PreviewSettings>({
    queryKey: PREVIEW_SETTINGS_QUERY_KEY,
    queryFn: async () => {
      const [
        intermediaryLoadingPromptRaw,
        intermediaryLoadingDurationRaw,
        intermediaryReturnPauseRaw,
        roundProgressBarAlwaysVisibleRaw,
      ] = await Promise.all([
        trpc.store.get.query({ key: INTERMEDIARY_LOADING_PROMPT_KEY }).catch(() => null),
        trpc.store.get.query({ key: INTERMEDIARY_LOADING_DURATION_KEY }).catch(() => null),
        trpc.store.get.query({ key: INTERMEDIARY_RETURN_PAUSE_KEY }).catch(() => null),
        trpc.store.get
          .query({ key: "game.video.roundProgressBarAlwaysVisible" })
          .catch(() => null),
      ]);

      const trimmedPrompt =
        typeof intermediaryLoadingPromptRaw === "string"
          ? intermediaryLoadingPromptRaw.trim()
          : "";
      const durationParsed =
        typeof intermediaryLoadingDurationRaw === "number"
          ? intermediaryLoadingDurationRaw
          : Number(intermediaryLoadingDurationRaw);
      const returnPauseParsed =
        typeof intermediaryReturnPauseRaw === "number"
          ? intermediaryReturnPauseRaw
          : Number(intermediaryReturnPauseRaw);

      return {
        intermediaryLoadingPrompt:
          trimmedPrompt.length > 0 ? trimmedPrompt : DEFAULT_INTERMEDIARY_LOADING_PROMPT,
        intermediaryLoadingDurationSec: Number.isFinite(durationParsed)
          ? Math.max(1, Math.min(60, Math.floor(durationParsed)))
          : DEFAULT_INTERMEDIARY_LOADING_DURATION_SEC,
        intermediaryReturnPauseSec: Number.isFinite(returnPauseParsed)
          ? Math.max(0, Math.min(60, Math.floor(returnPauseParsed)))
          : DEFAULT_INTERMEDIARY_RETURN_PAUSE_SEC,
        roundProgressBarAlwaysVisible: normalizeRoundProgressBarAlwaysVisible(
          roundProgressBarAlwaysVisibleRaw
        ),
      };
    },
    staleTime: 60_000,
  });
}

export function useControllerSupportEnabled() {
  return useQuery({
    queryKey: ["rounds", "controller-support"],
    queryFn: async () => {
      try {
        const stored = await trpc.store.get.query({
          key: "experimental.controllerSupportEnabled",
        });
        return normalizeControllerSupportEnabled(stored);
      } catch {
        return DEFAULT_CONTROLLER_SUPPORT_ENABLED;
      }
    },
    staleTime: 60_000,
  });
}

export function useWebInstallSettings() {
  return useQuery({
    queryKey: WEB_INSTALL_SETTINGS_QUERY_KEY,
    queryFn: async () => {
      try {
        const stored = await trpc.store.get.query({
          key: INSTALL_WEB_FUNSCRIPT_URL_ENABLED_KEY,
        });
        return { installWebFunscriptUrlEnabled: normalizeInstallWebFunscriptUrlEnabled(stored) };
      } catch {
        return { installWebFunscriptUrlEnabled: DEFAULT_INSTALL_WEB_FUNSCRIPT_URL_ENABLED };
      }
    },
    staleTime: 60_000,
  });
}

/** Mutation that wraps any library mutation and invalidates library queries on success. */
export function useLibraryMutation<TInput, TOutput>(
  mutationFn: (input: TInput) => Promise<TOutput>,
  options?: { onSuccess?: (data: TOutput, input: TInput) => void | Promise<void> }
) {
  const invalidateLibrary = useInvalidateLibrary();
  return useMutation({
    mutationFn,
    onSuccess: async (data, input) => {
      await invalidateLibrary();
      await options?.onSuccess?.(data, input);
    },
  });
}
