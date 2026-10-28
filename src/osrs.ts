import { CallableTool, FunctionCall, Part, Tool, mcpToTool } from '@google/genai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { BUILD_ID } from './version';

// Covers a Cloud Run cold start of the OSRS server.
const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 30_000;
// How long to go without the tools after the server couldn't be reached.
const RETRY_AFTER_MS = 60_000;

const UNAVAILABLE = 'The Old School RuneScape data service is unavailable right now.';

interface Connection {
  client: Client;
  tool: CallableTool;
}

/**
 * Old School RuneScape lookups (hiscores, quests, diaries, gains, GE prices) from the public
 * endpoint of the rs-mcp server. It only serves public data for whichever player is named, so
 * any Discord user may trigger any of its tools.
 *
 * The server runs on Cloud Run and scales to zero, which drops MCP sessions. So the connection
 * is made lazily, and a failed tool call reconnects and retries once before telling Gemini the
 * service is down, rather than failing the whole reply.
 */
export class OsrsTool implements CallableTool {
  // Shared by concurrent messages; replaced only by whoever finds it broken.
  private connection: Promise<Connection> | null = null;
  private retryAfter = 0;

  constructor(private readonly url: string, private readonly token: string) {}

  /** The tool if the server can be reached now, else null (chat then goes on without it). */
  async ifAvailable(): Promise<OsrsTool | null> {
    // After a failed connect, don't make every message wait for the connect timeout.
    if (Date.now() < this.retryAfter) {
      return null;
    }
    try {
      await this.connected();
      return this;
    } catch (error) {
      console.error('OSRS MCP server unavailable:', error);
      this.retryAfter = Date.now() + RETRY_AFTER_MS;
      return null;
    }
  }

  async tool(): Promise<Tool> {
    return (await this.connected()).tool.tool();
  }

  async callTool(functionCalls: FunctionCall[]): Promise<Part[]> {
    for (const call of functionCalls) {
      console.log(`OSRS tool call: ${call.name} ${JSON.stringify(call.args ?? {})}`);
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      const connection = this.connected();
      try {
        return await (await connection).tool.callTool(functionCalls);
      } catch (error) {
        console.error(`OSRS tool call failed (attempt ${attempt}):`, error);
        await this.discard(connection);
      }
    }
    return functionCalls.map((call) => ({
      functionResponse: { id: call.id, name: call.name, response: { error: UNAVAILABLE } },
    }));
  }

  private connected(): Promise<Connection> {
    if (!this.connection) {
      const connection = this.connect();
      this.connection = connection;
      connection.catch(() => this.discard(connection));
    }
    return this.connection;
  }

  private async connect(): Promise<Connection> {
    const client = new Client({ name: 'gork', version: BUILD_ID });
    const transport = new StreamableHTTPClientTransport(new URL(this.url), {
      requestInit: { headers: { Authorization: `Bearer ${this.token}` } },
    });
    try {
      await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
      const tool = mcpToTool(client, { timeout: CALL_TIMEOUT_MS });
      await tool.tool(); // lists the tools now, so a broken server shows up here
      return { client, tool };
    } catch (error) {
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  /** Drops a broken connection, unless another message already replaced it. */
  private async discard(connection: Promise<Connection>): Promise<void> {
    if (this.connection !== connection) {
      return;
    }
    this.connection = null;
    const settled = await connection.catch(() => null);
    await settled?.client.close().catch(() => undefined);
  }
}
