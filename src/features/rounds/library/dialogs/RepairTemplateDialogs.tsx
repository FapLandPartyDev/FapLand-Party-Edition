import { Trans, useLingui } from "@lingui/react/macro";
import { GameDropdown } from "@/components/ui/GameDropdown";
import { Modal, ModalField } from "../ui/Modal";
import { isTemplateRound } from "../helpers";
import type {
  HeroTemplateRepairState,
  RoundLibraryEntry,
  RoundTemplateRepairState,
} from "../types";
import type { SourceHeroOption } from "@/routes/roundsSelectors";

export function RepairTemplateRoundDialog({
  state,
  rounds,
  disabled,
  onClose,
  onChange,
  onSubmit,
}: {
  state: RoundTemplateRepairState;
  rounds: RoundLibraryEntry[];
  disabled: boolean;
  onClose: () => void;
  onChange: (updater: (current: RoundTemplateRepairState) => RoundTemplateRepairState) => void;
  onSubmit: () => void;
}) {
  const { t } = useLingui();
  return (
    <Modal
      title={t`Repair Template Round`}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel={disabled ? t`Repairing...` : t`Attach Source Media`}
      disabled={disabled}
    >
      <div className="space-y-4">
        <p className="rounded-2xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm text-zinc-200">
          <Trans>
            Attach installed media to{" "}
            <span className="font-semibold text-amber-100">{state.roundName}</span>.
          </Trans>
        </p>
        <ModalField label={t`Installed Round Source`}>
          <GameDropdown
            value={state.installedRoundId}
            options={[
              { value: "" as string, label: t`Select installed round` },
              ...rounds
                .filter((round) => !isTemplateRound(round))
                .map((round) => ({
                  value: round.id,
                  label: round.name + (round.hero?.name ? ` [${round.hero.name}]` : ""),
                })),
            ]}
            onChange={(value) =>
              onChange((current) => ({ ...current, installedRoundId: value }))
            }
          />
        </ModalField>
      </div>
    </Modal>
  );
}

export function RepairTemplateHeroDialog({
  state,
  sourceHeroOptions,
  disabled,
  onClose,
  onChange,
  onApplySourceHero,
  onSubmit,
}: {
  state: HeroTemplateRepairState;
  sourceHeroOptions: SourceHeroOption[];
  disabled: boolean;
  onClose: () => void;
  onChange: (updater: (current: HeroTemplateRepairState) => HeroTemplateRepairState) => void;
  onApplySourceHero: (sourceHeroId: string) => void;
  onSubmit: () => void;
}) {
  const { t } = useLingui();
  return (
    <Modal
      title={t`Repair Template Hero`}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel={disabled ? t`Repairing...` : t`Attach Hero Media`}
      disabled={disabled}
    >
      <div className="space-y-4">
        <p className="rounded-2xl border border-amber-300/25 bg-amber-500/10 p-4 text-sm text-zinc-200">
          <Trans>
            Choose a source hero for{" "}
            <span className="font-semibold text-amber-100">{state.heroName}</span>. Assignments are
            auto-filled by round name, then order.
          </Trans>
        </p>
        <ModalField label={t`Source Hero`}>
          <GameDropdown
            value={state.sourceHeroId}
            options={[
              { value: "" as string, label: t`Select source hero` },
              ...sourceHeroOptions.map((option) => ({
                value: option.heroId,
                label: `${option.heroName} (${option.rounds.length} rounds)`,
              })),
            ]}
            onChange={(value) => onApplySourceHero(value)}
          />
        </ModalField>
        <div className="space-y-3">
          {state.assignments.map((assignment) => {
            const selectedSourceHero = sourceHeroOptions.find(
              (entry) => entry.heroId === state.sourceHeroId
            );
            return (
              <ModalField key={assignment.roundId} label={assignment.roundName}>
                <GameDropdown
                  value={assignment.installedRoundId}
                  options={[
                    { value: "" as string, label: t`Select installed round` },
                    ...(selectedSourceHero?.rounds ?? []).map((round) => ({
                      value: round.id,
                      label: round.name,
                    })),
                  ]}
                  onChange={(value) =>
                    onChange((current) => ({
                      ...current,
                      assignments: current.assignments.map((entry) =>
                        entry.roundId === assignment.roundId
                          ? { ...entry, installedRoundId: value }
                          : entry
                      ),
                    }))
                  }
                />
              </ModalField>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
