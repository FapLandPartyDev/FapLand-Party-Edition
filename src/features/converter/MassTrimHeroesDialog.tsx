import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { converter } from "../../services/converter";
import { playHoverSound, playSelectSound } from "../../utils/audio";
import { DEFAULT_TRIM_ALLOWANCE_MS } from "./types";

export type MassTrimHeroOption = {
  id: string;
  name: string;
  author: string | null;
  roundCount: number;
};

type MassTrimHeroesDialogProps = {
  open: boolean;
  heroes: MassTrimHeroOption[];
  onClose: () => void;
  onCompleted: () => void;
};

type MassTrimResult = Awaited<ReturnType<typeof converter.massTrimHeroes>>;

export function MassTrimHeroesDialog({
  open,
  heroes,
  onClose,
  onCompleted,
}: MassTrimHeroesDialogProps) {
  const { t } = useLingui();
  const [selectedHeroIds, setSelectedHeroIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [allowanceDraft, setAllowanceDraft] = useState(`${DEFAULT_TRIM_ALLOWANCE_MS}`);
  const [isTrimming, setIsTrimming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MassTrimResult | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isTrimming) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isTrimming, onClose, open]);

  const filteredHeroes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return heroes;
    return heroes.filter((hero) =>
      [hero.name, hero.author ?? ""].join(" ").toLowerCase().includes(query)
    );
  }, [heroes, searchQuery]);

  const selectedIdSet = useMemo(() => new Set(selectedHeroIds), [selectedHeroIds]);
  const selectedSectionCount = heroes.reduce(
    (total, hero) => total + (selectedIdSet.has(hero.id) ? hero.roundCount : 0),
    0
  );
  const allowanceMs = Number(allowanceDraft.trim());
  const hasValidAllowance =
    Number.isFinite(allowanceMs) && allowanceMs >= 0 && Number.isInteger(allowanceMs);

  if (!open) return null;

  const toggleHero = (heroId: string) => {
    setSelectedHeroIds((current) =>
      current.includes(heroId)
        ? current.filter((candidate) => candidate !== heroId)
        : [...current, heroId]
    );
    setResult(null);
    setError(null);
  };

  const runMassTrim = async () => {
    if (selectedHeroIds.length === 0) {
      setError(t`Select at least one hero.`);
      return;
    }
    if (!hasValidAllowance) {
      setError(t`Enter a valid non-negative allowance in milliseconds.`);
      return;
    }

    playSelectSound();
    setIsTrimming(true);
    setError(null);
    setResult(null);
    try {
      const nextResult = await converter.massTrimHeroes({
        heroIds: selectedHeroIds,
        allowanceMs,
      });
      setResult(nextResult);
      onCompleted();
    } catch (trimError) {
      setError(trimError instanceof Error ? trimError.message : t`Mass trim failed.`);
    } finally {
      setIsTrimming(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[190] flex items-center justify-center overflow-hidden bg-black/80 p-2 backdrop-blur-md sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mass-trim-heroes-title"
    >
      <div className="flex max-h-[calc(100dvh-1rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-violet-300/35 bg-zinc-950 shadow-2xl shadow-violet-950/50 sm:max-h-[calc(100dvh-2rem)]">
        <header className="shrink-0 border-b border-zinc-700/70 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="mass-trim-heroes-title" className="text-xl font-black text-violet-100">
                <Trans>Mass Trim Heroes</Trans>
              </h2>
              <p className="mt-1 text-sm text-zinc-400">
                <Trans>
                  Select existing heroes and trim every section to its first and last moving
                  funscript action.
                </Trans>
              </p>
            </div>
            <button
              type="button"
              disabled={isTrimming}
              aria-label={t`Close mass trim`}
              onClick={onClose}
              className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-white disabled:opacity-50"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <label className="text-xs font-medium text-zinc-300">
              <Trans>Find heroes</Trans>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t`Search heroes...`}
                className="mt-1 w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-400"
              />
            </label>
            <label className="text-xs font-medium text-zinc-300">
              <Trans>Allowance (ms)</Trans>
              <input
                type="number"
                min={0}
                step={1}
                value={allowanceDraft}
                onChange={(event) => {
                  setAllowanceDraft(event.target.value);
                  setResult(null);
                  setError(null);
                }}
                className="mt-1 w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-400"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-zinc-400">
              {t`${selectedHeroIds.length} heroes selected · ${selectedSectionCount} sections`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setSelectedHeroIds(filteredHeroes.map((hero) => hero.id));
                  setResult(null);
                }}
                className="text-xs font-semibold text-violet-300 hover:text-violet-100"
              >
                <Trans>Select visible</Trans>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedHeroIds([]);
                  setResult(null);
                }}
                className="text-xs font-semibold text-zinc-400 hover:text-zinc-200"
              >
                <Trans>Clear</Trans>
              </button>
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto rounded-xl border border-zinc-700/80 bg-black/25">
            {filteredHeroes.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-zinc-500">
                <Trans>No heroes match this search.</Trans>
              </p>
            ) : (
              filteredHeroes.map((hero) => (
                <label
                  key={hero.id}
                  className="flex cursor-pointer items-center gap-3 border-b border-zinc-800 px-4 py-3 last:border-b-0 hover:bg-violet-500/10"
                >
                  <input
                    type="checkbox"
                    checked={selectedIdSet.has(hero.id)}
                    onChange={() => toggleHero(hero.id)}
                    className="size-4 accent-violet-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-zinc-100">
                      {hero.name}
                    </span>
                    {hero.author ? (
                      <span className="block truncate text-xs text-zinc-500">{hero.author}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300">
                    {t`${hero.roundCount} sections`}
                  </span>
                </label>
              ))
            )}
          </div>

          <p className="rounded-xl border border-amber-300/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/80">
            <Trans>
              Sections without a usable funscript or time range will be skipped. Existing section
              IDs and hero assignments are preserved.
            </Trans>
          </p>

          {error ? (
            <p className="rounded-xl border border-rose-300/35 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
              {error}
            </p>
          ) : null}
          {result ? (
            <p className="rounded-xl border border-emerald-300/35 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
              {t`Trimmed ${result.trimmedSectionCount} sections. ${result.unchangedSectionCount} were already trimmed and ${result.skippedSectionCount} were skipped.`}
            </p>
          ) : null}
        </div>

        <footer className="flex shrink-0 justify-end gap-3 border-t border-zinc-700/70 px-5 py-4">
          <button
            type="button"
            disabled={isTrimming}
            onMouseEnter={playHoverSound}
            onClick={onClose}
            className="rounded-xl border border-zinc-600 px-4 py-2 text-sm font-semibold text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            <Trans>Close</Trans>
          </button>
          <button
            type="button"
            disabled={isTrimming || selectedHeroIds.length === 0 || !hasValidAllowance}
            onMouseEnter={playHoverSound}
            onClick={() => void runMassTrim()}
            className="rounded-xl border border-violet-300/60 bg-violet-500/30 px-4 py-2 text-sm font-semibold text-violet-100 hover:bg-violet-500/45 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500"
          >
            {isTrimming ? <Trans>Trimming...</Trans> : <Trans>Trim Selected Heroes</Trans>}
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );
}
