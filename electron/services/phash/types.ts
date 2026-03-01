export type NormalizedVideoHashRange = {
    durationMs: number;
    startTimeMs: number;
    endTimeMs: number;
    isFullVideo: boolean;
};

export type DecodedFrame = {
    width: number;
    height: number;
    data: Uint8ClampedArray;
};

export type PhashBinaries = {
    ffmpegPath: string;
    ffprobePath: string;
    source: "bundled" | "system";
    ffmpegVersion: string | null;
    ffprobeVersion: string | null;
};
