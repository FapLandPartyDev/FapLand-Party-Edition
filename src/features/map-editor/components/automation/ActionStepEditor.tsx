import React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { GameDropdown } from "../../../../components/ui/GameDropdown";
import { playHoverSound, playSelectSound } from "../../../../utils/audio";
import {
  AUTOMATION_ACTION_DESCRIPTORS,
  ACTION_FIELDS,
  getNestedValue,
  setNestedValue,
  type ActionKind,
} from "../../../../game/automation/registry";
import { DynamicFieldEditor } from "./DynamicFieldEditor";
import { BackgroundPresetEditor } from "./BackgroundPresetEditor";
import type { EditorGraphConfig, EditorAutomationRule } from "../../EditorState";
import { createEditorId } from "../../EditorState";

type ActionStepEditorProps = {
  step: EditorAutomationRule["actions"][number];
  config: EditorGraphConfig;
  ruleIdForRefs?: string;
  stepIndex: number;
  onPatchAction: (actionId: string, patch: Record<string, unknown>) => void;
  onPatchActionKind: (actionId: string, kind: string) => void;
  onRemoveAction: (actionId: string) => void;
};

const COLLAPSIBLE_ACTIONS: ReadonlySet<string> = new Set([
  "background.setPreset",
  "graph.addNode",
  "graph.patchNode",
  "graph.addEdge",
  "graph.patchEdge",
]);

function buildDefaultAction(kind: ActionKind, config: EditorGraphConfig): Record<string, unknown> {
  switch (kind) {
    case "timer.setRestRemainingMs":
      return { kind, remainingMs: 5000 };
    case "player.grantPauseCharge":
    case "player.grantSkipCharge":
      return { kind, amount: 1 };
    case "player.adjustMoney":
    case "player.adjustScore":
      return { kind, amount: 50 };
    case "player.applyPerk":
    case "player.removePerk":
    case "player.applyAntiPerk":
    case "player.removeAntiPerk":
      return { kind, perkId: "" };
    case "music.playTrack":
      return { kind, trackId: config.music.tracks[0]?.id ?? "" };
    case "music.setPlaylistLoop":
      return { kind, loop: true };
    case "ui.showToast":
      return { kind, message: "", variant: "info" };
    case "background.setPreset":
      return {
        kind,
        preset: {
          kind: "image",
          uri: config.style.background?.uri ?? "",
          name: config.style.background?.name ?? "Background",
          fit: config.style.background?.fit ?? "cover",
          position: config.style.background?.position ?? "center",
          opacity: config.style.background?.opacity ?? 0.55,
          blur: config.style.background?.blur ?? 0,
          dim: config.style.background?.dim ?? 0.35,
          scale: config.style.background?.scale ?? 1,
          offsetX: config.style.background?.offsetX ?? 0,
          offsetY: config.style.background?.offsetY ?? 0,
          motion: config.style.background?.motion ?? "fixed",
          parallaxStrength: config.style.background?.parallaxStrength ?? 0.18,
        },
      };
    case "graph.addNode":
      return {
        kind,
        node: {
          id: createEditorId("node"),
          name: "New Node",
          kind: "path",
        },
      };
    case "graph.removeNode":
      return { kind, nodeId: config.startNodeId };
    case "graph.patchNode":
      return { kind, nodeId: config.startNodeId, patch: { name: "Patched" } };
    case "graph.addEdge":
      return {
        kind,
        edge: {
          id: createEditorId("edge"),
          fromNodeId: config.nodes[0]?.id ?? "",
          toNodeId: config.nodes[1]?.id ?? "",
        },
      };
    case "graph.removeEdge":
      return { kind, edgeId: config.edges[0]?.id ?? "" };
    case "graph.patchEdge":
      return { kind, edgeId: config.edges[0]?.id ?? "", patch: {} };
    case "graph.setStartNode":
      return { kind, nodeId: config.startNodeId };
    case "rule.enable":
    case "rule.disable":
      return { kind, ruleId: (config.automations ?? [])[0]?.id ?? "" };
    case "rule.setCooldownMs":
      return { kind, ruleId: (config.automations ?? [])[0]?.id ?? "", cooldownMs: 5000 };
    default:
      return { kind };
  }
}

export const ActionStepEditor: React.FC<ActionStepEditorProps> = React.memo(
  ({
    step,
    config,
    ruleIdForRefs,
    stepIndex,
    onPatchAction,
    onPatchActionKind,
    onRemoveAction,
  }) => {
    const { t } = useLingui();
    const action = step.action as Record<string, unknown>;
    const kind = action.kind as string;
    const fields = ACTION_FIELDS[kind as ActionKind] ?? [];
    const isCollapsible = COLLAPSIBLE_ACTIONS.has(kind) && fields.length > 3;
    const [expanded, setExpanded] = React.useState(!isCollapsible);

    const categorizedOptions = React.useMemo(() => {
      const seen = new Map<string, Array<{ value: string; label: string }>>();
      for (const d of AUTOMATION_ACTION_DESCRIPTORS) {
        let list = seen.get(d.category);
        if (!list) {
          list = [];
          seen.set(d.category, list);
        }
        list.push({ value: d.kind, label: d.label });
      }
      const result: Array<{ value: string; label: string; heading?: boolean }> = [];
      for (const [category, items] of seen) {
        result.push({ value: `__heading_${category}`, label: category, heading: true });
        for (const item of items) {
          result.push(item);
        }
      }
      return result;
    }, []);

    const handleFieldChange = (fieldName: string, value: unknown) => {
      onPatchAction(step.id, {
        action: setNestedValue(action, fieldName, value),
      });
    };

    const resolveFieldValue = (fieldName: string): unknown => {
      return getNestedValue(action, fieldName);
    };

    const hasContainerFields = fields.some((f) => f.name.includes("."));

    const displayFields = isCollapsible && !expanded ? fields.slice(0, 2) : fields;

    return (
      <div className="space-y-2 rounded-lg border border-zinc-700/40 bg-zinc-950/60 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-zinc-600 font-mono">{stepIndex + 1}.</span>
          <GameDropdown
            value={kind}
            options={categorizedOptions}
            onChange={(value: string) => onPatchActionKind(step.id, value)}
            onHoverSfx={playHoverSound}
            onSelectSfx={playSelectSound}
            className="min-w-[160px] flex-1"
          />
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              step={100}
              value={step.delayMs ?? 0}
              onChange={(e) =>
                onPatchAction(step.id, {
                  delayMs: Math.max(0, Number.parseInt(e.target.value, 10) || 0),
                })
              }
              className="w-20 rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2 py-1 text-xs text-zinc-100"
            />
            <span className="text-[10px] text-zinc-500">{t`ms`}</span>
          </div>
          <label className="flex items-center gap-1 rounded-md border border-zinc-700/40 bg-zinc-950/40 px-2 py-1 text-[10px] text-zinc-400">
            <input
              type="checkbox"
              checked={step.continueOnError ?? false}
              onChange={(e) => onPatchAction(step.id, { continueOnError: e.target.checked })}
              className="accent-cyan-500"
            />
            {t`Continue on error`}
          </label>
          <button
            type="button"
            className="ml-auto rounded-md border border-rose-500/35 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-100 hover:border-rose-400/55 hover:bg-rose-500/20"
            onClick={() => onRemoveAction(step.id)}
          >
            <Trans>Remove</Trans>
          </button>
        </div>

        {kind === "background.setPreset" ? (
          <BackgroundPresetEditor
            preset={(action.preset ?? {}) as Record<string, unknown>}
            onPatchPreset={(patch) =>
              onPatchAction(step.id, {
                action: {
                  ...action,
                  preset: {
                    ...((action.preset as Record<string, unknown>) ?? {}),
                    ...patch,
                  },
                },
              })
            }
          />
        ) : displayFields.length > 0 ? (
          <div className="space-y-2">
            {!hasContainerFields ? (
              <div className="grid grid-cols-2 gap-2">
                {displayFields.map((field) => (
                  <DynamicFieldEditor
                    key={field.name}
                    field={field}
                    value={resolveFieldValue(field.name)}
                    config={config}
                    ruleIdForRefs={ruleIdForRefs}
                    onChange={handleFieldChange}
                    labelClassName="!text-[10px]"
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {(() => {
                  const containerNames = [
                    ...new Set(
                      fields.filter((f) => f.name.includes(".")).map((f) => f.name.split(".")[0]!)
                    ),
                  ];
                  return containerNames.map((containerName) => {
                    const containerFields = fields.filter((f) =>
                      f.name.startsWith(`${containerName}.`)
                    );
                    const maybeContainer = action[containerName];
                    const container =
                      typeof maybeContainer === "object" && maybeContainer !== null
                        ? (maybeContainer as Record<string, unknown>)
                        : {};
                    const visibleContainerFields =
                      isCollapsible && !expanded ? containerFields.slice(0, 2) : containerFields;
                    return (
                      <div
                        key={containerName}
                        className="rounded-md border border-zinc-700/30 bg-zinc-950/30 p-2 space-y-2"
                      >
                        <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                          {containerName}
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {visibleContainerFields.map((field) => (
                            <DynamicFieldEditor
                              key={field.name}
                              field={field}
                              value={container[field.name.slice(containerName.length + 1)]}
                              config={config}
                              ruleIdForRefs={ruleIdForRefs}
                              onChange={handleFieldChange}
                              labelClassName="!text-[10px]"
                            />
                          ))}
                        </div>
                      </div>
                    );
                  });
                })()}
                {(() => {
                  const nonContainerFields = displayFields.filter((f) => !f.name.includes("."));
                  if (nonContainerFields.length === 0) return null;
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      {nonContainerFields.map((field) => (
                        <DynamicFieldEditor
                          key={field.name}
                          field={field}
                          value={resolveFieldValue(field.name)}
                          config={config}
                          ruleIdForRefs={ruleIdForRefs}
                          onChange={handleFieldChange}
                          labelClassName="!text-[10px]"
                        />
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}
            {isCollapsible && (
              <button
                type="button"
                className="w-full rounded-md border border-zinc-700/30 bg-zinc-950/30 py-1 text-[10px] text-zinc-400 hover:text-zinc-200 hover:border-zinc-500/40"
                onClick={() => setExpanded((prev) => !prev)}
              >
                {expanded ? t`Show less` : t`${fields.length - 2} more fields...`}
              </button>
            )}
          </div>
        ) : null}
      </div>
    );
  }
);

ActionStepEditor.displayName = "ActionStepEditor";

export { buildDefaultAction };
