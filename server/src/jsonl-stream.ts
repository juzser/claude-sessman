import { createReadStream } from "node:fs";

/**
 * Streams the bytes of `filePath` starting at `startOffset`, calling `onLine`
 * for every complete (newline-terminated) line found. Returns the byte offset
 * immediately after the last complete line — a trailing partial line (no
 * newline yet) is left unconsumed so it's re-read whole next time. Never
 * buffers more than the current chunk plus one pending partial line.
 *
 * Standalone module (not defined inline in transcript-index.ts) so both the
 * main-chain transcript scanner (transcript-index.ts) and the per-subagent
 * sidecar scanner (subagent-index.ts) can share the exact same
 * offset-tracking/half-written-line behaviour without either file importing
 * from the other.
 */
export function streamAppend(
  filePath: string,
  startOffset: number,
  onLine: (line: string) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { start: startOffset });
    let leftover: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let offset = startOffset;

    stream.on("data", (chunk) => {
      const data = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      const buf = leftover.length ? Buffer.concat([leftover, data]) : data;
      let lineStart = 0;
      for (;;) {
        const newlineIndex = buf.indexOf(0x0a, lineStart);
        if (newlineIndex === -1) break;
        const lineBuf = buf.subarray(lineStart, newlineIndex);
        onLine(lineBuf.toString("utf8"));
        offset += newlineIndex - lineStart + 1;
        lineStart = newlineIndex + 1;
      }
      leftover = buf.subarray(lineStart);
    });
    stream.on("end", () => resolve(offset));
    stream.on("error", reject);
  });
}
