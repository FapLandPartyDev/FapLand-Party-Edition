import { Trans, useLingui } from "@lingui/react/macro";
import { Modal, ModalField } from "../ui/Modal";
import type { LegacyPlaylistReviewState } from "../types";

export function LegacyPlaylistReviewDialog({
  state,
  onClose,
  onChange,
  onToggleCheckpoint,
  onToggleExclusion,
  onSubmit,
}: {
  state: LegacyPlaylistReviewState;
  onClose: () => void;
  onChange: (updater: (current: LegacyPlaylistReviewState) => LegacyPlaylistReviewState) => void;
  onToggleCheckpoint: (slotId: string) => void;
  onToggleExclusion: (slotId: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useLingui();
  return (
    <Modal
      title={t`Review Legacy Import`}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel={
        state.creating
          ? t`Importing...`
          : state.createPlaylist
            ? t`Import and Create Playlist`
            : t`Import Without Playlist`
      }
      disabled={state.creating}
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-violet-300/25 bg-violet-500/10 p-4 text-sm text-zinc-200">
          <Trans>
            Review the folder before import. Ordered by filename (natural sort), so entries like 2,
            10, and 100 stay in human order.
          </Trans>
        </div>
        <label className="flex items-start gap-3 rounded-2xl border border-zinc-700/70 bg-black/35 px-4 py-3 text-sm text-zinc-200">
          <input
            type="checkbox"
            checked={state.createPlaylist}
            onChange={(e) =>
              onChange((current) => ({
                ...current,
                createPlaylist: e.target.checked,
                error: null,
              }))
            }
            className="mt-0.5 h-4 w-4 rounded border-zinc-500 bg-black/40"
          />
          <span>
            <Trans>Create a playlist after import.</Trans>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-2xl border border-zinc-700/70 bg-black/35 px-4 py-3 text-sm text-zinc-200">
          <input
            type="checkbox"
            checked={state.deferPhash}
            onChange={(e) =>
              onChange((current) => ({
                ...current,
                deferPhash: e.target.checked,
                error: null,
              }))
            }
            className="mt-0.5 h-4 w-4 rounded border-zinc-500 bg-black/40"
          />
          <span>
            <Trans>Defer phash generation to a later moment.</Trans>
          </span>
        </label>
        <ModalField label={t`Playlist Name`}>
          <input
            value={state.playlistName}
            onChange={(e) =>
              onChange((current) => ({ ...current, playlistName: e.target.value, error: null }))
            }
            disabled={!state.createPlaylist}
            className={`w-full rounded-xl border px-4 py-3 text-sm outline-none transition-all duration-200 ${
              state.createPlaylist
                ? "border-violet-300/35 bg-black/45 text-zinc-100 focus:border-violet-200/80 focus:ring-2 focus:ring-violet-400/25"
                : "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500"
            }`}
            placeholder={t`Legacy Playlist`}
          />
        </ModalField>
        <div className="rounded-2xl border border-zinc-700/70 bg-black/35 p-4">
          <div className="mb-3 flex items-center justify-between gap-3 text-xs uppercase tracking-[0.18em] text-zinc-300">
            <span>
              <Trans>Import Order Preview</Trans>
            </span>
            <span>
              {state.slots.length} <Trans>slots</Trans>
            </span>
          </div>
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
            {state.slots.map((slot) => (
              <div
                key={slot.id}
                className="flex items-center gap-3 rounded-xl border border-zinc-700/60 bg-zinc-900/60 px-3 py-3 text-sm text-zinc-100"
              >
                <span className="w-10 shrink-0 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] text-violet-200">
                  {slot.originalOrder + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-zinc-50">{slot.sourceLabel}</div>
                  <div className="text-xs text-zinc-400">
                    <Trans>Excluded:</Trans> {slot.excludedFromImport ? t`Yes` : t`No`}
                  </div>
                  <div className="text-xs text-zinc-400">
                    <Trans>Checkpoint:</Trans> {slot.selectedAsCheckpoint ? t`Yes` : t`No`}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-zinc-300">
                  <input
                    type="checkbox"
                    checked={!slot.excludedFromImport}
                    onChange={() => onToggleExclusion(slot.id)}
                    className="h-4 w-4 rounded border-zinc-500 bg-black/40"
                  />
                  <span>
                    <Trans>Import</Trans>
                  </span>
                </label>
                <label className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-zinc-300">
                  <input
                    type="checkbox"
                    checked={slot.selectedAsCheckpoint}
                    disabled={slot.excludedFromImport}
                    onChange={() => onToggleCheckpoint(slot.id)}
                    className="h-4 w-4 rounded border-zinc-500 bg-black/40 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <span>
                    <Trans>Checkpoint</Trans>
                  </span>
                </label>
              </div>
            ))}
          </div>
        </div>
        {state.error && (
          <p className="rounded-xl border border-rose-300/35 bg-rose-500/15 px-4 py-3 text-sm text-rose-100">
            {state.error}
          </p>
        )}
      </div>
    </Modal>
  );
}
