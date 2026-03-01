import { db, type InstallFolderScanResult } from "./db";
import { playlists, type PlaylistImportResult } from "./playlists";
import { security } from "./security";
import { reviewInstallSidecarTrust } from "../components/InstallSidecarTrustModalHost";
import { confirmInstallSidecar } from "../components/InstallConfirmationModalHost";
import type { ToastVariant } from "../components/ui/ToastHost";

export type OpenedFileKind = "sidecar" | "playlist" | "unsupported" | "cancelled";

export type OpenedFileImportResult =
  | {
    kind: "sidecar";
    filePath: string;
    result: InstallFolderScanResult;
    feedback: ImportFeedback;
  }
  | {
    kind: "playlist";
    filePath: string;
    imported: PlaylistImportResult;
    feedback: ImportFeedback;
  }
  | {
    kind: "unsupported";
    filePath: string;
  }
  | {
    kind: "cancelled";
    filePath: string;
  };

export type ImportFeedback = {
  variant: ToastVariant;
  message: string;
};

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function summarizeImportResult(filePath: string, result: InstallFolderScanResult): ImportFeedback {
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
  const { status } = result;
  const stats = status.stats;

  if (status.state === "aborted") {
    return {
      variant: "info",
      message: `Import canceled for ${fileName}.`,
    };
  }

  if (stats.failed > 0 && stats.installed === 0 && stats.updated === 0) {
    return {
      variant: "error",
      message: `Failed to import ${fileName}.`,
    };
  }

  if (stats.failed > 0) {
    return {
      variant: "info",
      message: `Imported ${fileName} with issues. ${stats.installed} new, ${stats.updated} updated, ${stats.failed} failed.`,
    };
  }

  if (stats.installed === 0 && stats.updated > 0) {
    return {
      variant: "info",
      message: `Updated existing content from ${fileName}. ${pluralize(stats.updated, "round")} updated.`,
    };
  }

  if (stats.installed > 0 && stats.updated > 0) {
    return {
      variant: "success",
      message: `Imported ${fileName}. ${stats.installed} new, ${stats.updated} updated.`,
    };
  }

  return {
    variant: "success",
    message: `Installed ${fileName}. ${pluralize(stats.installed, "round")}, ${pluralize(stats.playlistsImported, "playlist")}.`,
  };
}

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

    const confirmation = await confirmInstallSidecar(analysis);
    if (confirmation.action === "cancel") {
      return { kind: "cancelled", filePath };
    }

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
    const result = await db.install.importSidecarFile(filePath, review.trustedBaseDomains);
    return {
      kind,
      filePath,
      result,
      feedback: summarizeImportResult(filePath, result),
    };
  }

  if (kind === "playlist") {
    const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
    const analysis = {
      filePath,
      contentName: fileName.replace(/\.fplay$/iu, ""),
      entries: [],
      unknownEntries: [],
    };
    const confirmation = await confirmInstallSidecar(analysis);
    if (confirmation.action === "cancel") {
      return { kind: "cancelled", filePath };
    }

    const imported = await playlists.importFromFile({ filePath });
    await playlists.setActive(imported.playlist.id);
    return {
      kind,
      filePath,
      imported,
      feedback: {
        variant: "success",
        message: `Imported playlist "${imported.playlist.name}".`,
      },
    };
  }

  return {
    kind: "unsupported",
    filePath,
  };
}
