import { CallableTool, FunctionCall, Part, Tool } from '@google/genai';
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

export interface ToolCall {
  name?: string;
  args?: unknown;
  response?: unknown;
}

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
  // History actually fetched: the limit after server setting and cap, and the messages kept
  context?: { limit: number; messages: number };
  // true when a server config command answered instead of Gemini
  command?: boolean;
  model?: string;
  prompt?: string;
  toolCalls?: ToolCall[];
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

// Long strings cut short. Never throws: tracing must not affect the reply.
function truncated(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value, (_key, v) =>
      typeof v === 'string' && v.length > MAX_TOOL_STRING
        ? `${v.slice(0, MAX_TOOL_STRING)}... [${v.length - MAX_TOOL_STRING} more chars]`
        : v));
  } catch {
    return '[could not record]';
  }
}

/**
 * Wraps a tool so each call it answers is added to the trace as it happens, so the calls made
 * before a failed Gemini request are still recorded.
 */
export function traced(tool: CallableTool, trace: Trace): CallableTool {
  return {
    tool: (): Promise<Tool> => tool.tool(),
    async callTool(calls: FunctionCall[]): Promise<Part[]> {
      const parts = await tool.callTool(calls);
      // Without IDs, calls to the same function are matched in order
      const unmatched = [...calls];
      for (const part of parts) {
        const response = part.functionResponse;
        if (!response) continue;
        const i = unmatched.findIndex((c) => (response.id ? c.id === response.id : c.name === response.name));
        const call = i >= 0 ? unmatched.splice(i, 1)[0] : undefined;
        (trace.toolCalls ??= []).push({
          name: response.name,
          args: truncated(call?.args),
          response: truncated(response.response),
        });
      }
      return parts;
    },
  };
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
