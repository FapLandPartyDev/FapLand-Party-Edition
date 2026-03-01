import { Trans } from "@lingui/react/macro";

export function DifficultyBadge({
  difficulty,
  animate,
}: {
  difficulty: number;
  animate: boolean;
}) {
  const level = Math.max(1, Math.min(5, difficulty));
  return (
    <div
      className={`round-library-difficulty absolute left-3 top-3 flex items-center gap-2 rounded-full border px-3 py-1.5 font-[family-name:var(--font-jetbrains-mono)] text-[10px] text-white backdrop-blur-md ${
        animate ? "animate-difficulty-pop" : ""
      }`}
    >
      <span className="round-library-difficulty-label">
        <Trans>Difficulty</Trans>
      </span>
      <span className="text-yellow-200 drop-shadow-[0_0_8px_rgba(253,224,71,0.85)]">
        {"★".repeat(level)}
      </span>
      <span className="rounded-full bg-black/30 px-2 py-0.5 text-white/90">{level}/5</span>
    </div>
  );
}
