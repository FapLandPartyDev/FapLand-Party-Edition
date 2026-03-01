import path from "node:path";

export type DialogPathApprovalKind =
  | "installFolder"
  | "installSidecarFile"
  | "playlistExportFile"
  | "playlistImportFile";

const APPROVAL_TTL_MS = 10 * 60 * 1000;

const approvedPathsByKind = new Map<DialogPathApprovalKind, Map<string, number>>();

function normalizeApprovedPath(rawPath: string): string | null {
  const trimmed = rawPath.trim();
  if (trimmed.length === 0) return null;
  return path.normalize(path.resolve(trimmed));
}

function pruneExpiredApprovals(kind: DialogPathApprovalKind, nowMs: number): Map<string, number> {
  const existing = approvedPathsByKind.get(kind) ?? new Map<string, number>();
  for (const [approvedPath, expiresAtMs] of existing.entries()) {
    if (expiresAtMs <= nowMs) {
      existing.delete(approvedPath);
    }
  }
  approvedPathsByKind.set(kind, existing);
  return existing;
}

export function approveDialogPath(kind: DialogPathApprovalKind, rawPath: string): void {
  const normalizedPath = normalizeApprovedPath(rawPath);
  if (!normalizedPath) return;

  const approvals = pruneExpiredApprovals(kind, Date.now());
  approvals.set(normalizedPath, Date.now() + APPROVAL_TTL_MS);
}

export function assertApprovedDialogPath(kind: DialogPathApprovalKind, rawPath: string): string {
  const normalizedPath = normalizeApprovedPath(rawPath);
  if (!normalizedPath) {
    throw new Error("Path must be selected through the system dialog.");
  }

  const approvals = pruneExpiredApprovals(kind, Date.now());
  const expiresAtMs = approvals.get(normalizedPath);
  if (!expiresAtMs) {
    throw new Error("Path must be selected through the system dialog.");
  }

  approvals.delete(normalizedPath);
  return normalizedPath;
}

export function clearApprovedDialogPathsForTests(): void {
  approvedPathsByKind.clear();
}
