// Detects whether a message is "a Family Guy reference" — deliberately broad.
// Handles leetspeak (f4m1ly gu4y), diacritics (fàmily gúy), separators
// (family-guy, family_guy, familyguy), typos/transpositions (gamily fuy), plus a
// list of character names and catchphrases. Tune the lists at the bottom.

// Leetspeak / symbol → letter. Applied before stripping non-letters.
const LEET = {
  '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a', '5': 's', '6': 'g',
  '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i', '+': 't',
  '(': 'c', '<': 'c', '|': 'l', '£': 'l', '€': 'e',
};

function base(s) {
  const lowered = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let out = '';
  for (const ch of lowered) out += LEET[ch] ?? ch;
  return out;
}

// "familyguy" — letters only, all separators/punctuation gone.
const tightOf = (s) => base(s).replace(/[^a-z]/g, '');
// "family guy" — words preserved, separated by single spaces.
const spacedOf = (s) => base(s).replace(/[^a-z]+/g, ' ').trim();

// Levenshtein edit distance (iterative, two rows).
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

// Is some substring of `hay` within `maxDist` edits of `needle`? (Bounded so a
// pathologically long message can't blow up the scan.)
function fuzzyNear(hay, needle, maxDist) {
  if (hay.length > 2000) return false;
  const n = needle.length;
  for (let w = Math.max(1, n - maxDist); w <= n + maxDist; w++) {
    for (let i = 0; i + w <= hay.length; i++) {
      if (lev(hay.slice(i, i + w), needle) <= maxDist) return true;
    }
  }
  return false;
}

export function isFamilyGuyReference(text) {
  if (!text) return false;
  const tight = tightOf(text);
  if (!tight) return false;

  // The title itself, in every joined form (leet/diacritic/separator/spacing).
  if (tight.includes('familyguy')) return true;

  // Distinctive multi-word phrases & full names — safe as joined substrings.
  for (const p of JOINED) if (tight.includes(p)) return true;

  // Distinctive single tokens — word-boundary (prefix) so plurals/possessives
  // hit but random substrings don't. Catches "griffins", "stewie's".
  if (TOKEN_RE.test(spacedOf(text))) return true;

  // Last: typos/transpositions of the title ("gamily fuy" -> 2 edits).
  return fuzzyNear(tight, 'familyguy', 2);
}

// ── tunable reference lists ────────────────────────────────────────────────
// Checked as substrings of the letters-only form, so write them joined.
const JOINED = [
  // full character names
  'petergriffin', 'loisgriffin', 'briangriffin', 'meggriffin', 'chrisgriffin',
  'glennquagmire', 'clevelandbrown', 'joeswanson', 'bonnieswanson', 'adamwest',
  'tomtucker', 'olliewilliams', 'mortgoldman', 'drhartman', 'evilmonkey',
  'giantchicken', 'koolaidman', 'consuela', 'herbert',
  // catchphrases / references
  'shutupmeg', 'freakinsweet', 'roadhouse', 'whatthedeuce', 'victoryismine',
  'grindsmygears', 'birdistheword', 'surfinbird', 'coolwhip', 'holycraplois',
  'giggitygiggity',
  // ── deep cuts for the real heads ──
  'conwaytwitty',        // the smash-cut to a full Conway Twitty performance
  'buzzkillington',      // Buzz Killington, the tedious Victorian
  'drunkenclam',         // the bar
  'pawtucketpatriot', 'pawtucketpat', // the brewery Peter works at
  'greasedupdeafguy',    // "You'll never catch him!"
  'triciatakanawa',      // Asian correspondent, Channel 5 news
  'dianesimmons',        // co-anchor
  'neilgoldman',         // Meg's stalker
  'jonathanweed', 'mrweed', // Peter's first boss (choked on a dinner roll)
  'randynewman',         // "he's just singing about what he sees"
  'bagofweed',           // the Wizard-of-Oz "A Bag of Weed" number
  'sexyparty',           // "It's a sexy party!"
  'mayorwest',           // Mayor Adam West
  'idadavis',            // Quagmire's dad
  'chickenfight',        // Peter vs. Ernie the Giant Chicken
];
// Single distinctive words. Matched at a word-start boundary.
const TOKENS = [
  'stewie', 'quagmire', 'griffin', 'giggity', 'quahog',
  // deep cuts
  'petoria',   // Peter's micronation
  'shipoopi',  // the Music Man number Peter performs
  'seamus',    // the peg-limbed fisherman
  'bertram',   // Stewie's arch-nemesis half-brother
  'rupert',    // Stewie's teddy bear
];
const TOKEN_RE = new RegExp(`\\b(${TOKENS.join('|')})`, 'i');
