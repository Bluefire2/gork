import { Content } from '@google/genai';
import { AttachmentBuilder } from 'discord.js';
import { isPlayerStats, renderStatsCard } from './statsCard';
import { isPriceHistory, renderPriceCard } from './priceCard';

// Most cards per reply, in case Gemini looks up several players or items at once.
const MAX_CARDS = 3;

interface CardKind<T> {
  tool: string;
  is(value: unknown): value is T;
  key(value: T): string; // one card per player or item
  file(value: T): string;
  render(value: T): Promise<Buffer>;
}

const fileName = (name: string, suffix: string) => `${name.replace(/[^A-Za-z0-9_-]+/g, '_')}-${suffix}.png`;

const KINDS: CardKind<any>[] = [
  {
    tool: 'get_stats',
    is: isPlayerStats,
    key: (s) => `stats:${s.rsn.toLowerCase()}`,
    file: (s) => fileName(s.rsn, 'stats'),
    render: renderStatsCard,
  },
  {
    tool: 'get_price_history',
    is: isPriceHistory,
    key: (h) => `price:${h.name}`,
    file: (h) => fileName(h.name, `price-${h.period}`),
    render: renderPriceCard,
  },
];

// mcpToTool passes the MCP CallToolResult through: { content: [{ type: 'text', text: json }] }.
function parseResult(result: unknown): unknown {
  const r = result as { isError?: boolean; content?: { type?: string; text?: string }[] } | undefined;
  const text = r && !r.isError ? r.content?.find((c) => c.type === 'text')?.text : undefined;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Image cards for the tool results in a reply's automatic function calling history: a skills
 * card per player looked up with get_stats, a chart per item looked up with get_price_history.
 * Failed lookups are skipped, and a card that fails to render is left out rather than failing
 * the reply.
 */
export async function replyCards(history: Content[] | undefined): Promise<AttachmentBuilder[]> {
  const found = new Map<string, { kind: CardKind<any>; value: unknown }>();
  for (const content of history ?? []) {
    for (const part of content.parts ?? []) {
      const response = part.functionResponse;
      const kind = KINDS.find((k) => k.tool === response?.name);
      if (!kind) continue;
      const value = parseResult(response!.response);
      if (kind.is(value)) found.set(kind.key(value), { kind, value });
    }
  }

  const cards: AttachmentBuilder[] = [];
  for (const { kind, value } of [...found.values()].slice(0, MAX_CARDS)) {
    try {
      cards.push(new AttachmentBuilder(await kind.render(value), { name: kind.file(value) }));
    } catch (error) {
      console.error(`Could not render the ${kind.tool} card:`, error);
    }
  }
  return cards;
}
