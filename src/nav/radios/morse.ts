/**
 * International Morse code (ITU-R M.1677-1) for station identifiers.
 * Characters are separated by a single space, e.g. 'SAX' -> '... .- -..-'.
 */
const MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
};

const cache = new Map<string, string>();

/** Morse pattern of an ident; unknown characters are skipped. Results are cached (no per-frame allocation). */
export function morse(ident: string): string {
  let m = cache.get(ident);
  if (m === undefined) {
    m = ident
      .toUpperCase()
      .split('')
      .map((c) => MORSE[c] ?? '')
      .filter((s) => s.length > 0)
      .join(' ');
    cache.set(ident, m);
  }
  return m;
}
