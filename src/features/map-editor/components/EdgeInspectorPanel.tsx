import React from "react";
import type { EditorEdge } from "../EditorState";

interface EdgeInspectorPanelProps {
    selectedEdge: EditorEdge | null;
    allEdges: ReadonlyArray<EditorEdge>;
    onPatchEdge: (edgeId: string, patch: Partial<EditorEdge>) => void;
}

export const EdgeInspectorPanel: React.FC<EdgeInspectorPanelProps> = React.memo(({
    selectedEdge,
    allEdges,
    onPatchEdge,
}) => {
    if (!selectedEdge) {
        return (
            <div className="flex items-center justify-center py-8 text-xs text-zinc-600">
                Select an edge to inspect
            </div>
        );
    }

    const alternativeEdges = allEdges.filter((edge) => edge.fromNodeId === selectedEdge.fromNodeId && edge.id !== selectedEdge.id);
    const hasFreeAlternative = alternativeEdges.some((edge) => (edge.gateCost ?? 0) <= 0);
    const showFallbackHint = (selectedEdge.gateCost ?? 0) > 0;

    return (
        <div className="space-y-3 p-3">
            <div className="rounded-lg border border-white/6 bg-black/20 px-2.5 py-2">
                <p className="text-xs font-medium text-zinc-300">
                    {selectedEdge.fromNodeId} <span className="text-zinc-600">→</span> {selectedEdge.toNodeId}
                </p>
            </div>

            {/* ── Gate cost ─────────────────── */}
            <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Gate cost ($)</span>
                <input
                    type="number"
                    min={0}
                    step={1}
                    value={selectedEdge.gateCost ?? 0}
                    onChange={(event) => {
                        const gateCost = Math.max(0, Math.floor(Number(event.target.value) || 0));
                        onPatchEdge(selectedEdge.id, { gateCost });
                    }}
                    className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
                />
            </label>

            {/* ── Weight ─────────────────── */}
            <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Weight</span>
                <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={selectedEdge.weight ?? 1}
                    onChange={(event) => {
                        const weight = Math.max(0.1, Number(event.target.value) || 1);
                        onPatchEdge(selectedEdge.id, { weight });
                    }}
                    className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
                />
            </label>

            {/* ── Label ─────────────────── */}
            <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Label</span>
                <input
                    type="text"
                    value={selectedEdge.label ?? ""}
                    onChange={(event) => {
                        const value = event.target.value.trim();
                        onPatchEdge(selectedEdge.id, { label: value.length > 0 ? value : undefined });
                    }}
                    className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
                />
            </label>

            {/* ── Gate info ─────────────────── */}
            <p className="text-[11px] text-zinc-600">
                Gate: if the player lacks money, this edge is unavailable.
            </p>

            {showFallbackHint && (
                <p className={`rounded-md border p-2 text-[11px] ${hasFreeAlternative
                    ? "border-emerald-600/35 bg-emerald-950/20 text-emerald-300"
                    : "border-amber-600/35 bg-amber-950/20 text-amber-300"
                    }`}>
                    {hasFreeAlternative
                        ? "✓ Fallback path available."
                        : "⚠ No free fallback path — add another outgoing edge."}
                </p>
            )}
        </div>
    );
});

EdgeInspectorPanel.displayName = "EdgeInspectorPanel";
