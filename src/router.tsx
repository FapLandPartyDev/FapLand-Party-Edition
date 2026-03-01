import { createHashHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { DefaultErrorComponent } from "./components/ErrorFallback";
import { RoutePendingComponent } from "./components/RoutePending";

export const getRouter = () => {
  const history =
    typeof window !== "undefined" &&
    window.location.protocol !== "http:" &&
    window.location.protocol !== "https:"
      ? createHashHistory()
      : undefined;

  const router = createRouter({
    routeTree,
    context: {},
    history,
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
    defaultPendingComponent: RoutePendingComponent,
  });

  return router;
};
