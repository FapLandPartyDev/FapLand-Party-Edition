import React from "react";
import { GameDropdown } from "../../../../components/ui/GameDropdown";
import { playHoverSound, playSelectSound } from "../../../../utils/audio";
import { PERK_LIBRARY } from "../../../../game/data/perks";
import type { FieldDescriptor } from "../../../../game/automation/registry";
import type { EditorGraphConfig } from "../../EditorState";

type DynamicFieldEditorProps = {
  field: FieldDescriptor;
  value: unknown;
  config: EditorGraphConfig;
  ruleIdForRefs?: string;
  onChange: (fieldName: string, value: unknown) => void;
  labelClassName?: string;
};

function getNodeOptions(config: EditorGraphConfig, optional: boolean) {
  const nodes = config.nodes.map((n: { id: string; name: string }) => ({
    value: n.id,
    label: n.name,
  }));
  if (optional) {
    return [{ value: "", label: "Any Node" }, ...nodes];
  }
  return nodes;
}

function getTrackOptions(config: EditorGraphConfig) {
  return config.music.tracks.map((t: { id: string; name: string }) => ({
    value: t.id,
    label: t.name,
  }));
}

function getEdgeOptions(config: EditorGraphConfig) {
  return config.edges.map((e: { id: string; fromNodeId: string; toNodeId: string }) => {
    const from = config.nodes.find((n) => n.id === e.fromNodeId)?.name ?? e.fromNodeId;
    const to = config.nodes.find((n) => n.id === e.toNodeId)?.name ?? e.toNodeId;
    return { value: e.id, label: `${from} → ${to}` };
  });
}

function getRuleOptions(config: EditorGraphConfig, currentRuleId?: string) {
  return (config.automations ?? [])
    .filter((r: { id: string }) => r.id !== currentRuleId)
    .map((r: { id: string; name: string }) => ({ value: r.id, label: r.name }));
}

export const DynamicFieldEditor: React.FC<DynamicFieldEditorProps> = React.memo(
  ({ field, value, config, ruleIdForRefs, onChange, labelClassName }) => {
    switch (field.type) {
      case "select": {
        const stringValue = typeof value === "string" ? value : "";
        return (
          <label className="flex flex-col gap-1">
            <span
              className={`text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500 ${labelClassName ?? ""}`}
            >
              {field.label}
            </span>
            <GameDropdown
              value={stringValue}
              options={field.options.map((o) => ({ value: o.value, label: o.label }))}
              onChange={(v: string) => onChange(field.name, v)}
              onHoverSfx={playHoverSound}
              onSelectSfx={playSelectSound}
            />
          </label>
        );
      }
      case "number": {
        const numValue = typeof value === "number" ? value : 0;
        return (
          <label className="flex flex-col gap-1">
            <span
              className={`text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500 ${labelClassName ?? ""}`}
            >
              {field.label}
            </span>
            <input
              type="number"
              min={field.min}
              max={field.max}
              step={field.step ?? 1}
              value={numValue}
              onChange={(e) => onChange(field.name, Number.parseFloat(e.target.value) || 0)}
              className="rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
            />
          </label>
        );
      }
      case "text": {
        const strValue = typeof value === "string" ? value : "";
        return (
          <label className="flex flex-col gap-1">
            <span
              className={`text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500 ${labelClassName ?? ""}`}
            >
              {field.label}
            </span>
            <input
              type="text"
              value={strValue}
              onChange={(e) => onChange(field.name, e.target.value)}
              className="rounded-md border border-zinc-700/50 bg-zinc-950/60 px-2.5 py-1.5 text-xs text-zinc-100 outline-none transition-colors focus:border-cyan-500/50"
            />
          </label>
        );
      }
      case "toggle": {
        const boolValue = typeof value === "boolean" ? value : false;
        return (
          <label className="flex items-center gap-2 rounded-md border border-zinc-700/40 bg-zinc-950/40 px-3 py-1.5">
            <input
              type="checkbox"
              checked={boolValue}
              onChange={(e) => onChange(field.name, e.target.checked)}
              className="accent-cyan-500"
            />
            <span className="text-xs text-zinc-300">{field.label}</span>
          </label>
        );
      }
      case "nodeRef": {
        const stringValue = typeof value === "string" ? value : "";
        return (
          <label className="flex flex-col gap-1">
            <span
              className={`text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500 ${labelClassName ?? ""}`}
            >
              {field.label}
            </span>
            <GameDropdown
              value={stringValue}
              options={getNodeOptions(config, !!field.optional)}
              onChange={(v: string) => onChange(field.name, v || undefined)}
              onHoverSfx={playHoverSound}
              onSelectSfx={playSelectSound}
            />
          </label>
        );
      }
      case "trackRef": {
        const stringValue = typeof value === "string" ? value : "";
        return (
          <label className="flex flex-col gap-1">
            <span
              className={`text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500 ${labelClassName ?? ""}`}
            >
              {field.label}
            </span>
            <GameDropdown
              value={stringValue}
              options={getTrackOptions(config)}
              onChange={(v: string) => onChange(field.name, v)}
              onHoverSfx={playHoverSound}
              onSelectSfx={playSelectSound}
            />
          </label>
        );
      }
      case "edgeRef": {
        const stringValue = typeof value === "string" ? value : "";
        return (
          <label className="flex flex-col gap-1">
            <span
              className={`text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500 ${labelClassName ?? ""}`}
            >
              {field.label}
            </span>
            <GameDropdown
              value={stringValue}
              options={getEdgeOptions(config)}
              onChange={(v: string) => onChange(field.name, v)}
              onHoverSfx={playHoverSound}
              onSelectSfx={playSelectSound}
            />
          </label>
        );
      }
      case "ruleRef": {
        const stringValue = typeof value === "string" ? value : "";
        return (
          <label className="flex flex-col gap-1">
            <span
              className={`text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500 ${labelClassName ?? ""}`}
            >
              {field.label}
            </span>
            <GameDropdown
              value={stringValue}
              options={[
                ...(field.optional ? [{ value: "", label: "This Rule" }] : []),
                ...getRuleOptions(config, ruleIdForRefs),
              ]}
              onChange={(v: string) => onChange(field.name, v || undefined)}
              onHoverSfx={playHoverSound}
              onSelectSfx={playSelectSound}
            />
          </label>
        );
      }
      case "perkRef": {
        const strValue = typeof value === "string" ? value : "";
        const perkOptions = PERK_LIBRARY.filter(
          (p) => !field.perkKind || p.kind === field.perkKind
        ).map((p) => ({ value: p.id, label: p.name }));
        return (
          <label className="flex flex-col gap-1">
            <span
              className={`text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500 ${labelClassName ?? ""}`}
            >
              {field.label}
            </span>
            <GameDropdown
              value={strValue}
              options={[{ value: "", label: "Select..." }, ...perkOptions]}
              onChange={(v: string) => onChange(field.name, v)}
              onHoverSfx={playHoverSound}
              onSelectSfx={playSelectSound}
            />
          </label>
        );
      }
      default:
        return null;
    }
  }
);

DynamicFieldEditor.displayName = "DynamicFieldEditor";
