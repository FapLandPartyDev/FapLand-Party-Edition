import React from "react";
import { useSfwMode } from "../../hooks/useSfwMode";
import { abbreviateNsfwText } from "../../utils/sfwText";
import { getConverterShortcutGroups } from "./shortcuts";

type HotkeyOverlayProps = {
  visible: boolean;
};

export const HotkeyOverlay: React.FC<HotkeyOverlayProps> = ({ visible }) => {
  const sfwMode = useSfwMode();
  if (!visible) return null;

  return (
    <section className="animate-entrance rounded-2xl border border-violet-300/40 bg-black/60 p-5 backdrop-blur-sm">
      <p className="mb-3 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-violet-200">
        Keyboard Shortcuts
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {getConverterShortcutGroups().map((group) => (
          <div key={group.category}>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-100">
              {group.category}
            </p>
            <div className="space-y-1.5">
              {group.shortcuts.map((shortcut) => (
                <div key={shortcut.id} className="flex items-center gap-2 text-xs">
                  <kbd className="converter-kbd min-w-[6rem] text-center">
                    {shortcut.keysLabel}
                  </kbd>
                  <span className="text-zinc-300">
                    {abbreviateNsfwText(shortcut.description, sfwMode)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

HotkeyOverlay.displayName = "HotkeyOverlay";
