import { promptForContentFormatUpdate } from "./contentFormatUpdatePrompt";
import { trpc } from "./trpc";

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/u).filter(Boolean).pop() ?? filePath;
}

/**
 * Checks whether a content parsing failure may be explained by an outdated app.
 * Returns true when an update was available and the user was shown the update prompt.
 */
export async function offerUpdateForIncompatibleContent(filePath: string): Promise<boolean> {
  try {
    const state = await trpc.updater.check.mutate({ force: true });
    if (state.status !== "update_available") return false;

    const result = await promptForContentFormatUpdate({
      fileName: getFileName(filePath),
      currentVersion: state.currentVersion,
      latestVersion: state.latestVersion,
    });
    if (result.action === "update") {
      await trpc.updater.openLatestDownload.mutate();
    }
    return true;
  } catch (error) {
    // The original content error remains the useful error if the update check itself fails.
    console.error("Failed to check for an update after an incompatible content error", error);
    return false;
  }
}
