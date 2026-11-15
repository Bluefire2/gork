import { CallableTool, FunctionCall, FunctionDeclaration, Part, Tool } from '@google/genai';

export const SHOW_STATS_CARD = 'show_stats_card';

const DECLARATIONS: FunctionDeclaration[] = [
  {
    name: SHOW_STATS_CARD,
    description:
      "Attach an image of a player's whole skills tab (every level, plus quest points, diaries, " +
      'combat achievements, clues and collection log) to your reply. Only when they ask to see ' +
      'their stats, levels or account, or the question is about their account as a whole and ' +
      'the whole picture helps. Not when the question needs only a few specific levels. The ' +
      'image is drawn from a get_stats result for the same player in this reply.',
    parametersJsonSchema: {
      type: 'object',
      properties: { rsn: { type: 'string', description: "The player's RuneScape name, as passed to get_stats" } },
      required: ['rsn'],
    },
  },
];

/** A player name in the form used to match a show_stats_card call to a get_stats result. */
export function rsnKey(rsn: string): string {
  return rsn.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
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
      const response = rsn
        ? {
            output:
              `The skills card for "${rsn}" will be attached to your reply, drawn from their get_stats ` +
              "result in this reply (look them up with get_stats if you haven't). Don't list their levels.",
          }
        : { error: 'Pass the RuneScape name of the player whose card to attach.' };
      parts.push({ functionResponse: { id: call.id, name: call.name, response } });
    }
    return parts;
  }
}
