import React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { playHoverSound, playSelectSound } from "../../../utils/audio";
import type { EditorAutomationRule, EditorGraphConfig, EditorNode } from "../EditorState";
import { TriggerEditor } from "./automation/TriggerEditor";
import { ConditionGroupEditor } from "./automation/ConditionGroupEditor";
import { ActionStepEditor } from "./automation/ActionStepEditor";
import { RuleSettingsEditor } from "./automation/RuleSettingsEditor";
import { GameDropdown } from "../../../components/ui/GameDropdown";
import type { AutomationTrigger } from "../../../game/automation/schema";
import type { ConditionKind } from "../../../game/automation/registry";
import { AUTOMATION_TEMPLATE_OPTIONS } from "../automationTemplates";

type AutomationPanelProps = {
  config: EditorGraphConfig;
  selectedRuleId: string | null;
  validationMessages: ReadonlyArray<{
    path: string;
    message: string;
    severity: "error" | "warning";
  }>;
  onSelectRule: (ruleId: string | null) => void;
  onCreateRule: () => void;
  onCreateRuleFromTemplate: (templateId: string) => void;
  onDuplicateRule: (ruleId: string) => void;
  onDisableAllRules: () => void;
  onDeleteRule: (ruleId: string) => void;
  onPatchRule: (ruleId: string, patch: Partial<EditorAutomationRule>) => void;
  onPatchRuleTrigger: (ruleId: string, trigger: AutomationTrigger) => void;
  onPatchRuleConditionsOperator: (ruleId: string, operator: "all" | "any") => void;
  onAddCondition: (ruleId: string, kind: ConditionKind) => void;
  onPatchCondition: (ruleId: string, path: number[], patch: Record<string, unknown>) => void;
  onReplaceCondition: (ruleId: string, path: number[], kind: ConditionKind) => void;
  onRemoveCondition: (ruleId: string, path: number[]) => void;
  onAddConditionGroup: (ruleId: string) => void;
  onPatchConditionGroupOperator: (ruleId: string, operator: "all" | "any") => void;
  onAddAction: (ruleId: string) => void;
  onPatchAction: (ruleId: string, actionId: string, patch: Record<string, unknown>) => void;
  onPatchActionKind: (ruleId: string, actionId: string, kind: string) => void;
  onRemoveAction: (ruleId: string, actionId: string) => void;
};

function summarizeRule(rule: EditorAutomationRule, nodes: ReadonlyArray<EditorNode>): string {
  const nodeName = (nodeId?: string) =>
    nodes.find((node) => node.id === nodeId)?.name ?? nodeId ?? "any node";
  switch (rule.trigger.kind) {
    case "node.enter":
      return `Enter ${nodeName(rule.trigger.nodeId ?? (rule.scope.kind === "node" ? rule.scope.nodeId : undefined))}`;
    case "node.leave":
      return `Leave ${nodeName(rule.trigger.nodeId ?? (rule.scope.kind === "node" ? rule.scope.nodeId : undefined))}`;
    case "node.stay":
      return `Stay on ${nodeName(rule.trigger.nodeId ?? (rule.scope.kind === "node" ? rule.scope.nodeId : undefined))} for ${(rule.trigger.elapsedMs / 1000).toFixed(0)}s`;
    case "player.controlUsed":
      return `Player used ${rule.trigger.control ?? "a control"}`;
    case "round.lifecycle":
      return `Round ${rule.trigger.phase}`;
    case "music.stateChanged":
      return `Music ${rule.trigger.state}`;
    case "session.timer":
      return `Timer ${rule.trigger.timer}`;
    case "board.pathChoiceStarted":
      return "Path choice started";
    case "board.pathChoiceResolved":
      return "Path choice resolved";
    case "player.stateChanged":
      return `Player ${rule.trigger.stateKey} changed`;
    default:
      return "Automation";
  }
}

function getScopeLabel(
  rule: EditorAutomationRule,
  nodes: ReadonlyArray<EditorNode>,
  globalLabel: string,
  brokenLabel: string
): string {
  if (rule.scope.kind === "global") return globalLabel;
  const scope = rule.scope;
  return nodes.find((node) => node.id === scope.nodeId)?.name ?? brokenLabel;
}

export const AutomationPanel: React.FC<AutomationPanelProps> = React.memo(
  ({
    config,
    selectedRuleId,
    validationMessages,
    onSelectRule,
    onCreateRule,
    onCreateRuleFromTemplate,
    onDuplicateRule,
    onDisableAllRules,
    onDeleteRule,
    onPatchRule,
    onPatchRuleTrigger,
    onAddCondition,
    onPatchCondition,
    onReplaceCondition,
    onRemoveCondition,
    onAddConditionGroup,
    onPatchConditionGroupOperator,
    onAddAction,
    onPatchAction,
    onPatchActionKind,
    onRemoveAction,
  }) => {
    const { t } = useLingui();
    const [templateId, setTemplateId] =
      React.useState<(typeof AUTOMATION_TEMPLATE_OPTIONS)[number]["id"]>("node-enter-pause");
    const automations = config.automations ?? [];
    const selectedRule = automations.find((rule) => rule.id === selectedRuleId) ?? null;
    const selectedRuleMessages = selectedRule
      ? validationMessages.filter((entry) =>
          entry.path.startsWith(`automations.${selectedRule.id}`)
        )
      : [];

    const handlePatchTriggerField = (patch: Record<string, unknown>) => {
      if (!selectedRule) return;
      const newTrigger = {
        ...(selectedRule.trigger as Record<string, unknown>),
        ...patch,
      } as AutomationTrigger;
      onPatchRuleTrigger(selectedRule.id, newTrigger);
    };

    const handleReplaceTrigger = (trigger: AutomationTrigger) => {
      if (!selectedRule) return;
      onPatchRuleTrigger(selectedRule.id, trigger);
    };

    return (
      <div className="grid gap-3 p-3 grid-cols-[260px_minmax(0,1fr)]">
        <div className="col-span-2 rounded-lg border border-amber-500/35 bg-amber-950/25 px-3 py-2 text-xs text-amber-100">
          <p className="font-semibold">
            <Trans>Experimental feature</Trans>
          </p>
          <p className="mt-1 text-amber-100/80">
            <Trans>
              Automation is still in development. Expect bugs and some things not to work yet.
            </Trans>
          </p>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-white/8 bg-black/20 p-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              <Trans>Automations</Trans>
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                className="rounded-md border border-cyan-500/45 bg-cyan-500/12 px-3 py-2 text-xs font-semibold text-cyan-100 transition-colors hover:border-cyan-400/65 hover:bg-cyan-500/20"
                onMouseEnter={playHoverSound}
                onClick={onCreateRule}
              >
                <Trans>New Rule</Trans>
              </button>
              <GameDropdown
                value={templateId}
                options={AUTOMATION_TEMPLATE_OPTIONS.map((entry) => ({
                  value: entry.id,
                  label: entry.label,
                }))}
                onChange={(value) =>
                  setTemplateId(value as (typeof AUTOMATION_TEMPLATE_OPTIONS)[number]["id"])
                }
                onHoverSfx={playHoverSound}
                onSelectSfx={playSelectSound}
              />
              <button
                type="button"
                className="rounded-md border border-fuchsia-500/35 bg-fuchsia-500/10 px-3 py-2 text-xs font-semibold text-fuchsia-100 transition-colors hover:border-fuchsia-400/55 hover:bg-fuchsia-500/20"
                onMouseEnter={playHoverSound}
                onClick={() => onCreateRuleFromTemplate(templateId)}
              >
                <Trans>From Template</Trans>
              </button>
              <button
                type="button"
                className="rounded-md border border-zinc-700/50 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-200 transition-colors hover:border-zinc-500/60 hover:text-white"
                onMouseEnter={playHoverSound}
                onClick={onDisableAllRules}
              >
                <Trans>Disable All</Trans>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {automations.length === 0 ? (
              <div className="rounded-xl border border-dashed border-zinc-700/50 bg-black/20 px-4 py-5 text-xs text-zinc-500">
                <p className="font-medium text-zinc-300">
                  <Trans>Build &quot;if this happens, do that&quot; rules here.</Trans>
                </p>
                <p className="mt-1">
                  <Trans>Start with a trigger, add optional conditions, then chain actions.</Trans>
                </p>
              </div>
            ) : (
              automations.map((rule) => {
                const issues = validationMessages.filter((entry) =>
                  entry.path.startsWith(`automations.${rule.id}`)
                );
                return (
                  <button
                    key={rule.id}
                    type="button"
                    className={`block w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                      selectedRuleId === rule.id
                        ? "border-cyan-400/55 bg-cyan-500/10"
                        : "border-zinc-700/40 bg-black/20 hover:border-zinc-500/60"
                    }`}
                    onMouseEnter={playHoverSound}
                    onClick={() => onSelectRule(rule.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-zinc-100">
                        {rule.name}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] ${
                          rule.enabled
                            ? "border-emerald-400/35 bg-emerald-500/15 text-emerald-200"
                            : "border-zinc-600/50 bg-zinc-900/80 text-zinc-400"
                        }`}
                      >
                        {rule.enabled ? t`On` : t`Off`}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-400">
                      {summarizeRule(rule, config.nodes)}
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-zinc-500">
                      <span>{getScopeLabel(rule, config.nodes, t`Global`, t`Broken node`)}</span>
                      <span>
                        {rule.actions.length} {t`actions`}
                      </span>
                      {issues.length > 0 && (
                        <span className="text-amber-300">
                          {issues.length} {t`issues`}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-black/20 p-4">
          {!selectedRule ? (
            <div className="text-sm text-zinc-400">
              <Trans>Select a rule to edit its trigger, conditions, and actions.</Trans>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={selectedRule.name}
                  onChange={(event) => onPatchRule(selectedRule.id, { name: event.target.value })}
                  className="min-w-[220px] flex-1 rounded-md border border-zinc-700/50 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
                />
                <label className="flex items-center gap-2 rounded-md border border-zinc-700/50 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200">
                  <input
                    type="checkbox"
                    checked={selectedRule.enabled}
                    onChange={(event) =>
                      onPatchRule(selectedRule.id, { enabled: event.target.checked })
                    }
                  />
                  <Trans>Enabled</Trans>
                </label>
                <button
                  type="button"
                  className="rounded-md border border-zinc-700/50 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-200 hover:border-zinc-500/60 hover:text-white"
                  onClick={() => onDuplicateRule(selectedRule.id)}
                >
                  <Trans>Duplicate</Trans>
                </button>
                <button
                  type="button"
                  className="rounded-md border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-100 hover:border-rose-400/55 hover:bg-rose-500/20"
                  onClick={() => onDeleteRule(selectedRule.id)}
                >
                  <Trans>Delete</Trans>
                </button>
              </div>

              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-1 rounded-full bg-blue-400/60" />
                  <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                    <Trans>When</Trans>
                  </p>
                </div>
                <TriggerEditor
                  trigger={selectedRule.trigger}
                  config={config}
                  onPatchTrigger={handlePatchTriggerField}
                  onReplaceTrigger={handleReplaceTrigger}
                />
              </section>

              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-1 rounded-full bg-amber-400/60" />
                  <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                    <Trans>If</Trans>
                  </p>
                </div>
                <ConditionGroupEditor
                  group={selectedRule.conditions ?? { operator: "all", conditions: [] }}
                  depth={0}
                  config={config}
                  ruleIdForRefs={selectedRule.id}
                  onPatchGroup={(_path, patch) => {
                    onPatchConditionGroupOperator(selectedRule.id, patch.operator ?? "all");
                  }}
                  onAddCondition={(_path, kind) => onAddCondition(selectedRule.id, kind)}
                  onAddSubGroup={() => onAddConditionGroup(selectedRule.id)}
                  onPatchCondition={(path, patch) => onPatchCondition(selectedRule.id, path, patch)}
                  onReplaceCondition={(path, kind) =>
                    onReplaceCondition(selectedRule.id, path, kind)
                  }
                  onRemoveEntry={(path) => onRemoveCondition(selectedRule.id, path)}
                />
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-1 rounded-full bg-emerald-400/60" />
                    <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                      <Trans>Then</Trans>
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-md border border-zinc-700/50 bg-zinc-950/70 px-2.5 py-1.5 text-xs text-zinc-200 hover:border-zinc-500/60 hover:text-white"
                    onClick={() => onAddAction(selectedRule.id)}
                  >
                    <Trans>Add Action</Trans>
                  </button>
                </div>
                {selectedRule.actions.map((step, index) => (
                  <ActionStepEditor
                    key={step.id}
                    step={step}
                    config={config}
                    ruleIdForRefs={selectedRule.id}
                    stepIndex={index}
                    onPatchAction={(actionId, patch) =>
                      onPatchAction(selectedRule.id, actionId, patch)
                    }
                    onPatchActionKind={(actionId, kind) =>
                      onPatchActionKind(selectedRule.id, actionId, kind)
                    }
                    onRemoveAction={(actionId) => onRemoveAction(selectedRule.id, actionId)}
                  />
                ))}
              </section>

              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-1 rounded-full bg-zinc-400/40" />
                  <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                    <Trans>Settings</Trans>
                  </p>
                </div>
                <RuleSettingsEditor rule={selectedRule} onPatchRule={onPatchRule} />
              </section>

              <section className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                  <Trans>Preview</Trans>
                </p>
                <div className="rounded-lg border border-zinc-700/40 bg-zinc-950/60 p-3 text-xs text-zinc-300">
                  <p>
                    {t`When`} {summarizeRule(selectedRule, config.nodes)}
                  </p>
                  <p className="mt-1">
                    {t`Then`}{" "}
                    {selectedRule.actions
                      .map((step) => {
                        const descriptor = step.action.kind;
                        return typeof descriptor === "string" ? descriptor : String(descriptor);
                      })
                      .join(", ")}
                  </p>
                </div>
                {selectedRuleMessages.length > 0 && (
                  <div className="space-y-2">
                    {selectedRuleMessages.map((entry) => (
                      <div
                        key={`${entry.path}-${entry.message}`}
                        className={`rounded-lg border px-3 py-2 text-xs ${
                          entry.severity === "error"
                            ? "border-rose-500/35 bg-rose-950/20 text-rose-100"
                            : "border-amber-500/35 bg-amber-950/20 text-amber-100"
                        }`}
                      >
                        {entry.message}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    );
  }
);

AutomationPanel.displayName = "AutomationPanel";
