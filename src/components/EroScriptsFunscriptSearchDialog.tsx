import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  eroscripts,
  type EroScriptsFunscriptCandidate,
  type EroScriptsFunscriptDownloadResult,
  type EroScriptsLoginStatus,
  type EroScriptsSearchResult,
  type EroScriptsTopicMedia,
  type EroScriptsVideoCandidate,
} from "../services/eroscripts";
import { playHoverSound, playSelectSound } from "../utils/audio";
import { security } from "../services/security";

export type EroScriptsRoundInstallInput = {
  name: string;
  videoUri: string;
  funscriptUri: string | null;
  sourceUrl: string;
};

type EroScriptsFunscriptSearchDialogProps = {
  open: boolean;
  initialQuery: string;
  currentFunscriptUri?: string | null;
  onClose: () => void;
  onAttachFunscript?: (result: EroScriptsFunscriptDownloadResult) => Promise<void> | void;
  onInstallRound?: (input: EroScriptsRoundInstallInput) => Promise<void> | void;
};

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString();
}

function buildActionKey(kind: string, url: string): string {
  return `${kind}:${url}`;
}

function parseSearchTags(input: string): string[] {
  const seen = new Set<string>();
  return input
    .split(/[,\n]/u)
    .map((tag) => tag.trim().replace(/^#/u, "").replace(/\s+/gu, "-").toLowerCase())
    .filter((tag) => {
      if (!tag || seen.has(tag)) return false;
      seen.add(tag);
      return true;
    });
}

export function EroScriptsFunscriptSearchDialog({
  open,
  initialQuery,
  currentFunscriptUri,
  onClose,
  onAttachFunscript,
  onInstallRound,
}: EroScriptsFunscriptSearchDialogProps) {
  const { t } = useLingui();
  const [query, setQuery] = useState(initialQuery);
  const [tagInput, setTagInput] = useState("");
  const [results, setResults] = useState<EroScriptsSearchResult[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<EroScriptsSearchResult | null>(null);
  const [media, setMedia] = useState<EroScriptsTopicMedia | null>(null);
  const [selectedFunscript, setSelectedFunscript] =
    useState<EroScriptsFunscriptDownloadResult | null>(null);
  const [loginStatus, setLoginStatus] = useState<EroScriptsLoginStatus | null>(null);
  const [isLoadingLogin, setIsLoadingLogin] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingTopic, setIsLoadingTopic] = useState(false);
  const [isLogingInProgress, setIsLoggingInProgress] = useState(false);
  const [busyActionKey, setBusyActionKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshLoginStatus = useCallback(async () => {
    setIsLoadingLogin(true);
    try {
      const status = await eroscripts.getLoginStatus();
      setLoginStatus(status);
    } catch (loginError) {
      console.error("Failed to fetch EroScripts login status", loginError);
    } finally {
      setIsLoadingLogin(false);
    }
  }, []);

  const handleLogin = useCallback(async () => {
    playSelectSound();
    setIsLoggingInProgress(true);
    try {
      await eroscripts.openLoginWindow();
    } catch (loginError) {
      setError(toErrorMessage(loginError, t`Failed to open EroScripts login window.`));
    } finally {
      setIsLoggingInProgress(false);
    }
  }, [t]);

  const handleClearLogin = useCallback(async () => {
    playSelectSound();
    setIsLoadingLogin(true);
    try {
      const status = await eroscripts.clearLoginCookies();
      setLoginStatus(status);
      setMessage(t`Login cookies cleared.`);
    } catch (clearError) {
      setError(toErrorMessage(clearError, t`Failed to clear login cookies.`));
    } finally {
      setIsLoadingLogin(false);
    }
  }, [t]);

  const handleOpenInBrowser = useCallback(
    async (url: string) => {
      playSelectSound();
      try {
        await security.openExternal(url);
      } catch (openError) {
        setError(toErrorMessage(openError, t`Failed to open URL in browser.`));
      }
    },
    [t]
  );

  const performSearch = useCallback(
    async (searchQuery: string, tags: string[]) => {
      setIsSearching(true);
      setError(null);
      setMessage(null);
      setSelectedTopic(null);
      setMedia(null);
      try {
        const next = await eroscripts.search({
          query: searchQuery.trim() || undefined,
          tags,
          limit: 20,
        });
        setResults(next);
        if (next.length === 0) {
          setMessage(t`No EroScripts topics matched that search.`);
        }
      } catch (searchError) {
        setError(toErrorMessage(searchError, t`EroScripts search failed.`));
      } finally {
        setIsSearching(false);
      }
    },
    [t]
  );

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setTagInput("");
    setResults([]);
    setSelectedTopic(null);
    setMedia(null);
    setSelectedFunscript(null);
    setError(null);
    setMessage(null);
    void refreshLoginStatus();
    void performSearch(initialQuery, []);
  }, [initialQuery, open, performSearch, refreshLoginStatus]);

  useEffect(() => {
    if (!open) return;
    const handleFocus = () => {
      void refreshLoginStatus();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [open, refreshLoginStatus]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.eroscripts.subscribeToLoginStatus((status) => {
      setLoginStatus(status);
      setIsLoadingLogin(false);
    });
    return unsubscribe;
  }, []);

  const canInstallRounds = Boolean(onInstallRound);
  const canAttachFunscript = Boolean(onAttachFunscript);

  const resultCountLabel = useMemo(() => {
    if (isSearching) return t`Searching...`;
    if (results.length === 0) return t`No results loaded`;
    return t`${results.length} result${results.length === 1 ? "" : "s"}`;
  }, [isSearching, results.length, t]);

  if (!open) return null;

  const runSearch = async () => performSearch(query, parseSearchTags(tagInput));

  const loadTopic = async (topic: EroScriptsSearchResult) => {
    setSelectedTopic(topic);
    setMedia(null);
    setError(null);
    setMessage(null);
    setIsLoadingTopic(true);
    try {
      const next = await eroscripts.listTopicMedia(topic.topicId);
      setMedia(next);
      if (next.funscripts.length === 0 && next.videos.length === 0) {
        setMessage(t`No downloadable funscripts or video links were found in this topic.`);
      }
    } catch (topicError) {
      setError(toErrorMessage(topicError, t`Failed to load EroScripts topic.`));
    } finally {
      setIsLoadingTopic(false);
    }
  };

  const downloadFunscript = async (
    candidate: EroScriptsFunscriptCandidate,
    mode: "select" | "attach"
  ) => {
    if (!candidate.supported) return;
    const actionKey = buildActionKey(mode, candidate.url);
    setBusyActionKey(actionKey);
    setError(null);
    setMessage(null);
    try {
      const downloaded = await eroscripts.downloadFunscript(candidate);
      setSelectedFunscript(downloaded);
      if (mode === "attach" && onAttachFunscript) {
        await onAttachFunscript(downloaded);
        setMessage(t`Funscript attached.`);
      } else {
        setMessage(t`Funscript ready for video install.`);
      }
    } catch (downloadError) {
      setError(toErrorMessage(downloadError, t`Failed to download funscript.`));
    } finally {
      setBusyActionKey(null);
    }
  };

  const installVideo = async (candidate: EroScriptsVideoCandidate, download: boolean) => {
    if (!selectedTopic || !onInstallRound || !candidate.supported) return;
    const actionKey = buildActionKey(download ? "download-video" : "install-web", candidate.url);
    setBusyActionKey(actionKey);
    setError(null);
    setMessage(null);
    try {
      const videoUri = download
        ? (await eroscripts.downloadVideo(candidate)).videoUri
        : candidate.url;
      await onInstallRound({
        name: selectedTopic.title,
        videoUri,
        funscriptUri: selectedFunscript?.funscriptUri ?? null,
        sourceUrl: candidate.url,
      });
      setMessage(
        selectedFunscript
          ? t`Video installed with the selected funscript.`
          : t`Video installed without a funscript.`
      );
    } catch (installError) {
      setError(toErrorMessage(installError, t`Failed to install video.`));
    } finally {
      setBusyActionKey(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[190] overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),transparent_38%),rgba(3,7,18,0.9)] px-4 py-6 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="eroscripts-search-title"
    >
      <div className="mx-auto flex min-h-full w-full max-w-6xl items-center justify-center">
        <div className="w-full rounded-3xl border border-cyan-300/25 bg-zinc-950/95 p-5 shadow-[0_0_70px_rgba(34,211,238,0.22)]">
          <div className="flex flex-col gap-4 border-b border-white/10 pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.35em] text-cyan-200/75">
                <Trans>EroScripts</Trans>
              </p>
              <h2 id="eroscripts-search-title" className="mt-2 text-2xl font-black text-cyan-50">
                <Trans>Find Videos & Funscripts</Trans>
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-zinc-400">
                <Trans>
                  Search free EroScripts topics, attach direct funscripts, or install discovered
                  videos with an optional downloaded copy.
                </Trans>
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div
                className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 transition ${
                  loginStatus?.loggedIn
                    ? "border-emerald-500/30 bg-emerald-500/10"
                    : "border-zinc-700 bg-zinc-900/40"
                }`}
              >
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    <Trans>EroScripts Account</Trans>
                  </span>
                  <span className="text-xs font-semibold text-zinc-200">
                    {isLoadingLogin ? (
                      <Trans>Checking...</Trans>
                    ) : loginStatus?.loggedIn ? (
                      (loginStatus.username ?? <Trans>Logged In</Trans>)
                    ) : (
                      <Trans>Not Logged In</Trans>
                    )}
                  </span>
                </div>
                {loginStatus?.loggedIn ? (
                  <button
                    type="button"
                    disabled={isLoadingLogin}
                    onMouseEnter={playHoverSound}
                    onClick={handleClearLogin}
                    title={t`Logout`}
                    className="ml-1 rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-rose-400 disabled:opacity-50"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isLoadingLogin || isLogingInProgress}
                    onMouseEnter={playHoverSound}
                    onClick={handleLogin}
                    className="ml-1 rounded-lg border border-cyan-500/50 bg-cyan-500/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-tight text-cyan-100 transition hover:border-cyan-400 hover:bg-cyan-500/30 disabled:opacity-50"
                  >
                    <Trans>Login</Trans>
                  </button>
                )}
              </div>
              <button
                type="button"
                onMouseEnter={playHoverSound}
                onClick={() => {
                  playSelectSound();
                  onClose();
                }}
                className="rounded-xl border border-zinc-600 bg-zinc-900/80 px-4 py-2 text-sm font-semibold text-zinc-200 transition hover:border-zinc-400"
              >
                <Trans>Close</Trans>
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <div className="space-y-4">
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void runSearch();
                }}
              >
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t`Search title, creator, or video name`}
                    className="min-h-12 flex-1 rounded-xl border border-cyan-300/25 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-200/80"
                  />
                  <button
                    type="submit"
                    disabled={isSearching}
                    onMouseEnter={playHoverSound}
                    className="min-h-12 rounded-xl border border-cyan-300/60 bg-cyan-500/25 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200/80 hover:bg-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSearching ? t`Searching...` : t`Search`}
                  </button>
                </div>
                <div className="block">
                  <span
                    id="eroscripts-tags-label"
                    className="mb-1 block text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500"
                  >
                    <Trans>Tags</Trans>
                  </span>
                  <input
                    id="eroscripts-tags-input"
                    aria-labelledby="eroscripts-tags-label"
                    value={tagInput}
                    onChange={(event) => setTagInput(event.target.value)}
                    placeholder={t`Comma-separated tags, for example vr, pov`}
                    className="min-h-12 w-full rounded-xl border border-cyan-300/25 bg-black/45 px-4 py-3 text-sm text-zinc-100 outline-none transition focus:border-cyan-200/80"
                  />
                </div>
              </form>

              <div className="flex items-center justify-between text-xs text-zinc-500">
                <span>{resultCountLabel}</span>
                {currentFunscriptUri ? (
                  <span>{t`Current round already has a funscript`}</span>
                ) : null}
              </div>

              <div className="max-h-[56vh] space-y-2 overflow-y-auto pr-1">
                {results.map((result) => {
                  const selected = selectedTopic?.topicId === result.topicId;
                  return (
                    <button
                      key={result.topicId}
                      type="button"
                      onMouseEnter={playHoverSound}
                      onClick={() => {
                        playSelectSound();
                        void loadTopic(result);
                      }}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        selected
                          ? "border-cyan-200/70 bg-cyan-500/15"
                          : "border-white/10 bg-black/30 hover:border-cyan-300/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-bold text-zinc-100">{result.title}</h3>
                        {formatDate(result.createdAt) ? (
                          <span className="shrink-0 text-xs text-zinc-500">
                            {formatDate(result.createdAt)}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-400">{result.excerpt}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-zinc-500">
                        {result.author ? <span>{result.author}</span> : null}
                        <span>{t`Topic ${result.topicId}`}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-h-[28rem] rounded-2xl border border-white/10 bg-black/30 p-4">
              {!selectedTopic ? (
                <div className="flex h-full items-center justify-center text-center text-sm text-zinc-500">
                  <Trans>Select a search result to inspect downloadable files.</Trans>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-bold text-zinc-100">{selectedTopic.title}</h3>
                    <a
                      href={selectedTopic.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-xs text-cyan-200 hover:text-cyan-100"
                    >
                      <Trans>Open topic</Trans>
                    </a>
                  </div>

                  {selectedFunscript ? (
                    <div className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                      {t`Selected funscript: ${selectedFunscript.filename}`}
                    </div>
                  ) : null}

                  {isLoadingTopic ? (
                    <div className="rounded-xl border border-cyan-300/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
                      <Trans>Loading downloadable files...</Trans>
                    </div>
                  ) : null}

                  {media ? (
                    <>
                      <section>
                        <div className="mb-2 flex items-center justify-between">
                          <h4 className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-100">
                            <Trans>Funscripts</Trans>
                          </h4>
                          <span className="text-xs text-zinc-500">{media.funscripts.length}</span>
                        </div>
                        <div className="space-y-2">
                          {media.funscripts.length === 0 ? (
                            <p className="text-sm text-zinc-500">
                              <Trans>No direct funscripts found.</Trans>
                            </p>
                          ) : (
                            media.funscripts.map((candidate) => {
                              const selectKey = buildActionKey("select", candidate.url);
                              const attachKey = buildActionKey("attach", candidate.url);
                              const busy =
                                busyActionKey === selectKey || busyActionKey === attachKey;
                              return (
                                <div
                                  key={candidate.url}
                                  className="rounded-xl border border-white/10 bg-zinc-950/70 p-3"
                                >
                                  <div className="break-all text-sm font-semibold text-zinc-100">
                                    {candidate.filename}
                                  </div>
                                  {!candidate.supported ? (
                                    <p className="mt-1 text-xs text-amber-200">
                                      {candidate.unsupportedReason ??
                                        t`This file type is not supported yet.`}
                                    </p>
                                  ) : null}
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {canInstallRounds ? (
                                      <button
                                        type="button"
                                        disabled={!candidate.supported || busy}
                                        onMouseEnter={playHoverSound}
                                        onClick={() => {
                                          playSelectSound();
                                          void downloadFunscript(candidate, "select");
                                        }}
                                        className="rounded-lg border border-emerald-300/50 bg-emerald-500/20 px-3 py-2 text-xs font-semibold text-emerald-100 transition hover:border-emerald-200/80 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {busyActionKey === selectKey
                                          ? t`Downloading...`
                                          : t`Use with Video`}
                                      </button>
                                    ) : null}
                                    {canAttachFunscript ? (
                                      <button
                                        type="button"
                                        disabled={!candidate.supported || busy}
                                        onMouseEnter={playHoverSound}
                                        onClick={() => {
                                          playSelectSound();
                                          void downloadFunscript(candidate, "attach");
                                        }}
                                        className="rounded-lg border border-cyan-300/50 bg-cyan-500/20 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200/80 disabled:cursor-not-allowed disabled:opacity-50"
                                      >
                                        {busyActionKey === attachKey
                                          ? t`Attaching...`
                                          : t`Attach to Current Video`}
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </section>

                      <section>
                        <div className="mb-2 flex items-center justify-between">
                          <h4 className="text-sm font-bold uppercase tracking-[0.18em] text-violet-100">
                            <Trans>Videos</Trans>
                          </h4>
                          <span className="text-xs text-zinc-500">{media.videos.length}</span>
                        </div>
                        <div className="space-y-2">
                          {media.videos.length === 0 ? (
                            <p className="text-sm text-zinc-500">
                              <Trans>No downloader-supported video links found.</Trans>
                            </p>
                          ) : (
                            media.videos.map((candidate) => {
                              const webKey = buildActionKey("install-web", candidate.url);
                              const downloadKey = buildActionKey("download-video", candidate.url);
                              const busy =
                                busyActionKey === webKey || busyActionKey === downloadKey;
                              return (
                                <div
                                  key={candidate.url}
                                  className="rounded-xl border border-white/10 bg-zinc-950/70 p-3"
                                >
                                  <div className="break-all text-sm font-semibold text-zinc-100">
                                    {candidate.label}
                                  </div>
                                  <div className="mt-1 break-all text-xs text-zinc-500">
                                    {candidate.url}
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {canInstallRounds ? (
                                      <>
                                        <button
                                          type="button"
                                          disabled={!candidate.supported || busy}
                                          onMouseEnter={playHoverSound}
                                          onClick={() => {
                                            playSelectSound();
                                            void installVideo(candidate, false);
                                          }}
                                          className="rounded-lg border border-violet-300/50 bg-violet-500/20 px-3 py-2 text-xs font-semibold text-violet-100 transition hover:border-violet-200/80 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                          {busyActionKey === webKey
                                            ? t`Installing...`
                                            : t`Install Web Video`}
                                        </button>
                                        <button
                                          type="button"
                                          disabled={busy}
                                          onMouseEnter={playHoverSound}
                                          onClick={() => handleOpenInBrowser(candidate.url)}
                                          className="rounded-lg border border-zinc-500 bg-zinc-700/40 px-3 py-2 text-xs font-semibold text-zinc-100 transition hover:border-zinc-300/70 disabled:opacity-50"
                                        >
                                          <Trans>Open in Browser</Trans>
                                        </button>
                                      </>
                                    ) : (
                                      <p className="text-xs text-zinc-500">
                                        <Trans>Video install is not available here.</Trans>
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </section>
                    </>
                  ) : null}
                </div>
              )}
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-xl border border-rose-300/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="mt-4 rounded-xl border border-emerald-300/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              {message}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
