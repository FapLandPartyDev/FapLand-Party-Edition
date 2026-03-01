import React, { useEffect, useMemo, useState } from "react";
import { Trans, useLingui } from "@lingui/react/macro";
import { db, type InstalledRound } from "../../services/db";
import { trpc } from "../../services/trpc";
import { playHoverSound, playSelectSound } from "../../utils/audio";
import {
  DEFAULT_INSTALL_WEB_FUNSCRIPT_URL_ENABLED,
  INSTALL_WEB_FUNSCRIPT_URL_ENABLED_KEY,
  normalizeInstallWebFunscriptUrlEnabled,
} from "../../constants/experimentalFeatures";
import { ConverterSelectionCard } from "./ConverterSelectionCard";
import {
  getRoundVideoDurationMs,
  MAXIMUM_VIDEO_LENGTH_FILTER_MINUTES,
  meetsMinimumVideoLength,
} from "./sourceFilter";
import { MassTrimHeroesDialog } from "./MassTrimHeroesDialog";

type SourceSection = "round" | "hero" | "file" | "url";

type HeroSummary = {
  id: string;
  name: string;
  author: string | null;
  description: string | null;
  roundCount: number;
  totalDurationMs: number;
};

type ConverterSourcePickerProps = {
  section: SourceSection;
  localFunscriptUri: string | null;
  onSelectRound: (roundId: string) => void;
  onSelectHero: (heroId: string) => void;
  onSelectLocalVideo: () => void;
  onSelectLocalFunscript: () => void;
  onSelectWebsiteSource: (videoUri: string, funscriptUri: string | null) => void;
  onSearchEroScripts?: () => void;
  minimumVideoLengthMinutes: number;
  onMinimumVideoLengthChange: (minutes: number) => void;
};

function ConverterSourcePickerSkeleton({
  section,
}: {
  section: Extract<SourceSection, "round" | "hero">;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      aria-label={section === "round" ? "Loading rounds" : "Loading heroes"}
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={`converter-source-skeleton:${section}:${index}`}
          className="rounded-2xl border border-purple-400/25 bg-zinc-950/55 p-4 backdrop-blur-xl"
          aria-hidden="true"
        >
          {section === "round" ? (
            <div className="-m-4 mb-4 aspect-video animate-pulse rounded-t-2xl border-b border-purple-400/20 bg-zinc-800/70" />
          ) : null}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-5 w-3/4 animate-pulse rounded bg-violet-300/15" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-300/10" />
            </div>
            {section === "round" ? (
              <div className="h-5 w-16 animate-pulse rounded-full bg-violet-300/15" />
            ) : null}
          </div>
          <div className="mt-4 space-y-2">
            <div className="h-3 w-full animate-pulse rounded bg-zinc-300/10" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-zinc-300/10" />
          </div>
          <div className="mt-5 flex gap-2">
            <div className="h-5 w-16 animate-pulse rounded-md bg-zinc-300/10" />
            <div className="h-5 w-20 animate-pulse rounded-md bg-zinc-300/10" />
          </div>
        </div>
      ))}
    </div>
  );
}

function normalizeHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function getUriFilename(uri: string): string {
  try {
    const parsed = new URL(uri);
    const decodedPath = decodeURIComponent(parsed.pathname);
    const filename = decodedPath.split(/[/\\]/).filter(Boolean).pop();
    return filename ?? uri;
  } catch {
    return uri.split(/[/\\]/).pop() ?? uri;
  }
}

export const ConverterSourcePicker: React.FC<ConverterSourcePickerProps> = React.memo(
  ({
    section,
    localFunscriptUri,
    onSelectRound,
    onSelectHero,
    onSelectLocalVideo,
    onSelectLocalFunscript,
    onSelectWebsiteSource,
    onSearchEroScripts,
    minimumVideoLengthMinutes,
    onMinimumVideoLengthChange,
  }) => {
    const { t } = useLingui();
    const [rounds, setRounds] = useState<InstalledRound[]>([]);
    const [heroes, setHeroes] = useState<HeroSummary[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [websiteVideoUrl, setWebsiteVideoUrl] = useState("");
    const [websiteFunscriptUrl, setWebsiteFunscriptUrl] = useState("");
    const [websiteFunscriptFileUri, setWebsiteFunscriptFileUri] = useState<string | null>(null);
    const [websiteFunscriptFileLabel, setWebsiteFunscriptFileLabel] = useState<string | null>(null);
    const [websitePickerError, setWebsitePickerError] = useState<string | null>(null);
    const [installWebFunscriptUrlEnabled, setInstallWebFunscriptUrlEnabled] = useState(
      DEFAULT_INSTALL_WEB_FUNSCRIPT_URL_ENABLED
    );
    const [massTrimOpen, setMassTrimOpen] = useState(false);
    const [dataVersion, setDataVersion] = useState(0);

    useEffect(() => {
      let mounted = true;

      const loadData = async () => {
        setIsLoading(true);
        try {
          const [allRounds, allHeroes, rawInstallWebFunscriptUrlEnabled] = await Promise.all([
            db.round.findInstalled(true),
            db.hero.findMany(),
            trpc.store.get.query({ key: INSTALL_WEB_FUNSCRIPT_URL_ENABLED_KEY }),
          ]);

          if (!mounted) return;

          setInstallWebFunscriptUrlEnabled(
            normalizeInstallWebFunscriptUrlEnabled(rawInstallWebFunscriptUrlEnabled)
          );

          const standaloneRounds = allRounds.filter(
            (round) => !round.heroId && round.resources.length > 0
          );
          setRounds(standaloneRounds);

          const heroSummaries: HeroSummary[] = allHeroes
            .map((hero) => {
              const heroRounds = allRounds.filter(
                (round) => round.heroId === hero.id && round.resources.length > 0
              );
              const totalDurationMs = heroRounds.reduce(
                (sum, round) => sum + (round.endTime ?? 0) - (round.startTime ?? 0),
                0
              );
              return {
                id: hero.id,
                name: hero.name,
                author: hero.author ?? null,
                description: hero.description ?? null,
                roundCount: heroRounds.length,
                totalDurationMs,
              };
            })
            .filter((hero) => hero.roundCount > 0)
            .sort((a, b) => a.name.localeCompare(b.name));

          setHeroes(heroSummaries);
        } catch (error) {
          console.error("Failed to load converter source data", error);
        } finally {
          if (mounted) setIsLoading(false);
        }
      };

      void loadData();

      return () => {
        mounted = false;
      };
    }, [dataVersion]);

    const filteredRounds = useMemo(() => {
      const query = searchQuery.trim().toLowerCase();

      return rounds.filter((round) => {
        const searchText = [round.name, round.author ?? "", round.description ?? ""]
          .join(" ")
          .toLowerCase();
        return (
          (!query || searchText.includes(query)) &&
          meetsMinimumVideoLength(getRoundVideoDurationMs(round), minimumVideoLengthMinutes)
        );
      });
    }, [minimumVideoLengthMinutes, rounds, searchQuery]);

    const filteredHeroes = useMemo(() => {
      const query = searchQuery.trim().toLowerCase();
      if (!query) return heroes;
      return heroes.filter((hero) => {
        const searchText = [hero.name, hero.author ?? "", hero.description ?? ""]
          .join(" ")
          .toLowerCase();
        return searchText.includes(query);
      });
    }, [heroes, searchQuery]);

    if (section === "file") {
      return (
        <div className="space-y-4">
          <div className="rounded-2xl border border-purple-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
            <h3 className="text-lg font-bold text-violet-100">
              <Trans>Local Video File</Trans>
            </h3>
            <p className="mt-1 text-sm text-zinc-400">
              <Trans>Select a video file from your computer to convert into rounds.</Trans>
            </p>
            <button
              type="button"
              onMouseEnter={playHoverSound}
              onClick={() => {
                playSelectSound();
                onSelectLocalVideo();
              }}
              className="mt-4 rounded-xl border border-violet-300/60 bg-violet-500/30 px-5 py-3 text-sm font-semibold text-violet-100 transition-all duration-200 hover:border-violet-200/80 hover:bg-violet-500/45"
            >
              <Trans>Select Video File</Trans>
            </button>
          </div>

          <div className="rounded-2xl border border-cyan-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
            <h3 className="text-lg font-bold text-cyan-100">
              <Trans>Attach Funscript (Optional)</Trans>
            </h3>
            <p className="mt-1 text-sm text-zinc-400">
              <Trans>Attach a funscript file for auto-detection of round boundaries.</Trans>
            </p>
            <button
              type="button"
              onMouseEnter={playHoverSound}
              onClick={() => {
                playSelectSound();
                onSelectLocalFunscript();
              }}
              className="mt-4 rounded-xl border border-cyan-300/60 bg-cyan-500/30 px-5 py-3 text-sm font-semibold text-cyan-100 transition-all duration-200 hover:border-cyan-200/80 hover:bg-cyan-500/45"
            >
              {localFunscriptUri ? (
                <Trans>Replace Funscript</Trans>
              ) : (
                <Trans>Select Funscript File</Trans>
              )}
            </button>
            {localFunscriptUri ? (
              <div className="mt-3 rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                {t`Local funscript attached: ${getUriFilename(localFunscriptUri)}`}
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    if (section === "url") {
      return (
        <div className="space-y-4">
          <div className="rounded-2xl border border-violet-400/25 bg-zinc-950/55 p-5 backdrop-blur-xl">
            <h3 className="text-lg font-bold text-violet-100">
              <Trans>Website Video URL</Trans>
            </h3>
            <p className="mt-1 text-sm text-zinc-400">
              <Trans>
                Paste a supported website video URL and jump straight into the converter. The app
                will cache the video first, then you can start editing.
              </Trans>
            </p>

            <div className="mt-4 space-y-3">
              <label className="block" htmlFor="converter-website-video-url">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                  <Trans>Video URL</Trans>
                </span>
                <input
                  id="converter-website-video-url"
                  type="url"
                  aria-label={t`Video URL`}
                  value={websiteVideoUrl}
                  onChange={(event) => {
                    setWebsiteVideoUrl(event.target.value);
                    setWebsitePickerError(null);
                  }}
                  placeholder="https://www.pornhub.com/view_video.php?viewkey=..."
                  className="w-full rounded-xl border border-violet-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-violet-200/75"
                />
              </label>

              {installWebFunscriptUrlEnabled && (
                <label className="block" htmlFor="converter-website-funscript-url">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">
                    <Trans>Funscript URL</Trans>
                  </span>
                  <input
                    id="converter-website-funscript-url"
                    type="url"
                    aria-label={t`Funscript URL`}
                    value={websiteFunscriptUrl}
                    onChange={(event) => {
                      setWebsiteFunscriptUrl(event.target.value);
                      setWebsiteFunscriptFileUri(null);
                      setWebsiteFunscriptFileLabel(null);
                      setWebsitePickerError(null);
                    }}
                    placeholder={t`Optional: https://example.com/video.funscript`}
                    className="w-full rounded-xl border border-cyan-300/30 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition-colors focus:border-cyan-200/75"
                  />
                </label>
              )}
            </div>

            {websitePickerError ? (
              <div className="mt-3 rounded-xl border border-rose-300/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {websitePickerError}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  void window.electronAPI.dialog.selectConverterFunscriptFile().then((filePath) => {
                    if (!filePath) return;
                    const converted = window.electronAPI.file.convertFileSrc(filePath);
                    setWebsiteFunscriptFileUri(converted);
                    setWebsiteFunscriptFileLabel(filePath.split(/[/\\]/).pop() ?? filePath);
                    setWebsiteFunscriptUrl("");
                    setWebsitePickerError(null);
                  });
                }}
                className="rounded-xl border border-cyan-300/60 bg-cyan-500/25 px-5 py-3 text-sm font-semibold text-cyan-100 transition-all duration-200 hover:border-cyan-200/80 hover:bg-cyan-500/40"
              >
                <Trans>Select Local Funscript</Trans>
              </button>
              {onSearchEroScripts ? (
                <button
                  type="button"
                  onMouseEnter={playHoverSound}
                  onClick={() => {
                    playSelectSound();
                    onSearchEroScripts();
                  }}
                  className="rounded-xl border border-emerald-300/60 bg-emerald-500/25 px-5 py-3 text-sm font-semibold text-emerald-100 transition-all duration-200 hover:border-emerald-200/80 hover:bg-emerald-500/40"
                >
                  <Trans>Search EroScripts</Trans>
                </button>
              ) : null}
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  const normalizedVideoUrl = normalizeHttpUrl(websiteVideoUrl);
                  if (!normalizedVideoUrl) {
                    setWebsitePickerError(t`Enter a valid http(s) video URL.`);
                    return;
                  }

                  const trimmedFunscriptUrl = websiteFunscriptUrl.trim();
                  const normalizedFunscriptUrl =
                    trimmedFunscriptUrl.length > 0 ? normalizeHttpUrl(trimmedFunscriptUrl) : null;
                  if (trimmedFunscriptUrl.length > 0 && !normalizedFunscriptUrl) {
                    setWebsitePickerError(t`Funscript URL must also be a valid http(s) URL.`);
                    return;
                  }

                  setWebsitePickerError(null);
                  onSelectWebsiteSource(
                    normalizedVideoUrl,
                    websiteFunscriptFileUri ?? normalizedFunscriptUrl
                  );
                }}
                className="rounded-xl border border-violet-300/60 bg-violet-500/30 px-5 py-3 text-sm font-semibold text-violet-100 transition-all duration-200 hover:border-violet-200/80 hover:bg-violet-500/45"
              >
                <Trans>Use Website Source</Trans>
              </button>
            </div>

            {websiteFunscriptFileLabel ? (
              <div className="mt-3 rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                {t`Local funscript attached: ${websiteFunscriptFileLabel}`}
              </div>
            ) : null}

            <div className="mt-4 rounded-xl border border-zinc-700/70 bg-black/30 px-4 py-3 text-xs text-zinc-400">
              <Trans>
                Supported in practice through yt-dlp-backed playback. Paste sites like Pornhub,
                XVideos, or xHamster here, then add segments the same way as any other source.
              </Trans>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div
          className={`grid gap-3 rounded-2xl border border-purple-400/20 bg-black/30 p-3 ${
            section === "round"
              ? "sm:grid-cols-[minmax(0,1fr)_16rem]"
              : "sm:grid-cols-[minmax(0,1fr)_auto]"
          }`}
        >
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t`Search ${section === "round" ? "rounds" : "heroes"}...`}
            className="w-full rounded-xl border border-zinc-700/80 bg-black/40 px-4 py-2 text-sm text-zinc-100 outline-none transition-colors focus:border-violet-400/60 focus:ring-2 focus:ring-violet-400/20"
          />
          {section === "round" ? (
            <div className="rounded-xl border border-zinc-700/80 bg-black/40 px-3 py-2">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <label
                  htmlFor="converter-minimum-video-length"
                  className="font-medium text-zinc-400"
                >
                  <Trans>Minimum length</Trans>
                </label>
                <span className="tabular-nums text-violet-200">
                  {minimumVideoLengthMinutes > 0 ? (
                    t`${minimumVideoLengthMinutes} min`
                  ) : (
                    <Trans>Any length</Trans>
                  )}
                </span>
              </div>
              <input
                id="converter-minimum-video-length"
                aria-label={t`Minimum video length in minutes`}
                type="range"
                min="0"
                max={MAXIMUM_VIDEO_LENGTH_FILTER_MINUTES}
                step="1"
                value={minimumVideoLengthMinutes}
                onChange={(event) => onMinimumVideoLengthChange(event.currentTarget.valueAsNumber)}
                className="h-2 w-full cursor-pointer accent-violet-500"
              />
            </div>
          ) : (
            <button
              type="button"
              onMouseEnter={playHoverSound}
              onClick={() => {
                playSelectSound();
                setMassTrimOpen(true);
              }}
              disabled={heroes.length === 0}
              className="rounded-xl border border-amber-300/60 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-100 hover:bg-amber-500/35 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              <Trans>Mass Trim Heroes</Trans>
            </button>
          )}
        </div>

        {isLoading ? (
          <ConverterSourcePickerSkeleton section={section} />
        ) : section === "round" ? (
          filteredRounds.length === 0 ? (
            <div className="rounded-2xl border border-zinc-700/50 bg-black/20 p-8 text-center">
              <p className="text-sm text-zinc-400">
                {searchQuery.trim() || minimumVideoLengthMinutes > 0
                  ? t`No rounds match your filters.`
                  : t`No standalone rounds available. Install some rounds first.`}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredRounds.map((round) => {
                const resource = round.resources[0];
                const durationMs = getRoundVideoDurationMs(round);
                return (
                  <ConverterSelectionCard
                    key={round.id}
                    kind="round"
                    name={round.name}
                    author={round.author}
                    description={round.description}
                    type={round.type}
                    bpm={round.bpm}
                    durationMs={durationMs}
                    hasFunscript={Boolean(resource?.funscriptUri)}
                    previewImage={round.previewImage}
                    previewVideoUri={resource?.videoUri ?? null}
                    previewStartTimeMs={round.startTime}
                    previewEndTimeMs={round.endTime}
                    onClick={() => onSelectRound(round.id)}
                  />
                );
              })}
            </div>
          )
        ) : filteredHeroes.length === 0 ? (
          <div className="rounded-2xl border border-zinc-700/50 bg-black/20 p-8 text-center">
            <p className="text-sm text-zinc-400">
              {searchQuery.trim()
                ? t`No heroes match your search.`
                : t`No heroes with rounds available. Create a hero first.`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredHeroes.map((hero) => (
              <ConverterSelectionCard
                key={hero.id}
                kind="hero"
                name={hero.name}
                author={hero.author}
                description={hero.description}
                roundCount={hero.roundCount}
                durationMs={hero.totalDurationMs}
                onClick={() => onSelectHero(hero.id)}
              />
            ))}
          </div>
        )}
        {massTrimOpen ? (
          <MassTrimHeroesDialog
            open
            heroes={heroes}
            onClose={() => setMassTrimOpen(false)}
            onCompleted={() => setDataVersion((version) => version + 1)}
          />
        ) : null}
      </div>
    );
  }
);

ConverterSourcePicker.displayName = "ConverterSourcePicker";
