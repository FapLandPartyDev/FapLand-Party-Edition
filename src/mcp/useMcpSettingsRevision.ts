import { useEffect, useState } from "react";
import { MCP_CHANGED_EVENT, type McpChange } from "./types";

export function useMcpSettingsRevision(prefix: string): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const listener = (event: Event) => {
      const change = (event as CustomEvent<McpChange>).detail;
      if (change?.setting?.key.startsWith(prefix)) setRevision((current) => current + 1);
    };
    window.addEventListener(MCP_CHANGED_EVENT, listener);
    return () => window.removeEventListener(MCP_CHANGED_EVENT, listener);
  }, [prefix]);
  return revision;
}
