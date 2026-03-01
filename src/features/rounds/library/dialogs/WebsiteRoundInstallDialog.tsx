import { useEffect, useRef } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useControllerSurface } from "@/controller";
import { ActionButton } from "../ui/ActionButton";
import type { WebsiteRoundVideoValidationState } from "../types";

export function WebsiteRoundInstallDialog({
  open,
  roundName,
  videoUrl,
  funscriptUrl,
  funscriptFileLabel,
  isSettingsLoading,
  showFunscriptUrl,
  error,
  success,
  videoValidation,
  installing,
  disabled,
  onClose,
  onRoundNameChange,
  onVideoUrlChange,
  onFunscriptUrlChange,
  onSelectLocalFunscript,
  onSearchEroScripts,
  onInstall,
  onHoverSfx,
}: {
  open: boolean;
  roundName: string;
  videoUrl: string;
  funscriptUrl: string;
  funscriptFileLabel: string | null;
  isSettingsLoading: boolean;
  showFunscriptUrl: boolean;
  error: string | null;
  success: string | null;
  videoValidation: WebsiteRoundVideoValidationState;
  installing: boolean;
  disabled: boolean;
  onClose: () => void;
  onRoundNameChange: (value: string) => void;
  onVideoUrlChange: (value: string) => void;
  onFunscriptUrlChange: (value: string) => void;
  onSelectLocalFunscript: () => void;
  onSearchEroScripts: () => void;
  onInstall: () => void;
  onHoverSfx: () => void;
}) {
  const { t } = useLingui();
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useControllerSurface({
    id: "website-round-install-dialog",
    scopeRef: dialogRef,
    priority: 180,
    enabled: open,
    initialFocusId: "website-round-name",
    onBack: () => {
      onClose();
      return true;
    },
  });

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(192,38,211,0.18),transparent_35%),rgba(3,7,18,0.86)] px-4 py-6 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="relative w-full max-w-3xl overflow-hidden rounded-[2rem] border border-fuchsia-300/25 bg-slate-950/95 shadow-[0_28px_120px_rgba(168,85,247,0.25)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t`Install from web`}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(217,70,239,0.14),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(34,211,238,0.12),transparent_32%)]" />
        <div className="relative space-y-6 p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.34em] text-fuchsia-200/80">
                <Trans>Website Install</Trans>
              </p>
              <h2 className="mt-3 text-3xl font-black tracking-tight text-white">
                <Trans>Install From Web</Trans>
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                <Trans>
                  Create an installed round directly from a supported public website URL. Playback
                  starts from the web source immediately and caches in the background.
                </Trans>
              </p>
            </div>
            <button
              type="button"
              onMouseEnter={onHoverSfx}
              onClick={onClose}
              disabled={installing}
              className={`rounded-xl border px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] ${
                installing
                  ? "cursor-not-allowed border-slate-700 bg-slate-900 text-slate-500"
                  : "border-slate-600/80 bg-black/30 text-slate-300 transition-all duration-200 hover:border-fuchsia-200/60 hover:text-white"
              }`}
            >
              <Trans>Close</Trans>
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                <Trans>Round Name</Trans>
              </span>
              <input
                type="text"
                value={roundName}
                onChange={(event) => onRoundNameChange(event.target.value)}
                placeholder={t`My Website Round`}
                className="w-full rounded-xl border border-fuchsia-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-fuchsia-200/75"
                data-controller-focus-id="website-round-name"
                data-controller-initial="true"
                aria-label={t`Round Name`}
              />
            </label>

            <label className="block lg:col-span-2">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                <Trans>Video URL</Trans>
              </span>
              <input
                type="url"
                value={videoUrl}
                onChange={(event) => onVideoUrlChange(event.target.value)}
                placeholder={t`https://www.pornhub.com/view_video.php?viewkey=...`}
                className={`w-full rounded-xl border bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-fuchsia-200/75 ${
                  videoValidation.state === "unsupported"
                    ? "border-rose-300/60"
                    : videoValidation.state === "supported"
                      ? "border-emerald-300/60"
                      : videoValidation.state === "checking"
                        ? "border-cyan-300/60"
                        : "border-fuchsia-300/30"
                }`}
                aria-label={t`Video URL`}
              />
              {videoValidation.message ? (
                <span
                  className={`mt-2 block text-xs ${
                    videoValidation.state === "unsupported"
                      ? "text-rose-200"
                      : videoValidation.state === "supported"
                        ? "text-emerald-200"
                        : "text-cyan-200"
                  }`}
                >
                  {videoValidation.message}
                </span>
              ) : null}
            </label>

            {isSettingsLoading ? (
              <div className="block lg:col-span-2">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                  <Trans>Funscript URL</Trans>
                </span>
                <div className="h-12 animate-pulse rounded-xl border border-cyan-300/20 bg-black/45" />
              </div>
            ) : showFunscriptUrl ? (
              <label className="block lg:col-span-2">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                  <Trans>Funscript URL</Trans>
                </span>
                <input
                  type="url"
                  value={funscriptUrl}
                  onChange={(event) => onFunscriptUrlChange(event.target.value)}
                  placeholder={t`Optional: https://example.com/video.funscript`}
                  className="w-full rounded-xl border border-cyan-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-cyan-200/75"
                  aria-label={t`Funscript URL`}
                />
              </label>
            ) : null}
          </div>

          {error ? (
            <div className="rounded-xl border border-rose-300/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}

          {success ? (
            <div className="rounded-xl border border-emerald-300/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              {success}
            </div>
          ) : null}

          {funscriptFileLabel ? (
            <div className="rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
              <Trans>Local funscript attached: {funscriptFileLabel}</Trans>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <ActionButton
              label={t`Select Local Funscript`}
              description={t`Attach an optional local .funscript file`}
              tone="cyan"
              disabled={disabled}
              onHover={onHoverSfx}
              onClick={onSelectLocalFunscript}
            />
            <ActionButton
              label={t`Search EroScripts`}
              description={t`Find videos and direct funscripts from EroScripts.`}
              tone="emerald"
              disabled={disabled}
              onHover={onHoverSfx}
              onClick={onSearchEroScripts}
            />
            <ActionButton
              label={installing ? t`Installing...` : t`Install Website Round`}
              description={t`Create an installed round from the current website source fields.`}
              tone="violet"
              disabled={
                disabled ||
                videoValidation.state === "checking" ||
                videoValidation.state === "unsupported"
              }
              onHover={onHoverSfx}
              onClick={onInstall}
            />
          </div>

          <div className="rounded-xl border border-zinc-700/70 bg-black/30 px-4 py-3 text-xs text-zinc-400">
            <Trans>
              Public website URLs only in v1. Private sessions, cookies, and login-gated sources are
              intentionally unsupported here.
            </Trans>
            {!isSettingsLoading && !showFunscriptUrl
              ? " "
              : ""}
            {!isSettingsLoading && !showFunscriptUrl ? (
              <Trans>
                Use a local funscript by default, or enable the experimental remote funscript URL
                field in settings.
              </Trans>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
