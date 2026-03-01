import React from "react";

type HotkeyOverlayProps = {
    visible: boolean;
};

const HOTKEYS = [
    ["Space", "Play/Pause"],
    ["I / O", "Mark IN/OUT"],
    ["Enter", "Add segment"],
    ["Delete", "Remove selected"],
    ["1/2/3", "Set round type"],
    ["← →", "Seek ±1s"],
    ["Shift+← →", "Seek ±5s"],
    [", / .", "Nudge selected end"],
    ["= / - / 0", "Zoom"],
    ["R", "Random jump"],
    ["?", "Toggle this overlay"],
] as const;

export const HotkeyOverlay: React.FC<HotkeyOverlayProps> = React.memo(({ visible }) => {
    if (!visible) return null;

    return (
        <section className="animate-entrance rounded-2xl border border-violet-300/40 bg-black/60 p-5 backdrop-blur-sm">
            <p className="mb-3 font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-violet-200">
                Keyboard Shortcuts
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                {HOTKEYS.map(([key, description]) => (
                    <div key={key} className="flex items-center gap-2 text-xs">
                        <kbd className="converter-kbd min-w-[4rem] text-center">{key}</kbd>
                        <span className="text-zinc-300">{description}</span>
                    </div>
                ))}
            </div>
        </section>
    );
});

HotkeyOverlay.displayName = "HotkeyOverlay";
