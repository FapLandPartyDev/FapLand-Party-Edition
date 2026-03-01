import { trpc } from "../services/trpc";

export async function generateVideoPhash(
    path: string,
    startTime?: number,
    endTime?: number
): Promise<string> {
    return trpc.phash.generate.query({ path, startTime, endTime });
}