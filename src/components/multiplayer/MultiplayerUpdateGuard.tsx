import React from "react";
import { useAppUpdate } from "../../hooks/useAppUpdate";
import { AnimatedBackground } from "../AnimatedBackground";
import { playSelectSound } from "../../utils/audio";
import { useNavigate } from "@tanstack/react-router";

/**
 * A guard component that blocks access to multiplayer features if an update is available.
 * This ensures all players are on the same version to prevent protocol mismatches.
 */
export const MultiplayerUpdateGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { state, triggerPrimaryAction } = useAppUpdate();
  const navigate = useNavigate();

  // If we are still checking or no update is available, show the content.
  // Note: "error" is also ignored here to avoid blocking users if GitHub is down,
  // unless we decide that blocking on error is safer.
  // Given the current requirement, "update_available" is the key trigger.
  if (state.status !== "update_available") {
    return <>{children}</>;
  }

  return (
    <div className="fixed inset-0 z-[10000] flex flex-col items-center justify-center p-6 text-center text-zinc-100 overflow-hidden">
      <AnimatedBackground />

      {/* Dark overlay with glass effect */}
      <div className="pointer-events-none absolute inset-0 bg-black/40 backdrop-blur-xl" />

      {/* Decorative gradients */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(139,92,246,0.15),transparent_50%),radial-gradient(circle_at_20%_80%,rgba(34,211,238,0.1),transparent_40%)]" />

      <div className="relative w-full max-w-md space-y-8 rounded-[2.5rem] border border-white/10 bg-zinc-900/40 p-10 shadow-2xl backdrop-blur-2xl animated-entrance">
        <div className="space-y-4">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 border border-violet-400/30 shadow-inner">
            <svg
              className="h-10 w-10 text-violet-300 drop-shadow-[0_0_8px_rgba(167,139,250,0.5)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl font-black tracking-tight text-white sm:text-4xl">
              Update Required
            </h1>
            <p className="text-lg font-medium text-violet-200/70">Multiplayer protocol mismatch</p>
          </div>

          <p className="text-sm leading-relaxed text-zinc-400">
            A newer version of f-land is available (v{state.latestVersion}). To ensure fair play and
            stable connections, all players must be on the latest build.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <button
            onClick={() => {
              playSelectSound();
              void triggerPrimaryAction();
            }}
            className="group relative flex items-center justify-center gap-3 overflow-hidden rounded-2xl bg-white px-8 py-4 text-sm font-bold uppercase tracking-widest text-black transition-all hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(255,255,255,0.3)] active:scale-[0.98]"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-violet-200/0 via-violet-200/30 to-violet-200/0 translate-x-[-100%] transition-transform duration-1000 group-hover:translate-x-[100%]" />
            Update Now
          </button>

          <button
            onClick={() => {
              playSelectSound();
              void navigate({ to: "/" });
            }}
            className="rounded-2xl border border-white/5 bg-white/5 py-4 text-xs font-bold uppercase tracking-[0.2em] text-zinc-400 transition-all hover:bg-white/10 hover:text-white"
          >
            Return to Menu
          </button>
        </div>

        <div className="pt-2">
          <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.3em] text-zinc-600">
            Detected: v{state.currentVersion} → v{state.latestVersion}
          </p>
        </div>
      </div>
    </div>
  );
};
