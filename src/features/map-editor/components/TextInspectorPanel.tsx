import React from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import type { EditorTextAnnotation } from "../EditorState";
import { toColorInputValue } from "../nodeVisuals";

const DEFAULT_TEXT = "Guidance text";
const DEFAULT_TEXT_COLOR = "#f8fafc";
const DEFAULT_TEXT_SIZE = 18;
const MIN_TEXT_SIZE = 10;
const MAX_TEXT_SIZE = 72;
const MAX_TEXT_LENGTH = 500;

interface TextInspectorPanelProps {
  selectedTextAnnotation: EditorTextAnnotation | null;
  onPatchTextAnnotation: (
    annotationId: string,
    patch: Partial<Omit<EditorTextAnnotation, "id">>
  ) => void;
}

const clampSize = (value: number): number => Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, value));

export const TextInspectorPanel: React.FC<TextInspectorPanelProps> = React.memo(
  ({ selectedTextAnnotation, onPatchTextAnnotation }) => {
    const { t } = useLingui();
    const [draftText, setDraftText] = React.useState(selectedTextAnnotation?.text ?? DEFAULT_TEXT);

    React.useEffect(() => {
      setDraftText(selectedTextAnnotation?.text ?? DEFAULT_TEXT);
    }, [selectedTextAnnotation?.id, selectedTextAnnotation?.text]);

    if (!selectedTextAnnotation) {
      return (
        <div className="flex items-center justify-center py-8 text-xs text-zinc-600">
          <Trans>Select text to inspect</Trans>
        </div>
      );
    }

    const colorValue = toColorInputValue(selectedTextAnnotation.styleHint.color, DEFAULT_TEXT_COLOR);
    const sizeValue =
      typeof selectedTextAnnotation.styleHint.size === "number"
        ? String(selectedTextAnnotation.styleHint.size)
        : "";

    const commitText = (value: string) => {
      const normalized = value.trim().slice(0, MAX_TEXT_LENGTH);
      onPatchTextAnnotation(selectedTextAnnotation.id, {
        text: normalized.length > 0 ? normalized : DEFAULT_TEXT,
      });
      if (normalized.length === 0) {
        setDraftText(DEFAULT_TEXT);
      }
    };

    return (
      <div className="space-y-3 p-3">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            <Trans>Text</Trans>
          </span>
          <textarea
            maxLength={MAX_TEXT_LENGTH}
            value={draftText}
            onChange={(event) => {
              const value = event.target.value.slice(0, MAX_TEXT_LENGTH);
              setDraftText(value);
              if (value.trim().length > 0) {
                onPatchTextAnnotation(selectedTextAnnotation.id, { text: value });
              }
            }}
            onBlur={(event) => commitText(event.target.value)}
            className="mt-1 min-h-24 w-full resize-y rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-2 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
            placeholder={t`Guidance text`}
          />
        </label>

        <div className="rounded-lg border border-white/6 bg-black/20 p-2.5">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            <Trans>Appearance</Trans>
          </p>
          <div className="mt-2 space-y-3">
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Color</Trans>
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  aria-label={t`Text color`}
                  type="color"
                  value={colorValue}
                  onChange={(event) =>
                    onPatchTextAnnotation(selectedTextAnnotation.id, {
                      styleHint: {
                        ...selectedTextAnnotation.styleHint,
                        color: event.target.value,
                      },
                    })
                  }
                  className="h-9 w-14 rounded border border-zinc-700/50 bg-zinc-950/60 p-1"
                />
                <button
                  type="button"
                  aria-label={t`Reset text color`}
                  className="rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-500/60 hover:text-white"
                  onClick={() =>
                    onPatchTextAnnotation(selectedTextAnnotation.id, {
                      styleHint: {
                        ...selectedTextAnnotation.styleHint,
                        color: undefined,
                      },
                    })
                  }
                >
                  <Trans>Reset</Trans>
                </button>
              </div>
            </label>

            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                <Trans>Size</Trans>
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  aria-label={t`Text size`}
                  type="number"
                  min={MIN_TEXT_SIZE}
                  max={MAX_TEXT_SIZE}
                  step="1"
                  value={sizeValue}
                  onChange={(event) => {
                    const value = event.target.value.trim();
                    if (value.length === 0) {
                      onPatchTextAnnotation(selectedTextAnnotation.id, {
                        styleHint: {
                          ...selectedTextAnnotation.styleHint,
                          size: undefined,
                        },
                      });
                      return;
                    }

                    const parsed = Number.parseFloat(value);
                    onPatchTextAnnotation(selectedTextAnnotation.id, {
                      styleHint: {
                        ...selectedTextAnnotation.styleHint,
                        size: Number.isFinite(parsed) ? clampSize(parsed) : DEFAULT_TEXT_SIZE,
                      },
                    });
                  }}
                  className="w-full rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
                  placeholder={String(DEFAULT_TEXT_SIZE)}
                />
                <button
                  type="button"
                  aria-label={t`Reset text size`}
                  className="rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-200 transition-colors hover:border-zinc-500/60 hover:text-white"
                  onClick={() =>
                    onPatchTextAnnotation(selectedTextAnnotation.id, {
                      styleHint: {
                        ...selectedTextAnnotation.styleHint,
                        size: undefined,
                      },
                    })
                  }
                >
                  <Trans>Reset</Trans>
                </button>
              </div>
            </label>
          </div>
        </div>
      </div>
    );
  }
);

TextInspectorPanel.displayName = "TextInspectorPanel";
