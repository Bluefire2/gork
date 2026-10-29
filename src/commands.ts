import { Message } from 'discord.js';
import { getServerSetting, setServerSetting, getServerSettings, removeServerSetting, getFlagType, parseFlagValue, getUserRsn, setUserRsn, removeUserRsn } from './serverConfig';
import { BUILD_ID, BUILD_TIMESTAMP } from './version';

/**
 * Result of processing a command
 */
export interface CommandResult {
  handled: boolean; // Whether the command was handled (and LLM should not be called)
  response?: string; // Response message to send to the user
}

/**
 * Parses and handles server config commands
 * Commands:
 *   --setFlag="flagName: value" - Sets a flag value (parsed according to flag type defined in code)
 *   --getFlag="flagName" - Gets a flag value and its type
 *   --listFlags - Lists all flags for the server
 *   --removeFlag="flagName" - Removes a flag
 *   --setRsn <name> / --getRsn / --removeRsn - The author's Old School RuneScape name (any server or DM)
 *
 * @param message - The Discord message
 * @param content - The message content (with bot mention removed)
 * @returns CommandResult indicating if the command was handled
 */
export function handleServerConfigCommand(message: Message, content: string): CommandResult {
  // RuneScape names are per user, so these work in DMs too
  const rsnResult = handleRsnCommand(message.author.id, content);
  if (rsnResult.handled) {
    return rsnResult;
  }

  // Only handle commands in guilds (servers), not DMs
  if (!message.guild) {
    return { handled: false };
  }

  const guildId = message.guild.id;

  // Parse --setFlag="flagName: value"
  const setFlagMatch = content.match(/--setFlag="([^"]+):\s*([^"]+)"/i);
  if (setFlagMatch) {
    const flagName = setFlagMatch[1].trim();
    const valueString = setFlagMatch[2].trim();

    try {
      const parsedValue = parseFlagValue(flagName, valueString);
      setServerSetting(guildId, flagName, parsedValue);
      const flagType = getFlagType(flagName);
      const typeInfo = flagType ? ` (type: \`${flagType}\`)` : '';
      return {
        handled: true,
        response: `✅ Set flag \`${flagName}\`${typeInfo} to \`${JSON.stringify(parsedValue)}\``
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        handled: true,
        response: `❌ ${errorMessage}`
      };
    }
  }

  // Parse --getFlag="flagName"
  const getFlagMatch = content.match(/--getFlag="([^"]+)"/i);
  if (getFlagMatch) {
    const flagName = getFlagMatch[1].trim();
    const value = getServerSetting(guildId, flagName);
    if (value === undefined) {
      const flagType = getFlagType(flagName);
      if (flagType) {
        return {
          handled: true,
          response: `❌ Flag \`${flagName}\` (type: \`${flagType}\`) is not set`
        };
      }
      return {
        handled: true,
        response: `❌ Flag \`${flagName}\` is not set`
      };
    }
    const flagType = getFlagType(flagName);
    const typeInfo = flagType ? ` (type: \`${flagType}\`)` : '';
    return {
      handled: true,
      response: `📋 Flag \`${flagName}\`${typeInfo} = \`${JSON.stringify(value)}\``
    };
  }

  // Parse --listFlags
  if (content.match(/--listFlags/i)) {
    const settings = getServerSettings(guildId);
    const flags = Object.keys(settings);
    if (flags.length === 0) {
      return {
        handled: true,
        response: `📋 No flags set for this server`
      };
    }
    const flagList = flags.map(flag => {
      const value = settings[flag];
      const flagType = getFlagType(flag);
      const typeInfo = flagType ? ` (${flagType})` : '';
      return `  • \`${flag}\`${typeInfo}: \`${JSON.stringify(value)}\``;
    }).join('\n');
    return {
      handled: true,
      response: `📋 Server flags:\n${flagList}`
    };
  }

  // Parse --removeFlag="flagName"
  const removeFlagMatch = content.match(/--removeFlag="([^"]+)"/i);
  if (removeFlagMatch) {
    const flagName = removeFlagMatch[1].trim();
    const existed = getServerSetting(guildId, flagName) !== undefined;
    removeServerSetting(guildId, flagName);
    if (existed) {
      return {
        handled: true,
        response: `✅ Removed flag \`${flagName}\``
      };
    } else {
      return {
        handled: true,
        response: `⚠️ Flag \`${flagName}\` was not set`
      };
    }
  }

  // Parse --setPersonality ... (everything after --setPersonality is the personality text)
  const setPersonalityMatch = content.match(/--setPersonality\s+([\s\S]+)/i);
  if (setPersonalityMatch) {
    const personalityText = setPersonalityMatch[1].trim();
    if (!personalityText) {
      return {
        handled: true,
        response: `❌ Personality text cannot be empty. Usage: \`--setPersonality You are helpful, friendly, and chatty.\``
      };
    }
    setServerSetting(guildId, 'personality', personalityText);
    return {
      handled: true,
      response: `✅ Set personality to: "${personalityText}"`
    };
  }

  // Parse --getPersonality
  if (content.match(/--getPersonality/i)) {
    const personality = getServerSetting(guildId, 'personality');
    if (!personality) {
      return {
        handled: true,
        response: `❌ Personality is not set.`
      };
    }
    return {
      handled: true,
      response: `🧠 Current Personality:\n\`\`\`\n${personality}\n\`\`\``
    };
  }

  // Parse --version
  if (content.match(/--version/i)) {
    return {
      handled: true,
      response: `🤖 Bot Version: \`${BUILD_ID}\` (Built: \`${BUILD_TIMESTAMP}\`)`
    };
  }

  // No command matched
  return { handled: false };
}

// Jagex display names: 1-12 letters, digits, spaces, hyphens and underscores
const RSN_PATTERN = /^[A-Za-z0-9 _-]{1,12}$/;

/**
 * Tidies a RuneScape name as typed (surrounding quotes, repeated spaces) and checks it.
 * @param input - The name as the user wrote it
 * @returns The name, or null if it can't be a RuneScape name
 */
export function normalizeRsn(input: string): string | null {
  const rsn = input.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim();
  return RSN_PATTERN.test(rsn) ? rsn : null;
}

/**
 * Handles --setRsn <name>, --getRsn and --removeRsn, which save the author's Old School
 * RuneScape name so questions about "my" account can be answered without asking for it.
 * @param userId - The Discord user ID of the message author
 * @param content - The message content (with bot mention removed)
 * @returns CommandResult indicating if the command was handled
 */
export function handleRsnCommand(userId: string, content: string): CommandResult {
  const setRsnMatch = content.match(/--setRsn\b(.*)/i);
  if (setRsnMatch) {
    const rsn = normalizeRsn(setRsnMatch[1]);
    if (!rsn) {
      return {
        handled: true,
        response: `❌ That isn't a valid RuneScape name (1-12 letters, numbers, spaces, - or _). Usage: \`--setRsn Lynx Titan\``
      };
    }
    setUserRsn(userId, rsn);
    return {
      handled: true,
      response: `✅ Saved your RuneScape name as \`${rsn}\`. Ask me about "my stats" any time.`
    };
  }

  if (content.match(/--getRsn\b/i)) {
    const rsn = getUserRsn(userId);
    return {
      handled: true,
      response: rsn
        ? `📋 Your RuneScape name is \`${rsn}\``
        : `❌ You haven't saved a RuneScape name. Usage: \`--setRsn Lynx Titan\``
    };
  }

  if (content.match(/--removeRsn\b/i)) {
    return {
      handled: true,
      response: removeUserRsn(userId)
        ? `✅ Removed your RuneScape name`
        : `⚠️ You hadn't saved a RuneScape name`
    };
  }

  return { handled: false };
}

