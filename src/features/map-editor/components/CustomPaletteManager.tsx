import React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { playHoverSound } from "../../../utils/audio";
import type { GraphRoadPalette } from "../../../game/playlistSchema";
import type { CustomRoadPalette } from "../../../constants/customPaletteSettings";

type PaletteColorKey = "body" | "railA" | "railB" | "glow" | "center" | "gate" | "marker";

const PALETTE_COLOR_KEYS: PaletteColorKey[] = [
  "body",
  "railA",
  "railB",
  "glow",
  "center",
  "gate",
  "marker",
];

interface CustomPaletteManagerProps {
  currentPalette: GraphRoadPalette;
  customPalettes: CustomRoadPalette[];
  isLoading: boolean;
  onApplyPalette: (palette: GraphRoadPalette) => void;
  onSave: (name: string, palette: GraphRoadPalette) => Promise<void>;
  onUpdate: (id: string, patch: { name?: string; palette?: GraphRoadPalette }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

interface EditingState {
  id: string;
  name: string;
  palette: GraphRoadPalette;
}

export const CustomPaletteManager: React.FC<CustomPaletteManagerProps> = React.memo(
  ({ currentPalette, customPalettes, isLoading, onApplyPalette, onSave, onUpdate, onDelete }) => {
    const { t } = useLingui();
    const [isSaving, setIsSaving] = React.useState(false);
    const [showSaveInput, setShowSaveInput] = React.useState(false);
    const [saveNameDraft, setSaveNameDraft] = React.useState("");
    const [saveError, setSaveError] = React.useState<string | null>(null);
    const [editingState, setEditingState] = React.useState<EditingState | null>(null);
    const [isUpdating, setIsUpdating] = React.useState(false);
    const [isDeleting, setIsDeleting] = React.useState<string | null>(null);
    const saveInputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
      if (showSaveInput) {
        saveInputRef.current?.focus();
      }
    }, [showSaveInput]);

    const handleSave = React.useCallback(async () => {
      const name = saveNameDraft.trim();
      if (!name) {
        setSaveError(t`Name cannot be empty`);
        return;
      }
      setIsSaving(true);
      setSaveError(null);
      try {
        await onSave(name, { ...currentPalette });
        setSaveNameDraft("");
        setShowSaveInput(false);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : t`Failed to save palette`);
      } finally {
        setIsSaving(false);
      }
    }, [currentPalette, onSave, saveNameDraft, t]);

    const handleStartEdit = React.useCallback((entry: CustomRoadPalette) => {
      setEditingState({ id: entry.id, name: entry.name, palette: { ...entry.palette } });
    }, []);

    const handleCommitEdit = React.useCallback(async () => {
      if (!editingState) return;
      setIsUpdating(true);
      try {
        await onUpdate(editingState.id, {
          name: editingState.name,
          palette: editingState.palette,
        });
        setEditingState(null);
      } catch (error) {
        console.error("Failed to update custom palette", error);
      } finally {
        setIsUpdating(false);
      }
    }, [editingState, onUpdate]);

    const handleDelete = React.useCallback(
      async (id: string) => {
        setIsDeleting(id);
        try {
          if (editingState?.id === id) setEditingState(null);
          await onDelete(id);
        } catch (error) {
          console.error("Failed to delete custom palette", error);
        } finally {
          setIsDeleting(null);
        }
      },
      [editingState, onDelete]
    );

    const handleEditColorChange = React.useCallback(
      (key: PaletteColorKey, value: string) => {
        setEditingState((prev) => {
          if (!prev) return prev;
          return { ...prev, palette: { ...prev.palette, [key]: value, presetId: "custom" } };
        });
      },
      []
    );

    if (isLoading) {
      return (
        <p className="text-[10px] text-zinc-600">
          <Trans>Loading palettes…</Trans>
        </p>
      );
    }

    return (
      <div className="space-y-2">
        {customPalettes.length > 0 && (
          <div className="space-y-1.5">
            {customPalettes.map((entry) => {
              const isCurrentlyEditing = editingState?.id === entry.id;
              const isCurrentlyDeleting = isDeleting === entry.id;

              if (isCurrentlyEditing) {
                const editPalette = editingState.palette;
                return (
                  <div
                    key={entry.id}
                    className="space-y-2 rounded-lg border border-cyan-400/25 bg-cyan-500/5 p-2.5"
                  >
                    <input
                      type="text"
                      value={editingState.name}
                      onKeyDown={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        setEditingState((prev) =>
                          prev ? { ...prev, name: e.target.value } : prev
                        )
                      }
                      className="w-full rounded border border-zinc-700/60 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-cyan-400/60"
                      placeholder={t`Palette name`}
                    />
                    <div className="grid gap-1.5">
                      {PALETTE_COLOR_KEYS.map((key) => {
                        const labelMap: Record<PaletteColorKey, string> = {
                          body: t`Body`,
                          railA: t`Rail A`,
                          railB: t`Rail B`,
                          glow: t`Glow`,
                          center: t`Center`,
                          gate: t`Gate`,
                          marker: t`Markers`,
                        };
                        return (
                          <label key={key} className="flex items-center justify-between gap-2">
                            <span className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">
                              {labelMap[key]}
                            </span>
                            <input
                              type="color"
                              value={editPalette[key]}
                              onChange={(e) => handleEditColorChange(key, e.target.value)}
                              className="h-7 w-10 rounded border border-zinc-700/60 bg-zinc-950 p-0.5"
                            />
                          </label>
                        );
                      })}
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onMouseEnter={playHoverSound}
                        onClick={() => void handleCommitEdit()}
                        disabled={isUpdating}
                        className="flex-1 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-2 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:border-cyan-300/60 disabled:cursor-wait disabled:opacity-60"
                      >
                        <Trans>Save changes</Trans>
                      </button>
                      <button
                        type="button"
                        onMouseEnter={playHoverSound}
                        onClick={() => setEditingState(null)}
                        className="rounded-lg border border-zinc-700/50 px-2 py-1.5 text-[11px] text-zinc-400 transition hover:text-zinc-200"
                      >
                        <Trans>Cancel</Trans>
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={entry.id}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-700/40 bg-zinc-900/30 px-2.5 py-2"
                >
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => onApplyPalette({ ...entry.palette })}
                    className="flex flex-1 items-center gap-2 text-left transition hover:opacity-90"
                    title={t`Apply "${entry.name}"`}
                  >
                    <span className="flex gap-0.5">
                      {(["railA", "railB", "glow"] as const).map((key) => (
                        <span
                          key={key}
                          className="h-3 w-4 rounded-sm border border-white/10"
                          style={{ backgroundColor: entry.palette[key] }}
                        />
                      ))}
                    </span>
                    <span className="truncate text-[11px] text-zinc-300">{entry.name}</span>
                  </button>
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => handleStartEdit(entry)}
                    className="rounded p-1 text-zinc-500 transition hover:text-zinc-200"
                    aria-label={t`Edit "${entry.name}"`}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onMouseEnter={playHoverSound}
                    onClick={() => void handleDelete(entry.id)}
                    disabled={isCurrentlyDeleting}
                    className="rounded p-1 text-rose-400/60 transition hover:text-rose-300 disabled:cursor-wait disabled:opacity-40"
                    aria-label={t`Delete "${entry.name}"`}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {showSaveInput ? (
          <div className="space-y-1.5 rounded-lg border border-cyan-400/20 bg-cyan-950/10 p-2.5">
            <label className="sr-only" htmlFor="save-custom-palette-name">
              <Trans>Palette name</Trans>
            </label>
            <input
              id="save-custom-palette-name"
              ref={saveInputRef}
              type="text"
              value={saveNameDraft}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSave();
                }
                if (e.key === "Escape") {
                  setShowSaveInput(false);
                  setSaveNameDraft("");
                  setSaveError(null);
                }
              }}
              onChange={(e) => {
                setSaveNameDraft(e.target.value);
                setSaveError(null);
              }}
              placeholder={t`My palette name`}
              className={`w-full rounded-lg border bg-zinc-950/70 px-2.5 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none transition ${
                saveError ? "border-rose-400/60" : "border-zinc-700/60 focus:border-cyan-300/70"
              }`}
            />
            {saveError && <p className="text-[10px] text-rose-300">{saveError}</p>}
            <div className="flex gap-1.5">
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="flex-1 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-100 transition hover:border-cyan-300/60 disabled:cursor-wait disabled:opacity-60"
              >
                {isSaving ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
              </button>
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={() => {
                  setShowSaveInput(false);
                  setSaveNameDraft("");
                  setSaveError(null);
                }}
                className="rounded-lg border border-zinc-700/50 px-2.5 py-1.5 text-[11px] text-zinc-400 transition hover:text-zinc-200"
              >
                <Trans>Cancel</Trans>
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onMouseEnter={playHoverSound}
            onClick={() => {
              setShowSaveInput(true);
              setSaveNameDraft("");
              setSaveError(null);
            }}
            className="w-full rounded-lg border border-dashed border-zinc-700/60 px-2.5 py-1.5 text-[11px] text-zinc-500 transition hover:border-zinc-500 hover:text-zinc-300"
          >
            + <Trans>Save current as palette</Trans>
          </button>
        )}
      </div>
    );
  }
);

CustomPaletteManager.displayName = "CustomPaletteManager";
