import { Client, GatewayIntentBits, Events } from 'discord.js';
import { GoogleGenAI } from '@google/genai';
import { buildPrompt, MESSAGE_HISTORY_LIMIT } from './prompt';
import { parseFlags, BotFlags } from './flags';
import { handleServerConfigCommand } from './commands';
import { getServerSetting } from './serverConfig';
import * as fs from 'fs';
import * as path from 'path';

interface Config {
  token: string;
  test_token: string;
  gemini_api_key: string;
}

// Load configuration
const configPath = path.join(__dirname, '..', 'config.json');
const config: Config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Determine which token to use based on TEST_MODE environment variable
const isTestMode = process.env.TEST_MODE === 'true';
const token = isTestMode ? config.test_token : config.token;

// Gemini model names
// Common model names: gemini-2.5-flash, gemini-2.5-pro, gemini-1.5-flash, gemini-1.5-pro
// If models don't work, use listAvailableModels() to see what's actually available
const GEMINI_MODEL_REGULAR = 'gemini-2.5-pro';
const GEMINI_MODEL_ADVANCED = 'gemini-3-pro-preview';

/**
 * Lists all available Gemini models (useful for debugging).
 * Uncomment the call to this function in the ready event to see available models.
 * Note: This may not work with all API configurations - check Google's documentation.
 */
async function listAvailableModels(): Promise<void> {
  try {
    // Try to list models - this API may vary
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + config.gemini_api_key);
    const data = await response.json() as { models?: Array<{ name: string }> };
    if (data.models) {
      console.log('Available Gemini models:');
      data.models.forEach((model) => {
        console.log(`  - ${model.name}`);
      });
    } else {
      console.log('Could not retrieve model list. Common model names:');
      console.log('  - gemini-2.5-flash');
      console.log('  - gemini-2.5-pro');
      console.log('  - gemini-1.5-flash');
      console.log('  - gemini-1.5-pro');
    }
  } catch (error) {
    console.error('Error listing models:', error);
    console.log('Common model names to try:');
    console.log('  - gemini-2.5-flash');
    console.log('  - gemini-2.5-pro');
    console.log('  - gemini-1.5-flash');
    console.log('  - gemini-1.5-pro');
  }
}

/**
 * Logs a message only when the bot is running in test mode.
 * @param args - Arguments to pass to console.log
 */
function log(...args: any[]): void {
  if (isTestMode) {
    console.log(...args);
  }
}

if (!token || token === 'YOUR_BOT_TOKEN_HERE' || token === 'YOUR_TEST_BOT_TOKEN_HERE') {
  console.error(`Error: ${isTestMode ? 'Test' : 'Regular'} bot token is not set in config.json`);
  process.exit(1);
}

if (!config.gemini_api_key || config.gemini_api_key === 'YOUR_GEMINI_API_KEY_HERE') {
  console.error('Error: Gemini API key is not set in config.json');
  process.exit(1);
}

// Initialize Gemini AI
const genAI = new GoogleGenAI({ apiKey: config.gemini_api_key });

// Create a new client instance
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// When the client is ready, run this code (only once)
client.once(Events.ClientReady, async () => {
  console.log(`Bot is ready! Running in ${isTestMode ? 'TEST' : 'REGULAR'} mode`);
  console.log(`Logged in as ${client.user?.tag}`);
  
  // List available models on startup in test mode (useful for debugging)
  if (isTestMode) {
    await listAvailableModels();
  }
});

// Respond to messages that mention/tag the bot
client.on('messageCreate', async (message) => {
  // Ignore messages from bots
  if (message.author.bot) return;

    // Check if the bot is mentioned in the message
    if (message.mentions.has(client.user!)) {
      // Extract the message content, removing the bot mention
      const rawMessageContent = message.content
        .replace(new RegExp(`<@!?${client.user?.id}>`, 'g'), '')
        .trim();

      // If there's no message after the mention, send a default response
      if (!rawMessageContent) {
        await message.reply('Hello! How can I help you?');
        return;
      }

      // Parse flags from the message
      const { flags, content: userMessageContent } = parseFlags(rawMessageContent);

      // Check if this is a server config command (handles before LLM call)
      const commandResult = handleServerConfigCommand(message, rawMessageContent);
      if (commandResult.handled) {
        await message.reply(commandResult.response || 'Command processed.');
        return;
      }

      // If there's no content after removing flags, send a default response
      if (!userMessageContent) {
        await message.reply('Hello! How can I help you?');
        return;
      }

      try {
        // Show typing indicator
        await message.channel.sendTyping();

        // Fetch previous messages for context
        // Priority: server-level context flag > per-message flag > default
        // Cap at 100 messages maximum
        const serverContext = message.guild ? getServerSetting<number>(message.guild.id, 'context') : undefined;
        const contextLimit = Math.min(100, serverContext ?? flags.context ?? MESSAGE_HISTORY_LIMIT);
        const previousMessages = await message.channel.messages.fetch({ 
          limit: contextLimit,
          before: message.id 
        });
        
        // Convert to array and reverse to get chronological order (oldest to newest)
        // Exclude the current message and bot's own messages from history
        const messageHistory = Array.from(previousMessages.values())
          .filter(msg => !msg.author.bot || msg.author.id === client.user?.id)
          .reverse();

        // Build the prompt for Gemini with message history
        // Pass the cleaned content (without flags) as an override
        const prompt = buildPrompt(message, messageHistory, client.user?.id, userMessageContent);

        // Determine which model to use based on flags
        const model = flags.advanced ? GEMINI_MODEL_ADVANCED : GEMINI_MODEL_REGULAR;

        // Log the prompt being sent to Gemini
        log(`Prompt being sent to Gemini (model: ${model}):`);
        log('---');
        log(prompt);
        log('---');

        // Call Gemini API
        const response = await genAI.models.generateContent({
          model: model,
          contents: prompt,
        });
        const text = response.text;

        // Log the response from Gemini
        log('Response from Gemini:');
        log('---');
        log(text);
        log('---');

      // Check if we got a valid response
      if (!text || text.trim().length === 0) {
        await message.reply('I received an empty response from Gemini.');
        return;
      }

      // Discord has a 2000 character limit per message, so we may need to split long responses
      if (text.length <= 2000) {
        await message.reply(text);
      } else {
        // Split into chunks if response is too long
        const chunks = text.match(/.{1,2000}/g) || [];
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          if (!chunk) continue;
          
          if (i === 0) {
            await message.reply(chunk);
          } else {
            await message.channel.send(chunk);
          }
        }
      }
    } catch (error) {
      console.error('Error calling Gemini API:', error);
      await message.reply('Sorry, I encountered an error while processing your request.');
    }
  }
});

// Log in to Discord with your client's token
client.login(token).catch((error) => {
  console.error('Failed to login:', error);
  process.exit(1);
});

