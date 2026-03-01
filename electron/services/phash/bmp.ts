import type { DecodedFrame } from "./types";

const BITMAP_FILE_HEADER_SIZE = 14;
const DIB_HEADER_SIZE_OFFSET = 14;
const BMP_HEADER_MIN_SIZE = 40;
const PIXEL_OFFSET_OFFSET = 10;
const WIDTH_OFFSET = 18;
const HEIGHT_OFFSET = 22;
const PLANES_OFFSET = 26;
const BITS_PER_PIXEL_OFFSET = 28;
const COMPRESSION_OFFSET = 30;

function ensureLength(buffer: Buffer, minLength: number): void {
    if (buffer.length < minLength) {
        throw new Error("Invalid BMP data: buffer too small.");
    }
}

export function decodeBmpFrame(buffer: Buffer): DecodedFrame {
    ensureLength(buffer, BITMAP_FILE_HEADER_SIZE + BMP_HEADER_MIN_SIZE);

    if (buffer.toString("ascii", 0, 2) !== "BM") {
        throw new Error("Unsupported BMP format: missing BM signature.");
    }

    const dibHeaderSize = buffer.readUInt32LE(DIB_HEADER_SIZE_OFFSET);
    if (dibHeaderSize < BMP_HEADER_MIN_SIZE) {
        throw new Error(`Unsupported BMP DIB header size: ${dibHeaderSize}.`);
    }

    const pixelOffset = buffer.readUInt32LE(PIXEL_OFFSET_OFFSET);
    const width = buffer.readInt32LE(WIDTH_OFFSET);
    const heightRaw = buffer.readInt32LE(HEIGHT_OFFSET);
    const planes = buffer.readUInt16LE(PLANES_OFFSET);
    const bitsPerPixel = buffer.readUInt16LE(BITS_PER_PIXEL_OFFSET);
    const compression = buffer.readUInt32LE(COMPRESSION_OFFSET);

    if (planes !== 1) {
        throw new Error(`Unsupported BMP planes value: ${planes}.`);
    }
    if (compression !== 0) {
        throw new Error(`Unsupported BMP compression value: ${compression}.`);
    }
    if (width <= 0 || heightRaw === 0) {
        throw new Error(`Unsupported BMP dimensions: ${width}x${heightRaw}.`);
    }
    if (bitsPerPixel !== 24 && bitsPerPixel !== 32) {
        throw new Error(`Unsupported BMP bits per pixel: ${bitsPerPixel}.`);
    }

    const height = Math.abs(heightRaw);
    const topDown = heightRaw < 0;

    const bytesPerPixel = bitsPerPixel / 8;
    const rowStride = bitsPerPixel === 24
        ? (((width * bytesPerPixel) + 3) & ~3)
        : width * bytesPerPixel;

    const requiredLength = pixelOffset + (rowStride * height);
    ensureLength(buffer, requiredLength);

    const rgba = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y += 1) {
        const srcY = topDown ? y : (height - 1 - y);
        const srcRowOffset = pixelOffset + (srcY * rowStride);
        const dstRowOffset = y * width * 4;

        for (let x = 0; x < width; x += 1) {
            const srcOffset = srcRowOffset + (x * bytesPerPixel);
            const dstOffset = dstRowOffset + (x * 4);

            const b = buffer[srcOffset] ?? 0;
            const g = buffer[srcOffset + 1] ?? 0;
            const r = buffer[srcOffset + 2] ?? 0;
            const a = bitsPerPixel === 32 ? (buffer[srcOffset + 3] ?? 255) : 255;

            rgba[dstOffset] = r;
            rgba[dstOffset + 1] = g;
            rgba[dstOffset + 2] = b;
            rgba[dstOffset + 3] = a;
        }
    }

    return {
        width,
        height,
        data: rgba,
    };
}
