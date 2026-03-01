import { useCallback, useEffect, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { HandyStrokeRangeControl } from "./HandyStrokeRangeControl";
import { playHoverSound, playSelectSound } from "../utils/audio";
import {
  admissibleRange,
  describeNativeSync,
  nativeOutputName,
  orderNativeAxes,
  setNativeRange,
  toRangePercent,
  type MfpNativeOutput,
  type MfpNativePeer,
  type MfpNativeSyncState,
} from "../services/haptics/multifunplayerNative";

type Range = { min: number; max: number };
/** A dragged or committed range shown until the player reports it back. */
type Preview = Range & { committedAt: number | null };

/** A report this much newer than a commit already carries it. */
const ECHO_MS = 300;
type OutputAxis = MfpNativeOutput["axes"][number];

const STATUS_DOT: Record<MfpNativeOutput["status"], string> = {
  connected: "bg-emerald-400",
  connecting: "bg-cyan-400 animate-pulse",
  disconnecting: "bg-amber-400 animate-pulse",
  disconnected: "bg-zinc-500",
  failed: "bg-rose-400",
};

const SYNC_TONE: Record<MfpNativeSyncState, string> = {
  waiting: "border-zinc-500/40 bg-zinc-500/10 text-zinc-300",
  loading: "border-cyan-300/40 bg-cyan-400/12 text-cyan-100",
  syncing: "border-cyan-300/40 bg-cyan-400/12 text-cyan-100",
  synced: "border-emerald-300/40 bg-emerald-400/12 text-emerald-100",
  drifting: "border-amber-300/40 bg-amber-400/12 text-amber-100",
};

function formatDrift(driftMs: number) {
  return `${driftMs > 0 ? "+" : ""}${driftMs} ms`;
}

/**
 * Device state reported by a natively linked MultiFunPlayer. The primary
 * stroke axis of each device stays in view; extra axes fold away.
 */
export function MultiFunPlayerDevicePanel({ peer }: { peer: MfpNativePeer }) {
  const { t } = useLingui();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = useState<Record<string, Preview>>({});
  const [error, setError] = useState<string | null>(null);
  const sync = describeNativeSync(peer);
  const reportedAt = peer.updatedAt;

  useEffect(() => {
    if (reportedAt == null) return;
    queueMicrotask(() =>
      setPreview((current) => {
        const kept = Object.entries(current).filter(
          ([, range]) => range.committedAt == null || range.committedAt > reportedAt - ECHO_MS
        );
        return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
      })
    );
  }, [reportedAt]);
  const outputs = peer.state?.outputs ?? [];
  const axisNames = new Map(peer.state?.axes.map((axis) => [axis.axis, axis.name]) ?? []);

  const syncLabel: Record<MfpNativeSyncState, string> = {
    waiting: t`Waiting for round`,
    loading: t`Loading script`,
    syncing: t`Syncing`,
    synced: t`In sync`,
    drifting: t`Out of sync`,
  };

  const commit = useCallback(
    (output: string, axis: OutputAxis, nextMin: number, nextMax: number) => {
      const key = `${output}/${axis.axis}`;
      const range = admissibleRange(nextMin, nextMax, toRangePercent(axis.minimum));
      setPreview((current) => ({ ...current, [key]: { ...range, committedAt: Date.now() } }));
      setError(null);
      void setNativeRange(output, axis.axis, range.min, range.max).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setPreview((current) =>
          Object.fromEntries(Object.entries(current).filter(([candidate]) => candidate !== key))
        );
      });
    },
    []
  );

  const rangeOf = (output: string, axis: OutputAxis): Range =>
    preview[`${output}/${axis.axis}`] ?? {
      min: toRangePercent(axis.minimum),
      max: toRangePercent(axis.maximum),
    };

  const renderSlider = (output: MfpNativeOutput, axis: OutputAxis, compact: boolean) => {
    const range = rangeOf(output.id, axis);
    const name = axisNames.get(axis.axis) ?? axis.axis;
    return (
      <HandyStrokeRangeControl
        size={compact ? "compact" : "regular"}
        minValue={range.min}
        maxValue={range.max}
        disabled={!axis.enabled}
        minAriaLabel={t`${nativeOutputName(output)} ${name} minimum`}
        maxAriaLabel={t`${nativeOutputName(output)} ${name} maximum`}
        onPreview={(min, max) =>
          setPreview((current) => ({
            ...current,
            [`${output.id}/${axis.axis}`]: { min, max, committedAt: null },
          }))
        }
        onCommit={(min, max) => commit(output.id, axis, min, max)}
        trackClassName="bg-white/10"
        activeTrackClassName={compact ? "bg-cyan-300/35" : "bg-cyan-400/70"}
      />
    );
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white">
            <Trans>MultiFunPlayer devices</Trans>
          </p>
          <p className="mt-0.5 truncate text-[10px] text-zinc-400">
            {peer.application}
            {peer.version ? ` ${peer.version}` : ""} · <Trans>native link</Trans>
          </p>
        </div>
        <div
          role="status"
          className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold ${SYNC_TONE[sync.state]}`}
        >
          <span>{syncLabel[sync.state]}</span>
          {sync.driftMs != null ? (
            <span className="font-mono text-[10px] opacity-80">{formatDrift(sync.driftMs)}</span>
          ) : null}
        </div>
      </div>

      {outputs.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-400">
          <Trans>No outputs are configured in MultiFunPlayer.</Trans>
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {outputs.map((output) => {
            const { primary, secondary } = orderNativeAxes(output);
            const open = expanded.has(output.id);
            const primaryRange = primary ? rangeOf(output.id, primary) : null;
            return (
              <li
                key={output.id}
                className="rounded-lg border border-white/10 bg-black/15 px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[output.status]}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-100">
                      {nativeOutputName(output)}
                    </p>
                    <p className="truncate text-[10px] text-zinc-400">
                      {output.kind}
                      {output.rate ? ` · ${output.rate} Hz` : ""}
                      {output.status === "failed" && output.error ? ` · ${output.error}` : ""}
                    </p>
                  </div>
                  {primary && primaryRange ? (
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-300/80">
                        {primary.axis}
                      </p>
                      <p className="font-mono text-xs text-zinc-200">
                        {primaryRange.min}–{primaryRange.max}%
                      </p>
                    </div>
                  ) : null}
                </div>

                {primary ? (
                  <div className={primary.enabled ? "" : "opacity-50"}>
                    {renderSlider(output, primary, false)}
                  </div>
                ) : (
                  <p className="mt-2 text-[10px] text-zinc-500">
                    <Trans>This output has no adjustable axes.</Trans>
                  </p>
                )}

                {secondary.length ? (
                  <>
                    <button
                      type="button"
                      aria-expanded={open}
                      onMouseEnter={playHoverSound}
                      onClick={() => {
                        playSelectSound();
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (!next.delete(output.id)) next.add(output.id);
                          return next;
                        });
                      }}
                      data-controller-focus-id={`mfp-axes-${output.id}`}
                      className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-zinc-400 transition hover:text-zinc-200"
                    >
                      <span
                        aria-hidden="true"
                        className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}
                      >
                        ›
                      </span>
                      {open ? (
                        <Trans>Hide extra axes</Trans>
                      ) : (
                        <Trans>Extra axes ({secondary.length})</Trans>
                      )}
                    </button>
                    {open ? (
                      <div className="mt-1.5 space-y-0.5 border-t border-white/5 pt-1.5">
                        {secondary.map((axis) => {
                          const range = rangeOf(output.id, axis);
                          return (
                            <div
                              key={axis.axis}
                              className={`grid grid-cols-[4.5rem_1fr_3.75rem] items-center gap-2.5 ${axis.enabled ? "" : "opacity-45"}`}
                              title={axis.enabled ? undefined : t`Disabled in MultiFunPlayer`}
                            >
                              <span className="truncate text-[10px] text-zinc-300">
                                <span className="font-semibold text-zinc-200">{axis.axis}</span>{" "}
                                {axisNames.get(axis.axis) ?? ""}
                              </span>
                              {renderSlider(output, axis, true)}
                              <span className="text-right font-mono text-[10px] text-zinc-400">
                                {range.min}–{range.max}%
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {error ? (
        <p className="mt-3 text-xs text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
