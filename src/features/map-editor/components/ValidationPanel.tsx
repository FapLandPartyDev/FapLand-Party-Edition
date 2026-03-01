import React from "react";
import { Trans } from "@lingui/react/macro";
import { useSfwMode } from "../../../hooks/useSfwMode";
import { abbreviateNsfwText } from "../../../utils/sfwText";
import type { GraphValidationResult } from "../validateGraphConfig";

interface ValidationPanelProps {
  validation: GraphValidationResult;
  onSelectIssue?: (issue: GraphValidationResult["errors"][number]) => void;
}

export const ValidationPanel: React.FC<ValidationPanelProps> = React.memo(
  ({ validation, onSelectIssue }) => {
    const sfwMode = useSfwMode();

    return (
      <div className="space-y-2 p-3">
        {validation.errors.length === 0 && validation.warnings.length === 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-950/15 px-3 py-2.5">
            <span className="text-emerald-400">✓</span>
            <p className="text-xs text-emerald-300">
              <Trans>Graph is valid</Trans>
            </p>
          </div>
        )}
        {validation.errors.length > 0 && (
          <p className="pt-1 text-[10px] font-semibold uppercase tracking-wider text-rose-300">
            <Trans>Required to play</Trans> ({validation.errors.length})
          </p>
        )}
        {validation.errors.map((entry, index) => (
          <button
            type="button"
            key={`error-${entry.path}-${index}`}
            className="flex w-full items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-950/15 px-3 py-2 text-left transition hover:border-rose-400/45 hover:bg-rose-950/25 disabled:cursor-default"
            disabled={!entry.nodeId && !entry.edgeId}
            onClick={() => onSelectIssue?.(entry)}
          >
            <span className="mt-0.5 flex-shrink-0 text-[10px] text-rose-400">●</span>
            <p className="min-w-0 break-words text-xs text-rose-200">
              {abbreviateNsfwText(entry.message, sfwMode)}
            </p>
          </button>
        ))}
        {validation.warnings.length > 0 && (
          <p className="pt-2 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
            <Trans>Warnings</Trans> ({validation.warnings.length})
          </p>
        )}
        {validation.warnings.map((entry, index) => (
          <button
            type="button"
            key={`warning-${entry.path}-${index}`}
            className="flex w-full items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-950/15 px-3 py-2 text-left transition hover:border-amber-400/45 disabled:cursor-default"
            disabled={!entry.nodeId && !entry.edgeId}
            onClick={() => onSelectIssue?.(entry)}
          >
            <span className="mt-0.5 flex-shrink-0 text-[10px] text-amber-400">●</span>
            <p className="min-w-0 break-words text-xs text-amber-200">
              {abbreviateNsfwText(entry.message, sfwMode)}
            </p>
          </button>
        ))}
      </div>
    );
  }
);

ValidationPanel.displayName = "ValidationPanel";
