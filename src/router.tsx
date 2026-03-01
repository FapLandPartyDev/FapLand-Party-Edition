import { createHashHistory, createRouter } from "@tanstack/react-router";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

// Create a new router instance
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
  });

  return router;
};
