import React from "react";
import { useLingui } from "@lingui/react/macro";
import { playHoverSound, playSelectSound } from "../../../utils/audio";
import { GameDropdown } from "../../../components/ui/GameDropdown";
import type { MapEditorTool, MapRoundBulkAction } from "../EditorState";
import type { GraphAlignmentStrategy } from "../graphAlignment";
import type { MapEditorSaveStatus } from "../mapEditorDraft";

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
  snapToGrid: boolean;
  isDirty: boolean;
  savePending: boolean;
  testMapPending: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canBulkEditRounds: boolean;
  selectionCount: number;
  validationErrorCount: number;
  draftSaveStatus: MapEditorSaveStatus;
  helpOpen: boolean;
  onSetTool: (tool: MapEditorTool) => void;
  onAlignmentStrategyChange: (strategy: GraphAlignmentStrategy) => void;
  onRealignGraph: () => void;
  onRequestRoundBulkAction: (action: MapRoundBulkAction) => void;
  onToggleGrid: () => void;
  onToggleSnapToGrid: () => void;
  onResetView: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onResetGraph: () => void;
  onConvertToLinear: () => void;
  onSave: () => void;
  onTestMap: () => void;
  onHelpOpenChange: (open: boolean) => void;
}

export const EditorToolbar: React.FC<EditorToolbarProps> = React.memo(
  ({
    tool,
    alignmentStrategy,
    canRealign,
    showGrid,
    snapToGrid,
    isDirty,
    savePending,
    testMapPending,
    canUndo,
    canRedo,
    canBulkEditRounds,
    selectionCount,
    validationErrorCount,
    draftSaveStatus,
    helpOpen,
    onSetTool,
    onAlignmentStrategyChange,
    onRealignGraph,
    onRequestRoundBulkAction,
    onToggleGrid,
    onToggleSnapToGrid,
    onResetView,
    onDelete,
    onUndo,
    onRedo,
    onResetGraph,
    onConvertToLinear,
    onSave,
    onTestMap,
    onHelpOpenChange,
  }) => {
    const { t } = useLingui();
    const helpRootRef = React.useRef<HTMLDivElement>(null);
    const helpButtonRef = React.useRef<HTMLButtonElement>(null);
    const helpWasOpenRef = React.useRef(false);
    React.useEffect(() => {
      if (helpWasOpenRef.current && !helpOpen) helpButtonRef.current?.focus();
      helpWasOpenRef.current = helpOpen;
    }, [helpOpen]);
    React.useEffect(() => {
      if (!helpOpen) return;
      const onPointerDown = (event: PointerEvent) => {
        if (!helpRootRef.current?.contains(event.target as Node)) onHelpOpenChange(false);
      };
      document.addEventListener("pointerdown", onPointerDown);
      return () => document.removeEventListener("pointerdown", onPointerDown);
    }, [helpOpen, onHelpOpenChange]);
    const toolLabels: Record<MapEditorTool, string> = {
      select: t`Select`,
      place: t`Place`,
      connect: t`Connect`,
      text: t`Text`,
    };

    return (
      <div className="editor-toolbar relative z-10 flex flex-shrink-0 flex-wrap items-center gap-1 rounded-lg border border-white/8 bg-black/40 px-2 py-1.5 backdrop-blur-sm">
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
          <ToolbarIconButton
            label={snapToGrid ? t`Disable Snap` : t`Enable Snap`}
            icon={snapToGrid ? "⊞" : "⊡"}
            onClick={onToggleSnapToGrid}
          />
          <ToolbarIconButton label={t`Reset View`} shortcut="0" icon="⌖" onClick={onResetView} />
        </div>

        <div className="mx-1.5 h-5 w-px bg-zinc-700/60" />

        {/* ── Edit actions ─────────────────── */}
        <div className="flex items-center gap-1">
          <ToolbarIconButton
            label={
              selectionCount > 1 ? t`Delete ${selectionCount} selected items` : t`Delete selection`
            }
            shortcut="Delete / Backspace"
            icon="✕"
            onClick={onDelete}
            disabled={selectionCount === 0}
          />
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

        <div className="mx-1.5 h-5 w-px bg-zinc-700/60" />

        {/* ── Round bulk actions ─────────────────── */}
        <div className="flex items-center gap-1">
          <span className="hidden rounded-md border border-transparent px-2 py-1 text-xs text-zinc-400 sm:inline">
            {t`Rounds`}
          </span>
          <RoundBulkButton
            label={t`Order`}
            disabled={!canBulkEditRounds}
            onClick={() => onRequestRoundBulkAction("order")}
          />
          <RoundBulkButton
            label={t`Random`}
            disabled={!canBulkEditRounds}
            onClick={() => onRequestRoundBulkAction("random")}
          />
          <RoundBulkButton
            label={t`Progressive`}
            disabled={!canBulkEditRounds}
            onClick={() => onRequestRoundBulkAction("progressive")}
          />
          <RoundBulkButton
            label={t`Difficulty`}
            disabled={!canBulkEditRounds}
            onClick={() => onRequestRoundBulkAction("difficulty")}
          />
        </div>

        <div className="flex-grow" />

        {/* ── Persist actions ─────────────────── */}
        <div className="flex items-center gap-1.5">
          <span
            className={`hidden rounded-full border px-2 py-1 text-[10px] font-semibold lg:inline ${validationErrorCount === 0 ? "border-emerald-500/30 text-emerald-300" : "border-amber-500/30 text-amber-300"}`}
          >
            {validationErrorCount === 0 ? t`Ready to play` : t`${validationErrorCount} issues`}
          </span>
          <ToolbarIconButton
            label={t`Convert to Linear`}
            icon="⇄"
            onClick={onConvertToLinear}
            disabled={savePending || testMapPending}
          />
          <div ref={helpRootRef} className="relative">
            <button
              ref={helpButtonRef}
              type="button"
              aria-label={t`Map editor help`}
              aria-haspopup="dialog"
              aria-expanded={helpOpen}
              className="editor-tool-button rounded-md border border-violet-500/35 bg-violet-500/10 px-2.5 py-1.5 text-xs font-bold text-violet-100 transition-all hover:border-violet-400/60 hover:bg-violet-500/20"
              onMouseEnter={playHoverSound}
              onClick={() => {
                playSelectSound();
                onHelpOpenChange(!helpOpen);
              }}
              data-controller-focus-id="map-editor-toolbar-help"
            >
              ?
            </button>
            {helpOpen && (
              <div
                className="absolute bottom-auto right-0 top-10 z-50 max-h-[min(26rem,70vh)] w-80 overflow-y-auto rounded-xl border border-violet-300/25 bg-zinc-950/98 p-4 text-xs text-zinc-300 shadow-2xl backdrop-blur-xl"
                role="dialog"
                aria-label={t`Map editor help`}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="font-bold text-violet-100">{t`Keyboard shortcuts`}</p>
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-zinc-400 hover:bg-white/8 hover:text-white"
                    onClick={() => onHelpOpenChange(false)}
                  >{t`Close`}</button>
                </div>
                <ul className="space-y-1.5">
                  <li>{t`Select/move: V, then drag nodes or text.`}</li>
                  <li>{t`Place: P or a visible tile shortcut, then click the canvas.`}</li>
                  <li>{t`Connect: C, then choose source and target nodes.`}</li>
                  <li>{t`Delete: Delete or Backspace removes the selection. X is also supported.`}</li>
                  <li>{t`Undo/redo: Ctrl/Cmd+Z and Ctrl/Cmd+Y.`}</li>
                  <li>{t`Save: Ctrl/Cmd+S saves the current draft.`}</li>
                  <li>{t`Escape closes open tools or clears the selection.`}</li>
                </ul>
              </div>
            )}
          </div>
          <button
            type="button"
            className="editor-tool-button rounded-md border border-emerald-500/45 bg-emerald-500/12 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition-all hover:border-emerald-400/65 hover:bg-emerald-500/20 disabled:opacity-40"
            onMouseEnter={playHoverSound}
            onClick={onSave}
            disabled={
              savePending ||
              testMapPending ||
              (!isDirty && draftSaveStatus !== "error" && draftSaveStatus !== "dirty")
            }
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

interface RoundBulkButtonProps {
  label: string;
  disabled: boolean;
  onClick: () => void;
}

const RoundBulkButton: React.FC<RoundBulkButtonProps> = React.memo(
  ({ label, disabled, onClick }) => (
    <button
      type="button"
      title={label}
      disabled={disabled}
      className="editor-tool-button rounded-md border border-amber-500/30 bg-amber-500/8 px-2 py-1.5 text-[11px] font-semibold text-amber-200 transition-all hover:border-amber-400/60 hover:bg-amber-500/15 disabled:opacity-40"
      onMouseEnter={playHoverSound}
      onClick={() => {
        playSelectSound();
        onClick();
      }}
      data-controller-focus-id={`map-editor-toolbar-rounds-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
    >
      {label}
    </button>
  )
);

RoundBulkButton.displayName = "RoundBulkButton";
