import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { randomQuote, formatQuote } from './quotes.js';
import { randomFunnyMoment, formatFunnyMoment, poolStats } from './subtitles.js';
import { isSubscribed, subscribe, unsubscribe } from './subscriptions.js';

const OWNER_ID = process.env.OWNER_ID;
const MESSAGES_PER_QUOTE = 10;
const messageCounts = new Map(); // channelId -> messages since last quote

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (c) => {
  const { lines, episodes } = poolStats(); // warm the pool so first use is instant
  console.log(`Logged in as ${c.user.tag}. ${lines} lines from ${episodes} episodes loaded.`);
});

// Slash commands: /quote, /funnymoment, /subscribe, /unsubscribe
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName } = interaction;

  if (commandName === 'quote') {
    await interaction.reply(formatQuote(randomQuote()));
  } else if (commandName === 'funnymoment') {
    const moment = randomFunnyMoment();
    await interaction.reply(
      moment ? formatFunnyMoment(moment) : 'No subtitles loaded — run the extraction first.',
    );
  } else if (commandName === 'subscribe' || commandName === 'unsubscribe') {
    // Owner-only: gate on the exact user ID, not a role, so only I can run it.
    if (!OWNER_ID || interaction.user.id !== OWNER_ID) {
      await interaction.reply({ content: 'Only the bot owner can use this.', ephemeral: true });
      return;
    }
    const ch = interaction.channelId;
    if (commandName === 'subscribe') {
      const added = subscribe(ch);
      messageCounts.set(ch, 0);
      await interaction.reply({
        content: added
          ? `Subscribed — I'll drop a random quote here every ${MESSAGES_PER_QUOTE} messages.`
          : 'This channel is already subscribed.',
        ephemeral: true,
      });
    } else {
      const removed = unsubscribe(ch);
      messageCounts.delete(ch);
      await interaction.reply({
        content: removed ? 'Unsubscribed — no more automatic quotes here.' : 'This channel was not subscribed.',
        ephemeral: true,
      });
    }
  }
});

// Message handling: keyword/mention replies, plus the every-N-messages quote drop.
client.on(Events.MessageCreate, (message) => {
  if (message.author.bot) return; // ignore bots (incl. our own quote posts)

  const content = message.content.toLowerCase();
  const mentionsBot = client.user && message.mentions.has(client.user);
  if (mentionsBot || content.includes('family guy')) {
    const moment = randomFunnyMoment();
    if (moment) message.reply(formatFunnyMoment(moment));
  }

  // In subscribed channels, post a random quote every MESSAGES_PER_QUOTE messages.
  if (isSubscribed(message.channelId)) {
    const n = (messageCounts.get(message.channelId) || 0) + 1;
    if (n >= MESSAGES_PER_QUOTE) {
      messageCounts.set(message.channelId, 0);
      const moment = randomFunnyMoment();
      if (moment) message.channel.send(formatFunnyMoment(moment));
    } else {
      messageCounts.set(message.channelId, n);
    }
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

client.login(token);
