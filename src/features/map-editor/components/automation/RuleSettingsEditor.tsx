import React from "react";
import { Trans } from "@lingui/react/macro";
import type { EditorAutomationRule } from "../../EditorState";

type RuleSettingsEditorProps = {
  rule: EditorAutomationRule;
  onPatchRule: (ruleId: string, patch: Partial<EditorAutomationRule>) => void;
};

export const RuleSettingsEditor: React.FC<RuleSettingsEditorProps> = React.memo(
  ({ rule, onPatchRule }) => {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor={`rule-cooldown-${rule.id}`}
              className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500"
            >
              <Trans>Cooldown (ms)</Trans>
            </label>
            <input
              id={`rule-cooldown-${rule.id}`}
              type="number"
              min={0}
              step={1000}
              value={rule.cooldownMs}
              onChange={(e) =>
                onPatchRule(rule.id, {
                  cooldownMs: Math.max(0, Number.parseInt(e.target.value, 10) || 0),
                })
              }
              className="rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
            />
          </div>
          <div className="flex items-center gap-2 rounded-md border border-zinc-700/40 bg-zinc-950/40 px-3 py-2 self-end">
            <input
              id={`rule-stop-${rule.id}`}
              type="checkbox"
              checked={rule.stopAfterMatch}
              onChange={(e) => onPatchRule(rule.id, { stopAfterMatch: e.target.checked })}
              className="accent-cyan-500"
            />
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control */}
            <label htmlFor={`rule-stop-${rule.id}`} className="flex flex-col cursor-pointer">
              <span className="text-xs text-zinc-300">
                <Trans>Stop After Match</Trans>
              </span>
              <span className="text-[10px] text-zinc-500">
                <Trans>Prevents further rules from firing</Trans>
              </span>
            </label>
          </div>
        </div>
      </div>
    );
  }
);

RuleSettingsEditor.displayName = "RuleSettingsEditor";
