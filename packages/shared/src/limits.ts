import { z } from 'zod';

// Byte limits apply to UTF-8, including inputs that use multibyte characters.
export const MAX_CLIENT_FRAME_BYTES = 16 * 1024;
export const MAX_WATCH_LINE_BYTES = 16 * 1024;
export const MAX_TEXT_BYTES = 8 * 1024;
export const MAX_COMMANDS = 4096;
export const MAX_ANSWERS = 256;
export const MAX_COMMAND_HISTORY_BYTES = 1024 * 1024;
export const MAX_ANSWER_HISTORY_BYTES = 256 * 1024;

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function boundedText(bytes: number) {
  return z
    .string()
    .max(bytes)
    .refine((text) => utf8Bytes(text) <= bytes, 'UTF-8 byte limit exceeded');
}

export const InboxMessageSchema = z.discriminatedUnion('cmd', [
  z.object({ cmd: z.literal('hint') }).strict(),
  z.object({ cmd: z.literal('status') }).strict(),
  z.object({ cmd: z.literal('submit'), text: boundedText(MAX_TEXT_BYTES) }).strict(),
  z.object({ cmd: z.literal('explain'), text: boundedText(MAX_TEXT_BYTES) }).strict(),
]);

export const CmdlogEntrySchema = z
  .object({
    epoch: z.number().int().nonnegative().safe(),
    exitCode: z.number().int().min(0).max(255),
    cwd: boundedText(4096).refine((text) => text.startsWith('/')),
    command: boundedText(MAX_TEXT_BYTES).refine((text) => text.length > 0),
  })
  .strict();
