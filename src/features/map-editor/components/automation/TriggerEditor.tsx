import React from "react";
import { GameDropdown } from "../../../../components/ui/GameDropdown";
import { playHoverSound, playSelectSound } from "../../../../utils/audio";
import {
  AUTOMATION_TRIGGER_DESCRIPTORS,
  TRIGGER_FIELDS,
  type TriggerKind,
} from "../../../../game/automation/registry";
import { DynamicFieldEditor } from "./DynamicFieldEditor";
import type { EditorGraphConfig } from "../../EditorState";
import type { AutomationTrigger } from "../../../../game/automation/schema";

type TriggerEditorProps = {
  trigger: AutomationTrigger;
  config: EditorGraphConfig;
  onPatchTrigger: (patch: Record<string, unknown>) => void;
  onReplaceTrigger: (trigger: AutomationTrigger) => void;
};

function buildDefaultTrigger(
  kind: TriggerKind,
  currentTrigger: AutomationTrigger
): AutomationTrigger {
  const currentRecord = currentTrigger as Record<string, unknown>;
  const nodeRef =
    "nodeId" in currentTrigger ? (currentRecord.nodeId as string | undefined) : undefined;
  switch (kind) {
    case "node.enter":
      return { kind: "node.enter", ...(nodeRef ? { nodeId: nodeRef } : {}) } as AutomationTrigger;
    case "node.leave":
      return { kind: "node.leave", ...(nodeRef ? { nodeId: nodeRef } : {}) } as AutomationTrigger;
    case "node.stay":
      return {
        kind: "node.stay",
        ...(nodeRef ? { nodeId: nodeRef } : {}),
        elapsedMs: 10000,
        repeatMode: "once",
      } as AutomationTrigger;
    case "player.stateChanged":
      return { kind: "player.stateChanged", stateKey: "money" } as AutomationTrigger;
    case "player.controlUsed":
      return { kind: "player.controlUsed", control: "pause" } as AutomationTrigger;
    case "round.lifecycle":
      return { kind: "round.lifecycle", phase: "queued" } as AutomationTrigger;
    case "music.stateChanged":
      return { kind: "music.stateChanged", state: "trackStarted" } as AutomationTrigger;
    case "session.timer":
      return { kind: "session.timer", timer: "restPauseStarted" } as AutomationTrigger;
    case "board.pathChoiceStarted":
      return { kind: "board.pathChoiceStarted" } as AutomationTrigger;
    case "board.pathChoiceResolved":
      return { kind: "board.pathChoiceResolved" } as AutomationTrigger;
    default:
      return { kind } as AutomationTrigger;
  }
}

export const TriggerEditor: React.FC<TriggerEditorProps> = React.memo(
  ({ trigger, config, onPatchTrigger, onReplaceTrigger }) => {
    const fields = TRIGGER_FIELDS[trigger.kind] ?? [];

    const categorizedOptions = React.useMemo(() => {
      const seen = new Map<string, Array<{ value: string; label: string }>>();
      for (const d of AUTOMATION_TRIGGER_DESCRIPTORS) {
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
          label: items[0]!.value.split(".")[0] ?? "",
          heading: true,
        });
        for (const item of items) {
          result.push(item);
        }
      }
      return result;
    }, []);

    const handleFieldChange = (fieldName: string, value: unknown) => {
      onPatchTrigger({ [fieldName]: value });
    };

    return (
      <div className="space-y-3">
        <GameDropdown
          value={trigger.kind}
          options={categorizedOptions}
          onChange={(value: string) =>
            onReplaceTrigger(buildDefaultTrigger(value as TriggerKind, trigger))
          }
          onHoverSfx={playHoverSound}
          onSelectSfx={playSelectSound}
        />
        {fields.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {fields.map((field) => (
              <DynamicFieldEditor
                key={field.name}
                field={field}
                value={(trigger as Record<string, unknown>)[field.name]}
                config={config}
                onChange={handleFieldChange}
              />
            ))}
          </div>
        )}
      </div>
    );
  }
);

TriggerEditor.displayName = "TriggerEditor";
