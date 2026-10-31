import { Content } from '@google/genai';
import { Message } from 'discord.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { BotFlags } from './flags';

// One JSON file per mention the bot handles, named by the mention's message ID, so a bug
// report only needs a message link. Only the newest MAX_TRACES are kept.
export const TRACE_DIR = path.join(__dirname, '..', 'traces');
const MAX_TRACES = 500;

// Tool results can be large (a whole bank, a price history); the prompt and response are kept whole.
const MAX_TOOL_STRING = 4000;

export interface Trace {
  build: string;
  time: string;
  durationMs?: number;
  guild: string | null;
  channel: string;
  message: string;
  author: string;
  content: string;
  flags?: BotFlags;
  // true when a server config command answered instead of Gemini
  command?: boolean;
  model?: string;
  prompt?: string;
  toolCalls?: unknown;
  response?: string;
  // IDs of the messages the bot sent in reply
  replies: string[];
  error?: string;
}

export function newTrace(message: Message, build: string): Trace {
  return {
    build,
    time: new Date().toISOString(),
    guild: message.guild ? `${message.guild.name} (${message.guild.id})` : null,
    channel: message.channelId,
    message: message.id,
    author: `${message.author.tag} (${message.author.id})`,
    content: message.content,
    replies: [],
  };
}

/** The automatic function calling history, with long strings cut short. */
export function traceToolCalls(history: Content[] | undefined): unknown {
  if (!history?.length) return undefined;
  return JSON.parse(JSON.stringify(history, (_key, value) =>
    typeof value === 'string' && value.length > MAX_TOOL_STRING
      ? `${value.slice(0, MAX_TOOL_STRING)}... [${value.length - MAX_TOOL_STRING} more chars]`
      : value));
}

/**
 * Writes the trace and deletes the oldest ones beyond the limit. Never throws: a trace that
 * can't be saved must not affect the reply.
 */
export async function saveTrace(trace: Trace, dir = TRACE_DIR, max = MAX_TRACES): Promise<void> {
  try {
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(dir, `${trace.message}.json`), JSON.stringify(trace, null, 2), { mode: 0o600 });

    // Message IDs are snowflakes, which sort by creation time
    const ids = (await fs.readdir(dir))
      .filter((f) => /^\d+\.json$/.test(f))
      .map((f) => BigInt(f.slice(0, -'.json'.length)))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const id of ids.slice(0, Math.max(0, ids.length - max))) {
      await fs.rm(path.join(dir, `${id}.json`), { force: true });
    }
  } catch (error) {
    console.error('Could not save trace:', error);
  }
}
