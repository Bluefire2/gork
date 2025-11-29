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

3. Edit `config.json` and add your bot tokens:
```json
{
  "token": "YOUR_ACTUAL_BOT_TOKEN",
  "test_token": "YOUR_TEST_BOT_TOKEN"
}
```

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

## Notes

- The bot automatically switches between tokens based on the `TEST_MODE` environment variable
- `config.json` is gitignored to protect your tokens
- Make sure to add your actual tokens to `config.json` before running the bot

