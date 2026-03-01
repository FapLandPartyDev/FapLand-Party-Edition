import { runCommand } from "./extract";

export async function probeVideoDurationMs(
  ffprobePath: string,
  videoPath: string,
  headers?: Record<string, string>
): Promise<number> {
  const args = ["-v", "error", "-show_entries", "format=duration", "-of", "json"];

  if (headers && Object.keys(headers).length > 0) {
    const headerString =
      Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n") + "\r\n";
    args.push("-headers", headerString);
  }

  args.push(videoPath);

  const { stdout } = await runCommand(ffprobePath, args, { timeoutMs: 600_000 });
  const payload = JSON.parse(stdout.toString("utf8")) as {
    format?: { duration?: string | number };
  };
  const rawDuration = payload.format?.duration;
  const durationSeconds =
    typeof rawDuration === "number"
      ? rawDuration
      : typeof rawDuration === "string"
        ? Number(rawDuration)
        : Number.NaN;

  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new Error(`Invalid duration returned by ffprobe for ${videoPath}.`);
  }

  return Math.floor(durationSeconds * 1000);
}
