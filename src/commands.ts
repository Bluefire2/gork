import { Message } from 'discord.js';
import { getServerSetting, setServerSetting, getServerSettings, removeServerSetting, getFlagType, parseFlagValue } from './serverConfig';

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
 * 
 * @param message - The Discord message
 * @param content - The message content (with bot mention removed)
 * @returns CommandResult indicating if the command was handled
 */
export function handleServerConfigCommand(message: Message, content: string): CommandResult {
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
  const setPersonalityMatch = content.match(/--setPersonality\s+(.+)/i);
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

  // No command matched
  return { handled: false };
}

