import React from "react";

export type StatPillTone = "violet" | "cyan" | "emerald" | "pink" | "amber" | "rose" | "indigo";

export type StatPillProps = {
  label: string;
  value: string | number;
  tone?: StatPillTone;
  className?: string;
};

const toneStyles: Record<StatPillTone, string> = {
  violet: "border-violet-300/30 bg-violet-500/10 text-violet-100",
  cyan: "border-cyan-300/30 bg-cyan-500/10 text-cyan-100",
  emerald: "border-emerald-300/30 bg-emerald-500/10 text-emerald-100",
  pink: "border-pink-300/30 bg-pink-500/10 text-pink-100",
  amber: "border-amber-300/30 bg-amber-500/10 text-amber-100",
  rose: "border-rose-300/30 bg-rose-500/10 text-rose-100",
  indigo: "border-indigo-300/30 bg-indigo-500/10 text-indigo-100",
};

export const StatPill: React.FC<StatPillProps> = ({
  label,
  value,
  tone = "violet",
  className = "",
}) => {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors duration-150 ${toneStyles[tone]} ${className}`}
    >
      <span className="opacity-70">{label}:</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
};

StatPill.displayName = "StatPill";
