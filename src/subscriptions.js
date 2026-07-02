// Tracks which channels are subscribed to the "random quote every N messages"
// feature. The set of channel IDs is persisted to data/subscriptions.json so it
// survives restarts; the per-channel message counter is in-memory (see index.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Override with SUBSCRIPTIONS_FILE to point at a writable volume (see Dockerfile);
// defaults to the repo's data/ for local runs.
const FILE = process.env.SUBSCRIPTIONS_FILE
  ? path.resolve(process.env.SUBSCRIPTIONS_FILE)
  : path.join(__dirname, '..', 'data', 'subscriptions.json');

function read() {
  try {
    return new Set(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  } catch {
    return new Set();
  }
}

const channels = read();

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify([...channels]) + '\n');
}

export function isSubscribed(channelId) {
  return channels.has(channelId);
}

// Returns true if it was newly added, false if it was already subscribed.
export function subscribe(channelId) {
  if (channels.has(channelId)) return false;
  channels.add(channelId);
  save();
  return true;
}

// Returns true if it was removed, false if it wasn't subscribed.
export function unsubscribe(channelId) {
  if (!channels.delete(channelId)) return false;
  save();
  return true;
}
