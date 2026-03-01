import type { DecodedFrame } from "./types";

export function combineFramesToSprite(
    frames: DecodedFrame[],
    columns: number,
    rows: number,
): DecodedFrame {
    const expectedFrames = columns * rows;
    if (frames.length !== expectedFrames) {
        throw new Error(`Expected ${expectedFrames} frames for sprite, received ${frames.length}.`);
    }

    const first = frames[0];
    if (!first) {
        throw new Error("Cannot build sprite from an empty frame list.");
    }

    const frameWidth = first.width;
    const frameHeight = first.height;

    for (let i = 1; i < frames.length; i += 1) {
        const frame = frames[i];
        if (!frame) continue;
        if (frame.width !== frameWidth || frame.height !== frameHeight) {
            throw new Error("All sampled frames must share the same dimensions.");
        }
    }

    const spriteWidth = frameWidth * columns;
    const spriteHeight = frameHeight * rows;
    const sprite = new Uint8ClampedArray(spriteWidth * spriteHeight * 4);

    for (let index = 0; index < frames.length; index += 1) {
        const frame = frames[index];
        if (!frame) continue;

        const targetX = (index % columns) * frameWidth;
        const targetY = Math.floor(index / rows) * frameHeight;

        for (let y = 0; y < frameHeight; y += 1) {
            const srcOffset = y * frameWidth * 4;
            const dstOffset = (((targetY + y) * spriteWidth) + targetX) * 4;
            const row = frame.data.subarray(srcOffset, srcOffset + (frameWidth * 4));
            sprite.set(row, dstOffset);
        }
    }

    return {
        width: spriteWidth,
        height: spriteHeight,
        data: sprite,
    };
}
