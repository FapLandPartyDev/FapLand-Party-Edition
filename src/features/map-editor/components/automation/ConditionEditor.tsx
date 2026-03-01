import React from "react";
import { Trans } from "@lingui/react/macro";
import { GameDropdown } from "../../../../components/ui/GameDropdown";
import { playHoverSound, playSelectSound } from "../../../../utils/audio";
import {
  AUTOMATION_CONDITION_DESCRIPTORS,
  CONDITION_FIELDS,
  type ConditionKind,
} from "../../../../game/automation/registry";
import { DynamicFieldEditor } from "./DynamicFieldEditor";
import type { EditorGraphConfig } from "../../EditorState";
import type { AutomationCondition } from "../../../../game/automation/schema";

type ConditionEditorProps = {
  condition: AutomationCondition;
  config: EditorGraphConfig;
  ruleIdForRefs?: string;
  onPatch: (patch: Record<string, unknown>) => void;
  onReplaceCondition: (kind: ConditionKind) => void;
  onRemove: () => void;
};

function buildDefaultCondition(
  kind: ConditionKind,
  config: EditorGraphConfig
): AutomationCondition {
  switch (kind) {
    case "currentNode":
      return { kind: "currentNode", comparator: "is", nodeId: config.startNodeId };
    case "triggerNode":
      return { kind: "triggerNode", comparator: "is", nodeId: config.startNodeId };
    case "hasPerk":
      return { kind: "hasPerk", perkId: "" };
    case "hasAntiPerk":
      return { kind: "hasAntiPerk", perkId: "" };
    case "playerMoney":
      return { kind: "playerMoney", comparator: "gt", value: 0 };
    case "playerScore":
      return { kind: "playerScore", comparator: "gt", value: 0 };
    case "shieldRounds":
      return { kind: "shieldRounds", comparator: "gt", value: 0 };
    case "restRemainingMs":
      return { kind: "restRemainingMs", comparator: "gt", value: 0 };
    case "restState":
      return { kind: "restState", state: "paused" };
    case "roundState":
      return { kind: "roundState", state: "active" };
    case "musicState":
      return { kind: "musicState", state: "playing" };
    case "currentTrack":
      return { kind: "currentTrack", comparator: "is", trackId: config.music.tracks[0]?.id ?? "" };
    case "background":
      return { kind: "background", comparator: "isSet" };
    case "ruleCooldown":
      return { kind: "ruleCooldown", state: "active" };
    default:
      return { kind } as unknown as AutomationCondition;
  }
}

export const ConditionEditor: React.FC<ConditionEditorProps> = React.memo(
  ({ condition, config, ruleIdForRefs, onPatch, onReplaceCondition, onRemove }) => {
    const fields = CONDITION_FIELDS[condition.kind as ConditionKind] ?? [];

    const categorizedOptions = React.useMemo(() => {
      const seen = new Map<string, Array<{ value: string; label: string }>>();
      for (const d of AUTOMATION_CONDITION_DESCRIPTORS) {
        let list = seen.get(d.category);
        if (!list) {
          list = [];
          seen.set(d.category, list);
        }
        list.push({ value: d.kind, label: d.label });
      }
      const result: Array<{ value: string; label: string; heading?: boolean }> = [];
      for (const [, items] of seen) {
        result.push({
          value: `__heading_${items[0]!.value}`,
          label: items[0]!.value,
          heading: true,
        });
        for (const item of items) {
          result.push(item);
        }
      }
      return result;
    }, []);

    const handleFieldChange = (fieldName: string, value: unknown) => {
      onPatch({ [fieldName]: value });
    };

    const isInverted = "invert" in condition ? Boolean(condition.invert) : false;

    return (
      <div className="rounded-lg border border-zinc-700/40 bg-zinc-950/60 p-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <GameDropdown
            value={condition.kind}
            options={categorizedOptions}
            onChange={(v: string) => onReplaceCondition(v as ConditionKind)}
            onHoverSfx={playHoverSound}
            onSelectSfx={playSelectSound}
            className="flex-1 min-w-[140px]"
          />
          <label className="flex items-center gap-1.5 rounded-md border border-zinc-700/40 bg-zinc-950/40 px-2 py-1.5 text-[11px] text-zinc-400 shrink-0">
            <input
              type="checkbox"
              checked={isInverted}
              onChange={(e) => onPatch({ invert: e.target.checked })}
              className="accent-amber-500"
            />
            <Trans>Invert</Trans>
          </label>
          <button
            type="button"
            className="rounded-md border border-rose-500/35 bg-rose-500/10 px-2 py-1.5 text-[11px] text-rose-100 shrink-0 hover:border-rose-400/55 hover:bg-rose-500/20"
            onClick={onRemove}
          >
            <Trans>Remove</Trans>
          </button>
        </div>
        {fields.length > 0 && (
          <div className="grid grid-cols-2 gap-2 pl-1">
            {fields.map((field) => (
              <DynamicFieldEditor
                key={field.name}
                field={field}
                value={(condition as Record<string, unknown>)[field.name]}
                config={config}
                ruleIdForRefs={ruleIdForRefs}
                onChange={handleFieldChange}
                labelClassName="!text-[10px]"
              />
            ))}
          </div>
        )}
      </div>
    );
  }
);

ConditionEditor.displayName = "ConditionEditor";

export { buildDefaultCondition };
