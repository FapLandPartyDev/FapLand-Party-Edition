import { Trans } from "@lingui/react/macro";

export function RoutePendingComponent() {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-[#050508]" />
      <div className="absolute inset-0 bg-gradient-to-br from-violet-950/30 via-transparent to-indigo-950/20" />
      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-400" />
        <p className="font-mono text-xs text-zinc-500">
          <Trans>Loading...</Trans>
        </p>
      </div>
    </div>
  );
}
