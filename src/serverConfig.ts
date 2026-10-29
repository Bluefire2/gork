import * as fs from 'fs';
import * as path from 'path';

/**
 * Valid flag types
 */
export type FlagType = 'boolean' | 'string' | 'number';

/**
 * Static definition of flag types.
 * Add new flags here with their types.
 * Example:
 *   enabled: 'boolean',
 *   prefix: 'string',
 *   maxMessages: 'number'
 */
export const FLAG_TYPES: Record<string, FlagType> = {
  runescape: 'boolean',
  context: 'number',
  personality: 'string',
  // Add more flag definitions here
  // enabled: 'boolean',
  // prefix: 'string',
  // maxMessages: 'number',
};

/**
 * Structure for per-server settings
 */
export interface ServerSettings {
  [key: string]: boolean | number | string | undefined; // Allow any custom settings per server
}

/**
 * Structure for the entire server config file
 */
interface ServerConfigData {
  servers: {
    [guildId: string]: ServerSettings;
  };
  // Per-user settings, the same in every server (a RuneScape name belongs to the person)
  users?: {
    [userId: string]: UserSettings;
  };
}

/**
 * Structure for per-user settings
 */
export interface UserSettings {
  rsn?: string; // Old School RuneScape name, set with --setRsn
}

/**
 * Path to the server config file (stored in project root)
 */
const configPath = path.join(__dirname, '..', 'serverConfig.json');

/**
 * Default structure for a new server config file
 */
const defaultConfig: ServerConfigData = {
  servers: {}
};

/**
 * Loads the server config file, creating it with default structure if it doesn't exist
 */
function loadConfig(): ServerConfigData {
  try {
    // Check if file exists
    if (!fs.existsSync(configPath)) {
      // Create the file with default structure
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
      return defaultConfig;
    }

    // Read and parse existing file
    const fileContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(fileContent) as ServerConfigData;

    // Ensure the structure is valid
    if (!config.servers) {
      config.servers = {};
    }

    return config;
  } catch (error) {
    console.error('Error loading server config:', error);
    // Return default config on error
    return defaultConfig;
  }
}

/**
 * Saves the server config to disk
 */
function saveConfig(config: ServerConfigData): void {
  try {
    // Write a temp file and rename it over the config, so a crash mid-write can't leave a
    // half-written file (which loadConfig would read as empty, and the next save would keep)
    const tempPath = `${configPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(config, null, 2), 'utf-8');
    fs.renameSync(tempPath, configPath);
  } catch (error) {
    console.error('Error saving server config:', error);
  }
}

/**
 * Gets all settings for a specific server
 * @param guildId - The Discord guild (server) ID
 * @returns The server's settings object, or an empty object if not found
 */
export function getServerSettings(guildId: string): ServerSettings {
  const config = loadConfig();
  return config.servers[guildId] || {};
}

/**
 * Gets a specific setting for a server
 * @param guildId - The Discord guild (server) ID
 * @param key - The setting key to retrieve
 * @param defaultValue - Optional default value if the setting doesn't exist
 * @returns The setting value, or the default value if not found
 */
export function getServerSetting<T>(guildId: string, key: string, defaultValue?: T): T | undefined {
  const settings = getServerSettings(guildId);
  return settings[key] !== undefined ? settings[key] as T : defaultValue;
}

/**
 * Sets a specific setting for a server
 * @param guildId - The Discord guild (server) ID
 * @param key - The setting key to set
 * @param value - The value to set
 */
export function setServerSetting(guildId: string, key: string, value: any): void {
  const config = loadConfig();
  
  // Ensure the server entry exists
  if (!config.servers[guildId]) {
    config.servers[guildId] = {};
  }

  // Set the value
  config.servers[guildId][key] = value;

  // Save to disk
  saveConfig(config);
}

/**
 * Sets multiple settings for a server at once
 * @param guildId - The Discord guild (server) ID
 * @param settings - An object containing the settings to set
 */
export function setServerSettings(guildId: string, settings: Partial<ServerSettings>): void {
  const config = loadConfig();
  
  // Ensure the server entry exists
  if (!config.servers[guildId]) {
    config.servers[guildId] = {};
  }

  // Merge the new settings
  config.servers[guildId] = { ...config.servers[guildId], ...settings };

  // Save to disk
  saveConfig(config);
}

/**
 * Removes a specific setting for a server
 * @param guildId - The Discord guild (server) ID
 * @param key - The setting key to remove
 */
export function removeServerSetting(guildId: string, key: string): void {
  const config = loadConfig();
  
  if (config.servers[guildId]) {
    delete config.servers[guildId][key];
    saveConfig(config);
  }
}

/**
 * Removes all settings for a server
 * @param guildId - The Discord guild (server) ID
 */
export function removeServer(guildId: string): void {
  const config = loadConfig();
  
  if (config.servers[guildId]) {
    delete config.servers[guildId];
    saveConfig(config);
  }
}

/**
 * Gets a user's saved Old School RuneScape name
 * @param userId - The Discord user ID
 * @returns The RuneScape name, or undefined if not set
 */
export function getUserRsn(userId: string): string | undefined {
  return loadConfig().users?.[userId]?.rsn;
}

/**
 * Saves a user's Old School RuneScape name
 * @param userId - The Discord user ID
 * @param rsn - The RuneScape name
 */
export function setUserRsn(userId: string, rsn: string): void {
  const config = loadConfig();
  config.users ??= {};
  config.users[userId] = { ...config.users[userId], rsn };
  saveConfig(config);
}

/**
 * Removes a user's saved Old School RuneScape name
 * @param userId - The Discord user ID
 * @returns True if a name was saved
 */
export function removeUserRsn(userId: string): boolean {
  const config = loadConfig();
  const user = config.users?.[userId];
  if (!user?.rsn) {
    return false;
  }
  delete user.rsn;
  if (Object.keys(user).length === 0) {
    delete config.users![userId];
  }
  saveConfig(config);
  return true;
}

/**
 * Gets all servers that have settings configured
 * @returns An array of guild IDs that have settings
 */
export function getAllConfiguredServers(): string[] {
  const config = loadConfig();
  return Object.keys(config.servers);
}

/**
 * Gets the type definition for a flag from the static definition
 * @param flagName - The flag name
 * @returns The flag type, or undefined if not defined
 */
export function getFlagType(flagName: string): FlagType | undefined {
  return FLAG_TYPES[flagName];
}

const BOOLEAN_TRUE_VALUES = ['true', '1', 'yes', 'on'];
const BOOLEAN_FALSE_VALUES = ['false', '0', 'no', 'off'];

/**
 * Parses a string value into the appropriate type based on the flag's static type definition
 * @param flagName - The flag name
 * @param valueString - The string value to parse
 * @returns The parsed value
 * @throws Error if the flag type is not defined or if the value cannot be parsed
 */
export function parseFlagValue(flagName: string, valueString: string): any {
  const flagType = getFlagType(flagName);

  if (!flagType) {
    throw new Error(`Flag type not defined for "${flagName}". Please define it in FLAG_TYPES.`);
  }

  switch (flagType) {
    case 'boolean':
      const lowerValue = valueString.toLowerCase().trim();
      if (BOOLEAN_TRUE_VALUES.includes(lowerValue)) {
        return true;
      }
      if (BOOLEAN_FALSE_VALUES.includes(lowerValue)) {
        return false;
      }
      throw new Error(`Invalid boolean value: "${valueString}". Expected "true" or "false".`);

    case 'number':
      const numValue = parseFloat(valueString.trim());
      if (isNaN(numValue)) {
        throw new Error(`Invalid number value: "${valueString}"`);
      }
      return numValue;

    case 'string':
      return valueString.trim();

    default:
      throw new Error(`Unknown flag type: "${flagType}" for flag "${flagName}"`);
  }
}

