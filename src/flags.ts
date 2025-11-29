/**
 * Interface for bot command flags
 */
export interface BotFlags {
  advanced: boolean;
  context: number; // Number of previous messages to include as context
}

/**
 * Parses flags from a message string and returns the flags and the remaining message content.
 * Flags are in the format: --flag
 * @param messageContent - The raw message content
 * @returns An object containing the parsed flags and the message content with flags removed
 */
export function parseFlags(messageContent: string): { flags: BotFlags; content: string } {
  const flags: BotFlags = {
    advanced: false,
    context: 20, // Default value
  };

  // Split the message into words
  const words = messageContent.split(/\s+/);
  const remainingWords: string[] = [];

  // Parse flags
  for (const word of words) {
    if (word === '--advanced' || word === '-a') {
      flags.advanced = true;
    } else if (word.startsWith('--context=') || word.startsWith('-c=')) {
      // Parse --context=N or -c=N
      const value = word.split('=')[1];
      const contextValue = parseInt(value, 10);
      if (!isNaN(contextValue) && contextValue > 0) {
        flags.context = contextValue;
      }
    } else if (word.startsWith('--context') || word === '-c') {
      // Handle --context or -c without = (try to get next word as value)
      // We'll handle this in a second pass
      remainingWords.push(word);
    } else if (word.startsWith('--') || (word.startsWith('-') && word.length === 2)) {
      // Unknown flag, but we'll keep it in the content for now
      remainingWords.push(word);
    } else {
      remainingWords.push(word);
    }
  }

  // Second pass: handle --context or -c followed by a number
  const finalWords: string[] = [];
  for (let i = 0; i < remainingWords.length; i++) {
    const word = remainingWords[i];
    if ((word === '--context' || word === '-c') && i + 1 < remainingWords.length) {
      const nextWord = remainingWords[i + 1];
      const contextValue = parseInt(nextWord, 10);
      if (!isNaN(contextValue) && contextValue > 0) {
        flags.context = contextValue;
        i++; // Skip the next word since we used it
        continue;
      }
    }
    finalWords.push(word);
  }

  // Rejoin the remaining content
  const content = finalWords.join(' ').trim();

  return { flags, content };
}

