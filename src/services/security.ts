import { trpc } from "./trpc";

type TrustedSitesState = Awaited<ReturnType<typeof trpc.security.listTrustedSites.query>>;
type SecurityMode = TrustedSitesState["securityMode"];

export const security = {
  listTrustedSites: () => trpc.security.listTrustedSites.query(),
  openExternal: (url: string) => trpc.security.openExternal.mutate({ url }),
  setSecurityMode: (mode: SecurityMode) => trpc.security.setSecurityMode.mutate({ mode }),
  addTrustedSite: (baseDomain: string) => trpc.security.addTrustedSite.mutate({ baseDomain }),
  removeTrustedSite: (baseDomain: string) => trpc.security.removeTrustedSite.mutate({ baseDomain }),
} as const;
