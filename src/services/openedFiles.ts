import { db, type InstallFolderScanResult } from "./db";
import { playlists, type PlaylistImportResult } from "./playlists";
import { security } from "./security";
import { reviewInstallSidecarTrust } from "../components/InstallSidecarTrustModalHost";

export type OpenedFileKind = "sidecar" | "playlist" | "unsupported" | "cancelled";

export type OpenedFileImportResult =
  | {
    kind: "sidecar";
    filePath: string;
    result: InstallFolderScanResult;
  }
  | {
    kind: "playlist";
    filePath: string;
    imported: PlaylistImportResult;
  }
  | {
    kind: "unsupported";
    filePath: string;
  }
  | {
    kind: "cancelled";
    filePath: string;
  };

export function getOpenedFileKind(filePath: string): OpenedFileKind {
  const normalized = filePath.trim().toLowerCase();
  if (normalized.endsWith(".hero") || normalized.endsWith(".round") || normalized.endsWith(".fpack")) {
    return "sidecar";
  }
  if (normalized.endsWith(".fplay")) {
    return "playlist";
  }
  return "unsupported";
}

export async function importOpenedFile(filePath: string): Promise<OpenedFileImportResult> {
  const kind = getOpenedFileKind(filePath);

  if (kind === "sidecar") {
    const analysis = await db.install.inspectSidecarFile(filePath);
    const { securityMode } = await security.listTrustedSites();
    const review = securityMode === "prompt"
      ? await reviewInstallSidecarTrust(analysis)
      : { action: "import" as const, trustedBaseDomains: [] };
    if (review.action === "cancel") {
      return {
        kind: "cancelled",
        filePath,
      };
    }

    await Promise.all(review.trustedBaseDomains.map((baseDomain) => security.addTrustedSite(baseDomain)));
    return {
      kind,
      filePath,
      result: await db.install.importSidecarFile(filePath, review.trustedBaseDomains),
    };
  }

  if (kind === "playlist") {
    const imported = await playlists.importFromFile({ filePath });
    await playlists.setActive(imported.playlist.id);
    return {
      kind,
      filePath,
      imported,
    };
  }

  return {
    kind: "unsupported",
    filePath,
  };
}
