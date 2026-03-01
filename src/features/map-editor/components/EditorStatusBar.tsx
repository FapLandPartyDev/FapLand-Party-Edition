import React from "react";
import type { MapEditorTool } from "../EditorState";

interface EditorStatusBarProps {
    tool: MapEditorTool;
    nodeCount: number;
    selectedCount: number;
    activeTileLabel: string | null;
    selectedEdgeLabel: string;
}

const toTitleCase = (input: string): string =>
    `${input.slice(0, 1).toUpperCase()}${input.slice(1)}`;

export const EditorStatusBar: React.FC<EditorStatusBarProps> = React.memo(({
    tool,
    nodeCount,
    selectedCount,
    activeTileLabel,
    selectedEdgeLabel,
}) => (
    <div className="flex flex-shrink-0 items-center gap-4 rounded-lg border border-white/6 bg-black/30 px-3 py-1.5 font-mono text-[11px] text-zinc-500 backdrop-blur-sm">
        <StatusItem label="Tool" value={toTitleCase(tool)} data-testid="tool-value" accentClass="text-cyan-400" />
        <StatusItem label="Nodes" value={String(nodeCount)} data-testid="node-count" />
        <StatusItem label="Sel" value={`${selectedCount}`} />
        <StatusItem label="Tile" value={activeTileLabel ?? "—"} />
        <StatusItem label="Edge" value={selectedEdgeLabel} />
        <div className="flex-1" />
        <span className="text-zinc-600">
            V/P/C · 1-9 · L · X · ⌘Z · ⌘S · Space+Drag
        </span>
    </div>
));

EditorStatusBar.displayName = "EditorStatusBar";

/* ──────────────────────── Status item ──────────── */

interface StatusItemProps {
    label: string;
    value: string;
    accentClass?: string;
    "data-testid"?: string;
}

const StatusItem: React.FC<StatusItemProps> = React.memo(({ label, value, accentClass, "data-testid": testId }) => (
    <span className="flex items-center gap-1.5">
        <span className="text-zinc-600">{label}:</span>
        <span data-testid={testId} className={accentClass ?? "text-zinc-300"}>{value}</span>
    </span>
));

StatusItem.displayName = "StatusItem";
