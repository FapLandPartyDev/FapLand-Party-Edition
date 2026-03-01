import { redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { normalizeSfwModeEnabled, SFW_MODE_ENABLED_KEY } from "../constants/experimentalFeatures";
import { trpc } from "../services/trpc";
import { useSfwMode } from "./useSfwMode";

export async function assertMultiplayerAllowed(): Promise<void> {
  const sfwModeEnabled = normalizeSfwModeEnabled(
    await trpc.store.get.query({ key: SFW_MODE_ENABLED_KEY })
  );

  if (sfwModeEnabled) {
    throw redirect({ to: "/" });
  }
}

export function useMultiplayerSfwRedirect(): boolean {
  const navigate = useNavigate();
  const sfwModeEnabled = useSfwMode();

  useEffect(() => {
    if (!sfwModeEnabled) return;
    void navigate({ to: "/" });
  }, [navigate, sfwModeEnabled]);

  return sfwModeEnabled;
}
