import { Message } from 'discord.js';

// Number of previous messages to include as context
export const MESSAGE_HISTORY_LIMIT = 20;

/**
 * Replaces Discord mention patterns (like <@12345>) with readable usernames.
 * @param message - The Discord message containing mentions
 * @param botUserId - The user ID of the bot itself
 * @returns The message content with mentions replaced by usernames
 */
function replaceMentions(message: Message, botUserId: string | undefined): string {
  let content = message.content;

  // Replace user mentions with @username (or @_YOU_ if it's the bot itself)
  for (const [id, user] of message.mentions.users) {
    const mentionPattern = new RegExp(`<@!?${id}>`, 'g');
    if (botUserId && id === botUserId) {
      content = content.replace(mentionPattern, '@_YOU_');
    } else {
      content = content.replace(mentionPattern, `@${user.username}`);
    }
  }

  // Replace role mentions with @rolename
  if (message.mentions.roles) {
    for (const [id, role] of message.mentions.roles) {
      const mentionPattern = new RegExp(`<@&${id}>`, 'g');
      content = content.replace(mentionPattern, `@${role.name}`);
    }
  }

  // Replace channel mentions with #channelname
  if (message.mentions.channels) {
    for (const [id, channel] of message.mentions.channels) {
      const mentionPattern = new RegExp(`<#${id}>`, 'g');
      const channelName = 'name' in channel ? channel.name : 'channel';
      content = content.replace(mentionPattern, `#${channelName}`);
    }
  }

  return content.trim();
}

/**
 * Formats a Discord message for inclusion in the prompt context.
 * @param message - The Discord message to format
 * @param botUserId - The user ID of the bot itself
 * @returns A formatted string representation of the message
 */
function formatMessage(message: Message, botUserId: string | undefined): string {
  let author: string;
  if (botUserId && message.author.id === botUserId) {
    author = '_YOU_';
  } else if (message.author.bot) {
    author = `Bot (${message.author.username})`;
  } else {
    author = message.author.username;
  }
  const content = replaceMentions(message, botUserId);
  return `${author}: ${content}`;
}

/**
 * Builds a prompt for Gemini that introduces the chatbot task and includes message history and the user message.
 * @param currentMessage - The current Discord message from the user
 * @param messageHistory - Array of previous messages from the channel (oldest to newest)
 * @param botUserId - The user ID of the bot itself
 * @param contentOverride - Optional content to use instead of the message's content (e.g., after removing flags)
 * @returns A formatted prompt string for Gemini
 */
export function buildPrompt(
  currentMessage: Message,
  messageHistory: Message[],
  botUserId: string | undefined,
  contentOverride?: string
): string {
  // Build the initial system prompt
  const systemPrompt = `You are a helpful and friendly chatbot assistant 
participating in a Discord server conversation. You are an active participant 
in the conversation, not just a responder. Your task is to engage naturally and 
continue the conversation flow as if you've been part of the discussion all along.

IMPORTANT CONTEXT ABOUT DISCORD MESSAGES:
- When you see "@username" in a message, it means that user was tagged/mentioned, 
  indicating the message is directed at them.
- When you see "@_YOU_" in a message, it means you (the bot) were tagged/mentioned.
- Messages from you (the bot) are formatted as "_YOU_: message content".
- Some messages are posted by other bots. Other bot messages are formatted as 
  "Bot (username): message content" to distinguish them from human users.
- Regular user messages are formatted as "username: message content".

Below is the recent conversation history from the Discord channel (most recent 
messages at the end):

`;

  // Add message history if available
  let historySection = '';
  if (messageHistory.length > 0) {
    const formattedHistory = messageHistory
      .map(msg => formatMessage(msg, botUserId))
      .join('\n');
    historySection = formattedHistory + '\n\n';
  }

  // Format the current message with mentions replaced
  // Use content override if provided (e.g., after removing flags)
  const messageToFormat = contentOverride
    ? ({ ...currentMessage, content: contentOverride } as Message)
    : currentMessage;

  // Get the author name
  let authorName: string;
  if (botUserId && currentMessage.author.id === botUserId) {
    authorName = '_YOU_';
  } else if (currentMessage.author.bot) {
    authorName = `Bot (${currentMessage.author.username})`;
  } else {
    authorName = currentMessage.author.username;
  }

  // Get the message content with mentions replaced
  const messageContent = replaceMentions(messageToFormat, botUserId);

  // Build the current message section
  const currentMessageSection = `You have been tagged/mentioned by ${authorName}. 
Their message is: "${messageContent}"

Please respond naturally as a participant in this conversation, continuing the 
discussion organically. Take into account the full conversation context and respond 
in a way that feels like a natural continuation of the ongoing discussion. You 
should respond directly to ${authorName}'s message.

IMPORTANT: When you respond, your response should **JUST** be your response 
message text, as if you are speaking naturally in the conversation. Do not 
include an author specifier/prefix in your response.`;

  // Combine all sections
  return systemPrompt + historySection + currentMessageSection;
}

