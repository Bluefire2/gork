import { CallableTool, FunctionCall, FunctionDeclaration, Part, Tool } from '@google/genai';

export const SHOW_STATS_CARD = 'show_stats_card';

const DECLARATIONS: FunctionDeclaration[] = [
  {
    name: SHOW_STATS_CARD,
    description:
      "Attach an image of a player's whole skills tab (every level, plus quest points, diaries, " +
      'combat achievements, clues and collection log) to your reply. Only when someone asks to ' +
      "see the player's stats, levels or account, or the question is about the player's account " +
      'as a whole and the whole picture helps. Not when the question needs only a few specific ' +
      'levels. The image is drawn from a get_stats result for the same player in this reply.',
    parametersJsonSchema: {
      type: 'object',
      properties: { rsn: { type: 'string', description: "The player's RuneScape name, as passed to get_stats" } },
      required: ['rsn'],
    },
  },
];

/**
 * A player name in the form used to match a show_stats_card call to a get_stats result: any
 * two legal spellings of one name (case, spaces vs underscores) give the same key, and quotes
 * or padding Gemini might add around the name are dropped.
 */
export function rsnKey(rsn: string): string {
  return rsn.replace(/^["'\s]+|["'\s]+$/g, '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
}

/**
 * Lets Gemini decide whether a reply gets the skills card. The card used to be attached
 * whenever get_stats was called, which put a player's whole profile under answers that only
 * needed one or two levels. Now get_stats is just data for Gemini; the card is attached only
 * when it also calls this. The call itself does nothing: replyCards reads it from the history.
 */
export class StatsCardTool implements CallableTool {
  async tool(): Promise<Tool> {
    return { functionDeclarations: DECLARATIONS };
  }

  // Gemini's automatic function calling hands every tool all of a turn's calls; skip the rest.
  async callTool(functionCalls: FunctionCall[]): Promise<Part[]> {
    const parts: Part[] = [];
    for (const call of functionCalls) {
      if (call.name !== SHOW_STATS_CARD) continue;
      const rsn = String(call.args?.rsn ?? '').trim();
      console.log(`Stats card tool call: ${JSON.stringify(call.args ?? {})}`);
      // The card is matched up afterwards, so this can't promise one: a lookup that failed or
      // was never made means no image, and the reply text mustn't claim otherwise.
      const response = rsn
        ? {
            output:
              `If this reply has a successful get_stats result for "${rsn}", their skills card is ` +
              "attached to it; otherwise nothing is attached, so don't mention a card. Either way, " +
              "don't list their levels.",
          }
        : { error: 'Pass the RuneScape name of the player whose card to attach.' };
      parts.push({ functionResponse: { id: call.id, name: call.name, response } });
    }
    return parts;
  }
}
