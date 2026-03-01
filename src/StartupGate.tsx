import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

const RECOVERY_SHORTCUT_WINDOW_MS = 5000;

const LazyNormalApp = lazy(async () => {
  const module = await import("./NormalApp");
  return { default: module.NormalApp };
});

const LazyRecoveryMode = lazy(async () => {
  const module = await import("./RecoveryMode");
  return { default: module.RecoveryMode };
});

type StartupMode = "pending" | "normal" | "recovery" | "error";

export function StartupGate() {
  const [mode, setMode] = useState<StartupMode>("pending");
  const [startupError, setStartupError] = useState<string | null>(null);
  const [attemptId, setAttemptId] = useState(0);
  const recoveryRequestedRef = useRef(false);
  const normalStartCalledRef = useRef(false);

  const startNormally = useCallback(async () => {
    if (normalStartCalledRef.current) return;
    normalStartCalledRef.current = true;

    try {
      await window.electronAPI?.startupRecovery?.startNormally?.();
      return true;
    } catch (error) {
      console.error("Failed to start normal app startup", error);
      setStartupError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, []);

  const enterRecovery = useCallback(async () => {
    recoveryRequestedRef.current = true;
    try {
      await window.electronAPI?.startupRecovery?.enterRecovery?.();
    } catch (error) {
      console.error("Failed to enter recovery startup", error);
    } finally {
      setMode("recovery");
    }
  }, []);

  useEffect(() => {
    normalStartCalledRef.current = false;
    void startNormally().then((succeeded) => {
      if (succeeded && !recoveryRequestedRef.current) {
        setMode("normal");
      } else if (!succeeded && !recoveryRequestedRef.current) {
        setMode("error");
      }
    });
  }, [startNormally, attemptId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        void enterRecovery();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener("keydown", handleKeyDown);
    }, RECOVERY_SHORTCUT_WINDOW_MS);

    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enterRecovery]);

  if (mode === "normal") {
    return (
      <Suspense fallback={<StartupSplash message="Starting..." />}>
        <LazyNormalApp />
      </Suspense>
    );
  }

  if (mode === "recovery") {
    return (
      <Suspense fallback={<StartupSplash message="Opening recovery..." />}>
        <LazyRecoveryMode />
      </Suspense>
    );
  }

  if (mode === "error") {
    return <StartupError error={startupError} onRetry={() => {
      setStartupError(null);
      setAttemptId((prev) => prev + 1);
      setMode("pending");
    }} />;
  }

  return <StartupSplash message="Starting" />;
}

function StartupSplash({ message }: { message: string }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050508]">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div
          className="absolute animate-orb-drift animate-orb-fade"
          style={{
            top: "-15%",
            left: "-10%",
            width: "65vw",
            height: "65vw",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(139,92,246,0.35) 0%, rgba(139,92,246,0.08) 60%, transparent 80%)",
            filter: "blur(60px)",
          }}
        />
        <div
          className="absolute animate-orb-drift-2 animate-orb-fade"
          style={{
            top: "5%",
            right: "-15%",
            width: "55vw",
            height: "55vw",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(99,102,241,0.28) 0%, rgba(99,102,241,0.06) 60%, transparent 80%)",
            filter: "blur(70px)",
            animationDelay: "-6s, -2s",
          }}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {SPLASH_PARTICLES.map((p) => (
          <div
            key={p.id}
            className="particle"
            style={{
              left: `${p.x}%`,
              bottom: "-6px",
              width: `${p.size}px`,
              height: `${p.size}px`,
              background: p.color,
              boxShadow: `0 0 ${p.size * 2}px ${p.color}`,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
              ["--tx" as string]: `${p.tx}px`,
            }}
          />
        ))}
      </div>

      <div
        className="pointer-events-none absolute inset-0 z-20"
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(0,0,0,0.62) 100%), linear-gradient(to bottom, rgba(0,0,0,0.52) 0%, transparent 20%, transparent 80%, rgba(0,0,0,0.82) 100%)",
        }}
        aria-hidden
      />

      <div className="relative z-30 flex flex-col items-center px-6 text-center animate-entrance-fade">
        <p
          className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.6em] animate-entrance"
          style={{
            color: "rgba(192,132,252,0.7)",
            animationDelay: "0.1s",
          }}
        >
          {"Party Edition"}
        </p>

        <h1
          className="mt-3 text-7xl font-black tracking-tighter leading-none animate-title select-none"
          style={{
            backgroundImage:
              "linear-gradient(135deg, #e8d5ff 0%, #a78bfa 20%, #f5f3ff 40%, #818cf8 60%, #c4b5fd 80%, #f0f9ff 100%)",
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            filter: "drop-shadow(0 0 40px rgba(139,92,246,0.5)) drop-shadow(0 0 80px rgba(139,92,246,0.2))",
            backgroundSize: "200% auto",
          }}
        >
          FAP LAND
        </h1>

        <div
          className="mt-4 animate-entrance"
          style={{
            width: "120px",
            height: "2px",
            background: "linear-gradient(to right, transparent, rgba(139,92,246,0.8), rgba(99,102,241,0.6), transparent)",
            animationDelay: "0.3s",
          }}
        />

        <div className="mt-8 flex items-center gap-2 animate-entrance" style={{ animationDelay: "0.5s" }}>
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-violet-300" />
          </span>
          <span className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.25em] text-violet-200/60">
            {message}
          </span>
        </div>
      </div>
    </div>
  );
}

function StartupError({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050508]">
      <div className="relative z-30 flex flex-col items-center px-6 text-center max-w-lg">
        <div className="mb-6 text-6xl">&#x26A0;&#xFE0F;</div>
        <h1 className="mb-3 text-2xl font-extrabold tracking-tight text-red-100">
          Startup failed
        </h1>
        <p className="mb-2 text-sm text-zinc-400">
          The app could not initialize. You can retry or open recovery mode.
        </p>
        {error && (
          <p className="mb-6 max-h-24 overflow-auto rounded-lg border border-red-500/30 bg-red-500/10 p-3 font-mono text-xs text-red-300">
            {error}
          </p>
        )}
        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="rounded-xl border border-violet-300/60 bg-violet-500/30 px-6 py-2.5 text-sm font-semibold text-violet-100 transition-all duration-200 hover:border-violet-200/80 hover:bg-violet-500/45"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-xl border border-zinc-600 bg-zinc-800/80 px-6 py-2.5 text-sm font-semibold text-zinc-300 transition-all duration-200 hover:border-zinc-500 hover:bg-zinc-700/80"
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}

const SPLASH_PARTICLES = (() => {
  const colors = [
    "rgba(139,92,246,0.7)",
    "rgba(99,102,241,0.6)",
    "rgba(167,139,250,0.5)",
    "rgba(236,72,153,0.4)",
    "rgba(255,255,255,0.3)",
  ];
  return Array.from({ length: 8 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    size: 2 + Math.random() * 4,
    duration: 8 + Math.random() * 14,
    delay: Math.random() * 12,
    tx: (Math.random() - 0.5) * 120,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
})();
