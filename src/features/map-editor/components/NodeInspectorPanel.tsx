import React from "react";
import { resolvePortableRoundRef } from "../../../game/playlistRuntime";
import { usePlayableVideoFallback } from "../../../hooks/usePlayableVideoFallback";
import { SfwGuard } from "../../../components/SfwGuard";
import { playHoverSound, playSelectSound } from "../../../utils/audio";
import { GameDropdown } from "../../../components/ui/GameDropdown";
import type { InstalledRound } from "../../../services/db";
import type { EditorEdge, EditorNode, EditorSelectionState } from "../EditorState";
import { getNodeKindColor, toColorInputValue } from "../nodeVisuals";

interface PerkOption {
  id: string;
  name: string;
}

const NODE_KIND_OPTIONS: EditorNode["kind"][] = [
  "start",
  "end",
  "path",
  "safePoint",
  "round",
  "randomRound",
  "perk",
];

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

function formatInstalledRoundMeta(
  round: Pick<InstalledRound, "author" | "difficulty" | "type">
): string {
  const parts = [round.author ?? "Unknown Author", round.type ?? "Normal"];
  if (typeof round.difficulty === "number") {
    parts.push(`Difficulty ${round.difficulty}`);
  }
  return parts.join(" • ");
}

export const NodeInspectorPanel: React.FC<NodeInspectorPanelProps> = React.memo(
  ({
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

    const fallbackColor = getNodeKindColor(selectedNode.kind);
    const colorValue = toColorInputValue(selectedNode.styleHint?.color, fallbackColor);
    const sizeValue =
      typeof selectedNode.styleHint?.size === "number" ? String(selectedNode.styleHint.size) : "";

    return (
      <div className="space-y-3 p-3">
        {/* ── Name ─────────────────── */}
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            Name
          </span>
          <input
            type="text"
            value={selectedNode.name}
            onChange={(event) =>
              onPatchNode(selectedNode.id, { name: event.target.value || selectedNode.name })
            }
            className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
          />
        </label>

        {/* ── Kind ─────────────────── */}
        <div className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            Kind
          </span>
          <GameDropdown
            value={selectedNode.kind}
            options={NODE_KIND_OPTIONS.map((kind) => ({ value: kind, label: kind }))}
            onChange={(kind) => {
              onPatchNode(selectedNode.id, {
                kind: kind as EditorNode["kind"],
                roundRef:
                  kind === "round" ? (selectedNode.roundRef ?? { name: "Round" }) : undefined,
                forceStop: kind === "round" || kind === "perk" ? selectedNode.forceStop : undefined,
                skippable: kind === "round" ? selectedNode.skippable : undefined,
                visualId:
                  kind === "perk" ? (selectedNode.visualId ?? perkOptions[0]?.id) : undefined,
                giftGuaranteedPerk: kind === "perk" ? selectedNode.giftGuaranteedPerk : undefined,
                randomPoolId: undefined,
              });
            }}
          />
        </div>

        <div className="rounded-lg border border-white/6 bg-black/20 p-2.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            Appearance
          </p>
          <div className="mt-2 space-y-3">
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                Color
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  aria-label="Node color"
                  type="color"
                  value={colorValue}
                  onChange={(event) =>
                    onPatchNode(selectedNode.id, {
                      styleHint: {
                        color: event.target.value,
                      },
                    })
                  }
                  className="h-9 w-14 rounded border border-zinc-700/50 bg-zinc-950/60 p-1"
                />
                <button
                  type="button"
                  aria-label="Reset node color"
                  className="rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-500/60 hover:text-white"
                  onClick={() => onPatchNode(selectedNode.id, { styleHint: { color: undefined } })}
                >
                  Reset
                </button>
              </div>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                Size
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  aria-label="Node size"
                  type="number"
                  min="0.5"
                  max="3"
                  step="0.1"
                  value={sizeValue}
                  onChange={(event) => {
                    const value = event.target.value.trim();
                    if (value.length === 0) {
                      onPatchNode(selectedNode.id, { styleHint: { size: undefined } });
                      return;
                    }

                    const parsed = Number.parseFloat(value);
                    onPatchNode(selectedNode.id, {
                      styleHint: {
                        size: Number.isFinite(parsed)
                          ? Math.min(3, Math.max(0.5, parsed))
                          : undefined,
                      },
                    });
                  }}
                  className="w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
                  placeholder="1.0"
                />
                <button
                  type="button"
                  aria-label="Reset node size"
                  className="rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-500/60 hover:text-white"
                  onClick={() => onPatchNode(selectedNode.id, { styleHint: { size: undefined } })}
                >
                  Reset
                </button>
              </div>
            </label>
          </div>
        </div>

        {/* ── Round-specific fields ─────────────────── */}
        {selectedNode.kind === "round" && (
          <>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                Round name
              </span>
              <input
                type="text"
                value={selectedNode.roundRef?.name ?? ""}
                onChange={(event) =>
                  onPatchNode(selectedNode.id, {
                    roundRef: {
                      ...(selectedNode.roundRef ?? {}),
                      name: event.target.value.trim().length > 0 ? event.target.value : "Round",
                    },
                  })
                }
                className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
              />
            </label>
            <div className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                Installed round
              </span>
              <InstalledRoundPicker
                key={selectedNode.id}
                selectedRoundId={selectedNode.roundRef?.idHint ?? null}
                installedRounds={installedRounds}
                onClearSelection={() => {
                  onPatchNode(selectedNode.id, {
                    roundRef: {
                      name: selectedNode.roundRef?.name?.trim() || "Round",
                    },
                  });
                }}
                onSelectRound={(round) => {
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
              />
            </div>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                Force stop
              </span>
              <label className="mt-1 flex items-start gap-2 rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-2 text-xs text-zinc-200">
                <input
                  type="checkbox"
                  checked={Boolean(selectedNode.forceStop)}
                  onChange={(event) =>
                    onPatchNode(selectedNode.id, { forceStop: event.target.checked })
                  }
                  className="mt-0.5"
                />
                <span>
                  Stop movement as soon as a player reaches this round tile and start the round
                  immediately.
                </span>
              </label>
            </label>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                Skippable
              </span>
              <label className="mt-1 flex items-start gap-2 rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-2 text-xs text-zinc-200">
                <input
                  type="checkbox"
                  checked={Boolean(selectedNode.skippable)}
                  onChange={(event) =>
                    onPatchNode(selectedNode.id, { skippable: event.target.checked })
                  }
                  className="mt-0.5"
                />
                <span>
                  Let the player choose to play this round or skip it and roll from this tile
                  instead.
                </span>
              </label>
            </label>
            <SelectedRoundPreview
              round={
                selectedNode.roundRef
                  ? resolvePortableRoundRef(selectedNode.roundRef, installedRounds)
                  : null
              }
            />
          </>
        )}

        {selectedNode.kind === "safePoint" && (
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              Checkpoint Rest (sec)
            </span>
            <input
              type="number"
              min="0"
              step="1"
              value={
                typeof selectedNode.checkpointRestMs === "number" &&
                selectedNode.checkpointRestMs > 0
                  ? Math.floor(selectedNode.checkpointRestMs / 1000)
                  : ""
              }
              onChange={(event) => {
                const value = event.target.value.trim();
                if (value.length === 0) {
                  onPatchNode(selectedNode.id, { checkpointRestMs: undefined });
                  return;
                }
                const seconds = Number.parseInt(value, 10);
                onPatchNode(selectedNode.id, {
                  checkpointRestMs:
                    Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined,
                });
              }}
              className="mt-1 w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
              placeholder="Uses normal rest when empty"
            />
          </label>
        )}

        {selectedNode.kind === "randomRound" && (
          <div className="rounded-lg border border-amber-400/20 bg-amber-500/8 p-2.5 text-xs text-amber-100">
            This node plays a random installed round. It does not need a random pool.
          </div>
        )}

        {/* ── Perk-specific fields ─────────────────── */}
        {selectedNode.kind === "perk" && (
          <>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                Force stop
              </span>
              <label className="mt-1 flex items-start gap-2 rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-2 text-xs text-zinc-200">
                <input
                  type="checkbox"
                  checked={Boolean(selectedNode.forceStop)}
                  onChange={(event) =>
                    onPatchNode(selectedNode.id, { forceStop: event.target.checked })
                  }
                  className="mt-0.5"
                />
                <span>
                  Stop movement as soon as a player reaches this perk tile and resolve the perk
                  immediately.
                </span>
              </label>
            </label>
            <div className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                Guaranteed perk
              </span>
              <GameDropdown
                value={selectedNode.visualId ?? ""}
                options={[
                  { value: "" as string, label: "None" },
                  ...perkOptions.map((perk) => ({
                    value: perk.id,
                    label: perk.name,
                  })),
                ]}
                onChange={(value) => onPatchNode(selectedNode.id, { visualId: value })}
              />
            </div>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                Gift guaranteed perk
              </span>
              <label className="mt-1 flex items-start gap-2 rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-2 text-xs text-zinc-200">
                <input
                  type="checkbox"
                  checked={Boolean(selectedNode.giftGuaranteedPerk)}
                  onChange={(event) =>
                    onPatchNode(selectedNode.id, { giftGuaranteedPerk: event.target.checked })
                  }
                  className="mt-0.5"
                />
                <span>
                  Add the guaranteed perk to the player's inventory instead of applying it
                  immediately.
                </span>
              </label>
            </label>
          </>
        )}

        {/* ── Paths / outgoing edges ─────────────────── */}
        <div className="rounded-lg border border-white/6 bg-black/20 p-2.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            Outgoing Paths
          </p>
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
              onClick={() =>
                onCommitSelection({
                  selectedNodeIds: [],
                  primaryNodeId: null,
                  selectedEdgeId: edge.id,
                })
              }
            >
              {edge.fromNodeId} → {edge.toNodeId}
              <span className="ml-2 text-zinc-600">
                gate ${edge.gateCost ?? 0} · w{edge.weight ?? 1}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }
);

NodeInspectorPanel.displayName = "NodeInspectorPanel";

const InstalledRoundPicker: React.FC<{
  selectedRoundId: string | null;
  installedRounds: ReadonlyArray<InstalledRound>;
  onSelectRound: (round: InstalledRound) => void;
  onClearSelection: () => void;
}> = React.memo(({ selectedRoundId, installedRounds, onSelectRound, onClearSelection }) => {
  const [query, setQuery] = React.useState("");

  const filteredRounds = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = installedRounds.filter((round) => {
      if (!normalizedQuery) return true;
      const haystack =
        `${round.name} ${round.author ?? ""} ${round.type ?? "Normal"} ${round.difficulty ?? ""}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });

    return [...matches].sort((left, right) => {
      if (left.id === selectedRoundId) return -1;
      if (right.id === selectedRoundId) return 1;
      return left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });
  }, [installedRounds, query, selectedRoundId]);

  React.useEffect(() => {
    setQuery("");
  }, [selectedRoundId]);

  return (
    <div className="mt-1 space-y-2 rounded-lg border border-zinc-700/50 bg-zinc-950/40 p-2">
      <input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="w-full rounded-md border border-zinc-700/50 bg-zinc-950/70 px-2.5 py-2 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
        placeholder="Search by round, author, or type"
      />
      <button
        type="button"
        className={`block w-full rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${
          selectedRoundId
            ? "border-zinc-700/50 bg-zinc-950/60 text-zinc-300 hover:border-zinc-500/60 hover:text-white"
            : "border-cyan-400/50 bg-cyan-500/12 text-cyan-100"
        }`}
        onMouseEnter={playHoverSound}
        onClick={onClearSelection}
      >
        <div className="font-medium">Custom / none</div>
        <div className="mt-1 text-[11px] text-zinc-500">
          Keep the manual round name without linking to an installed round.
        </div>
      </button>
      <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
        {filteredRounds.map((round) => {
          const selected = round.id === selectedRoundId;
          return (
            <button
              key={round.id}
              type="button"
              className={`block w-full rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${
                selected
                  ? "border-cyan-400/50 bg-cyan-500/12 text-cyan-100"
                  : "border-zinc-700/40 bg-zinc-950/50 text-zinc-300 hover:border-zinc-500/60 hover:text-white"
              }`}
              onMouseEnter={playHoverSound}
              onClick={() => {
                playSelectSound();
                onSelectRound(round);
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{round.name}</span>
                {selected && <span className="text-[10px] uppercase tracking-[0.1em]">Selected</span>}
              </div>
              <div className="mt-1 text-[11px] text-zinc-500">{formatInstalledRoundMeta(round)}</div>
            </button>
          );
        })}
        {filteredRounds.length === 0 && (
          <div className="rounded-md border border-zinc-800 bg-black/25 px-2.5 py-3 text-xs text-zinc-400">
            No installed rounds match the current filter.
          </div>
        )}
      </div>
    </div>
  );
});

InstalledRoundPicker.displayName = "InstalledRoundPicker";

function SelectedRoundPreview({ round }: { round: InstalledRound | null }) {
  const previewUri = round?.resources[0]?.videoUri;
  const previewImage = round?.previewImage ?? null;
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [isPreviewActive, setIsPreviewActive] = React.useState(false);
  const { getVideoSrc, ensurePlayableVideo, handleVideoError } = usePlayableVideoFallback();
  const shouldLoadPreview = Boolean(previewUri) && isPreviewActive;
  const previewVideoSrc = shouldLoadPreview ? getVideoSrc(previewUri) : undefined;

  const previewWindowSec = React.useMemo(() => {
    const startMs =
      typeof round?.startTime === "number" && Number.isFinite(round.startTime)
        ? Math.max(0, round.startTime)
        : 0;
    const rawEndMs =
      typeof round?.endTime === "number" && Number.isFinite(round.endTime)
        ? Math.max(0, round.endTime)
        : null;
    const endMs = rawEndMs !== null && rawEndMs > startMs ? rawEndMs : null;
    return {
      startSec: startMs / 1000,
      endSec: endMs === null ? null : endMs / 1000,
    };
  }, [round?.endTime, round?.startTime]);

  const resolvePreviewWindow = (video: HTMLVideoElement) => {
    const hasFiniteDuration = Number.isFinite(video.duration) && video.duration > 0;
    const startSec = hasFiniteDuration
      ? Math.min(previewWindowSec.startSec, video.duration)
      : previewWindowSec.startSec;
    let endSec = previewWindowSec.endSec;
    if (endSec !== null && hasFiniteDuration) {
      endSec = Math.min(endSec, video.duration);
    }
    if (endSec !== null && endSec <= startSec + 0.001) {
      endSec = null;
    }
    return { startSec, endSec };
  };

  const startPreview = async () => {
    if (!previewUri) return;
    setIsPreviewActive(true);
    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const { startSec } = resolvePreviewWindow(video);
    video.currentTime = startSec;
    try {
      await video.play();
    } catch (error) {
      console.error("Map editor preview play blocked", error);
    }
  };

  const stopPreview = () => {
    setIsPreviewActive(false);
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const { startSec } = resolvePreviewWindow(video);
    video.currentTime = startSec;
  };

  return (
    <div className="rounded-lg border border-white/6 bg-black/20 p-2.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
        Round preview
      </p>
      {round ? (
        <>
          <div
            className={`group/video relative mt-2 aspect-video overflow-hidden rounded-lg border border-cyan-400/20 bg-gradient-to-br from-[#1b1130] via-[#120a25] to-[#0d1a33] ${previewUri ? "cursor-pointer" : ""}`}
            onMouseEnter={() => {
              void startPreview();
            }}
            onMouseLeave={stopPreview}
            onFocus={() => {
              void startPreview();
            }}
            onBlur={stopPreview}
            tabIndex={previewUri ? 0 : undefined}
            role={previewUri ? "button" : undefined}
            aria-label={previewUri ? `Preview ${round.name}` : undefined}
          >
            {previewImage && (
              <SfwGuard>
                <img
                  src={previewImage}
                  alt={`${round.name} preview`}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover/video:scale-[1.03] group-focus-within/video:scale-[1.03]"
                  loading="lazy"
                  decoding="async"
                />
              </SfwGuard>
            )}
            {previewUri ? (
              <SfwGuard>
                <video
                  ref={videoRef}
                  className={`h-full w-full object-cover transition-transform duration-500 group-hover/video:scale-[1.06] group-focus-within/video:scale-[1.06] ${previewImage ? "opacity-0 group-hover/video:opacity-100 group-focus-within/video:opacity-100" : ""}`}
                  src={previewVideoSrc}
                  muted
                  preload={shouldLoadPreview ? "metadata" : "none"}
                  playsInline
                  poster={previewImage ?? undefined}
                  onError={() => {
                    void handleVideoError(previewUri);
                  }}
                  onLoadedMetadata={() => {
                    if (!isPreviewActive) return;
                    void ensurePlayableVideo(previewUri);
                    const video = videoRef.current;
                    if (!video) return;
                    const { startSec } = resolvePreviewWindow(video);
                    video.currentTime = startSec;
                  }}
                  onLoadedData={() => {
                    if (!isPreviewActive) return;
                    const video = videoRef.current;
                    if (!video) return;
                    const { startSec } = resolvePreviewWindow(video);
                    video.currentTime = startSec;
                    void video.play().catch(() => {});
                  }}
                  onTimeUpdate={() => {
                    if (!isPreviewActive) return;
                    const video = videoRef.current;
                    if (!video) return;
                    const { startSec, endSec } = resolvePreviewWindow(video);
                    if (video.currentTime < startSec) {
                      video.currentTime = startSec;
                      return;
                    }
                    if (endSec !== null && video.currentTime >= endSec - 0.04) {
                      video.currentTime = startSec;
                      if (video.paused) {
                        void video.play().catch(() => {});
                      }
                    }
                  }}
                  onEnded={() => {
                    if (!isPreviewActive) return;
                    const video = videoRef.current;
                    if (!video) return;
                    const { startSec } = resolvePreviewWindow(video);
                    video.currentTime = startSec;
                    void video.play().catch(() => {});
                  }}
                />
              </SfwGuard>
            ) : !previewImage ? (
              <div className="flex h-full items-center justify-center text-[10px] font-[family-name:var(--font-jetbrains-mono)] uppercase tracking-[0.25em] text-zinc-500">
                No Preview
              </div>
            ) : null}

            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
            {previewUri && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/45 bg-black/45 text-sm text-white opacity-0 transition-opacity duration-200 group-hover/video:opacity-100 group-focus-within/video:opacity-100">
                  ▶
                </span>
              </div>
            )}
          </div>
          <div className="mt-2 space-y-1">
            <p className="text-xs font-semibold text-zinc-100">{round.name}</p>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-md border border-cyan-400/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-cyan-100">
                {round.type ?? "Normal"}
              </span>
              {round.author && (
                <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-300">
                  {round.author}
                </span>
              )}
            </div>
          </div>
        </>
      ) : (
        <p className="mt-1 text-xs text-zinc-500">
          Select an installed round to see its preview here.
        </p>
      )}
    </div>
  );
}
