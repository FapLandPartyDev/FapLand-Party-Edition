import { Trans, useLingui } from "@lingui/react/macro";
import { Modal, ModalField, modalInputClass } from "../ui/Modal";
import type { EroScriptsDialogContext, HeroEditDraft } from "../types";

export function EditHeroDialog({
  draft,
  disabled,
  onClose,
  onChange,
  onSubmit,
  onDestructiveAction,
  onEroScriptsRequest,
}: {
  draft: HeroEditDraft;
  disabled: boolean;
  onClose: () => void;
  onChange: (updater: (current: HeroEditDraft) => HeroEditDraft) => void;
  onSubmit: () => void;
  onDestructiveAction: () => void;
  onEroScriptsRequest: (context: EroScriptsDialogContext) => void;
}) {
  const { t } = useLingui();
  const set = (patch: Partial<HeroEditDraft>) => onChange((prev) => ({ ...prev, ...patch }));

  return (
    <Modal
      title={t`Edit Hero`}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel={disabled ? t`Saving...` : t`Save Hero`}
      disabled={disabled}
      destructiveActionLabel={disabled ? t`Deleting...` : t`Delete Hero`}
      onDestructiveAction={onDestructiveAction}
    >
      <div className="grid grid-cols-1 gap-3">
        <ModalField label={t`Name`}>
          <input
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            className={modalInputClass}
          />
        </ModalField>
        <ModalField label={t`Author`}>
          <input
            value={draft.author}
            onChange={(e) => set({ author: e.target.value })}
            className={modalInputClass}
          />
        </ModalField>
        <ModalField label={t`Tags`}>
          <input
            value={draft.tagsText}
            onChange={(e) => set({ tagsText: e.target.value })}
            placeholder={t`tag-one, tag-two`}
            className={modalInputClass}
          />
        </ModalField>
        <ModalField label={t`Description`}>
          <textarea
            value={draft.description}
            onChange={(e) => set({ description: e.target.value })}
            className={`min-h-28 ${modalInputClass}`}
          />
        </ModalField>
        <div>
          <span className="mb-2 block font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.24em] text-zinc-300">
            <Trans>Funscript</Trans>
          </span>
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
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  void window.electronAPI.dialog
                    .selectConverterFunscriptFile()
                    .then((filePath) => {
                      if (!filePath) return;
                      set({
                        funscriptUri: window.electronAPI.file.convertFileSrc(filePath),
                        funscriptDirty: true,
                      });
                    });
                }}
                className="rounded-xl border border-cyan-300/35 bg-cyan-500/12 px-3 py-2 text-xs uppercase tracking-[0.18em] text-cyan-100 transition-all duration-200 hover:border-cyan-200/75 hover:bg-cyan-500/24 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {draft.funscriptUri ? t`Replace Funscript` : t`Attach Funscript`}
              </button>
              <button
                type="button"
                disabled={disabled || !draft.funscriptUri}
                onClick={() => set({ funscriptUri: null, funscriptDirty: true })}
                className="rounded-xl border border-orange-300/35 bg-orange-500/12 px-3 py-2 text-xs uppercase tracking-[0.18em] text-orange-100 transition-all duration-200 hover:border-orange-200/75 hover:bg-orange-500/24 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trans>Detach Funscript</Trans>
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onEroScriptsRequest("edit-hero")}
                className="rounded-xl border border-emerald-300/35 bg-emerald-500/12 px-3 py-2 text-xs uppercase tracking-[0.18em] text-emerald-100 transition-all duration-200 hover:border-emerald-200/75 hover:bg-emerald-500/24 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trans>Search EroScripts</Trans>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
