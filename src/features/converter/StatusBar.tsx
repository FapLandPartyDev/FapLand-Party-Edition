import React from "react";

type StatusBarProps = {
    message: string | null;
    error: string | null;
};

export const StatusBar: React.FC<StatusBarProps> = React.memo(({ message, error }) => {
    if (!message && !error) return null;

    return (
        <section className="animate-entrance rounded-2xl border border-zinc-700/50 bg-black/35 p-4 text-sm backdrop-blur-sm">
            {message && (
                <p className="flex items-center gap-2 text-emerald-200">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,0.4)]" />
                    {message}
                </p>
            )}
            {error && (
                <p className="mt-1 flex items-center gap-2 text-rose-200">
                    <span className="inline-block h-2 w-2 rounded-full bg-rose-400/80 shadow-[0_0_8px_rgba(251,113,133,0.4)]" />
                    {error}
                </p>
            )}
        </section>
    );
});

StatusBar.displayName = "StatusBar";
