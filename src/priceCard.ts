import { loadImage, Image, SKRSContext2D } from '@napi-rs/canvas';
import { BUILD_ID } from './version';
import { COLOR, PAD, bevel, card, text, toPng } from './cardStyle';
import { CARD_W } from './statsCard';

/** The fields of an rs-mcp get_price_history result that the card uses. */
export interface PriceHistory {
  name: string;
  period: 'day' | 'week' | 'month' | 'year';
  start_price: number | null;
  end_price: number | null;
  lowest: number | null;
  highest: number | null;
  change_percent: number | null;
  total_volume: number;
  points: { at: string; price: number | null; volume: number }[];
}

export function isPriceHistory(value: any): value is PriceHistory {
  return typeof value?.name === 'string' && typeof value.period === 'string' && Array.isArray(value.points);
}

const PERIOD_LABEL = { day: 'Past day', week: 'Past week', month: 'Past month', year: 'Past year' };

// Same width as the stats card, so cards line up in a reply.
const W = CARD_W;
const HEADER_H = 40;
const CHART_H = 132;
const AXIS_H = 12;
const FOOTER_H = 14;
const H = PAD + HEADER_H + CHART_H + AXIS_H + FOOTER_H + PAD;
const LABELS_W = 42; // price labels to the right of the plot
const VOLUME_H = 18; // volume bars along the bottom of the plot

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumSignificantDigits: 3 });

// --- item icons, from the OSRS Wiki, best effort ---------------------------------------------

const ICON_TIMEOUT_MS = 3_000;
const MAX_CACHED_ICONS = 200;
const iconCache = new Map<string, Promise<Image | null>>();

/** The item's inventory icon, or null if the Wiki doesn't have one under its name. */
function itemIcon(name: string): Promise<Image | null> {
  let icon = iconCache.get(name);
  if (!icon) {
    if (iconCache.size >= MAX_CACHED_ICONS) iconCache.clear();
    const url = `https://oldschool.runescape.wiki/images/${encodeURIComponent(name.replace(/ /g, '_'))}.png`;
    icon = fetch(url, {
      headers: { 'User-Agent': `gork/${BUILD_ID} (Discord bot; github.com/Bluefire2/gork)` },
      signal: AbortSignal.timeout(ICON_TIMEOUT_MS),
    })
      .then(async (response) => (response.ok ? loadImage(Buffer.from(await response.arrayBuffer())) : null))
      .catch(() => null);
    iconCache.set(name, icon);
  }
  return icon;
}

// --- drawing ------------------------------------------------------------------------------

function formatDate(iso: string, period: PriceHistory['period']): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  if (period !== 'day') return day;
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `${day} ${time}`;
}

/** A 1px line through the points, drawn as pixel columns so it stays crisp when scaled. */
function pixelLine(ctx: SKRSContext2D, points: ({ x: number; y: number } | null)[]): void {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue; // a gap where nothing traded
    const steps = Math.max(1, b.x - a.x);
    let prevY = a.y;
    for (let s = 0; s <= steps; s++) {
      const x = a.x + s;
      const y = Math.round(a.y + ((b.y - a.y) * s) / steps);
      const top = Math.min(prevY, y);
      ctx.fillRect(x, top, 1, Math.abs(y - prevY) + 1);
      prevY = y;
    }
  }
}

/** A PNG chart of an item's Grand Exchange price over the period. */
export async function renderPriceCard(history: PriceHistory): Promise<Buffer> {
  const icon = await itemIcon(history.name);
  const { canvas, ctx } = card(W, H);

  // Header: icon, name and period on the left; latest price and change on the right.
  const nameX = icon ? PAD + 40 : PAD + 1;
  if (icon) {
    const scale = Math.min(1, 32 / icon.width, 32 / icon.height);
    const w = Math.round(icon.width * scale);
    const h = Math.round(icon.height * scale);
    ctx.drawImage(icon, PAD + 2 + Math.floor((36 - w) / 2), PAD + 2 + Math.floor((32 - h) / 2), w, h);
  }
  text(ctx, history.name, nameX, PAD + 15, { font: '16px "RS Bold"', color: COLOR.orange });
  text(ctx, PERIOD_LABEL[history.period], nameX, PAD + 31, { color: COLOR.white });
  if (history.end_price !== null) {
    text(ctx, `${history.end_price.toLocaleString('en-US')} gp`, W - PAD - 2, PAD + 15, {
      font: '16px "RS Bold"',
      align: 'right',
    });
  }
  if (history.change_percent !== null) {
    const up = history.change_percent >= 0;
    text(ctx, `${up ? '+' : ''}${history.change_percent}%`, W - PAD - 2, PAD + 31, {
      color: up ? COLOR.green : COLOR.red,
      align: 'right',
    });
  }

  // Chart panel.
  const top = PAD + HEADER_H;
  bevel(ctx, PAD, top, W - PAD * 2, CHART_H, COLOR.barBg);
  const plotX = PAD + 4;
  const plotW = W - PAD * 2 - 8 - LABELS_W;
  const plotTop = top + 8;
  const volumeTop = top + CHART_H - 4 - VOLUME_H;
  const plotBottom = volumeTop - 6;

  const points = history.points;
  const prices = points.map((p) => p.price).filter((p): p is number => p !== null);
  if (prices.length === 0) {
    text(ctx, 'No trades in this period', W / 2, top + CHART_H / 2, { color: COLOR.grey, align: 'center' });
  } else {
    let lo = Math.min(...prices);
    let hi = Math.max(...prices);
    if (hi === lo) {
      hi += 1;
      lo -= 1;
    }
    const yOf = (price: number) => Math.round(plotBottom - ((price - lo) / (hi - lo)) * (plotBottom - plotTop));
    const xOf = (i: number) => plotX + (points.length === 1 ? plotW / 2 : Math.round((i * (plotW - 1)) / (points.length - 1)));

    // Gridlines and price labels: high, middle, low.
    for (const price of [hi, (hi + lo) / 2, lo]) {
      const y = yOf(price);
      ctx.fillStyle = COLOR.cell;
      for (let x = plotX; x < plotX + plotW; x += 3) ctx.fillRect(x, y, 1, 1);
      text(ctx, compact.format(price), plotX + plotW + 4, y + 4, { font: '16px "RS Small"', color: COLOR.grey });
    }

    // Volume bars.
    const maxVolume = Math.max(1, ...points.map((p) => p.volume));
    const barW = Math.max(1, Math.floor(plotW / points.length) - 1);
    ctx.fillStyle = COLOR.hi;
    points.forEach((p, i) => {
      const h = Math.round((p.volume / maxVolume) * VOLUME_H);
      if (h > 0) ctx.fillRect(Math.min(xOf(i), plotX + plotW - barW), volumeTop + VOLUME_H - h, barW, h);
    });

    ctx.fillStyle = COLOR.yellow;
    pixelLine(ctx, points.map((p, i) => (p.price === null ? null : { x: xOf(i), y: yOf(p.price) })));
  }

  // Dates under the chart.
  if (points.length > 0) {
    const axisY = top + CHART_H + AXIS_H - 1;
    const style = { font: '16px "RS Small"', color: COLOR.grey };
    text(ctx, formatDate(points[0].at, history.period), plotX, axisY, style);
    text(ctx, formatDate(points[points.length - 1].at, history.period), plotX + plotW, axisY, {
      ...style,
      align: 'right',
    });
  }

  const range =
    history.lowest !== null && history.highest !== null
      ? `Low ${compact.format(history.lowest)} · High ${compact.format(history.highest)} · `
      : '';
  text(ctx, `${range}Traded ${history.total_volume.toLocaleString('en-US')} · OSRS Wiki prices`, W / 2, H - PAD - 2, {
    font: '16px "RS Small"',
    color: COLOR.grey,
    align: 'center',
  });

  return toPng(canvas);
}
