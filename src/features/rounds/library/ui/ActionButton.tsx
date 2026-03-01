export type ActionTone = "violet" | "emerald" | "cyan" | "sky" | "rose" | "amber";

const TONE_CLASSES: Record<ActionTone, string> = {
  violet:
    "border-violet-300/55 bg-violet-500/18 text-violet-100 hover:border-violet-200/80 hover:bg-violet-500/30",
  emerald:
    "border-emerald-300/55 bg-emerald-500/18 text-emerald-100 hover:border-emerald-200/80 hover:bg-emerald-500/30",
  cyan: "border-cyan-300/55 bg-cyan-500/18 text-cyan-100 hover:border-cyan-200/80 hover:bg-cyan-500/30",
  sky: "border-sky-300/55 bg-sky-500/18 text-sky-100 hover:border-sky-200/80 hover:bg-sky-500/30",
  rose: "border-rose-300/55 bg-rose-500/18 text-rose-100 hover:border-rose-200/80 hover:bg-rose-500/30",
  amber:
    "border-amber-300/55 bg-amber-500/18 text-amber-100 hover:border-amber-200/80 hover:bg-amber-500/30",
};

export function ActionButton({
  label,
  onClick,
  onHover,
  disabled = false,
  description,
  tone = "violet",
  compact = false,
  icon,
}: {
  label: string;
  onClick: () => void;
  onHover?: () => void;
  disabled?: boolean;
  description?: string;
  tone?: ActionTone;
  compact?: boolean;
  icon?: string;
}) {
  const toneClass = TONE_CLASSES[tone];
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onClick}
      className={`rounded-2xl border font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.18em] transition-all duration-200 ${
        compact ? "px-3 py-2" : "px-4 py-3 text-left"
      } ${disabled ? "cursor-not-allowed border-zinc-700 bg-zinc-900/70 text-zinc-500" : toneClass}`}
    >
      <div className="flex items-center gap-2">
        {icon ? <span aria-hidden="true">{icon}</span> : null}
        <span>{label}</span>
      </div>
      {description && !compact ? (
        <div className="mt-2 text-[11px] normal-case tracking-normal opacity-80">{description}</div>
      ) : null}
    </button>
  );
}

export function DateFilterInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-[10rem] flex-col gap-1 rounded-xl border border-zinc-700/80 bg-black/30 px-3 py-2 text-xs text-zinc-300">
      <span className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-transparent font-[family-name:var(--font-jetbrains-mono)] text-xs text-zinc-100 outline-none [color-scheme:dark]"
      />
    </label>
  );
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-violet-300/15 bg-black/30 px-4 py-3">
      <div className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-bold text-zinc-100">{value}</div>
    </div>
  );
}

export function TechnicalDetail({
  label,
  value,
  className = "",
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2 ${className}`.trim()}
    >
      <p className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">{label}</p>
      <p className="mt-1 break-all text-[10px] uppercase text-zinc-200">{value || "—"}</p>
    </div>
  );
}
