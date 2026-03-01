import type { DecodedFrame } from "./types";

const TARGET_SIZE = 64;
const HASH_SIZE = 8;
const BLUE_CHANNEL_SCALE = 257 / 256;

const dct64 = [
    1.9993976373924083, 1.9945809133573804, 1.9849590691974202, 1.9705552847778824,
    1.9514042600770571, 1.9275521315908797, 1.8990563611860733, 1.8659855976694777,
    1.8284195114070614, 1.7864486023910306, 1.7401739822174227, 1.6897071304994142,
    1.6351696263031674, 1.5766928552532127, 1.5144176930129691, 1.448494165902934,
    1.3790810894741339, 1.3063456859075537, 1.2304631811612539, 1.151616382835691,
    1.0699952397741948, 0.9857963844595683, 0.8992226593092132, 0.8104826280099796,
    0.7197900730699766, 0.627363480797783, 0.5334255149497968, 0.43820248031373954,
    0.3419237775206027, 0.24482135039843256, 0.1471291271993349, 0.049082457045824535,
];

const dct32 = [
    1.9975909124103448, 1.978353019929562, 1.9400625063890882, 1.8830881303660416,
    1.8079785862468867, 1.7154572200005442, 1.6064150629612899, 1.4819022507099182,
    1.3431179096940369, 1.191398608984867, 1.0282054883864435, 0.8551101868605644,
    0.6737797067844401, 0.48596035980652796, 0.2934609489107235, 0.09813534865483627,
];

const dct16 = [
    1.9903694533443936, 1.9138806714644176, 1.76384252869671, 1.546020906725474,
    1.2687865683272912, 0.9427934736519956, 0.5805693545089246, 0.19603428065912154,
];

function resizeRgbaBilinear(frame: DecodedFrame, targetWidth: number, targetHeight: number): DecodedFrame {
    const srcWidth = frame.width;
    const srcHeight = frame.height;
    const src = frame.data;
    const dst = new Uint8ClampedArray(targetWidth * targetHeight * 4);

    for (let y = 0; y < targetHeight; y += 1) {
        const srcY = ((y + 0.5) * srcHeight) / targetHeight - 0.5;
        const y0 = Math.max(0, Math.min(srcHeight - 1, Math.floor(srcY)));
        const y1 = Math.max(0, Math.min(srcHeight - 1, y0 + 1));
        const wy = srcY - y0;

        for (let x = 0; x < targetWidth; x += 1) {
            const srcX = ((x + 0.5) * srcWidth) / targetWidth - 0.5;
            const x0 = Math.max(0, Math.min(srcWidth - 1, Math.floor(srcX)));
            const x1 = Math.max(0, Math.min(srcWidth - 1, x0 + 1));
            const wx = srcX - x0;

            const topLeft = ((y0 * srcWidth) + x0) * 4;
            const topRight = ((y0 * srcWidth) + x1) * 4;
            const bottomLeft = ((y1 * srcWidth) + x0) * 4;
            const bottomRight = ((y1 * srcWidth) + x1) * 4;

            const dstOffset = ((y * targetWidth) + x) * 4;

            for (let c = 0; c < 4; c += 1) {
                const top = (src[topLeft + c] * (1 - wx)) + (src[topRight + c] * wx);
                const bottom = (src[bottomLeft + c] * (1 - wx)) + (src[bottomRight + c] * wx);
                dst[dstOffset + c] = Math.max(0, Math.min(255, Math.round((top * (1 - wy)) + (bottom * wy))));
            }
        }
    }

    return {
        width: targetWidth,
        height: targetHeight,
        data: dst,
    };
}

function toGoimagehashGrayscale(frame: DecodedFrame): Float64Array {
    const out = new Float64Array(frame.width * frame.height);
    const data = frame.data;

    for (let i = 0; i < out.length; i += 1) {
        const p = i * 4;
        const r = data[p] ?? 0;
        const g = data[p + 1] ?? 0;
        const b = data[p + 2] ?? 0;
        out[i] = (0.299 * r) + (0.587 * g) + (0.114 * (b * BLUE_CHANNEL_SCALE));
    }

    return out;
}

function forwardDCT4(input: number[]): void {
    const x0 = input[0] ?? 0;
    const y0 = input[3] ?? 0;
    const x1 = input[1] ?? 0;
    const y1 = input[2] ?? 0;

    let t0 = x0 + y0;
    let t1 = x1 + y1;
    let t2 = (x0 - y0) / 1.8477590650225735;
    let t3 = (x1 - y1) / 0.7653668647301797;

    {
        const x = t0;
        const y = t1;
        t0 += t1;
        t1 = (x - y) / 1.4142135623730951;
    }

    {
        const x = t2;
        const y = t3;
        t2 += t3;
        t3 = (x - y) / 1.4142135623730951;
    }

    input[0] = t0;
    input[1] = t2 + t3;
    input[2] = t1;
    input[3] = t3;
}

function forwardDCT8(input: number[]): void {
    const a = [0, 0, 0, 0];
    const b = [0, 0, 0, 0];

    const x0 = input[0] ?? 0;
    const y0 = input[7] ?? 0;
    const x1 = input[1] ?? 0;
    const y1 = input[6] ?? 0;
    const x2 = input[2] ?? 0;
    const y2 = input[5] ?? 0;
    const x3 = input[3] ?? 0;
    const y3 = input[4] ?? 0;

    a[0] = x0 + y0;
    a[1] = x1 + y1;
    a[2] = x2 + y2;
    a[3] = x3 + y3;

    b[0] = (x0 - y0) / 1.9615705608064609;
    b[1] = (x1 - y1) / 1.6629392246050907;
    b[2] = (x2 - y2) / 1.1111404660392046;
    b[3] = (x3 - y3) / 0.3901806440322566;

    forwardDCT4(a);
    forwardDCT4(b);

    input[0] = a[0] ?? 0;
    input[1] = (b[0] ?? 0) + (b[1] ?? 0);
    input[2] = a[1] ?? 0;
    input[3] = (b[1] ?? 0) + (b[2] ?? 0);
    input[4] = a[2] ?? 0;
    input[5] = (b[2] ?? 0) + (b[3] ?? 0);
    input[6] = a[3] ?? 0;
    input[7] = b[3] ?? 0;
}

function forwardDCT16(input: number[]): void {
    const temp = new Array<number>(16).fill(0);
    for (let i = 0; i < 8; i += 1) {
        const x = input[i] ?? 0;
        const y = input[15 - i] ?? 0;
        temp[i] = x + y;
        temp[i + 8] = (x - y) / dct16[i]!;
    }

    const left = temp.slice(0, 8);
    const right = temp.slice(8, 16);
    forwardDCT8(left);
    forwardDCT8(right);

    for (let i = 0; i < 7; i += 1) {
        input[(i * 2)] = left[i] ?? 0;
        input[(i * 2) + 1] = (right[i] ?? 0) + (right[i + 1] ?? 0);
    }

    input[14] = left[7] ?? 0;
    input[15] = right[7] ?? 0;
}

function forwardDCT32(input: number[]): void {
    const temp = new Array<number>(32).fill(0);
    for (let i = 0; i < 16; i += 1) {
        const x = input[i] ?? 0;
        const y = input[31 - i] ?? 0;
        temp[i] = x + y;
        temp[i + 16] = (x - y) / dct32[i]!;
    }

    const left = temp.slice(0, 16);
    const right = temp.slice(16, 32);
    forwardDCT16(left);
    forwardDCT16(right);

    for (let i = 0; i < 15; i += 1) {
        input[(i * 2)] = left[i] ?? 0;
        input[(i * 2) + 1] = (right[i] ?? 0) + (right[i + 1] ?? 0);
    }

    input[30] = left[15] ?? 0;
    input[31] = right[15] ?? 0;
}

function forwardDCT64(input: number[]): void {
    const temp = new Array<number>(64).fill(0);
    for (let i = 0; i < 32; i += 1) {
        const x = input[i] ?? 0;
        const y = input[63 - i] ?? 0;
        temp[i] = x + y;
        temp[i + 32] = (x - y) / dct64[i]!;
    }

    const left = temp.slice(0, 32);
    const right = temp.slice(32, 64);
    forwardDCT32(left);
    forwardDCT32(right);

    for (let i = 0; i < 31; i += 1) {
        input[(i * 2)] = left[i] ?? 0;
        input[(i * 2) + 1] = (right[i] ?? 0) + (right[i + 1] ?? 0);
    }

    input[62] = left[31] ?? 0;
    input[63] = right[31] ?? 0;
}

function dct2dFast64(input: Float64Array): Float64Array {
    if (input.length !== TARGET_SIZE * TARGET_SIZE) {
        throw new Error(`Expected ${TARGET_SIZE}x${TARGET_SIZE} grayscale input.`);
    }

    const work = Array.from(input);

    for (let rowIndex = 0; rowIndex < TARGET_SIZE; rowIndex += 1) {
        const row = new Array<number>(TARGET_SIZE);
        for (let x = 0; x < TARGET_SIZE; x += 1) {
            row[x] = work[(rowIndex * TARGET_SIZE) + x] ?? 0;
        }
        forwardDCT64(row);
        for (let x = 0; x < TARGET_SIZE; x += 1) {
            work[(rowIndex * TARGET_SIZE) + x] = row[x] ?? 0;
        }
    }

    const flattens = new Float64Array(HASH_SIZE * HASH_SIZE);
    for (let x = 0; x < HASH_SIZE; x += 1) {
        const column = new Array<number>(TARGET_SIZE);
        for (let y = 0; y < TARGET_SIZE; y += 1) {
            column[y] = work[(TARGET_SIZE * y) + x] ?? 0;
        }

        forwardDCT64(column);

        for (let y = 0; y < HASH_SIZE; y += 1) {
            flattens[(HASH_SIZE * y) + x] = column[y] ?? 0;
        }
    }

    return flattens;
}

function quickSelectMedian(sequence: number[], low: number, hi: number, k: number): number {
    if (low === hi) return sequence[k] ?? 0;

    let currentLow = low;
    let currentHi = hi;

    while (currentLow < currentHi) {
        const pivot = Math.floor(currentLow / 2) + Math.floor(currentHi / 2);
        const pivotValue = sequence[pivot] ?? 0;
        let storeIdx = currentLow;

        [sequence[pivot], sequence[currentHi]] = [sequence[currentHi] ?? 0, sequence[pivot] ?? 0];

        for (let i = currentLow; i < currentHi; i += 1) {
            if ((sequence[i] ?? 0) < pivotValue) {
                [sequence[storeIdx], sequence[i]] = [sequence[i] ?? 0, sequence[storeIdx] ?? 0];
                storeIdx += 1;
            }
        }

        [sequence[currentHi], sequence[storeIdx]] = [sequence[storeIdx] ?? 0, sequence[currentHi] ?? 0];

        if (k <= storeIdx) {
            currentHi = storeIdx;
        } else {
            currentLow = storeIdx + 1;
        }
    }

    if (sequence.length % 2 === 0) {
        return ((sequence[k - 1] ?? 0) / 2) + ((sequence[k] ?? 0) / 2);
    }

    return sequence[k] ?? 0;
}

function medianOfPixelsFast64(values: Float64Array): number {
    const sequence = Array.from(values);
    const pos = Math.floor(sequence.length / 2);
    return quickSelectMedian(sequence, 0, sequence.length - 1, pos);
}

export function generateSpritePhashHex(sprite: DecodedFrame): string {
    const resized = resizeRgbaBilinear(sprite, TARGET_SIZE, TARGET_SIZE);
    const grayscale = toGoimagehashGrayscale(resized);
    const dct = dct2dFast64(grayscale);
    const median = medianOfPixelsFast64(dct);

    let hash = 0n;
    for (let idx = 0; idx < dct.length; idx += 1) {
        if ((dct[idx] ?? 0) > median) {
            hash |= 1n << BigInt((HASH_SIZE * HASH_SIZE) - idx - 1);
        }
    }

    return hash.toString(16);
}
