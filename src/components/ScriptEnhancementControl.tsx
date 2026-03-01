import { memo, useEffect, useRef, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  DEFAULT_SCRIPT_ENHANCEMENT,
  type ScriptEnhancement,
} from "../services/haptics/scriptEnhancement";
import {
  readScriptEnhancement,
  saveScriptEnhancement,
  readEnhancementSpeedProfile,
  saveEnhancementSpeedProfile,
} from "../services/scriptEnhancementSettings";
import { useHaptics } from "../contexts/HandyContext";
import {
  DEFAULT_ENHANCEMENT_SPEED_PROFILE,
  type EnhancementSpeedProfile,
} from "../services/haptics/enhancementProfile";
import type { HapticsProviderId } from "../services/haptics/types";

export const ScriptEnhancementControl = memo(function ScriptEnhancementControl({
  scriptUri,
}: {
  scriptUri: string;
}) {
  const { provider } = useHaptics();
  return (
    <ScriptEnhancementEditor
      key={`${scriptUri}:${provider}`}
      scriptUri={scriptUri}
      provider={provider}
    />
  );
});

function EnhancementSlider({
  label,
  value,
  disabled,
  commit,
}: {
  label: string;
  value: number;
  disabled: boolean;
  commit: (value: number) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value);
  const persist = async () => {
    if (draft !== value && !(await commit(draft))) setDraft(value);
  };
  return (
    <label className="block">
      <span className="flex justify-between">
        <span>{label}</span>
        <output>{draft}%</output>
      </span>
      <input
        className="w-full accent-cyan-400"
        type="range"
        min={0}
        max={100}
        step={1}
        aria-label={label}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={() => void persist()}
        onKeyUp={() => void persist()}
        onBlur={() => void persist()}
      />
    </label>
  );
}

function ScriptEnhancementEditor({
  scriptUri,
  provider,
}: {
  scriptUri: string;
  provider: HapticsProviderId;
}) {
  const { t } = useLingui();
  const [settings, setSettings] = useState(DEFAULT_SCRIPT_ENHANCEMENT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const savingRef = useRef(false);
  const [profile, setProfile] = useState(DEFAULT_ENHANCEMENT_SPEED_PROFILE);
  const [customRate, setCustomRate] = useState(profile.customRate);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([readScriptEnhancement(scriptUri), readEnhancementSpeedProfile(provider)])
      .then(([value, speedProfile]) => {
        if (cancelled) return;
        setSettings(value);
        setProfile(speedProfile);
        setCustomRate(speedProfile.customRate);
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
  }, [scriptUri, provider]);

  async function save(value: ScriptEnhancement) {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setFailed(false);
    try {
      setSettings(await saveScriptEnhancement(scriptUri, value));
      return true;
    } catch (error) {
      console.warn("Failed to save script enhancement settings", error);
      setFailed(true);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function saveProfile(value: EnhancementSpeedProfile) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setFailed(false);
    try {
      const saved = await saveEnhancementSpeedProfile(provider, value);
      setProfile(saved);
      setCustomRate(saved.customRate);
    } catch (error) {
      console.warn("Failed to save enhancement speed profile", error);
      setCustomRate(profile.customRate);
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
      <div className="absolute right-0 top-full z-50 mt-2 max-h-[70vh] w-80 space-y-3 overflow-y-auto rounded-lg border border-cyan-300/30 bg-zinc-950 p-4 text-zinc-100 shadow-xl">
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
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.delimitedEnabled ?? (settings.delimited ?? 0) > 0}
            disabled={loading || saving}
            onChange={(event) => {
              const enabled = event.target.checked;
              void save({
                ...settings,
                enabled: enabled || settings.enabled,
                delimitedEnabled: enabled,
                delimited: settings.delimited || 100,
              });
            }}
          />
          <Trans>Delimited</Trans>
        </label>
        <EnhancementSlider
          key={`delimited:${settings.delimited ?? 0}`}
          label={t`Delimited intensity`}
          value={settings.delimited ?? 0}
          disabled={loading || saving}
          commit={(value) => save({ ...settings, delimited: value })}
        />
        <p className="text-zinc-400">
          <Trans>
            Expands narrow strokes for scripts optimized for low-power devices such as The Handy 1.
            0% keeps the original range; 100% targets full width and depth within the device speed
            limit. Applied during playback; original files stay unchanged.
          </Trans>
        </p>
        <EnhancementSlider
          key={`punch:${settings.beatPunch ?? settings.wildness}`}
          label={t`Beat punch`}
          value={settings.beatPunch ?? settings.wildness}
          disabled={loading || saving}
          commit={(value) => save({ ...settings, beatPunch: value })}
        />
        <EnhancementSlider
          key={`variation:${settings.variation ?? settings.wildness}`}
          label={t`Variation`}
          value={settings.variation ?? settings.wildness}
          disabled={loading || saving}
          commit={(value) => save({ ...settings, variation: value })}
        />
        <label className="block space-y-1">
          <span>
            <Trans>Phrase length</Trans>
          </span>
          <select
            className="w-full rounded border border-zinc-700 bg-zinc-900 p-1"
            aria-label={t`Phrase length`}
            value={settings.phraseLength ?? 8}
            disabled={loading || saving}
            onChange={(event) => {
              const length = Number(event.target.value);
              void save({
                ...settings,
                phraseLength: length === 4 || length === 16 ? length : 8,
              });
            }}
          >
            <option value={4}>{t`4 strokes`}</option>
            <option value={8}>{t`8 strokes`}</option>
            <option value={16}>{t`16 strokes`}</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span>
            <Trans>Device speed profile</Trans>
          </span>
          <select
            className="w-full rounded border border-zinc-700 bg-zinc-900 p-1"
            aria-label={t`Device speed profile`}
            value={profile.preset}
            disabled={loading || saving}
            onChange={(event) =>
              void saveProfile({
                ...profile,
                preset: event.target.value as EnhancementSpeedProfile["preset"],
              })
            }
          >
            <option value="automatic">{t`Automatic`}</option>
            <option value="balanced">{t`Balanced (400 units/s)`}</option>
            <option value="responsive">{t`Responsive (800 units/s)`}</option>
            <option value="powerful">{t`Powerful (1600 units/s)`}</option>
            <option value="custom">{t`Custom`}</option>
          </select>
        </label>
        {profile.preset === "custom" && (
          <label className="block space-y-1">
            <span>
              <Trans>Maximum speed (units/s)</Trans>
            </span>
            <input
              className="w-full rounded border border-zinc-700 bg-zinc-900 p-1"
              type="number"
              min={1}
              max={2000}
              aria-label={t`Maximum speed (units/s)`}
              value={customRate}
              disabled={loading || saving}
              onChange={(event) => setCustomRate(Number(event.target.value))}
              onBlur={() => {
                if (customRate !== profile.customRate) void saveProfile({ ...profile, customRate });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
        )}
        <p className="text-zinc-400">
          <Trans>
            Speed profiles are saved per connection type. Existing device speed limits still apply.
          </Trans>
        </p>
        <p className="text-zinc-400">
          <Trans>Manage which patterns can run in Auto enhance script settings.</Trans>
        </p>
        {failed && (
          <p role="alert" className="text-rose-300">
            <Trans>Could not load or save enhancement settings. Try again.</Trans>
          </p>
        )}
      </div>
    </details>
  );
}
