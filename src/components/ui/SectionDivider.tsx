import React from "react";

export type SectionDividerProps = {
  className?: string;
  label?: string;
};

export const SectionDivider: React.FC<SectionDividerProps> = ({ className = "", label }) => {
  if (label) {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <div className="h-px flex-1 bg-zinc-700/50" />
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          {label}
        </span>
        <div className="h-px flex-1 bg-zinc-700/50" />
      </div>
    );
  }

  return <div className={`h-px w-full bg-zinc-700/50 ${className}`} />;
};

SectionDivider.displayName = "SectionDivider";
