import React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { GameDropdown } from "../../../../components/ui/GameDropdown";
import { playHoverSound, playSelectSound } from "../../../../utils/audio";
import { ConditionEditor } from "./ConditionEditor";
import type { EditorGraphConfig } from "../../EditorState";
import type { AutomationConditionGroup } from "../../../../game/automation/schema";
import type { ConditionKind } from "../../../../game/automation/registry";

type ConditionGroupEditorProps = {
  group: AutomationConditionGroup;
  depth: number;
  config: EditorGraphConfig;
  ruleIdForRefs?: string;
  onPatchGroup: (path: number[], patch: { operator?: "all" | "any" }) => void;
  onAddCondition: (path: number[], kind: ConditionKind) => void;
  onAddSubGroup: (path: number[]) => void;
  onPatchCondition: (path: number[], patch: Record<string, unknown>) => void;
  onReplaceCondition: (path: number[], kind: ConditionKind) => void;
  onRemoveEntry: (path: number[]) => void;
};

const CONDITION_KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "currentNode", label: "Current Node" },
  { value: "triggerNode", label: "Trigger Node" },
  { value: "hasPerk", label: "Has Perk" },
  { value: "hasAntiPerk", label: "Has Anti-Perk" },
  { value: "playerMoney", label: "Player Money" },
  { value: "playerScore", label: "Player Score" },
  { value: "shieldRounds", label: "Shield Rounds" },
  { value: "restRemainingMs", label: "Rest Remaining" },
  { value: "restState", label: "Rest State" },
  { value: "roundState", label: "Round State" },
  { value: "musicState", label: "Music State" },
  { value: "currentTrack", label: "Current Track" },
  { value: "background", label: "Background" },
  { value: "ruleCooldown", label: "Rule Cooldown" },
];

export const ConditionGroupEditor: React.FC<ConditionGroupEditorProps> = React.memo(
  ({
    group,
    depth,
    config,
    ruleIdForRefs,
    onPatchGroup,
    onAddCondition,
    onAddSubGroup,
    onPatchCondition,
    onReplaceCondition,
    onRemoveEntry,
  }) => {
    const { t } = useLingui();
    const [newConditionKind, setNewConditionKind] = React.useState<ConditionKind>("currentNode");

    const borderColor =
      depth === 0
        ? "border-zinc-700/40"
        : depth === 1
          ? "border-amber-500/25"
          : "border-fuchsia-500/25";

    return (
      <div
        className={`space-y-2 rounded-lg border ${borderColor} p-2.5`}
        style={{ marginLeft: depth > 0 ? 8 : 0, background: `rgba(9,9,11,${0.6 - depth * 0.1})` }}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {depth > 0 && (
              <span className="text-[10px] uppercase tracking-[0.08em] text-zinc-600">
                {group.operator === "all" ? t`AND` : t`OR`}
              </span>
            )}
            <GameDropdown
              value={group.operator}
              options={[
                { value: "all", label: t`All (AND)` },
                { value: "any", label: t`Any (OR)` },
              ]}
              onChange={(value: string) => onPatchGroup([], { operator: value as "all" | "any" })}
              onHoverSfx={playHoverSound}
              onSelectSfx={playSelectSound}
              className="w-32"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <GameDropdown
              value={newConditionKind}
              options={CONDITION_KIND_OPTIONS}
              onChange={(v: string) => setNewConditionKind(v as ConditionKind)}
              onHoverSfx={playHoverSound}
              onSelectSfx={playSelectSound}
              className="w-36"
            />
            <button
              type="button"
              className="rounded-md border border-zinc-700/50 bg-zinc-950/70 px-2 py-1.5 text-[11px] text-zinc-200 hover:border-zinc-500/60 hover:text-white"
              onClick={() => onAddCondition([], newConditionKind)}
            >
              <Trans>+</Trans>
            </button>
            {depth < 3 && (
              <button
                type="button"
                className="rounded-md border border-amber-500/30 bg-amber-500/8 px-2 py-1.5 text-[11px] text-amber-200 hover:border-amber-400/50 hover:bg-amber-500/15"
                onClick={() => onAddSubGroup([])}
              >
                <Trans>Group</Trans>
              </button>
            )}
          </div>
        </div>

        {group.conditions.length === 0 ? (
          <p className="text-xs text-zinc-500 py-1">
            <Trans>No conditions. Rule fires whenever the trigger matches.</Trans>
          </p>
        ) : (
          group.conditions.map((entry, index) => {
            if ("operator" in entry) {
              return (
                <ConditionGroupEditor
                  key={`group-${depth}-${index}`}
                  group={entry}
                  depth={depth + 1}
                  config={config}
                  ruleIdForRefs={ruleIdForRefs}
                  onPatchGroup={(subPath, patch) => onPatchGroup([index, ...subPath], patch)}
                  onAddCondition={(subPath, kind) => onAddCondition([index, ...subPath], kind)}
                  onAddSubGroup={(subPath) => onAddSubGroup([index, ...subPath])}
                  onPatchCondition={(subPath, patch) =>
                    onPatchCondition([index, ...subPath], patch)
                  }
                  onReplaceCondition={(subPath, kind) =>
                    onReplaceCondition([index, ...subPath], kind)
                  }
                  onRemoveEntry={(subPath) => onRemoveEntry([index, ...subPath])}
                />
              );
            }
            return (
              <ConditionEditor
                key={`cond-${depth}-${index}`}
                condition={entry}
                config={config}
                ruleIdForRefs={ruleIdForRefs}
                onPatch={(patch) => onPatchCondition([index], patch)}
                onReplaceCondition={(kind) => onReplaceCondition([index], kind)}
                onRemove={() => onRemoveEntry([index])}
              />
            );
          })
        )}
      </div>
    );
  }
);

ConditionGroupEditor.displayName = "ConditionGroupEditor";
