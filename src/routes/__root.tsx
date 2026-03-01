import {
  Component,
  Suspense,
  lazy,
  type CSSProperties,
  type ErrorInfo,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { createRootRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Trans } from "@lingui/react/macro";
import { CommandPalette } from "../components/CommandPalette";
import { ControllerProvider } from "../controller";
import { CommandPaletteGuardProvider } from "../contexts/CommandPaletteGuardContext";
import { ForegroundMediaProvider } from "../contexts/ForegroundMediaContext";
import { GlobalMusicProvider } from "../contexts/GlobalMusicContext";
import { HandyProvider } from "../contexts/HandyContext";
import { useGlobalParallax } from "../hooks/useGlobalParallax";
import {
  DEFAULT_MENU_THEME_ID,
  MENU_THEME_CHANGED_EVENT,
  MENU_THEME_KEY,
  getMainMenuTheme,
  normalizeMainMenuThemeId,
  type MainMenuThemeId,
} from "../constants/menuThemeSettings";
import { trpc } from "../services/trpc";
import "../styles.css";

let queryClient: QueryClient | null = null;

const LazyGlobalHandyOverlay = lazy(async () => {
  const module = await import("../components/GlobalHandyOverlay");
  return { default: module.GlobalHandyOverlay };
});

const LazyGlobalMusicOverlay = lazy(async () => {
  const module = await import("../components/GlobalMusicOverlay");
  return { default: module.GlobalMusicOverlay };
});

const LazyGlobalFpsCounter = lazy(async () => {
  const module = await import("../components/GlobalFpsCounter");
  return { default: module.GlobalFpsCounter };
});

type RootErrorBoundaryProps = {
  children: ReactNode;
};

type RootErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[RootErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-[#050508]" />
        <div className="absolute inset-0 bg-gradient-to-br from-red-950/40 via-transparent to-violet-950/30" />
        <div className="relative z-10 mx-4 max-w-lg text-center">
          <div className="mb-6 text-6xl">⚠️</div>
          <h1 className="mb-3 text-2xl font-extrabold tracking-tight text-red-100">
            <Trans>Something went wrong</Trans>
          </h1>
          <p className="mb-2 text-sm text-zinc-400">
            <Trans>An unexpected error occurred. The app may continue to function partially.</Trans>
          </p>
          {this.state.error instanceof Error && (
            <p className="mb-6 max-h-24 overflow-auto rounded-lg border border-red-500/30 bg-red-500/10 p-3 font-mono text-xs text-red-300">
              {this.state.error.message}
            </p>
          )}
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="rounded-xl border border-violet-300/60 bg-violet-500/30 px-6 py-2.5 text-sm font-semibold text-violet-100 transition-all duration-200 hover:border-violet-200/80 hover:bg-violet-500/45"
            >
              <Trans>Try Again</Trans>
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl border border-zinc-600 bg-zinc-800/80 px-6 py-2.5 text-sm font-semibold text-zinc-300 transition-all duration-200 hover:border-zinc-500 hover:bg-zinc-700/80"
            >
              <Trans>Reload App</Trans>
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function getQueryClient(): QueryClient {
  if (!queryClient) {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,
          refetchOnMount: false,
          refetchOnReconnect: false,
          retry: false,
        },
      },
    });
  }
  return queryClient;
}

function DeferredGlobalOverlayHost() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    let idleId: number | null = null;

    const mount = () => {
      if (!cancelled) {
        setMounted(true);
      }
    };

    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(mount, { timeout: 1200 });
    } else {
      timeoutId = window.setTimeout(mount, 400);
    }

    return () => {
      cancelled = true;

      if (idleId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <LazyGlobalFpsCounter />
      <LazyGlobalHandyOverlay />
      <LazyGlobalMusicOverlay />
    </Suspense>
  );
}

function isGameboardPath(pathname: string): boolean {
  return pathname === "/game" || pathname === "/multiplayer-match";
}

function AppThemeScope({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [themeId, setThemeId] = useState<MainMenuThemeId>(DEFAULT_MENU_THEME_ID);
  const theme = getMainMenuTheme(themeId);
  const gameboardPath = isGameboardPath(pathname);

  useEffect(() => {
    let cancelled = false;

    void trpc.store.get
      .query({ key: MENU_THEME_KEY })
      .then((value) => {
        if (!cancelled) {
          setThemeId(normalizeMainMenuThemeId(value));
        }
      })
      .catch((error) => {
        console.error("Failed to read app theme setting", error);
      });

    const handleThemeChange = (event: Event) => {
      setThemeId(normalizeMainMenuThemeId((event as CustomEvent<unknown>).detail));
    };

    window.addEventListener(MENU_THEME_CHANGED_EVENT, handleThemeChange);

    return () => {
      cancelled = true;
      window.removeEventListener(MENU_THEME_CHANGED_EVENT, handleThemeChange);
    };
  }, []);

  return (
    <div
      className={gameboardPath ? undefined : "app-theme-scope"}
      data-app-theme={gameboardPath ? undefined : theme.id}
      data-app-theme-disabled={gameboardPath ? "gameboard" : undefined}
      style={gameboardPath ? undefined : (theme.cssVars as CSSProperties)}
    >
      {children}
    </div>
  );
}

function RootComponent() {
  useGlobalParallax();

  return (
    <RootErrorBoundary>
      <QueryClientProvider client={getQueryClient()}>
        <ControllerProvider>
          <ForegroundMediaProvider>
            <GlobalMusicProvider>
              <HandyProvider>
                <CommandPaletteGuardProvider>
                  <AppThemeScope>
                    <Outlet />
                    <CommandPalette />
                  </AppThemeScope>
                </CommandPaletteGuardProvider>
                <DeferredGlobalOverlayHost />
              </HandyProvider>
            </GlobalMusicProvider>
          </ForegroundMediaProvider>
        </ControllerProvider>
      </QueryClientProvider>
    </RootErrorBoundary>
  );
}

export const Route = createRootRoute({
  component: RootComponent,
});
