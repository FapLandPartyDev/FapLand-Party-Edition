export type ContentFormatUpdatePrompt = {
  fileName: string;
  currentVersion: string;
  latestVersion: string | null;
};

export type ContentFormatUpdateResult = { action: "dismiss" } | { action: "update" };

export type PendingContentFormatUpdatePrompt = ContentFormatUpdatePrompt & {
  resolve: (result: ContentFormatUpdateResult) => void;
};

const listeners = new Set<(prompt: PendingContentFormatUpdatePrompt | null) => void>();
let pendingPrompt: PendingContentFormatUpdatePrompt | null = null;

function publish(prompt: PendingContentFormatUpdatePrompt | null): void {
  pendingPrompt = prompt;
  for (const listener of listeners) listener(prompt);
}

export function getPendingContentFormatUpdatePrompt(): PendingContentFormatUpdatePrompt | null {
  return pendingPrompt;
}

export function subscribeToContentFormatUpdatePrompt(
  listener: (prompt: PendingContentFormatUpdatePrompt | null) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resolveContentFormatUpdatePrompt(result: ContentFormatUpdateResult): void {
  const resolve = pendingPrompt?.resolve;
  if (!resolve) return;
  publish(null);
  resolve(result);
}

export async function promptForContentFormatUpdate(
  prompt: ContentFormatUpdatePrompt
): Promise<ContentFormatUpdateResult> {
  return await new Promise<ContentFormatUpdateResult>((resolve) => {
    publish({ ...prompt, resolve });
  });
}
