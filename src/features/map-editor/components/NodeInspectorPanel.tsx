import React from "react";
import { playHoverSound, playSelectSound } from "../../../utils/audio";
import type { InstalledRound } from "../../../services/db";
import type { EditorEdge, EditorNode, EditorSelectionState } from "../EditorState";

interface PerkOption {
    id: string;
    name: string;
}

const NODE_KIND_OPTIONS: EditorNode["kind"][] = ["start", "end", "path", "safePoint", "round", "randomRound", "perk", "event"];

interface NodeInspectorPanelProps {
    selectedNode: EditorNode | null;
    outgoingEdges: ReadonlyArray<EditorEdge>;
    installedRounds: ReadonlyArray<InstalledRound>;
    perkOptions: ReadonlyArray<PerkOption>;
    onPatchNode: (nodeId: string, patch: Partial<EditorNode>) => void;
    onCommitSelection: (selection: EditorSelectionState) => void;
    onSetTool: (tool: "connect") => void;
    onSetConnectFrom: (nodeId: string) => void;
}

export const NodeInspectorPanel: React.FC<NodeInspectorPanelProps> = React.memo(({
    selectedNode,
    outgoingEdges,
    installedRounds,
    perkOptions,
    onPatchNode,
    onCommitSelection,
    onSetTool,
    onSetConnectFrom,
}) => {
    if (!selectedNode) {
        return (
            <div className="flex items-center justify-center py-8 text-xs text-zinc-600">
                Select a node to inspect
            </div>
        );
    }

    return (
        <div className="space-y-3 p-3">
            {/* ── Name ─────────────────── */}
            <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Name</span>
                <input
                    type="text"
                    value={selectedNode.name}
                    onChange={(event) => onPatchNode(selectedNode.id, { name: event.target.value || selectedNode.name })}
                    className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
                />
            </label>

            {/* ── Kind ─────────────────── */}
            <label className="block">
                <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Kind</span>
                <select
                    value={selectedNode.kind}
                    onChange={(event) => {
                        const kind = event.target.value as EditorNode["kind"];
                        onPatchNode(selectedNode.id, {
                            kind,
                            roundRef: kind === "round" ? selectedNode.roundRef ?? { name: "Round" } : undefined,
                            forceStop: kind === "round" ? selectedNode.forceStop : undefined,
                            visualId: kind === "perk" ? selectedNode.visualId ?? perkOptions[0]?.id : undefined,
                            randomPoolId: kind === "randomRound" ? selectedNode.randomPoolId ?? "pool-1" : undefined,
                        });
                    }}
                    className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none"
                >
                    {NODE_KIND_OPTIONS.map((kind) => (
                        <option key={kind} value={kind}>{kind}</option>
                    ))}
                </select>
            </label>

            {/* ── Round-specific fields ─────────────────── */}
            {selectedNode.kind === "round" && (
                <>
                    <label className="block">
                        <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Round name</span>
                        <input
                            type="text"
                            value={selectedNode.roundRef?.name ?? ""}
                            onChange={(event) => onPatchNode(selectedNode.id, {
                                roundRef: {
                                    ...(selectedNode.roundRef ?? {}),
                                    name: event.target.value.trim().length > 0 ? event.target.value : "Round",
                                },
                            })}
                            className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
                        />
                    </label>
                    <label className="block">
                        <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Installed round</span>
                        <select
                            value={selectedNode.roundRef?.idHint ?? ""}
                            onChange={(event) => {
                                const round = installedRounds.find((entry) => entry.id === event.target.value);
                                if (!round) return;
                                onPatchNode(selectedNode.id, {
                                    roundRef: {
                                        idHint: round.id,
                                        name: round.name,
                                        author: round.author ?? undefined,
                                        type: round.type ?? undefined,
                                        installSourceKeyHint: round.installSourceKey ?? undefined,
                                        phash: round.phash ?? undefined,
                                    },
                                });
                            }}
                            className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none"
                        >
                            <option value="">Custom / none</option>
                            {installedRounds.map((round) => (
                                <option key={round.id} value={round.id}>{round.name}</option>
                            ))}
                        </select>
                    </label>
                    <label className="block">
                        <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Force stop</span>
                        <label className="mt-1 flex items-start gap-2 rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-2 text-xs text-zinc-200">
                            <input
                                type="checkbox"
                                checked={Boolean(selectedNode.forceStop)}
                                onChange={(event) => onPatchNode(selectedNode.id, { forceStop: event.target.checked })}
                                className="mt-0.5"
                            />
                            <span>
                                Stop movement as soon as a player reaches this round tile and start the round immediately.
                            </span>
                        </label>
                    </label>
                </>
            )}

            {selectedNode.kind === "safePoint" && (
                <label className="block">
                    <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Checkpoint Rest (sec)</span>
                    <input
                        type="number"
                        min="0"
                        step="1"
                        value={typeof selectedNode.checkpointRestMs === "number" && selectedNode.checkpointRestMs > 0 ? Math.floor(selectedNode.checkpointRestMs / 1000) : ""}
                        onChange={(event) => {
                            const value = event.target.value.trim();
                            if (value.length === 0) {
                                onPatchNode(selectedNode.id, { checkpointRestMs: undefined });
                                return;
                            }
                            const seconds = Number.parseInt(value, 10);
                            onPatchNode(selectedNode.id, {
                                checkpointRestMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined,
                            });
                        }}
                        className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
                        placeholder="Uses normal rest when empty"
                    />
                </label>
            )}

            {/* ── Perk-specific fields ─────────────────── */}
            {selectedNode.kind === "perk" && (
                <label className="block">
                    <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Guaranteed perk</span>
                    <select
                        value={selectedNode.visualId ?? ""}
                        onChange={(event) => onPatchNode(selectedNode.id, { visualId: event.target.value })}
                        className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none"
                    >
                        <option value="">None</option>
                        {perkOptions.map((perk) => (
                            <option key={perk.id} value={perk.id}>{perk.name}</option>
                        ))}
                    </select>
                </label>
            )}

            {/* ── Paths / outgoing edges ─────────────────── */}
            <div className="rounded-lg border border-white/6 bg-black/20 p-2.5">
                <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">Outgoing Paths</p>
                <p className="mt-1 text-xs text-zinc-400">
                    {outgoingEdges.length} edge{outgoingEdges.length !== 1 ? "s" : ""}
                </p>
                {selectedNode.kind === "end" && (
                    <p className="mt-1 text-[11px] text-amber-400/80">End nodes are terminal.</p>
                )}
                <button
                    type="button"
                    className="mt-2 rounded-md border border-cyan-500/40 bg-cyan-500/8 px-2 py-1 text-[11px] font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/15 disabled:opacity-40"
                    onMouseEnter={playHoverSound}
                    onClick={() => {
                        playSelectSound();
                        onSetTool("connect");
                        onSetConnectFrom(selectedNode.id);
                    }}
                    disabled={selectedNode.kind === "end"}
                >
                    Connect From Here
                </button>
                {outgoingEdges.map((edge) => (
                    <button
                        key={edge.id}
                        type="button"
                        className="mt-1.5 block w-full rounded-md border border-zinc-700/40 bg-zinc-950/50 px-2 py-1 text-left text-[11px] text-zinc-400 transition-colors hover:border-zinc-600/50 hover:text-zinc-300"
                        onClick={() => onCommitSelection({ selectedNodeIds: [], primaryNodeId: null, selectedEdgeId: edge.id })}
                    >
                        {edge.fromNodeId} → {edge.toNodeId}
                        <span className="ml-2 text-zinc-600">gate ${edge.gateCost ?? 0} · w{edge.weight ?? 1}</span>
                    </button>
                ))}
            </div>
        </div>
    );
});

NodeInspectorPanel.displayName = "NodeInspectorPanel";
