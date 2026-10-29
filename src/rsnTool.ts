import { CallableTool, FunctionCall, FunctionDeclaration, Part, Tool } from '@google/genai';
import { normalizeRsn } from './commands';
import { getUserRsn, removeUserRsn, setUserRsn } from './serverConfig';

const DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'set_my_rsn',
    description:
      "Save the RuneScape name of the person you're replying to, so later questions about " +
      '"my" account use it. Only for their own name, when they ask you to set, save or change ' +
      "it, or tell you their name. Replaces any name they saved before.",
    parametersJsonSchema: {
      type: 'object',
      properties: { rsn: { type: 'string', description: 'Their RuneScape name, 1-12 characters' } },
      required: ['rsn'],
    },
  },
  {
    name: 'clear_my_rsn',
    description: "Forget the saved RuneScape name of the person you're replying to, when they ask.",
    parametersJsonSchema: { type: 'object', properties: {} },
  },
];

/**
 * Lets Gemini save or clear the message author's RuneScape name, so "set my rsn to X" works
 * like --setRsn. Made per message and bound to its author: it can only change their own name.
 */
export class RsnTool implements CallableTool {
  constructor(private readonly userId: string) {}

  async tool(): Promise<Tool> {
    return { functionDeclarations: DECLARATIONS };
  }

  // Gemini's automatic function calling hands every tool all of a turn's calls; skip the rest.
  async callTool(functionCalls: FunctionCall[]): Promise<Part[]> {
    const parts: Part[] = [];
    for (const call of functionCalls) {
      const response = this.run(call);
      if (response) {
        console.log(`RSN tool call: ${call.name} ${JSON.stringify(call.args ?? {})}`);
        parts.push({ functionResponse: { id: call.id, name: call.name, response } });
      }
    }
    return parts;
  }

  private run(call: FunctionCall): Record<string, string> | null {
    switch (call.name) {
      case 'set_my_rsn': {
        const rsn = normalizeRsn(String(call.args?.rsn ?? ''));
        if (!rsn) {
          return { error: 'Not a valid RuneScape name: 1-12 letters, numbers, spaces, - or _.' };
        }
        const previous = getUserRsn(this.userId);
        setUserRsn(this.userId, rsn);
        return { output: previous && previous !== rsn ? `Saved "${rsn}" (was "${previous}").` : `Saved "${rsn}".` };
      }
      case 'clear_my_rsn':
        return { output: removeUserRsn(this.userId) ? 'Forgot their RuneScape name.' : 'They had no saved name.' };
      default:
        return null;
    }
  }
}
