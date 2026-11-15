/** Discord's limit on the length of one message. */
export const DISCORD_MESSAGE_LIMIT = 2000;

// Every piece but the last keeps this much of the limit free to close a code fence that is
// still open at its end (a newline plus the fence marker).
const FENCE_RESERVE = 8;

// Where a piece may end, best first: a paragraph break, a line break, any whitespace. The
// piece ends where the match starts and the next one begins where it ends, so the separator
// itself is dropped but the indentation of the next line is kept.
const BOUNDARIES = [/\n\s*\n/g, /\n/g, /\s/g];

interface Cut {
  start: number; // end of this piece
  end: number; // start of the next
}

/**
 * Splits a reply that is too long for one Discord message into pieces that each fit. A piece
 * ends at the last paragraph break that fits, else the last line break, else the last
 * whitespace, and mid-word only when there is no whitespace at all (never inside a surrogate
 * pair). A boundary in the first quarter of a piece is used only when the alternative is a
 * mid-word cut, so pieces don't get tiny. A code fence left open at the end of a piece is
 * closed there and reopened at the start of the next; a bold or italic span across a cut is
 * not repaired. A reply that fits comes back as one piece; a blank one as none.
 */
export function splitMessage(text: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
  if (limit < 1) throw new RangeError(`limit must be at least 1, got ${limit}`);
  const room = Math.max(1, limit - FENCE_RESERVE);
  const minPiece = room / 4;
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const cut = chooseBoundary(rest, room, minPiece) ?? hardCut(rest, room);
    let piece = rest.slice(0, cut.start).trimEnd();
    // Whitespace-only lines after the cut would make the next piece start blank
    let next = rest.slice(cut.end).replace(/^(?:[ \t]*\r?\n)+/, '');
    const fence = openFenceAt(piece);
    if (fence && fence.close.length + 1 <= FENCE_RESERVE) {
      const reopened = `${fence.open}\n${next}`;
      // A piece that is only a fence opener would reopen itself forever; leave that one be
      if (reopened.length < rest.length) {
        piece += `\n${fence.close}`;
        next = reopened;
      }
    }
    if (piece) pieces.push(piece);
    rest = next;
  }
  if (rest) pieces.push(rest.trimEnd());
  return pieces;
}

/**
 * The best boundary at which a piece of at most `room` characters can end: the last one of
 * the best kind that leaves at least `minPiece` characters, else the last one of the best
 * kind that leaves anything at all. Null when there is no whitespace to cut at.
 */
function chooseBoundary(text: string, room: number, minPiece: number): Cut | null {
  const candidates = BOUNDARIES.map((separator) => lastBoundary(text, separator, room)).filter(
    (cut): cut is Cut => cut !== null && text.slice(0, cut.start).trim().length > 0,
  );
  return candidates.find((cut) => cut.start >= minPiece) ?? candidates[0] ?? null;
}

/** The last match of `separator` starting at or before `maxStart`, or null. */
function lastBoundary(text: string, separator: RegExp, maxStart: number): Cut | null {
  let found: Cut | null = null;
  for (const match of text.matchAll(separator)) {
    if (match.index > maxStart) break;
    found = { start: match.index, end: match.index + match[0].length };
  }
  return found;
}

/** A cut at `room` characters, moved back one so it never lands inside a surrogate pair. */
function hardCut(text: string, room: number): Cut {
  const code = text.charCodeAt(room - 1);
  const end = room > 1 && code >= 0xd800 && code <= 0xdbff ? room - 1 : room;
  return { start: end, end };
}

interface Fence {
  open: string; // the opening line, with its info string, to put at the start of the next piece
  close: string; // the marker that closes it
}

// A fence line: up to three spaces, then three or more backticks or tildes, then the rest
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** The code fence still open at the end of `text`, if any. */
function openFenceAt(text: string): Fence | null {
  let open: { marker: string; line: string } | null = null;
  for (const line of text.split('\n')) {
    const match = FENCE_LINE.exec(line);
    if (!match) continue;
    const [, marker, info] = match;
    if (!open) {
      open = { marker, line: line.trimEnd() };
    } else if (marker[0] === open.marker[0] && marker.length >= open.marker.length && info.trim() === '') {
      open = null;
    }
  }
  return open ? { open: open.line, close: open.marker } : null;
}
