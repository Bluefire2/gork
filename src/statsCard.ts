import { loadImage, Image } from '@napi-rs/canvas';
import * as path from 'path';
import { ASSETS, COLOR, PAD, bevel, card, text, toPng } from './cardStyle';

/** The fields of an rs-mcp get_stats result that the card uses. */
export interface PlayerStats {
  rsn: string;
  account_type: string;
  fetched_at: string;
  total_level: number;
  total_xp: number;
  combat_level: number;
  skills: { skill: string; level: number; xp: number }[];
}

export function isPlayerStats(value: any): value is PlayerStats {
  return typeof value?.rsn === 'string' && Array.isArray(value.skills);
}

// The in-game skills tab is 3 columns by 8 rows. Its rows 1-4 go on the left and 5-8 on the
// right, because Discord shows a wide image much larger than a tall one.
const GRID = [
  ['Attack', 'Hitpoints', 'Mining', 'Prayer', 'Crafting', 'Firemaking'],
  ['Strength', 'Agility', 'Smithing', 'Magic', 'Fletching', 'Woodcutting'],
  ['Defence', 'Herblore', 'Fishing', 'Runecraft', 'Slayer', 'Farming'],
  ['Ranged', 'Thieving', 'Cooking', 'Construction', 'Hunter', 'Sailing'],
];

const CELL_W = 62;
const CELL_H = 32;
const GAP = 2;
const HEADER_H = 34;
const TOTAL_H = 26;
const FOOTER_H = 14;
const COLS = GRID[0].length;
export const CARD_W = PAD * 2 + CELL_W * COLS + GAP * (COLS - 1);
const H = PAD + HEADER_H + (CELL_H + GAP) * GRID.length + TOTAL_H + FOOTER_H + PAD;

// XP needed for each level, 1-99.
const LEVEL_XP = (() => {
  const table = [0, 0];
  let points = 0;
  for (let level = 1; level < 99; level++) {
    points += Math.floor(level + 300 * Math.pow(2, level / 7));
    table.push(Math.floor(points / 4));
  }
  return table;
})();

let icons: Promise<Map<string, Image>> | null = null;

function loadIcons(): Promise<Map<string, Image>> {
  icons ??= Promise.all(
    [...GRID.flat(), 'Stats'].map(
      async (name) => [name, await loadImage(path.join(ASSETS, 'icons', `${name}.png`))] as const,
    ),
  ).then((entries) => new Map(entries));
  return icons;
}

/** A PNG of the player's skills, laid out like the in-game skills tab. */
export async function renderStatsCard(stats: PlayerStats): Promise<Buffer> {
  const icon = await loadIcons();
  const skills = new Map(stats.skills.map((s) => [s.skill, s]));
  const W = CARD_W;
  const { canvas, ctx } = card(W, H);

  const type = stats.account_type === 'regular' ? '' : `  ·  ${stats.account_type.replace(/_/g, ' ')}`;
  text(ctx, stats.rsn, PAD + 1, PAD + 13, { font: '16px "RS Bold"', color: COLOR.orange });
  text(ctx, `Combat level: ${stats.combat_level}${type}`, PAD + 1, PAD + 28, { color: COLOR.white });

  const gridY = PAD + HEADER_H;
  GRID.forEach((row, r) => {
    row.forEach((name, col) => {
      const x = PAD + col * (CELL_W + GAP);
      const y = gridY + r * (CELL_H + GAP);
      bevel(ctx, x, y, CELL_W, CELL_H);

      const img = icon.get(name)!;
      ctx.drawImage(img, x + 4 + Math.floor((25 - img.width) / 2), y + 3 + Math.floor((25 - img.height) / 2));

      // Skills missing from the hiscores are below its cut-off; show them as level 1.
      const skill = skills.get(name);
      const level = skill?.level ?? 1;
      const maxed = level >= 99;
      text(ctx, String(level), x + CELL_W - 5, y + 19, {
        font: '16px "RS Bold"',
        color: maxed ? COLOR.orange : COLOR.yellow,
        align: 'right',
      });

      // Progress to the next level; full and orange at 99.
      let progress = 1;
      if (skill && !maxed) {
        const from = LEVEL_XP[level];
        const to = LEVEL_XP[level + 1];
        progress = Math.max(0, Math.min(1, (skill.xp - from) / (to - from)));
      }
      const barW = CELL_W - 8;
      ctx.fillStyle = COLOR.barBg;
      ctx.fillRect(x + 4, y + CELL_H - 5, barW, 2);
      ctx.fillStyle = maxed ? COLOR.orange : COLOR.green;
      ctx.fillRect(x + 4, y + CELL_H - 5, Math.round(barW * progress), 2);
    });
  });

  const totalY = gridY + (CELL_H + GAP) * GRID.length;
  const stat = icon.get('Stats')!;
  bevel(ctx, PAD, totalY, W - PAD * 2, TOTAL_H - 2);
  ctx.drawImage(stat, PAD + 4, totalY + Math.floor((TOTAL_H - 2 - stat.height) / 2));
  text(ctx, `Total: ${stats.total_level}`, PAD + 34, totalY + 16);
  text(ctx, `${stats.total_xp.toLocaleString('en-US')} xp`, W - PAD - 5, totalY + 16, {
    color: COLOR.white,
    align: 'right',
  });

  const fetched = stats.fetched_at.slice(0, 16).replace('T', ' ');
  text(ctx, `Hiscores · ${fetched} UTC`, W / 2, H - PAD - 2, {
    font: '16px "RS Small"',
    color: COLOR.grey,
    align: 'center',
  });

  return toPng(canvas);
}
