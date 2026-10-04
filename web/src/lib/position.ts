// Order keys: strings that sort in list order, so moving a task changes one key and never the others.
// A key is a fraction 0.d1d2d3... written in base 62; keys never end in "0", which keeps each fraction
// spelled one way, so plain string comparison is the same as numeric comparison.

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

const digitOf = (char: string | undefined): number =>
  char === undefined ? 0 : DIGITS.indexOf(char);

/** A key strictly between `a` and `b` (`a` empty means the start, `b` null means the end). */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let common = 0;
    while ((a[common] ?? "0") === b[common]) common += 1;
    if (common > 0) return b.slice(0, common) + midpoint(a.slice(common), b.slice(common));
  }
  const low = digitOf(a[0]);
  const high = b === null ? BASE : digitOf(b[0]);
  if (high - low > 1) return DIGITS[(low + high) >> 1] as string;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return (DIGITS[low] as string) + midpoint(a.slice(1), null);
}

/** A key that sorts after `before` and before `after`; either may be null for "no neighbour". */
export function positionBetween(before: string | null, after: string | null): string {
  if (before !== null && after !== null && before >= after) {
    throw new Error("positionBetween: before must sort before after");
  }
  return midpoint(before ?? "", after);
}

/** A key for a task appended to the end of the list. */
export const positionAfter = (last: string | null): string => positionBetween(last, null);
