import React from "react";
import { StatPill, type StatPillTone } from "./StatPill";

export type MetricItem = {
  label: string;
  value: string | number;
  tone?: StatPillTone;
};

export type InlineMetricsProps = {
  metrics: MetricItem[];
  className?: string;
  separator?: boolean;
};

export const InlineMetrics: React.FC<InlineMetricsProps> = ({
  metrics,
  className = "",
  separator = true,
}) => {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 ${className}`}>
      {metrics.map((metric, index) => (
        <React.Fragment key={`${metric.label}-${index}`}>
          <StatPill label={metric.label} value={metric.value} tone={metric.tone} />
          {separator && index < metrics.length - 1 && (
            <span className="hidden h-3 w-px bg-zinc-700 sm:block" aria-hidden="true" />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

InlineMetrics.displayName = "InlineMetrics";
