import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { inspectVideoFrames, inspectFunscript } from "../services/converterInspection";

export function formatConverterResult(name: string, result: unknown): CallToolResult | undefined {
  if (name === "fland_converter_inspectFrames") {
    const { frames, ...metadata } = result as Awaited<ReturnType<typeof inspectVideoFrames>>;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ...metadata,
            frames: frames.map((frame) => ({
              timestampMs: frame.timestampMs,
              seekTimeMs: frame.seekTimeMs,
            })),
          }),
        },
        ...frames.flatMap((frame): CallToolResult["content"] => [
          {
            type: "text",
            text: `Video frame requested at ${frame.timestampMs} ms (decoder seek ${frame.seekTimeMs} ms)`,
          },
          { type: "image", data: frame.data, mimeType: frame.mimeType },
        ]),
      ],
    };
  }
  if (name === "fland_converter_inspectFunscript") {
    const { plot, ...document } = result as Awaited<ReturnType<typeof inspectFunscript>>;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ...document,
            ...(plot ? { plot: { width: plot.width, height: plot.height, axes: plot.axes } } : {}),
          }),
        },
        ...(plot ? [{ type: "image" as const, mimeType: plot.mimeType, data: plot.data }] : []),
      ],
    };
  }
}
