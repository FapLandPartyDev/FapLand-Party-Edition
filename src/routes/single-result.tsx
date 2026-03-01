import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useState } from "react";

const SingleResultSearchSchema = z.object({
  score: z.coerce.number().int().min(0).default(0),
  highscore: z.coerce.number().int().min(0).default(0),
  reason: z.enum(["finished", "self_reported_cum", "cum_instruction_failed"]).default("finished"),
});

const reasonLabel: Record<z.infer<typeof SingleResultSearchSchema>["reason"], string> = {
  finished: "Campaign Completed",
  self_reported_cum: "CLIMAX ACHIEVED",
  cum_instruction_failed: "INSTRUCTION FAILED",
};

const reasonDescription: Record<z.infer<typeof SingleResultSearchSchema>["reason"], string> = {
  finished: "You completed the board and closed out the match.",
  self_reported_cum: "Sensory overload threshold reached. Initiating cooldown sequence.",
  cum_instruction_failed: "You failed the final instruction. The system is disappointed.",
};

export const Route = createFileRoute("/single-result")({
  validateSearch: (search) => SingleResultSearchSchema.parse(search),
  component: SingleResultRoute,
});

function SingleResultRoute() {
  const navigate = useNavigate();
  const search = SingleResultSearchSchema.parse(Route.useSearch());
  const isNewBest = search.score > 0 && search.score >= search.highscore;
  const isCum = search.reason === "self_reported_cum";

  // State for animated score counting
  const [displayScore, setDisplayScore] = useState(0);

  useEffect(() => {
    if (search.score === 0) return;

    let startTimestamp: number | null = null;
    const duration = 1500; // 1.5 seconds

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      // easeOutExpo
      const easing = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      setDisplayScore(Math.floor(easing * search.score));
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };
    window.requestAnimationFrame(step);
  }, [search.score]);

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#030509] text-zinc-100 font-sans select-none">
      {/* Dynamic Background */}
      <div className="absolute inset-0 z-0">
        {/* Orgasmic / Climax pulsating rings */}
        {isCum && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="absolute w-[40vw] h-[40vw] rounded-full border border-fuchsia-500/30 animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite] shadow-[0_0_100px_rgba(236,72,153,0.4)]" />
            <div className="absolute w-[60vw] h-[60vw] rounded-full border border-fuchsia-400/20 animate-[ping_3.5s_cubic-bezier(0,0,0.2,1)_infinite_0.5s] shadow-[0_0_150px_rgba(236,72,153,0.2)]" />
            <div className="absolute w-[80vw] h-[80vw] rounded-full border border-fuchsia-300/10 animate-[ping_4s_cubic-bezier(0,0,0.2,1)_infinite_1s]" />
            {/* Intense glowing core */}
            <div className="absolute w-[20vw] h-[20vw] rounded-full bg-fuchsia-600/20 blur-[100px] animate-pulse-glow" />
          </div>
        )}

        {/* Cyberpunk Grid Background */}
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(34,211,238,0.06)_1px,transparent_1px),linear-gradient(to_right,rgba(34,211,238,0.06)_1px,transparent_1px)] bg-[length:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-40 translate-y-[-1rem] animate-[scanline-scroll_10s_linear_infinite]" />

        {/* Scanlines and Noise */}
        <div className="absolute inset-0 scanlines opacity-50 pointer-events-none" />
        <div className="absolute inset-0 noise pointer-events-none" />
      </div>

      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-12 lg:px-12">
        <div className="animate-entrance-fade duration-1000">
          <p className="font-mono text-sm tracking-[0.4em] text-cyan-400/80 mb-4 animate-title text-center drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]">
            SYSTEM TERMINATION
          </p>

          <h1 className={`text-center text-5xl sm:text-7xl font-black uppercase tracking-[0.08em] ${isCum ? 'text-fuchsia-400 drop-shadow-[0_0_25px_rgba(236,72,153,0.8)]' : 'text-zinc-100 drop-shadow-[0_0_15px_rgba(255,255,255,0.4)]'} animate-entrance`}>
            {reasonLabel[search.reason]}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-center text-lg text-zinc-400 font-light tracking-wide animate-entrance" style={{ animationDelay: '200ms' }}>
            {reasonDescription[search.reason]}
          </p>
        </div>

        {/* Score Grid */}
        <div className="mt-16 grid gap-6 sm:grid-cols-2 animate-entrance" style={{ animationDelay: '400ms' }}>
          {/* Final Score */}
          <article className="relative overflow-hidden rounded-3xl border border-cyan-400/30 bg-black/40 p-8 backdrop-blur-2xl transition-all hover:bg-black/60 hover:border-cyan-400/60 hover:shadow-[0_0_40px_rgba(34,211,238,0.15)] group">
            <div className="absolute -inset-x-full -inset-y-full animate-[border-spin_4s_linear_infinite] bg-[conic-gradient(from_90deg_at_50%_50%,transparent_0%,rgba(34,211,238,0.1)_50%,transparent_100%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            <div className="relative z-10">
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-cyan-300/70">Final Score</p>
              <div className="mt-4 flex items-baseline gap-2">
                <p className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-br from-cyan-100 to-cyan-400 drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]">
                  {displayScore}
                </p>
                <span className="text-cyan-500/50 font-mono text-xl">PTS</span>
              </div>
            </div>
          </article>

          {/* Best Score */}
          <article className="relative overflow-hidden rounded-3xl border border-fuchsia-400/30 bg-black/40 p-8 backdrop-blur-2xl transition-all hover:bg-black/60 hover:border-fuchsia-400/60 hover:shadow-[0_0_40px_rgba(236,72,153,0.15)] group">
            <div className="absolute -inset-x-full -inset-y-full animate-[border-spin_4s_linear_infinite_reverse] bg-[conic-gradient(from_270deg_at_50%_50%,transparent_0%,rgba(236,72,153,0.1)_50%,transparent_100%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            <div className="relative z-10">
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-fuchsia-300/70">Personal Best</p>
              <div className="mt-4 flex items-baseline gap-2">
                <p className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-br from-fuchsia-100 to-fuchsia-400 drop-shadow-[0_0_15px_rgba(236,72,153,0.5)]">
                  {search.highscore}
                </p>
                <span className="text-fuchsia-500/50 font-mono text-xl">PTS</span>
              </div>
            </div>
          </article>
        </div>

        {/* Highscore Notification */}
        <div className={`mt-8 mx-auto w-full max-w-sm rounded-2xl border px-6 py-4 text-center font-mono text-sm uppercase tracking-widest transition-all animate-entrance ${isNewBest ? 'border-amber-400/50 bg-amber-500/10 text-amber-200 shadow-[0_0_30px_rgba(251,191,36,0.2)] animate-pulse' : 'border-white/5 bg-white/5 text-zinc-500'}`} style={{ animationDelay: '600ms' }}>
          {isNewBest ? "★ New Peak Record ★" : "No New Record Set"}
        </div>

        {/* Actions */}
        <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4 animate-entrance" style={{ animationDelay: '800ms' }}>
          <button
            type="button"
            onClick={() => {
              void navigate({ to: "/game", replace: true });
            }}
            className="group relative w-full sm:w-auto overflow-hidden rounded-full bg-cyan-500 px-10 py-4 font-bold uppercase tracking-widest text-black transition-all hover:scale-105 hover:bg-cyan-400 hover:shadow-[0_0_40px_rgba(34,211,238,0.6)] focus:outline-none focus:ring-4 focus:ring-cyan-500/50"
          >
            <div className="absolute inset-0 flex h-full w-full justify-center [transform:skew(-12deg)_translateX(-150%)] group-hover:duration-1000 group-hover:[transform:skew(-12deg)_translateX(150%)]">
              <div className="relative h-full w-8 bg-white/30" />
            </div>
            <span className="relative z-10">Play Again</span>
          </button>

          <button
            type="button"
            onClick={() => {
              void navigate({ to: "/", replace: true });
            }}
            className="w-full sm:w-auto rounded-full border border-zinc-700 bg-zinc-900/80 px-10 py-4 font-bold uppercase tracking-widest text-zinc-300 transition-all hover:bg-zinc-800 hover:text-white focus:outline-none focus:ring-4 focus:ring-zinc-700/50"
          >
            Go to Main Menu
          </button>

          <button
            type="button"
            onClick={() => {
              void navigate({ to: "/highscores" });
            }}
            className="w-full sm:w-auto rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-10 py-4 font-bold uppercase tracking-widest text-fuchsia-300 transition-all hover:bg-fuchsia-500/20 hover:border-fuchsia-500/60 hover:shadow-[0_0_20px_rgba(236,72,153,0.3)] focus:outline-none focus:ring-4 focus:ring-fuchsia-500/50"
          >
            Leaderboard
          </button>
        </div>
      </main>
    </div>
  );
}
