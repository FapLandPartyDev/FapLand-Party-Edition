import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { createUiControl } from "./uiControl";
import { settingsCatalog } from "./settingsCatalog";
import { MCP_CHANGED_EVENT } from "./types";
import { invalidateInstalledRoundCaches } from "../services/installedRoundsCache";

export function McpBridge() {
  const queryClient = useQueryClient();
  const router = useRouter();
  useEffect(() => {
    const api = window.electronAPI?.mcp;
    if (!api) return;
    const stopUi = api.onUiRequest(createUiControl((path) => router.navigate({ to: path as "/" })));
    const stopChanges = api.onChanged((change) => {
      if (change.procedure.startsWith("db.") || change.procedure === "converter.saveSegments") {
        invalidateInstalledRoundCaches();
      }
      if (change.setting) {
        const { key, value } = change.setting;
        const previous = localStorage.getItem(key);
        const serialized = typeof value === "string" ? value : JSON.stringify(value);
        if (serialized === undefined) localStorage.removeItem(key);
        else localStorage.setItem(key, serialized);
        window.dispatchEvent(
          new StorageEvent("storage", {
            key,
            oldValue: previous,
            newValue: serialized ?? null,
            storageArea: localStorage,
          })
        );
        const event = settingsCatalog.find((entry) => entry.key === key)?.event;
        if (event) window.dispatchEvent(new CustomEvent(event, { detail: value }));
      }
      void queryClient.invalidateQueries();
      void router.invalidate();
      window.dispatchEvent(new CustomEvent(MCP_CHANGED_EVENT, { detail: change }));
    });
    return () => {
      stopUi();
      stopChanges();
    };
  }, [queryClient, router]);
  return null;
}
