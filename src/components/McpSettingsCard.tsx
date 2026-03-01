import { useEffect, useState } from "react";
import { Trans } from "@lingui/react/macro";
import type { McpStatus } from "../mcp/types";

export function McpSettingsCard() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [port, setPort] = useState("32123");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    void window.electronAPI?.mcp
      ?.status()
      .then((value) => {
        if (mounted) {
          setStatus(value);
          setPort(String(value.port));
        }
      })
      .catch((error: unknown) => {
        if (mounted) setError(String(error));
      });
    return () => {
      mounted = false;
    };
  }, []);
  const save = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (!window.electronAPI?.mcp) throw new Error("MCP is available in the desktop app.");
      const next = await window.electronAPI.mcp.configure({
        enabled,
        port: Number(port),
      });
      setStatus(next);
      setPort(String(next.port));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  const buttonClass =
    "rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-sm text-cyan-100 disabled:opacity-50";
  return (
    <section className="rounded-3xl border border-cyan-400/25 bg-zinc-950/55 p-5 text-zinc-200 backdrop-blur-xl">
      <h2 className="text-lg font-extrabold text-cyan-100">
        <Trans>MCP App Control</Trans>
      </h2>
      <p className="mt-2 text-sm">
        <Trans>
          Connect an AI client to control rounds, downloads, playlists, advanced maps, settings and
          the visible app. Connected clients can modify or delete local content. Local clients have
          full app access.
        </Trans>
      </p>
      <p className="mt-3 text-sm" role="status">
        {status?.running ? <Trans>Server running</Trans> : <Trans>Server stopped</Trans>}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="text-sm">
          <Trans>Local port</Trans>
          <input
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(event) => setPort(event.target.value)}
            className="ml-2 w-28 rounded-lg border border-zinc-600 bg-zinc-900 p-2"
          />
        </label>
        <button
          type="button"
          className={buttonClass}
          disabled={busy || !status}
          onClick={() => void save(!status?.enabled)}
        >
          {status?.enabled ? <Trans>Disable MCP</Trans> : <Trans>Enable MCP</Trans>}
        </button>
        {status?.enabled && (
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => void save(true)}
          >
            <Trans>Apply port / Retry</Trans>
          </button>
        )}
      </div>
      {status && (
        <div className="mt-4 space-y-2 text-sm">
          <p>
            <Trans>Streamable HTTP endpoint:</Trans> <code className="break-all">{status.url}</code>
          </p>
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              void navigator.clipboard
                .writeText(status.url)
                .catch((error: unknown) => setError(String(error)));
            }}
          >
            <Trans>Copy connection URL</Trans>
          </button>
          <p className="text-zinc-400">
            <Trans>
              No authentication is required. The server accepts connections only on this computer. A
              stdio bridge and setup instructions are included in docs/mcp.md. ChatGPT cloud
              connections need a tunnel to reach a local server.
            </Trans>
          </p>
        </div>
      )}
      {(error || status?.error) && (
        <p role="alert" className="mt-3 text-red-300">
          {error ?? status?.error}
        </p>
      )}
    </section>
  );
}
