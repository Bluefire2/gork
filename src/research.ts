import { GoogleGenAI } from '@google/genai';
import { AttachmentBuilder, Client, Message, MessageCreateOptions } from 'discord.js';
import * as fs from 'fs';
import * as path from 'path';
import { BotFlags } from './flags';
import { ResearchProposal } from './researchTool';
import { getServerSetting } from './serverConfig';
import { Trace } from './trace';
import { BUILD_ID } from './version';

// Gemini's Deep Research agents (Interactions API). They only run in the background: create
// returns at once and the result is polled. The "max" one is slower, more thorough and costs
// 2-3x as much; --advanced picks it.
export const DEEP_RESEARCH_AGENT = 'deep-research-preview-04-2026';
export const DEEP_RESEARCH_AGENT_MAX = 'deep-research-max-preview-04-2026';

// A proposal nobody confirms is forgotten after this
const PROPOSAL_TTL_MS = 30 * 60_000;
const POLL_INTERVAL_MS = 20_000;
// The agent's own limit is 60 minutes
const JOB_TIMEOUT_MS = 65 * 60_000;
// Each run costs real money (about $1-3, max agent $3-7), so a few guards
const MAX_RUNNING_GLOBAL = 3;
const DEFAULT_DAILY_PER_GUILD = 5;
// Finished jobs kept in the file (running ones are always kept)
const MAX_JOBS_KEPT = 200;
// How much of the report goes in the message itself; the whole report is attached
const EXCERPT_CHARS = 1500;
const DISCORD_MESSAGE_LIMIT = 2000;

const JOBS_PATH = path.join(__dirname, '..', 'researchJobs.json');
const REPORTS_DIR = path.join(__dirname, '..', 'research');

// Answers in a reply to the proposal. Anything else in such a reply is taken as clarifications.
// A wrong cancel costs a re-ask; a wrong start costs money, so cancelling is matched loosely
// ("cancel that", "never mind, thanks") and starting only by whole words.
const GO_WORDS = /^(go|yes|yes please|yep|y|ok|okay|sure|start|do it|proceed|confirm)\W*$/i;
const CANCEL_WORDS = /^(no|nah|nope|no thanks|not now|don't|dont|(cancel|stop|never ?mind|forget it)\b.{0,30})\W*$/i;
// Without a reply to the proposal, only words that can't be an answer to anything else count:
// "yes" or "no" to some other question must not start or drop a run.
const BARE_GO_WORDS = /^(go|start|do it|proceed)\W*$/i;
const BARE_CANCEL_WORDS = /^(cancel|stop|never ?mind|forget it)\W*$/i;

/** A proposal posted in a channel, waiting for its author to confirm or cancel it. */
interface Pending {
  brief: string;
  questions: string[];
  agent: string;
  guildId: string;
  proposalMessageId: string;
  originalMessageId: string;
  expiresAt: number;
}

/** One deep-research run, from confirmation to delivery. Persisted so a restart can resume it. */
export interface ResearchJob {
  interactionId: string;
  agent: string;
  build: string;
  guildId: string;
  channelId: string;
  requesterId: string;
  requesterTag: string;
  brief: string;
  clarifications?: string;
  proposalMessageId: string;
  confirmMessageId: string;
  startedAt: string;
  status: 'running' | 'done' | 'failed';
  finishedAt?: string;
  // Where the report goes: DMs unless they're closed
  deliverTo: 'dm' | 'channel';
  // Where it actually went
  deliveredTo?: 'dm' | 'channel';
  // The run's final status from Gemini
  finalStatus?: string;
  error?: string;
  // Message IDs of the report / failure notice
  replies?: string[];
}

interface JobsFile {
  jobs: ResearchJob[];
}

function loadJobs(file: string): ResearchJob[] {
  try {
    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<JobsFile>;
    return Array.isArray(data.jobs) ? data.jobs : [];
  } catch (error) {
    console.error('Could not read research jobs:', error);
    return [];
  }
}

function isRunning(job: ResearchJob): boolean {
  return job.status === 'running';
}

function minutesSince(iso: string): number {
  return Math.round((Date.now() - Date.parse(iso)) / 60_000);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** The first part of the report, cut at a paragraph or line break. */
function excerpt(report: string, max: number): string {
  const text = report.trim();
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const cut = Math.max(head.lastIndexOf('\n\n'), head.lastIndexOf('\n'), Math.floor(max / 2));
  return `${head.slice(0, cut).trimEnd()}\n…`;
}

/** What the agent is asked. It sees nothing but this. */
function buildInput(brief: string, clarifications?: string): string {
  const parts = [brief];
  if (clarifications) parts.push(`Clarifications from the requester:\n${clarifications}`);
  parts.push('Write the report in Markdown with headings, and list your sources with URLs at the end.');
  return parts.join('\n\n');
}

/** The report text out of a finished interaction: the SDK's output_text, else the last text step. */
function reportText(result: { output_text?: string; steps?: unknown[] }): string | undefined {
  if (result.output_text?.trim()) return result.output_text;
  const steps = Array.isArray(result.steps) ? result.steps : [];
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i] as { type?: string; content?: unknown };
    if (step?.type !== 'model_output' || !Array.isArray(step.content)) continue;
    const text = (step.content as Array<{ type?: string; text?: string }>)
      .filter((c) => c?.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('');
    if (text.trim()) return text;
  }
  return undefined;
}

function isNotFound(error: unknown): boolean {
  const status = (error as { status?: number; statusCode?: number })?.status
    ?? (error as { statusCode?: number })?.statusCode;
  return status === 404 || /not found/i.test(errorMessage(error));
}

/**
 * Deep-research mode. Gemini (or --research) proposes a run; the bot posts the proposal and waits
 * for the author to confirm in a second message, which may answer clarifying questions; the run
 * then goes to Gemini's Deep Research agent in the background and is polled until the report is
 * ready, which is sent to the requester by DM (or in the channel if their DMs are closed).
 * Jobs are kept in researchJobs.json so a restart (every deploy) resumes polling.
 */
export class Research {
  private readonly pending = new Map<string, Pending>();
  // Runs being started (user ID -> guild ID): they count against the caps while the Gemini call
  // is in flight, so two confirmations arriving together can't both pass the checks.
  private readonly starting = new Map<string, string>();
  private jobs: ResearchJob[];
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly client: Client,
    private readonly genAI: GoogleGenAI,
    private readonly jobsPath = JOBS_PATH,
    private readonly reportsDir = REPORTS_DIR,
  ) {
    this.jobs = loadJobs(jobsPath);
  }

  /** Called once the client is ready: picks up runs that were in progress when the bot stopped. */
  resume(): void {
    const running = this.jobs.filter(isRunning);
    if (running.length === 0) return;
    console.log(`Resuming ${running.length} deep-research job(s): ${running.map((j) => j.interactionId).join(', ')}`);
    this.ensurePolling();
    void this.tick();
  }

  /**
   * Why a run can't start now for this person in this server; null when it can. Checked when
   * deciding whether to offer the tool, when a proposal is made, and again on confirmation.
   */
  refusal(guildId: string | null, userId: string): string | null {
    if (!guildId) return 'Deep research only works in a server channel.';
    if (getServerSetting<boolean>(guildId, 'research', true) === false) {
      return 'Deep research is turned off on this server (`--setFlag="research: true"` turns it on).';
    }
    const mine = this.jobs.find((j) => isRunning(j) && j.requesterId === userId);
    if (mine) {
      return `You already have a research run going (started ${minutesSince(mine.startedAt)} min ago); wait for that one to finish.`;
    }
    if (this.starting.has(userId)) {
      return 'Your research run is just starting; wait for that one to finish.';
    }
    if (this.jobs.filter(isRunning).length + this.starting.size >= MAX_RUNNING_GLOBAL) {
      return `I'm already running ${MAX_RUNNING_GLOBAL} research jobs; try again in a little while.`;
    }
    const limit = getServerSetting<number>(guildId, 'researchDaily', DEFAULT_DAILY_PER_GUILD) ?? DEFAULT_DAILY_PER_GUILD;
    const dayAgo = Date.now() - 24 * 60 * 60_000;
    const today = this.jobs.filter((j) => j.guildId === guildId && Date.parse(j.startedAt) > dayAgo).length
      + [...this.starting.values()].filter((g) => g === guildId).length;
    if (today >= limit) {
      return `This server has used its ${limit} deep-research run${limit === 1 ? '' : 's'} for today.`;
    }
    return null;
  }

  /** Whether Gemini should be offered propose_deep_research for this mention. */
  offersTool(message: Message): boolean {
    return this.refusal(message.guildId, message.author.id) === null;
  }

  /**
   * Posts a proposal and remembers it until the author confirms or cancels it, or it expires. A
   * newer proposal by the same person in the same channel replaces the older one.
   */
  async propose(message: Message, proposal: ResearchProposal, flags: BotFlags, trace: Trace): Promise<void> {
    const refusal = this.refusal(message.guildId, message.author.id);
    if (refusal) {
      trace.research = { refused: refusal };
      trace.replies.push((await message.reply(refusal)).id);
      return;
    }
    const agent = flags.advanced ? DEEP_RESEARCH_AGENT_MAX : DEEP_RESEARCH_AGENT;
    const lines = [
      "🔎 This looks like a job for deep research — it takes 5–20 minutes and I'll DM you the report.",
      '',
      `**Brief:** ${proposal.brief}`,
      '',
    ];
    if (proposal.questions.length > 0) {
      lines.push('Before I start:');
      proposal.questions.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
      lines.push('', 'Reply to this message (keep the ping on) with your answers (or just "go"), or "cancel". I\'ll wait 30 minutes.');
    } else {
      lines.push('Reply to this message (keep the ping on) with "go" to start, or "cancel". I\'ll wait 30 minutes.');
    }
    if (agent === DEEP_RESEARCH_AGENT_MAX) lines.push('_(--advanced: the slower, more thorough agent)_');

    const reply = await message.reply(shorten(lines.join('\n'), DISCORD_MESSAGE_LIMIT));
    trace.replies.push(reply.id);
    trace.research = { proposal: { brief: proposal.brief, questions: proposal.questions, agent } };
    this.pending.set(this.key(message.channelId, message.author.id), {
      brief: proposal.brief,
      questions: proposal.questions,
      agent,
      guildId: message.guildId!,
      proposalMessageId: reply.id,
      originalMessageId: message.id,
      expiresAt: Date.now() + PROPOSAL_TTL_MS,
    });
  }

  /**
   * If this mention answers a pending proposal by its author (a reply to the proposal, or a bare
   * go/cancel word), acts on it and returns true. Anything else is an ordinary message.
   */
  async handleReply(message: Message, content: string, flags: BotFlags, trace: Trace): Promise<boolean> {
    const key = this.key(message.channelId, message.author.id);
    const pending = this.pending.get(key);
    if (!pending) return false;
    if (Date.now() > pending.expiresAt) {
      this.pending.delete(key);
      return false;
    }
    const isReply = message.reference?.messageId === pending.proposalMessageId;
    // A reply to some other message is about that message, whatever it says
    if (message.reference && !isReply) return false;
    const go = isReply ? GO_WORDS.test(content) : BARE_GO_WORDS.test(content);
    const cancel = isReply ? CANCEL_WORDS.test(content) : BARE_CANCEL_WORDS.test(content);
    if (!isReply && !go && !cancel) return false;

    this.pending.delete(key);
    if (cancel) {
      trace.research = { dropped: true };
      trace.replies.push((await message.reply('Dropped.')).id);
      return true;
    }
    if (flags.advanced) pending.agent = DEEP_RESEARCH_AGENT_MAX;
    await this.start(pending, message, go ? undefined : content, trace);
    return true;
  }

  private key(channelId: string, userId: string): string {
    return `${channelId}:${userId}`;
  }

  private async start(pending: Pending, message: Message, clarifications: string | undefined, trace: Trace): Promise<void> {
    const reply = async (text: string) => {
      trace.replies.push((await message.reply(text)).id);
    };
    // The state may have changed since the proposal
    const refusal = this.refusal(pending.guildId, message.author.id);
    if (refusal) {
      trace.research = { refused: refusal };
      await reply(refusal);
      return;
    }

    // Hold the slot (synchronously, right after the checks) until the job is recorded
    this.starting.set(message.author.id, pending.guildId);
    let job: ResearchJob;
    try {
      const interaction = await this.genAI.interactions.create({
        agent: pending.agent,
        agent_config: { type: 'deep-research', thinking_summaries: 'none' },
        background: true,
        input: buildInput(pending.brief, clarifications),
      });
      job = {
        interactionId: interaction.id,
        agent: pending.agent,
        build: BUILD_ID,
        guildId: pending.guildId,
        channelId: message.channelId,
        requesterId: message.author.id,
        requesterTag: message.author.tag,
        brief: pending.brief,
        clarifications,
        proposalMessageId: pending.proposalMessageId,
        confirmMessageId: message.id,
        startedAt: new Date().toISOString(),
        status: 'running',
        deliverTo: 'dm',
      };
      this.jobs.push(job);
      this.save();
    } catch (error) {
      console.error('Could not start deep research:', error);
      trace.research = { refused: `start failed: ${errorMessage(error)}` };
      await reply(`❌ Couldn't start the research: ${shorten(errorMessage(error), 300)}`);
      return;
    } finally {
      this.starting.delete(message.author.id);
    }
    // Watch it from now on, whatever happens to the messages below
    this.ensurePolling();
    trace.research = { jobId: job.interactionId };
    console.log(`Deep research started: ${job.interactionId} (${pending.agent}) for ${job.requesterTag}`);

    // Say hello in their DMs now, so we know where the report can go
    const dmOpen = await this.dm(job, `🔎 Researching: ${shorten(pending.brief, 1500)}\n\nThe report will arrive here, usually within 5–20 minutes.`);
    if (!dmOpen) {
      job.deliverTo = 'channel';
      this.save();
    }
    await reply(dmOpen
      ? "Started — I'll DM you the report, usually within 5–20 minutes."
      : "Started — I can't DM you (are your DMs closed?), so I'll post the report here, usually within 5–20 minutes.");
  }

  private ensurePolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const job of this.jobs.filter(isRunning)) {
        try {
          await this.check(job);
        } catch (error) {
          console.error(`Deep research ${job.interactionId}: poll failed, will retry:`, errorMessage(error));
        }
      }
    } finally {
      this.ticking = false;
      if (this.timer && !this.jobs.some(isRunning)) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }
  }

  private async check(job: ResearchJob): Promise<void> {
    // Ask Gemini first: after a long outage the run may have finished, and that report is paid
    // for. The timeout only applies to a run that is still going (or can't be asked about).
    const timedOut = Date.now() - Date.parse(job.startedAt) > JOB_TIMEOUT_MS;
    const timeOut = async () => {
      await this.genAI.interactions.cancel(job.interactionId).catch(() => {});
      await this.finish(job, 'timed_out', { error: `no result after ${Math.round(JOB_TIMEOUT_MS / 60_000)} minutes` });
    };

    let result;
    try {
      result = await this.genAI.interactions.get(job.interactionId);
    } catch (error) {
      if (isNotFound(error)) {
        await this.finish(job, 'not_found', { error: 'Gemini no longer has this interaction' });
        return;
      }
      if (timedOut) {
        await timeOut();
        return;
      }
      throw error;
    }

    const status = String(result.status);
    const errors = result.errors?.map((e) => e.message ?? e.code).filter(Boolean).join('; ');
    switch (status) {
      case 'in_progress':
      case 'queued':
      case 'requires_continuation':
        if (timedOut) await timeOut();
        return;
      case 'completed': {
        const report = reportText(result);
        await this.finish(job, status, report ? { report } : { error: 'the agent returned an empty report' });
        return;
      }
      case 'incomplete':
      case 'budget_exceeded': {
        // Stopped early; hand over whatever it wrote
        const report = reportText(result);
        await this.finish(job, status, report
          ? { report, note: `⚠️ The research stopped early (${status}); this is what it had.` }
          : { error: errors || status });
        return;
      }
      default:
        // failed, cancelled, requires_action (the agent wants input, which this bot doesn't do)
        await this.finish(job, status, { error: errors || status });
    }
  }

  /**
   * Records the outcome first, then tells the requester. If sending fails, the job is still
   * finished (and the report is on disk), rather than delivered again on the next tick.
   */
  private async finish(job: ResearchJob, finalStatus: string, outcome: { report?: string; note?: string; error?: string }): Promise<void> {
    job.status = outcome.report ? 'done' : 'failed';
    job.finishedAt = new Date().toISOString();
    job.finalStatus = finalStatus;
    job.error = outcome.error;
    this.save();
    console.log(`Deep research ${job.interactionId}: ${job.status} (${finalStatus}) after ${minutesSince(job.startedAt)} min`);

    try {
      if (outcome.report) {
        this.saveReport(job.interactionId, outcome.report);
        await this.deliverReport(job, outcome.report, outcome.note);
      } else {
        const text = `❌ Research failed: ${shorten(outcome.error ?? finalStatus, 500)}\n_${shorten(job.brief, 300)}_`;
        await this.notifyChannel(job, text);
        if (job.deliverTo === 'dm') await this.dm(job, text);
      }
    } catch (error) {
      console.error(`Deep research ${job.interactionId}: could not deliver:`, error);
      job.error = `${job.error ? `${job.error}; ` : ''}delivery failed: ${errorMessage(error)}`;
    }
    this.save();
  }

  private async deliverReport(job: ResearchJob, report: string, note?: string): Promise<void> {
    const header = `📄 **Research report:** ${shorten(job.brief, 300)}`;
    const footer = '_Full report attached._';
    const fixed = [header, note, footer].filter(Boolean).join('\n\n').length + 4;
    const body = excerpt(report, Math.min(EXCERPT_CHARS, DISCORD_MESSAGE_LIMIT - fixed));
    const options: MessageCreateOptions = {
      content: [header, note, body, footer].filter(Boolean).join('\n\n'),
      files: [new AttachmentBuilder(Buffer.from(report, 'utf8'), { name: 'research-report.md' })],
    };

    if (job.deliverTo === 'dm' && (await this.dm(job, options))) {
      job.deliveredTo = 'dm';
      await this.notifyChannel(job, '✅ Done — the report is in your DMs.');
    } else {
      // DMs closed (now, or since the start): the channel gets it instead
      await this.notifyChannel(job, options);
      job.deliveredTo = 'channel';
    }
  }

  /** Sends to the requester's DMs; false when that isn't possible (closed DMs, blocked, left). */
  private async dm(job: ResearchJob, options: string | MessageCreateOptions): Promise<boolean> {
    try {
      const user = await this.client.users.fetch(job.requesterId);
      const sent = await user.send(options);
      (job.replies ??= []).push(sent.id);
      return true;
    } catch (error) {
      console.log(`Deep research ${job.interactionId}: cannot DM ${job.requesterTag}: ${errorMessage(error)}`);
      return false;
    }
  }

  /** Posts in the channel where the run was confirmed, as a reply to the confirmation. */
  private async notifyChannel(job: ResearchJob, options: string | MessageCreateOptions): Promise<void> {
    const channel = await this.client.channels.fetch(job.channelId);
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
      throw new Error(`channel ${job.channelId} is gone or not a text channel`);
    }
    const message: MessageCreateOptions = typeof options === 'string' ? { content: options } : { ...options };
    message.reply = { messageReference: job.confirmMessageId, failIfNotExists: false };
    const sent = await channel.send(message);
    (job.replies ??= []).push(sent.id);
  }

  private saveReport(interactionId: string, report: string): void {
    try {
      fs.mkdirSync(this.reportsDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(this.reportsDir, `${interactionId}.md`), report, { mode: 0o600 });
    } catch (error) {
      console.error('Could not save research report:', error);
    }
  }

  // Write a temp file and rename it over the jobs file, like serverConfig.ts, so a crash can't
  // leave a half-written file. Running jobs are always kept; old finished ones are pruned.
  private save(): void {
    const running = this.jobs.filter(isRunning);
    const finished = this.jobs
      .filter((j) => !isRunning(j))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .slice(-MAX_JOBS_KEPT);
    this.jobs = [...finished, ...running].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    try {
      const tempPath = `${this.jobsPath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify({ jobs: this.jobs } satisfies JobsFile, null, 2), { encoding: 'utf-8', mode: 0o600 });
      fs.renameSync(tempPath, this.jobsPath);
    } catch (error) {
      console.error('Could not save research jobs:', error);
    }
  }
}
