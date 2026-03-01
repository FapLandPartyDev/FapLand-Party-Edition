import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useCallback, useEffect } from "react";
import { useHandy } from "../contexts/HandyContext";
import { MenuButton } from "../components/MenuButton";
import { useMenuNavigation } from "../hooks/useMenuNavigation";
import { AnimatedBackground } from "../components/AnimatedBackground";

export const Route = createFileRoute("/connect")({
  component: ConnectHandy,
});

function ConnectHandy() {
  const { connectionKey, appApiKey, localIp, connected, synced, syncError, isConnecting, error, connect, disconnect } = useHandy();
  const navigate = useNavigate();
  const handyUserPortalUrl = "https://user.handyfeeling.com";

  const [inputKey, setInputKey] = useState(connectionKey);
  const [inputApiKey, setInputApiKey] = useState(appApiKey);
  const [inputIp, setInputIp] = useState(localIp);

  // Sync state if context changes
  useEffect(() => {
    queueMicrotask(() => {
      setInputKey(connectionKey);
      setInputApiKey(appApiKey);
      setInputIp(localIp);
    });
  }, [appApiKey, connectionKey, localIp]);

  const handleConnect = useCallback(async () => {
    if (connected) {
      await disconnect();
      return;
    }
    await connect(inputKey, inputIp, inputApiKey);
  }, [connected, disconnect, connect, inputApiKey, inputKey, inputIp]);

  const handleBack = useCallback(() => {
    navigate({ to: "/" });
  }, [navigate]);

  const options = [
    { id: "connect", label: connected ? "Disconnect" : (isConnecting ? "Connecting..." : "Connect"), primary: true, action: handleConnect },
    { id: "back", label: "Back to Menu", action: handleBack },
  ];

  const { selectedIndex, handleMouseEnter, handleClick } = useMenuNavigation(options);

  return (
    <div className="relative min-h-screen overflow-hidden font-[family-name:var(--font-inter-sans)] selection:bg-purple-500/30">
      <AnimatedBackground />

      <div className="relative z-10 h-screen overflow-y-auto px-4 py-6 sm:px-6 sm:py-8">
        <main className="parallax-ui-none mx-auto flex w-full max-w-4xl flex-col items-center text-center">

          <div className="mb-8 cursor-default sm:mb-12">
            <h1 className="text-4xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-white via-zinc-200 to-zinc-500 drop-shadow-2xl tracking-tighter mix-blend-plus-lighter">
              Hardware Setup
            </h1>
            <p className="text-zinc-400 mt-4 tracking-widest uppercase font-[family-name:var(--font-jetbrains-mono)] text-sm">
              Status: {connected ? <span className="text-emerald-400 font-bold animate-pulse">Connected</span> : <span className="text-red-400 font-bold">Disconnected</span>}
            </p>
            <p className="text-zinc-400 mt-2 tracking-widest uppercase font-[family-name:var(--font-jetbrains-mono)] text-xs">
              Sync: {synced ? <span className="text-cyan-300 font-bold">Synced</span> : <span className="text-zinc-500 font-bold">Not synced</span>}
            </p>
          </div>

          <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-zinc-700/50 bg-zinc-900/60 p-5 backdrop-blur-xl shadow-2xl mb-8 sm:gap-6 sm:p-8 sm:mb-10">

            <div className="flex flex-col gap-2 text-left">
              <label className="text-zinc-300 text-sm font-bold uppercase tracking-wider font-[family-name:var(--font-jetbrains-mono)] ml-2" htmlFor="connection-key-input">Connection Key / Channel Ref</label>
              <input
                id="connection-key-input"
                type="text"
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                placeholder="Device connection key"
                disabled={connected || isConnecting}
                className="bg-zinc-950 text-white rounded-xl px-4 py-3 border border-zinc-700 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition-all disabled:opacity-50"
              />
            </div>

            <div className="flex flex-col gap-2 text-left">
              <label className="text-zinc-300 text-sm font-bold uppercase tracking-wider font-[family-name:var(--font-jetbrains-mono)] ml-2" htmlFor="api-key-input">API Key</label>
              <input
                id="api-key-input"
                type="password"
                value={inputApiKey}
                onChange={(e) => setInputApiKey(e.target.value)}
                placeholder="Your TheHandy Application ID or Key"
                disabled={connected || isConnecting}
                className="bg-zinc-950 text-white rounded-xl px-4 py-3 border border-zinc-700 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition-all disabled:opacity-50"
              />
              <p className="text-zinc-500 text-xs ml-2 mt-1">Used for v3 auth. Client token is attempted first, with Application ID fallback.</p>
              <a
                href={handyUserPortalUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center justify-center rounded-xl border border-cyan-400/40 bg-cyan-500/10 px-4 py-3 text-center text-sm font-bold uppercase tracking-[0.18em] text-cyan-200 transition-colors hover:border-cyan-300 hover:bg-cyan-400/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/70"
              >
                Get API Key at HandyFeeling
              </a>
              <p className="text-zinc-500 text-xs ml-2">Need credentials? Create your account there, then issue an Application ID or API key for this app.</p>
            </div>

            <div className="flex flex-col gap-2 text-left">
              <label className="text-zinc-300 text-sm font-bold uppercase tracking-wider font-[family-name:var(--font-jetbrains-mono)] ml-2" htmlFor="local-ip-input">Local IP (Optional)</label>
              <input
                id="local-ip-input"
                type="text"
                value={inputIp}
                onChange={(e) => setInputIp(e.target.value)}
                placeholder="192.168.1.100"
                disabled={connected || isConnecting}
                className="bg-zinc-950 text-white rounded-xl px-4 py-3 border border-zinc-700 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition-all disabled:opacity-50"
              />
              <p className="text-zinc-500 text-xs ml-2 mt-1">Improves latency by skipping cloud relay.</p>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm font-[family-name:var(--font-jetbrains-mono)]">
                {error}
              </div>
            )}
            {syncError && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-amber-300 text-sm font-[family-name:var(--font-jetbrains-mono)]">
                {syncError}
              </div>
            )}

          </div>

          {/* Menu Options */}
          <div className="flex flex-col gap-2 w-full max-w-md pb-4">
            {options.map((opt, index) => (
              <MenuButton
                key={opt.id}
                label={opt.label}
                primary={opt.primary}
                selected={selectedIndex === index}
                onHover={() => handleMouseEnter(index)}
                onClick={() => handleClick(index)}
              />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
