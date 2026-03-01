import React from "react";
import type { ConverterState } from "./useConverterState";

type ConverterHeaderProps = {
    segmentCount: number;
    sourceSummary: string;
};

export const ConverterHeader: React.FC<ConverterHeaderProps> = React.memo(
    ({ segmentCount, sourceSummary }) => (
        <header className="animate-entrance converter-panel-glass rounded-3xl p-6 shadow-[0_0_50px_rgba(139,92,246,0.28)]">
            <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.45em] text-purple-200/85">
                Conversion Lab
            </p>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                <h1 className="text-3xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-200 via-purple-100 to-indigo-200 drop-shadow-[0_0_30px_rgba(139,92,246,0.55)] sm:text-5xl">
                    Round to Hero Converter
                </h1>
                <div className="rounded-xl border border-violet-200/30 bg-violet-400/10 px-4 py-2 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-violet-100">
                    {segmentCount} Segment{segmentCount === 1 ? "" : "s"} • {sourceSummary}
                </div>
            </div>
        </header>
    ),
);

ConverterHeader.displayName = "ConverterHeader";

export function pickConverterHeaderProps(state: ConverterState): ConverterHeaderProps {
    return {
        segmentCount: state.sortedSegments.length,
        sourceSummary: state.sourceSummary,
    };
}
