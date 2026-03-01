import React from "react";
import type { GraphValidationResult } from "../validateGraphConfig";

interface ValidationPanelProps {
    validation: GraphValidationResult;
}

export const ValidationPanel: React.FC<ValidationPanelProps> = React.memo(({ validation }) => (
    <div className="space-y-2 p-3">
        {validation.errors.length === 0 && validation.warnings.length === 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-950/15 px-3 py-2.5">
                <span className="text-emerald-400">✓</span>
                <p className="text-xs text-emerald-300">Graph is valid</p>
            </div>
        )}
        {validation.errors.map((entry, index) => (
            <div key={`error-${entry.path}-${index}`} className="flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-950/15 px-3 py-2">
                <span className="mt-0.5 flex-shrink-0 text-[10px] text-rose-400">●</span>
                <p className="text-xs text-rose-200">{entry.message}</p>
            </div>
        ))}
        {validation.warnings.map((entry, index) => (
            <div key={`warning-${entry.path}-${index}`} className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-950/15 px-3 py-2">
                <span className="mt-0.5 flex-shrink-0 text-[10px] text-amber-400">●</span>
                <p className="text-xs text-amber-200">{entry.message}</p>
            </div>
        ))}
    </div>
));

ValidationPanel.displayName = "ValidationPanel";
