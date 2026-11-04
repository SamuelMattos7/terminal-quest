import { MAX_WATCH_LINE_BYTES } from '@terminal-quest/shared';
import { createBudget, ResourceLimitError } from '../util/resourceLimits.js';

export const WATCH_BYTES_PER_SECOND = 256 * 1024;
export const WATCH_LINES_PER_SECOND = 128;
export const MAX_EXEC_OUTPUT_BYTES = 1024 * 1024;
export const MAX_SHELL_INPUT_BUFFER_BYTES = 64 * 1024;

/** Buffer raw bytes until newline: split UTF-8 code points stay intact.
 * A single fixed allocation also bounds floods of one-byte chunks. */
export function createLineReader(onLine: (line: string) => void, now = Date.now) {
  const pending = Buffer.alloc(MAX_WATCH_LINE_BYTES);
  const bytes = createBudget(WATCH_BYTES_PER_SECOND, now);
  const lines = createBudget(WATCH_LINES_PER_SECOND, now);
  let length = 0;
  return (chunk: Buffer): void => {
    if (!bytes.take(chunk.length)) throw new ResourceLimitError('watch byte rate');
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      const size = end - offset;
      if (length + size > pending.length) throw new ResourceLimitError('watch line bytes');
      chunk.copy(pending, length, offset, end);
      length += size;
      if (newline < 0) break;
      if (!lines.take()) throw new ResourceLimitError('watch line rate');
      const line = pending.toString('utf8', 0, length).replace(/\r$/, '');
      length = 0;
      onLine(line);
      offset = newline + 1;
    }
  };
}
