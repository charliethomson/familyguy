// A curated list of Family Guy quotes. Each entry has the line and the character
// who said it. Add more freely — the bot picks one at random.
export const quotes = [
  { text: "Shut up, Meg.", character: "Peter Griffin" },
  { text: "Giggity giggity goo!", character: "Glenn Quagmire" },
  { text: "Freakin' sweet!", character: "Peter Griffin" },
  { text: "Victory is mine!", character: "Stewie Griffin" },
  { text: "What the deuce?", character: "Stewie Griffin" },
  { text: "Ahh, this is not my Batman glass.", character: "Brian Griffin" },
  { text: "Roadhouse.", character: "Peter Griffin" },
  { text: "Blast! And double blast!", character: "Stewie Griffin" },
  { text: "Whose leg do you have to hump to get a dry martini around here?", character: "Brian Griffin" },
  { text: "You know what really grinds my gears?", character: "Peter Griffin" },
  { text: "Oh my God, who the hell cares?", character: "Stewie Griffin" },
  { text: "Hey, Lois. Hey, Lois. Hey. Hey, Lois. Lois. Lois. Mom. Mommy. Mama.", character: "Stewie Griffin" },
  { text: "I'm sorry, is my drinking bothering you? 'Cause it's kind of interfering with mine.", character: "Brian Griffin" },
  { text: "It's a trip you take with your family. A family trip. Around the world!", character: "Peter Griffin" },
  { text: "Nyeah, nyeah, nyeah, nyeah, nyeah!", character: "Stewie Griffin" },
  { text: "Bird is the word!", character: "Peter Griffin" },
  { text: "Cool Whip.", character: "Stewie Griffin" },
  { text: "I do say, I rather fancy Lois.", character: "Stewie Griffin" },
  { text: "Holy crap, Lois, it's Kool-Aid Man!", character: "Peter Griffin" },
  { text: "Oh, oh! Oh yeah!", character: "Kool-Aid Man" },
];

export function randomQuote() {
  return quotes[Math.floor(Math.random() * quotes.length)];
}

export function formatQuote(q) {
  return `> ${q.text}\n— *${q.character}*`;
}
