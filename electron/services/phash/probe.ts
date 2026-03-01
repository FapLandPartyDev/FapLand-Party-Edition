import { runCommand } from "./extract";

export async function probeVideoDurationMs(ffprobePath: string, videoPath: string): Promise<number> {
    const args = [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        videoPath,
    ];

    const { stdout } = await runCommand(ffprobePath, args);
    const payload = JSON.parse(stdout.toString("utf8")) as { format?: { duration?: string | number } };
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
