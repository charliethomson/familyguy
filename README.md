# familyguyfunnymomentsbot

A Discord bot that quotes Family Guy. It responds to a `/quote` slash command, to
`@mentions`, and to any message containing "family guy" with a random quote.

## Setup

1. **Create the bot** at <https://discord.com/developers/applications>:
   - New Application → **Bot** tab → *Reset Token* → copy the token.
   - **Bot** tab → enable the **Message Content Intent** (required for the
     mention/keyword replies).
   - **General Information** → copy the **Application ID** (this is `CLIENT_ID`).

2. **Install and configure**:
   ```sh
   npm install
   cp .env.example .env   # then fill in DISCORD_TOKEN, CLIENT_ID, and OWNER_ID
   ```

3. **Register the slash command**:
   ```sh
   npm run register
   ```
   Set `GUILD_ID` in `.env` to register instantly to one server during development;
   leave it blank for a global command (can take up to an hour to appear).

4. **Invite the bot** to your server. Under **OAuth2 → URL Generator**, select the
   `bot` and `applications.commands` scopes, then open the generated URL.

5. **Run it**:
   ```sh
   npm start
   ```

## Usage

- `/quote` — posts a random hand-picked Family Guy quote.
- `/funnymoment` — a fully random line pulled from any episode's subtitles, with its
  timecode so you can find the moment, e.g.:

  ```
  "I earned some banana bread."
  S12E11 - Brian's a Bad Father (2014) · 03:41
  ```
- Mention the bot or type a message containing "family guy" — posts a `/quote`.
- `/subscribe` / `/unsubscribe` — **owner only** (gated on `OWNER_ID`). In the channel
  where you run `/subscribe`, the bot posts a random quote every 10 messages until you
  `/unsubscribe`. Subscribed channels are remembered across restarts
  (`data/subscriptions.json`, gitignored); the message counter resets on restart.

## Adding quotes

Edit [`src/quotes.js`](src/quotes.js) and add `{ text, character }` entries to the
`quotes` array.

## Subtitle data (for `/funnymoment`)

`/funnymoment` draws from the show's actual subtitles. Three offline build steps
produce the two `data/` files the bot reads — all already run, and the `data/` output
is committed so the bot needs neither the media nor the SRTs at runtime:

1. **Subtitles** — [`scripts/extract_subs.py`](scripts/extract_subs.py) pulls the
   English subtitle track out of every `.mkv` into `subtitles/Season NN/*.srt`
   (391 episodes; 60 use image-based PGS subs that would need OCR, so they're
   skipped). Run with a live dashboard: `python3 scripts/extract_subs.py`.
2. **Episode metadata** — `npm run build:episodes`
   ([`scripts/build-episode-index.js`](scripts/build-episode-index.js)) reads the
   `.nfo` files next to each episode into [`data/episodes.json`](data/episodes.json)
   (title + year per `SxxExx`).
3. **Lines** — `npm run build:lines`
   ([`scripts/build-lines-index.js`](scripts/build-lines-index.js)) parses every SRT
   into [`data/lines.json`](data/lines.json): ~176k dialogue lines keyed by episode,
   each a `[timecode, line]` pair (markup stripped, music/sound cues filtered).

At runtime [`src/subtitles.js`](src/subtitles.js) just loads those two JSON files and
serves a uniformly random line — no SRT parsing. Steps 2–3 only need re-running when
the subtitles change; `subtitles/` is gitignored (re-derivable and large), but
`data/` is committed, so a plain `git clone` has everything `/funnymoment` needs.
