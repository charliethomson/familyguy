import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const commands = [
  new SlashCommandBuilder()
    .setName('quote')
    .setDescription('Get a random Family Guy quote.')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('funnymoment')
    .setDescription('A fully random line pulled from any episode.')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('subscribe')
    .setDescription('(Owner only) Post a random quote in this channel every 10 messages.')
    .setDMPermission(false)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('unsubscribe')
    .setDescription('(Owner only) Stop automatic quotes in this channel.')
    .setDMPermission(false)
    .toJSON(),
];

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID; // optional: register to one guild for instant updates

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in .env');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

try {
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log(`Registered ${commands.length} command(s) to guild ${guildId}.`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body: commands });
    console.log(`Registered ${commands.length} global command(s) (may take up to 1 hour to appear).`);
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}
