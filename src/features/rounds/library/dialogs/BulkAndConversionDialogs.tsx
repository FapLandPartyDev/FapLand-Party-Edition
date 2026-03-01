import { Trans, useLingui } from "@lingui/react/macro";
import { Modal, ModalField, modalInputClass, modalSelectClass } from "../ui/Modal";
import type { BulkTagsDialogState, HeroGroupRoundConversionState } from "../types";

export function BulkTagsDialog({
  state,
  selectedCount,
  disabled,
  onClose,
  onChange,
  onSubmit,
}: {
  state: BulkTagsDialogState;
  selectedCount: number;
  disabled: boolean;
  onClose: () => void;
  onChange: (updater: (current: BulkTagsDialogState) => BulkTagsDialogState) => void;
  onSubmit: () => void;
}) {
  const { t } = useLingui();
  return (
    <Modal
      title={t`Edit Tags for ${selectedCount} Rounds`}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel={disabled ? t`Saving...` : t`Apply Tags`}
      disabled={disabled}
    >
      <div className="grid gap-4">
        <ModalField label={t`Mode`}>
          <select
            value={state.mode}
            onChange={(e) =>
              onChange((prev) => ({
                ...prev,
                mode: e.target.value as BulkTagsDialogState["mode"],
              }))
            }
            className={modalSelectClass}
          >
            <option value="add">{t`Add tags`}</option>
            <option value="remove">{t`Remove tags`}</option>
            <option value="replace">{t`Replace tags`}</option>
          </select>
        </ModalField>
        <ModalField label={t`Tags`}>
          <input
            value={state.tagsText}
            onChange={(e) => onChange((prev) => ({ ...prev, tagsText: e.target.value }))}
            placeholder={t`tag-one, tag-two`}
            className={modalInputClass}
          />
        </ModalField>
        <p className="text-sm text-zinc-400">
          {state.mode === "replace"
            ? t`Replace all tags on ${selectedCount} selected rounds.`
            : state.mode === "remove"
              ? t`Remove matching tags from ${selectedCount} selected rounds.`
              : t`Add tags to ${selectedCount} selected rounds.`}
        </p>
      </div>
    </Modal>
  );
}

export function HeroGroupConversionDialog({
  state,
  disabled,
  onClose,
  onChange,
  onSubmit,
}: {
  state: HeroGroupRoundConversionState;
  disabled: boolean;
  onClose: () => void;
  onChange: (updater: (current: HeroGroupRoundConversionState) => HeroGroupRoundConversionState) => void;
  onSubmit: () => void;
}) {
  const { t } = useLingui();
  return (
    <Modal
      title={t`Convert Hero to Round`}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel={disabled ? t`Converting...` : t`Confirm Conversion`}
      disabled={disabled}
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-rose-300/25 bg-rose-500/10 p-4 text-sm text-zinc-200">
          <p className="font-semibold text-rose-100">
            <Trans>
              This keeps &ldquo;{state.keepRoundName}&rdquo; and permanently deletes{" "}
              {state.roundsToDeleteCount} attached round(s).
            </Trans>
          </p>
          <p className="mt-2 text-zinc-300">
            <Trans>
              The hero will be removed and the kept round will become a standalone entry. This
              cannot be undone in-app.
            </Trans>
          </p>
        </div>
        <ModalField label={t`Type "${state.heroName}" to confirm`}>
          <input
            value={state.confirmationText}
            onChange={(e) =>
              onChange((current) => ({
                ...current,
                confirmationText: e.target.value,
                error: null,
              }))
            }
            className="w-full rounded-xl border border-rose-300/30 bg-black/45 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-rose-200/70"
          />
        </ModalField>
        {state.error ? (
          <p className="rounded-2xl border border-amber-300/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            {state.error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
