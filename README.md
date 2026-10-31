# Discord Bot - TypeScript + discord.js v14

A Discord bot scaffold built with TypeScript and discord.js v14.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy the example config file and add your bot tokens:
```bash
cp config.json.example config.json
```

3. Edit `config.json` and add your bot tokens and Gemini API key:
```json
{
  "token": "YOUR_ACTUAL_BOT_TOKEN",
  "test_token": "YOUR_TEST_BOT_TOKEN",
  "gemini_api_key": "YOUR_GEMINI_API_KEY"
}
```

**Configuration Parameters:**
- `token` - Your main Discord bot token (used in regular/production mode)
- `test_token` - Your test Discord bot token (used in test mode)
- `gemini_api_key` - Your Google Gemini API key (required for AI functionality)
- `osrs_mcp_url`, `osrs_mcp_token` - Optional. The public endpoint of the
  [rs-mcp](https://github.com/Bluefire2/rs-mcp) server and its bearer token. When both are set,
  Gemini can look up Old School RuneScape data (stats, boss kill counts, quests, diaries, gains,
  GE prices and price history) for any player by name, and read OSRS Wiki pages for game
  knowledge. The endpoint serves public data only. If it can't be reached, the bot answers
  without these tools. The production token is in the rs-mcp project's Secret Manager as
  `osrs-mcp-public-api-tokens`. Replies get image cards (`src/cards.ts`): a player's skills tab
  when their stats are looked up (with quest points, diaries, combat achievements, clues and
  collection log underneath), and a price chart when an item's price history is. Skill and
  progress icons are from the [OSRS Wiki](https://oldschool.runescape.wiki) and fonts from
  [RuneStar/fonts](https://github.com/RuneStar/fonts) under CC0, both in `assets/osrs/`; item
  icons for the price chart are fetched from the Wiki when needed.

  Users can save their RuneScape name by just telling the bot ("set my rsn to Lynx Titan",
  "forget my rsn"), which Gemini does with the `set_my_rsn` / `clear_my_rsn` tools
  (`src/rsnTool.ts`), or with `--setRsn <name>`, `--getRsn` and `--removeRsn`. Then "what are my
  stats?" works without asking. The tools are bound to the message's author, so nobody can set
  someone else's name. The name is per Discord user, the same in every server and DMs, and
  stored in `serverConfig.json` under `users`. Saved names of the people in the conversation
  are passed to Gemini.

**Getting a Gemini API Key:**
1. Go to https://aistudio.google.com/app/apikey
2. Create a new API key or use an existing one
3. Copy the API key and add it to `config.json`

## Running the Bot

### Development Mode (with hot reload using ts-node)

**Regular mode:**
```bash
npm run dev
```

**Test mode:**
```bash
npm run dev:test
```

### Production Mode (compiled)

1. Build the TypeScript code:
```bash
npm run build
```

2. Run the bot:

**Regular mode:**
```bash
npm start
```

**Test mode:**
```bash
npm run test
```

## Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run the compiled bot in regular mode
- `npm run dev` - Run the bot in development mode (regular mode)
- `npm run dev:test` - Run the bot in development mode (test mode)
- `npm run test` - Run the compiled bot in test mode

## Bot Setup & Permissions

### OAuth Scopes Required
- `bot` - Required for all bots
- `applications.commands` - Optional (only needed if using slash commands)

### Bot Permissions Required
- **View Channels** - To see channels
- **Send Messages** - To send messages/replies
- **Read Message History** - To fetch previous messages for context
- **Use External Emojis** - Optional, for emoji support
- **Embed Links** - Optional, for rich embeds

### Privileged Intent
⚠️ **Important**: This bot requires the **Message Content Intent** (privileged intent), which must be enabled in the Discord Developer Portal:
1. Go to https://discord.com/developers/applications
2. Select your bot application
3. Go to the "Bot" section
4. Enable "Message Content Intent" under "Privileged Gateway Intents"

### Invite URL
Use this format to invite your bot (replace `YOUR_BOT_CLIENT_ID` with your bot's client ID):
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_BOT_CLIENT_ID&permissions=19456&scope=bot
```

The permissions value `19456` includes: View Channels, Send Messages, Read Message History, Use External Emojis, and Embed Links.

## Test Mode

**Test mode** is a special debugging mode that provides additional logging and uses a separate bot token. When test mode is enabled:

- The bot uses `test_token` from `config.json` instead of the regular `token`
- Additional debug logging is enabled (prompts sent to Gemini, responses received, etc.)
- Available Gemini models are listed on startup
- Useful for development and testing without affecting your production bot

**How to enable test mode:**
- Set the `TEST_MODE` environment variable to `'true'` when running the bot
- Or use the test mode npm scripts: `npm run dev:test` or `npm run test`

**What is `test_token`?**
The `test_token` is a separate Discord bot token used exclusively when running in test mode. This allows you to:
- Test bot functionality without affecting your production bot
- Use a different bot account for development/testing
- Keep your production bot running while testing new features

You can create a separate Discord application in the Discord Developer Portal to get a test bot token, or use a different bot token from an existing application.

## Deployment

The bot runs on a small Linux VM (Debian, Node at `/usr/bin/node`) as a systemd service.
Files in `deploy/`:

- `gork.service` - systemd unit. Runs `node dist/index.js` from `/opt/gork` as the `gork` user, restarts on failure, and gives up after 5 failed starts in 5 minutes.
- `deploy.sh` - run on the VM with `sudo`. Creates the user and the `/opt/gork` checkout on first run, fast-forwards to `origin/master`, runs `npm ci` and `npm run build`, installs the unit, restarts, and waits for `Bot is ready!` in the journal.

First install:
```bash
curl -fsSLO https://raw.githubusercontent.com/Bluefire2/gork/master/deploy/deploy.sh
sudo bash deploy.sh   # stops and asks for /opt/gork/config.json
sudo cp config.json.example /opt/gork/config.json && sudo nano /opt/gork/config.json
sudo bash deploy.sh
```

Subsequent deploys:
```bash
sudo bash /opt/gork/deploy/deploy.sh
```

Logs: `journalctl -u gork -f`

Traces: every mention the bot handles is saved to `traces/<message ID>.json` (gitignored, newest 500 kept): the parsed flags, model, full prompt, tool calls, response, any error, and the IDs of its replies. Useful for bug reports - see AGENTS.md.

## Notes

- The bot automatically switches between tokens based on the `TEST_MODE` environment variable
- `config.json` is gitignored to protect your tokens and API keys
- Make sure to add your actual tokens and Gemini API key to `config.json` before running the bot

