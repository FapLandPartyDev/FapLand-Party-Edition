import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  listActiveBans,
  listMatchHistory,
  unbanPlayer,
  type MultiplayerBanRecord,
  type MultiplayerMatchHistory,
} from "../services/multiplayer";

export const Route = createFileRoute("/multiplayer-bans")({
  loader: async () => {
    const [bans, history] = await Promise.all([
      listActiveBans(),
      listMatchHistory(),
    ]);

    return {
      bans,
      history,
    };
  },
  component: MultiplayerBansRoute,
});

function MultiplayerBansRoute() {
  const navigate = useNavigate();
  const { bans, history } = Route.useLoaderData();

  const [banList, setBanList] = useState<MultiplayerBanRecord[]>(bans);
  const [historyList, setHistoryList] = useState<MultiplayerMatchHistory[]>(history);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const [nextBans, nextHistory] = await Promise.all([
      listActiveBans(),
      listMatchHistory(),
    ]);
    setBanList(nextBans);
    setHistoryList(nextHistory);
  };

  return (
    <div className="min-h-screen bg-zinc-950 px-6 py-8 text-zinc-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Host Ban List</h1>
            <p className="text-sm text-zinc-400">Bans apply to your hosted lobbies by user ID or hardware ID.</p>
          </div>
          <button
            type="button"
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm hover:border-zinc-500"
            onClick={() => {
              void navigate({ to: "/multiplayer" });
            }}
          >
            Back
          </button>
        </header>

        {error && <div className="rounded border border-rose-500/60 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</div>}

        <section className="rounded border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="text-lg font-semibold">Active Bans</h2>
          <div className="mt-3 space-y-2">
            {banList.length === 0 && (
              <div className="rounded border border-zinc-800 bg-zinc-950/70 p-3 text-sm text-zinc-500">No active bans.</div>
            )}
            {banList.map((ban) => (
              <div key={ban.id} className="rounded border border-zinc-800 bg-zinc-950/70 p-3 text-sm">
                <div className="font-semibold">Ban {ban.id.slice(0, 8)}</div>
                <div className="mt-1 text-xs text-zinc-400">
                  User: {ban.bannedUserId ?? "-"}
                </div>
                <div className="text-xs text-zinc-400">
                  Hardware: {ban.bannedMachineIdHash ?? "-"}
                </div>
                {ban.reason && <div className="text-xs text-zinc-400">Reason: {ban.reason}</div>}
                <button
                  type="button"
                  className="mt-2 rounded border border-emerald-500/60 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-100"
                  onClick={() => {
                    void (async () => {
                      try {
                        await unbanPlayer(ban.id);
                        await refresh();
                      } catch (unbanError) {
                        setError(unbanError instanceof Error ? unbanError.message : "Failed to unban player.");
                      }
                    })();
                  }}
                >
                  Unban
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="text-lg font-semibold">Match History (Participant Visibility)</h2>
          <div className="mt-3 space-y-2">
            {historyList.length === 0 && (
              <div className="rounded border border-zinc-800 bg-zinc-950/70 p-3 text-sm text-zinc-500">No match history visible.</div>
            )}
            {historyList.map((item) => (
              <div key={item.id} className="rounded border border-zinc-800 bg-zinc-950/70 p-3 text-sm">
                <div className="font-semibold">Lobby {item.lobbyId.slice(0, 8)}</div>
                <div className="text-xs text-zinc-400">Finished: {new Date(item.finishedAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
