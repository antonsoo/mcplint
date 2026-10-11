/** Exact Levenshtein distance up to two edits; 3 means only "more than two".
 *
 * A path with at most two insertions/deletions cannot leave the five diagonals
 * around i === j. Keep just those cells in two rows, rather than allocating a
 * matrix from untrusted name lengths. Names use UTF-16 units, as the original
 * rule did; this is not a new Unicode normalization or similarity policy.
 */
export function nameDistance(a: string, b: string): number {
  const limit = 2;
  const beyond = limit + 1;
  if (Math.abs(a.length - b.length) > limit) return beyond;

  // Equal ends contribute no edits. Besides saving work for normal prefixed
  // tool names, this makes a very long name with one changed letter cheap.
  let start = 0;
  let endA = a.length;
  let endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0) return Math.min(beyond, Math.max(n, m));

  let previous = new Array<number>(2 * limit + 1).fill(beyond);
  let current = new Array<number>(2 * limit + 1).fill(beyond);
  let previousLo = 0;
  let previousHi = Math.min(m, limit);
  for (let j = 0; j <= previousHi; j++) previous[j] = j;
  for (let i = 1; i <= n; i++) {
    const lo = Math.max(0, i - limit);
    const hi = Math.min(m, i + limit);
    let best = beyond;
    for (let j = lo; j <= hi; j++) {
      const deletion = j >= previousLo && j <= previousHi ? previous[j - previousLo]! + 1 : beyond;
      const insertion = j > lo ? current[j - lo - 1]! + 1 : beyond;
      const replacement = j > 0 && j - 1 >= previousLo && j - 1 <= previousHi
        ? previous[j - 1 - previousLo]! + (a[start + i - 1] === b[start + j - 1] ? 0 : 1)
        : beyond;
      const value = j === 0 ? i : Math.min(deletion, insertion, replacement);
      current[j - lo] = value;
      best = Math.min(best, value);
    }
    if (best > limit) return beyond;
    [previous, current] = [current, previous];
    previousLo = lo;
    previousHi = hi;
  }
  return Math.min(beyond, previous[m - previousLo]!);
}
