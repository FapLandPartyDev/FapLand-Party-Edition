import { useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { GameDropdown } from "@/components/ui/GameDropdown";
import { useToast } from "@/components/ui/ToastHost";
import { db } from "@/services/db";
import { abbreviateNsfwText } from "@/utils/sfwText";
import { Modal, ModalField, modalInputClass } from "../ui/Modal";
import type { EroScriptsDialogContext, EditableRoundType, RoundEditDraft } from "../types";

export function EditRoundDialog({
  draft,
  disabled,
  onClose,
  onChange,
  onSubmit,
  onDestructiveAction,
  onEroScriptsRequest,
}: {
  draft: RoundEditDraft;
  disabled: boolean;
  onClose: () => void;
  onChange: (updater: (current: RoundEditDraft) => RoundEditDraft) => void;
  onSubmit: () => void;
  onDestructiveAction: () => void;
  onEroScriptsRequest: (context: EroScriptsDialogContext) => void;
}) {
  const { t } = useLingui();
  const { showToast } = useToast();
  const [isAutoDifficultyLoading, setIsAutoDifficultyLoading] = useState(false);
  const set = (patch: Partial<RoundEditDraft>) => onChange((prev) => ({ ...prev, ...patch }));

  return (
    <Modal
      title={t`Edit Round`}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel={disabled ? t`Saving...` : t`Save Round`}
      disabled={disabled}
      destructiveActionLabel={disabled ? t`Deleting...` : t`Delete Round`}
      onDestructiveAction={onDestructiveAction}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ModalField label={t`Name`}>
          <input
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            className={modalInputClass}
          />
        </ModalField>
        <ModalField label={t`Type`}>
          <GameDropdown
            value={draft.type}
            options={[
              { value: "Normal", label: t`Normal` },
              { value: "Interjection", label: t`Interjection` },
              { value: "Cum", label: abbreviateNsfwText(t`Cum`, false) },
            ]}
            onChange={(value) => set({ type: value as EditableRoundType })}
          />
        </ModalField>
        <ModalField label={t`Author`}>
          <input
            value={draft.author}
            onChange={(e) => set({ author: e.target.value })}
            className={modalInputClass}
          />
        </ModalField>
        <ModalField label={t`BPM`}>
          <input
            value={draft.bpm}
            onChange={(e) => set({ bpm: e.target.value })}
            className={modalInputClass}
          />
        </ModalField>
        <ModalField label={t`Difficulty`}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-xl border border-violet-300/30 bg-black/45 px-3 py-2">
              {[1, 2, 3, 4, 5].map((level) => {
                const currentDifficulty = draft.difficulty ? parseInt(draft.difficulty, 10) : 0;
                const active = level <= currentDifficulty;
                return (
                  <button
                    key={level}
                    type="button"
                    aria-label={t`Set difficulty to ${level} star${level === 1 ? "" : "s"}`}
                    onClick={() => set({ difficulty: String(level) })}
                    className={`text-lg leading-none transition-colors ${
                      active
                        ? "text-yellow-300 drop-shadow-[0_0_6px_rgba(253,224,71,0.7)]"
                        : "text-zinc-600 hover:text-zinc-400"
                    }`}
                  >
                    ★
                  </button>
                );
              })}
            </div>
            {draft.funscriptUri && (
              <button
                type="button"
                disabled={isAutoDifficultyLoading}
                onClick={() => {
                  if (!draft.funscriptUri) return;
                  setIsAutoDifficultyLoading(true);
                  db.round
                    .calculateDifficultyFromFunscript(draft.funscriptUri)
                    .then((result) => {
                      if (result != null) {
                        set({ difficulty: String(result) });
                      } else {
                        showToast(t`Could not estimate difficulty from funscript.`, "error");
                      }
                    })
                    .catch(() => {
                      showToast(t`Could not estimate difficulty from funscript.`, "error");
                    })
                    .finally(() => setIsAutoDifficultyLoading(false));
                }}
                className="text-xs text-zinc-500 hover:text-zinc-400 disabled:opacity-50"
              >
                {isAutoDifficultyLoading ? t`Calculating…` : t`Auto from funscript`}
              </button>
            )}
            {draft.difficulty && (
              <button
                type="button"
                onClick={() => set({ difficulty: "" })}
                className="text-xs text-zinc-500 hover:text-zinc-400"
              >
                <Trans>clear</Trans>
              </button>
            )}
          </div>
        </ModalField>
        <ModalField label={t`Start Time (ms)`}>
          <input
            value={draft.startTime}
            onChange={(e) => set({ startTime: e.target.value })}
            className={modalInputClass}
          />
        </ModalField>
        <ModalField label={t`End Time (ms)`}>
          <input
            value={draft.endTime}
            onChange={(e) => set({ endTime: e.target.value })}
            className={modalInputClass}
          />
        </ModalField>
        <ModalField label={t`Funscript`} className="sm:col-span-2">
          <div className="space-y-3 rounded-xl border border-violet-300/30 bg-black/45 p-3">
            <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200">
              {draft.funscriptUri ? (
                <span className="break-all">{draft.funscriptUri}</span>
              ) : (
                <span className="text-zinc-500">
                  <Trans>No funscript attached</Trans>
                </span>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase tracking-[0.18em] text-zinc-500">
                <Trans>Funscript Offset (ms)</Trans>
              </label>
              <input
                value={draft.funscriptOffsetMs}
                disabled={disabled || !draft.resourceId}
                inputMode="numeric"
                placeholder="0"
                onChange={(e) => set({ funscriptOffsetMs: e.target.value })}
                className={modalInputClass}
              />
            </div>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={draft.invertFunscript}
                disabled={disabled || !draft.resourceId || !draft.funscriptUri}
                onChange={(e) => set({ invertFunscript: e.target.checked })}
                className="h-4 w-4 rounded border-violet-300/40 bg-black/45 text-violet-400 focus:ring-violet-400/60 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span className="text-sm text-zinc-300">
                <Trans>Invert funscript (flip all positions)</Trans>
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={disabled || !draft.resourceId}
                onClick={() => {
                  void window.electronAPI.dialog
                    .selectConverterFunscriptFile()
                    .then((filePath) => {
                      if (!filePath) return;
                      set({
                        funscriptUri: window.electronAPI.file.convertFileSrc(filePath),
                      });
                    });
                }}
                className="rounded-xl border border-cyan-300/35 bg-cyan-500/12 px-3 py-2 text-xs uppercase tracking-[0.18em] text-cyan-100 transition-all duration-200 hover:border-cyan-200/75 hover:bg-cyan-500/24 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {draft.funscriptUri ? t`Replace Funscript` : t`Attach Funscript`}
              </button>
              <button
                type="button"
                disabled={disabled || !draft.resourceId || !draft.funscriptUri}
                onClick={() => set({ funscriptUri: null })}
                className="rounded-xl border border-orange-300/35 bg-orange-500/12 px-3 py-2 text-xs uppercase tracking-[0.18em] text-orange-100 transition-all duration-200 hover:border-orange-200/75 hover:bg-orange-500/24 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trans>Detach Funscript</Trans>
              </button>
              <button
                type="button"
                disabled={disabled || !draft.resourceId}
                onClick={() => onEroScriptsRequest("edit-round")}
                className="rounded-xl border border-emerald-300/35 bg-emerald-500/12 px-3 py-2 text-xs uppercase tracking-[0.18em] text-emerald-100 transition-all duration-200 hover:border-emerald-200/75 hover:bg-emerald-500/24 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trans>Search EroScripts</Trans>
              </button>
            </div>
            {!draft.resourceId && (
              <p className="text-xs text-zinc-500">
                <Trans>
                  Template rounds do not have a primary media resource, so a funscript cannot be
                  attached here.
                </Trans>
              </p>
            )}
          </div>
        </ModalField>
        <ModalField label={t`Random Selection`} className="sm:col-span-2">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={draft.excludeFromRandom}
              onChange={(e) => set({ excludeFromRandom: e.target.checked })}
              className="h-4 w-4 rounded border-violet-300/40 bg-black/45 text-violet-400 focus:ring-violet-400/60"
            />
            <span className="text-sm text-zinc-300">
              <Trans>Exclude from random round selection</Trans>
            </span>
          </label>
          <p className="mt-1 text-xs text-zinc-500">
            <Trans>
              When enabled, this round will never be picked by random round nodes, the succubus
              anti-perk, or the cum round fallback.
            </Trans>
          </p>
        </ModalField>
        <ModalField label={t`Tags`} className="sm:col-span-2">
          <input
            value={draft.tagsText}
            onChange={(e) => set({ tagsText: e.target.value })}
            placeholder={t`tag-one, tag-two`}
            className={modalInputClass}
          />
        </ModalField>
        <ModalField label={t`Library`} className="sm:col-span-2">
          <input
            value={draft.libraryLabel}
            onChange={(e) => set({ libraryLabel: e.target.value })}
            className={modalInputClass}
          />
        </ModalField>
        <ModalField label={t`Description`} className="sm:col-span-2">
          <textarea
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            className={`min-h-28 ${modalInputClass}`}
          />
        </ModalField>
      </div>
    </Modal>
  );
}
