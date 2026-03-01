import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CommandPalette } from "../components/CommandPalette";
import { GlobalHandyOverlay } from "../components/GlobalHandyOverlay";
import { GlobalMusicOverlay } from "../components/GlobalMusicOverlay";
import { ControllerProvider } from "../controller";
import { CommandPaletteGuardProvider } from "../contexts/CommandPaletteGuardContext";
import { ForegroundMediaProvider } from "../contexts/ForegroundMediaContext";
import { GlobalMusicProvider } from "../contexts/GlobalMusicContext";
import { HandyProvider } from "../contexts/HandyContext";
import { useGlobalParallax } from "../hooks/useGlobalParallax";
import "../styles.css";

let queryClient: QueryClient | null = null;

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
            Something went wrong
          </h1>
          <p className="mb-2 text-sm text-zinc-400">
            An unexpected error occurred. The app may continue to function partially.
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
              Try Again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl border border-zinc-600 bg-zinc-800/80 px-6 py-2.5 text-sm font-semibold text-zinc-300 transition-all duration-200 hover:border-zinc-500 hover:bg-zinc-700/80"
            >
              Reload App
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
                  <Outlet />
                  <CommandPalette />
                </CommandPaletteGuardProvider>
                <GlobalHandyOverlay />
                <GlobalMusicOverlay />
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
