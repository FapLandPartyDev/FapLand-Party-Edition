import { memo, useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  DEFAULT_SCRIPT_ENHANCEMENT,
  type ScriptEnhancement,
} from "../services/haptics/scriptEnhancement";
import {
  readScriptEnhancement,
  saveScriptEnhancement,
} from "../services/scriptEnhancementSettings";

export const ScriptEnhancementControl = memo(function ScriptEnhancementControl({
  scriptUri,
}: {
  scriptUri: string;
}) {
  const { t } = useLingui();
  const [settings, setSettings] = useState(DEFAULT_SCRIPT_ENHANCEMENT);
  const [wildness, setWildness] = useState(DEFAULT_SCRIPT_ENHANCEMENT.wildness);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void readScriptEnhancement(scriptUri)
      .then((value) => {
        if (cancelled) return;
        setSettings(value);
        setWildness(value.wildness);
        setLoading(false);
      })
      .catch((error: unknown) => {
        console.warn("Failed to load script enhancement settings", error);
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scriptUri]);

  async function save(value: ScriptEnhancement) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setFailed(false);
    try {
      setSettings(await saveScriptEnhancement(scriptUri, value));
    } catch (error) {
      console.warn("Failed to save script enhancement settings", error);
      setWildness(settings.wildness);
      setFailed(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <details className="relative text-xs normal-case tracking-normal">
      <summary className="cursor-pointer rounded-md border border-cyan-300/45 bg-cyan-500/15 px-2 py-1 text-cyan-100">
        <Trans>Auto enhance script</Trans>
      </summary>
      <div className="absolute right-0 top-full z-50 mt-2 w-72 space-y-3 rounded-lg border border-cyan-300/30 bg-zinc-950 p-4 text-zinc-100 shadow-xl">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={loading || saving}
            onChange={(event) => {
              void save({ ...settings, enabled: event.target.checked });
            }}
          />
          <Trans>Enhance this script</Trans>
        </label>
        <label className="block">
          <span className="flex justify-between">
            <span>
              <Trans>Wildness</Trans>
            </span>
            <output>{wildness}%</output>
          </span>
          <input
            className="w-full accent-cyan-400"
            type="range"
            min={0}
            max={100}
            step={1}
            aria-label={t`Wildness`}
            value={wildness}
            disabled={loading || saving}
            onChange={(event) => {
              setWildness(Number(event.target.value));
            }}
            onPointerUp={() => {
              if (wildness !== settings.wildness) void save({ ...settings, wildness });
            }}
            onKeyUp={() => {
              if (wildness !== settings.wildness) void save({ ...settings, wildness });
            }}
            onBlur={() => {
              if (!saving && wildness !== settings.wildness) void save({ ...settings, wildness });
            }}
          />
        </label>
        <p className="text-zinc-400">
          <Trans>
            Adds repeatable position variation and slow-up, fast-down strokes where the speed limit
            allows. Saved per script. Original files stay unchanged.
          </Trans>
        </p>
        {failed && (
          <p role="alert" className="text-rose-300">
            <Trans>Could not load or save enhancement settings. Try again.</Trans>
          </p>
        )}
      </div>
    </details>
  );
});
