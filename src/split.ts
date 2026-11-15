/** Discord's limit on the length of one message. */
export const DISCORD_MESSAGE_LIMIT = 2000;

/**
 * Splits a reply that is too long for one Discord message into pieces that each fit, cutting
 * at the last paragraph break before the limit, else the last line break, else the last space,
 * and only as a last resort mid-word. Whitespace at a cut is dropped, so no piece is blank.
 * A reply that fits comes back as one piece.
 */
export function splitMessage(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit + 1);
    // Prefer a cut that leaves the next piece starting on a new paragraph or line. A boundary
    // very early in the window would make a tiny piece, so fall through to the next kind.
    const cut = [/\n\s*\n/g, /\n/g, / /g]
      .map((separator) => lastBoundary(window, separator))
      .find((at) => at > limit / 4);
    const end = cut ?? limit;
    const piece = rest.slice(0, end).trimEnd();
    if (piece) pieces.push(piece);
    rest = rest.slice(end).replace(/^\s+/, '');
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/** Start of the last match of `separator` in `text`, or -1. */
function lastBoundary(text: string, separator: RegExp): number {
  let at = -1;
  for (const match of text.matchAll(separator)) at = match.index;
  return at;
}
