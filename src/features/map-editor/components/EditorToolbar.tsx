import React from "react";
import { useLingui } from "@lingui/react/macro";
import { playHoverSound, playSelectSound } from "../../../utils/audio";
import { GameDropdown } from "../../../components/ui/GameDropdown";
import type { MapEditorTool } from "../EditorState";
import type { GraphAlignmentStrategy } from "../graphAlignment";

const TOOL_ITEMS: ReadonlyArray<{
  id: MapEditorTool;
  shortcut: string;
  icon: string;
}> = [
  { id: "select", shortcut: "V", icon: "⊹" },
  { id: "place", shortcut: "P", icon: "◆" },
  { id: "connect", shortcut: "C", icon: "⤳" },
  { id: "text", shortcut: "T", icon: "T" },
];

interface EditorToolbarProps {
  tool: MapEditorTool;
  alignmentStrategy: GraphAlignmentStrategy;
  canRealign: boolean;
  showGrid: boolean;
  isDirty: boolean;
  savePending: boolean;
  testMapPending: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onSetTool: (tool: MapEditorTool) => void;
  onAlignmentStrategyChange: (strategy: GraphAlignmentStrategy) => void;
  onRealignGraph: () => void;
  onToggleGrid: () => void;
  onResetView: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onResetGraph: () => void;
  onSave: () => void;
  onTestMap: () => void;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = React.memo(
  ({
    tool,
    alignmentStrategy,
    canRealign,
    showGrid,
    isDirty,
    savePending,
    testMapPending,
    canUndo,
    canRedo,
    onSetTool,
    onAlignmentStrategyChange,
    onRealignGraph,
    onToggleGrid,
    onResetView,
    onDelete,
    onUndo,
    onRedo,
    onResetGraph,
    onSave,
    onTestMap,
  }) => {
    const { t } = useLingui();
    const toolLabels: Record<MapEditorTool, string> = {
      select: t`Select`,
      place: t`Place`,
      connect: t`Connect`,
      text: t`Text`,
    };

    return (
    <div className="editor-toolbar relative z-10 flex flex-shrink-0 items-center gap-1 rounded-lg border border-white/8 bg-black/40 px-2 py-1.5 backdrop-blur-sm">
      {/* ── Mode tools ─────────────────── */}
      <div className="flex items-center gap-1">
        {TOOL_ITEMS.map((item) => {
          const isActive = tool === item.id;
          const label = toolLabels[item.id];
          return (
            <button
              key={item.id}
              type="button"
              title={t`${label} (${item.shortcut})`}
              className={`editor-tool-button flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-all ${
                isActive
                  ? "is-active border-cyan-400/65 bg-cyan-500/18 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.15)]"
                  : "border-transparent bg-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              }`}
              onMouseEnter={playHoverSound}
              onClick={() => {
                playSelectSound();
                onSetTool(item.id);
              }}
              data-controller-focus-id={`map-editor-toolbar-tool-${item.id}`}
            >
              <span className="text-sm leading-none">{item.icon}</span>
              <span className="hidden sm:inline">{label}</span>
              <kbd className="hidden rounded bg-white/8 px-1 py-0.5 font-mono text-[10px] text-zinc-500 sm:inline">
                {item.shortcut}
              </kbd>
            </button>
          );
        })}
      </div>

      <div className="mx-1.5 h-5 w-px bg-zinc-700/60" />

      {/* ── View actions ─────────────────── */}
      <div className="flex items-center gap-1">
        <ToolbarIconButton
          label={showGrid ? t`Hide Grid` : t`Show Grid`}
          shortcut="G"
          icon={showGrid ? "▦" : "▢"}
          onClick={onToggleGrid}
        />
        <ToolbarIconButton label={t`Reset View`} shortcut="0" icon="⌖" onClick={onResetView} />
      </div>

      <div className="mx-1.5 h-5 w-px bg-zinc-700/60" />

      {/* ── Edit actions ─────────────────── */}
      <div className="flex items-center gap-1">
        <ToolbarIconButton label={t`Delete`} shortcut="X" icon="✕" onClick={onDelete} />
        <ToolbarIconButton
          label={t`Undo`}
          shortcut="⌘Z"
          icon="↶"
          onClick={onUndo}
          disabled={!canUndo}
        />
        <ToolbarIconButton
          label={t`Redo`}
          shortcut="⌘Y"
          icon="↷"
          onClick={onRedo}
          disabled={!canRedo}
        />
        <ToolbarIconButton label={t`Reset Graph`} icon="⟲" onClick={onResetGraph} />
        <div className="flex items-center gap-2 rounded-md border border-transparent px-2 py-1 text-xs text-zinc-400 hover:bg-white/5">
          <span className="hidden sm:inline">{t`Layout`}</span>
          <GameDropdown
            value={alignmentStrategy}
            options={[
              { value: "layeredHorizontal", label: t`Layered ->` },
              { value: "layeredVertical", label: t`Layered down` },
              { value: "layeredUp", label: t`Layered up` },
              { value: "snake", label: t`Snake` },
              { value: "gridCleanup", label: t`Grid tidy` },
            ]}
            onHoverSfx={playHoverSound}
            onSelectSfx={playSelectSound}
            onChange={(value) => {
              onAlignmentStrategyChange(value as GraphAlignmentStrategy);
            }}
          />
        </div>
        <ToolbarIconButton
          label={t`Apply Layout`}
          shortcut="L"
          icon="⇢"
          onClick={onRealignGraph}
          disabled={!canRealign}
        />
      </div>

      <div className="flex-1" />

      {/* ── Persist actions ─────────────────── */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="editor-tool-button rounded-md border border-emerald-500/45 bg-emerald-500/12 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition-all hover:border-emerald-400/65 hover:bg-emerald-500/20 disabled:opacity-40"
          onMouseEnter={playHoverSound}
          onClick={onSave}
          disabled={savePending || testMapPending || !isDirty}
          data-controller-focus-id="map-editor-toolbar-save"
        >
          {savePending ? t`Saving...` : t`Save`}
        </button>
        <button
          type="button"
          className="editor-tool-button rounded-md border border-cyan-500/45 bg-cyan-500/12 px-3 py-1.5 text-xs font-semibold text-cyan-200 transition-all hover:border-cyan-400/65 hover:bg-cyan-500/20 disabled:opacity-40"
          onMouseEnter={playHoverSound}
          onClick={onTestMap}
          disabled={savePending || testMapPending}
          data-controller-focus-id="map-editor-toolbar-test-map"
        >
          {testMapPending ? t`Starting...` : t`Test Map`}
        </button>
      </div>
    </div>
    );
  }
);

EditorToolbar.displayName = "EditorToolbar";

/* ──────────────────────── Tiny reusable icon button ──────────── */

interface ToolbarIconButtonProps {
  label: string;
  shortcut?: string;
  icon: string;
  disabled?: boolean;
  onClick: () => void;
}

const ToolbarIconButton: React.FC<ToolbarIconButtonProps> = React.memo(
  ({ label, shortcut, icon, disabled, onClick }) => (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      className="editor-tool-button rounded-md border border-transparent px-2 py-1.5 text-xs text-zinc-400 transition-all hover:bg-white/5 hover:text-zinc-200 disabled:opacity-40 disabled:hover:bg-transparent"
      onMouseEnter={playHoverSound}
      onClick={() => {
        playSelectSound();
        onClick();
      }}
      data-controller-focus-id={`map-editor-toolbar-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
    >
      <span className="text-sm leading-none">{icon}</span>
    </button>
  )
);

ToolbarIconButton.displayName = "ToolbarIconButton";
