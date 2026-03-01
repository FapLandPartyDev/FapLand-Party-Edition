import { db, type InstallFolderScanResult } from "./db";
import { playlists, type PlaylistImportResult } from "./playlists";

export type OpenedFileKind = "sidecar" | "playlist" | "unsupported";

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
    };

export function getOpenedFileKind(filePath: string): OpenedFileKind {
  const normalized = filePath.trim().toLowerCase();
  if (normalized.endsWith(".hero") || normalized.endsWith(".round")) {
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
    return {
      kind,
      filePath,
      result: await db.install.importSidecarFile(filePath),
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
