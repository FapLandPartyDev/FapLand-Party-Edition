import { useEffect, useState } from "react";
import { Trans } from "@lingui/react/macro";
import { trpc } from "../services/trpc";

export function MultiFunPlayerSettingsCard() {
  const [status, setStatus] = useState<{
    running: boolean;
    clients: number;
    port: number;
    error: string | null;
  } | null>(null);
  const [port, setPort] = useState("8080");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let first = true;
    const refresh = () => {
      void trpc.multifunplayer.status
        .query()
        .then((next) => {
          if (!alive) return;
          setStatus(next);
          if (first) {
            setPort(String(next.port));
            first = false;
          }
        })
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const configure = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(
        await trpc.multifunplayer.configure.mutate({
          enabled: !status?.running,
          port: Number(port),
        })
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-3xl border border-cyan-400/25 bg-zinc-950/55 p-5 text-zinc-200 backdrop-blur-xl">
      <h2 className="text-lg font-extrabold text-cyan-100">MultiFunPlayer</h2>
      <p className="mt-2 text-sm">
        <Trans>
          Enable the bridge, then add an OFS player in MultiFunPlayer and connect it to the address
          below. Configure your multi-axis device output in MultiFunPlayer.
        </Trans>
      </p>
      <p className="mt-2 text-sm">
        <Trans>
          Round playback sends the active funscript and matching axis files from the script folder.
          Use MultiFunPlayer axis links or motion providers for axes without scripts.
        </Trans>
      </p>
      <p className="mt-2 text-sm">
        <Trans>
          After connecting the OFS player, press Connect below to use the hardware controls. Stop
          and the cum button pause device playback. Stroke range adjusts the primary axis; configure
          other axes and output limits in MultiFunPlayer.
        </Trans>
      </p>
      <p className="mt-2 text-sm">
        <Trans>
          In MultiFunPlayer, turn off &quot;Update motion providers when paused&quot; for generated
          axes so Stop also pauses their motion.
        </Trans>
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="text-sm">
          <Trans>Port</Trans>{" "}
          <input
            className="w-24 rounded-lg border border-zinc-600 bg-zinc-900 px-2 py-1"
            type="number"
            min={1024}
            max={65535}
            value={port}
            disabled={busy || status?.running}
            onChange={(event) => setPort(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={
            busy ||
            !status ||
            !Number.isInteger(Number(port)) ||
            Number(port) < 1024 ||
            Number(port) > 65535
          }
          onClick={() => {
            void configure();
          }}
          className="rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-4 py-2 text-sm text-cyan-100 disabled:opacity-50"
        >
          {status?.running ? <Trans>Disable bridge</Trans> : <Trans>Enable bridge</Trans>}
        </button>
        <code className="text-sm">ws://127.0.0.1:{port}/ofs</code>
      </div>
      <p className="mt-3 text-sm" role="status">
        {status?.running ? (
          <Trans>Bridge running. Connected players: {status.clients}</Trans>
        ) : (
          <Trans>Bridge stopped</Trans>
        )}
      </p>
      {error || status?.error ? (
        <p className="mt-2 text-sm text-rose-300" role="alert">
          {error ?? status?.error}
        </p>
      ) : null}
    </section>
  );
}
