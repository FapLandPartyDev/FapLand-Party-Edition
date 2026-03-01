import { spawn } from "node:child_process";

type CommandResult = {
    stdout: Buffer;
    stderr: Buffer;
};

export async function runCommand(command: string, args: string[]): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
        child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

        child.on("error", (error) => {
            reject(error);
        });

        child.on("close", (code, signal) => {
            const stdout = Buffer.concat(stdoutChunks);
            const stderr = Buffer.concat(stderrChunks);
            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }

            const stderrText = stderr.toString("utf8").trim();
            const signalText = signal ? `, signal ${signal}` : "";
            reject(new Error(`Command failed with exit code ${code}${signalText}: ${stderrText}`));
        });
    });
}

export async function extractSpriteFrameBmp(
    ffmpegPath: string,
    videoPath: string,
    timestampMs: number,
    width: number,
): Promise<Buffer> {
    const timestampSeconds = (timestampMs / 1000).toFixed(6);

    const args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-ss",
        timestampSeconds,
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-vf",
        `scale=${width}:-1`,
        "-c:v",
        "bmp",
        "-f",
        "rawvideo",
        "-",
    ];

    const { stdout } = await runCommand(ffmpegPath, args);
    if (stdout.length === 0) {
        throw new Error("ffmpeg returned an empty frame output.");
    }

    return stdout;
}
