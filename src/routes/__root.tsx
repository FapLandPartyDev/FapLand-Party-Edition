import { createRootRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ipcLink } from "electron-trpc/renderer";
import superjson from "superjson";
import { HandyProvider } from "../contexts/HandyContext";
import { useGlobalParallax } from "../hooks/useGlobalParallax";
import { trpcReact } from "../services/trpc";
import "../styles.css";

export const RootComponent: React.FC = () => {
  useGlobalParallax();
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpcReact.createClient({
      links: [ipcLink()],
      transformer: superjson,
    })
  );

  return (
    <trpcReact.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <HandyProvider>
          <Outlet />
        </HandyProvider>
      </QueryClientProvider>
    </trpcReact.Provider>
  );
};

export const Route = createRootRoute({
  component: RootComponent,
});
