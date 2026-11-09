import { CallableTool, FunctionCall, FunctionDeclaration, Part, Tool } from '@google/genai';

export const PROPOSE_DEEP_RESEARCH = 'propose_deep_research';
const MAX_QUESTIONS = 3;

/** What Gemini wants researched, before the user has confirmed it. */
export interface ResearchProposal {
  brief: string;
  questions: string[];
}

export const RESEARCH_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: PROPOSE_DEEP_RESEARCH,
    description:
      'Propose a deep-research run instead of answering: a separate agent spends 5-20 minutes ' +
      'searching and reading many sources, and the report is sent to the user by DM. It costs ' +
      'money, and the user is asked to confirm before it runs. Only for a thorough, multi-source ' +
      'investigation that a chat answer cannot do justice to: comparisons, surveys of options, ' +
      '"research X", "deep dive", "write me a report". Never for quick facts, opinions, chat, or ' +
      'Old School RuneScape questions the lookup tools answer.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        brief: {
          type: 'string',
          description:
            'The research question, self-contained in 1-3 sentences, including whatever context ' +
            'from the conversation the researcher needs (they see nothing else).',
        },
        questions: {
          type: 'array',
          items: { type: 'string' },
          description:
            `Up to ${MAX_QUESTIONS} clarifying questions whose answers would materially change the ` +
            'research (scope, region, budget, time frame). Empty when there are none.',
        },
      },
      required: ['brief', 'questions'],
    },
  },
];

/**
 * Reads a proposal out of a function call's arguments; null if there is no usable brief.
 */
export function proposalFromArgs(args: unknown): ResearchProposal | null {
  const record = (args ?? {}) as Record<string, unknown>;
  const brief = typeof record.brief === 'string' ? record.brief.trim() : '';
  if (!brief) return null;
  const questions = Array.isArray(record.questions)
    ? record.questions
        .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
        .map((q) => q.trim())
        .slice(0, MAX_QUESTIONS)
    : [];
  return { brief, questions };
}

/**
 * Lets Gemini propose a deep-research run. The call only records the proposal: the bot then
 * asks the user to confirm, and whatever Gemini says after the call is not posted.
 */
export class ResearchTool implements CallableTool {
  proposal: ResearchProposal | null = null;

  async tool(): Promise<Tool> {
    return { functionDeclarations: RESEARCH_DECLARATIONS };
  }

  // Gemini's automatic function calling hands every tool all of a turn's calls; skip the rest.
  async callTool(functionCalls: FunctionCall[]): Promise<Part[]> {
    const parts: Part[] = [];
    for (const call of functionCalls) {
      if (call.name !== PROPOSE_DEEP_RESEARCH) continue;
      const proposal = proposalFromArgs(call.args);
      console.log(`Research tool call: ${JSON.stringify(call.args ?? {})}`);
      let response: Record<string, string>;
      if (proposal) {
        this.proposal = proposal;
        response = {
          output:
            'Recorded. The user is now being asked to confirm. Reply with one short sentence; ' +
            'do not answer the question yourself.',
        };
      } else {
        response = { error: 'A brief is required.' };
      }
      parts.push({ functionResponse: { id: call.id, name: call.name, response } });
    }
    return parts;
  }
}
