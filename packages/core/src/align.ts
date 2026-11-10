/** One line of an alignment: a step from each side, or a gap on one side. */
export interface AlignedPair {
  a?: number;
  b?: number;
  /** Both runs took a step here, but different ones. */
  changed?: boolean;
}

/**
 * Aligns two sequences of step signatures by their longest common subsequence, using Myers'
 * O((N+M)D) diff. Positions refer to the input arrays. Steps that only one run took come out as
 * pairs with a gap on the other side.
 */
export function align(a: readonly string[], b: readonly string[]): AlignedPair[] {
  // Trim the shared prefix and suffix first; most runs of the same task agree there.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const pairs: AlignedPair[] = [];
  for (let i = 0; i < start; i++) pairs.push({ a: i, b: i });
  pairs.push(...middle(a, b, start, endA, start, endB));
  for (let i = 0; i < a.length - endA; i++) pairs.push({ a: endA + i, b: endB + i });
  return pairs;
}

/** Beyond this many edits the trace of V arrays gets large; fall back to a plain gap. */
const MAX_EDITS = 2000;

function middle(
  a: readonly string[],
  b: readonly string[],
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): AlignedPair[] {
  const n = a1 - a0;
  const m = b1 - b0;
  if (n === 0 && m === 0) return [];
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max; d++) {
    // Keep only diagonals -d-1..d+1, the ones backtracking reads.
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number))) {
        x = v[offset + k + 1] as number;
      } else x = (v[offset + k - 1] as number) + 1;
      let y = x - k;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }
  if (found < 0) {
    // Too different to align cheaply: show every step of both as divergent.
    const pairs: AlignedPair[] = [];
    for (let i = 0; i < n; i++) pairs.push({ a: a0 + i });
    for (let j = 0; j < m; j++) pairs.push({ b: b0 + j });
    return pairs;
  }
  // Walk back through the saved V arrays.
  const reversed: AlignedPair[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d] as Int32Array;
    const k = x - y;
    const at = (diagonal: number) => prev[diagonal + d + 1] as number;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      reversed.push({ a: a0 + x, b: b0 + y });
    }
    if (down) {
      y--;
      reversed.push({ b: b0 + y });
    } else {
      x--;
      reversed.push({ a: a0 + x });
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    reversed.push({ a: a0 + x, b: b0 + y });
  }
  return reversed.reverse();
}

/** Index of the first pair where the runs diverge, or -1 when they match throughout. */
export function firstDivergence(pairs: readonly AlignedPair[]): number {
  return pairs.findIndex((pair) => pair.a == null || pair.b == null || pair.changed);
}

/**
 * Lays an alignment out for reading side by side, the way a diff viewer pairs a removed block
 * with the added block that replaced it: between two matches, the steps only A took and the
 * steps only B took share rows instead of stacking.
 */
export function sideBySide(pairs: readonly AlignedPair[]): AlignedPair[] {
  const out: AlignedPair[] = [];
  let onlyA: number[] = [];
  let onlyB: number[] = [];
  const flush = () => {
    const n = Math.max(onlyA.length, onlyB.length);
    for (let i = 0; i < n; i++) {
      const a = onlyA[i];
      const b = onlyB[i];
      out.push(a != null && b != null ? { a, b, changed: true } : a != null ? { a } : { b });
    }
    onlyA = [];
    onlyB = [];
  };
  for (const pair of pairs) {
    if (pair.a != null && pair.b != null) {
      flush();
      out.push(pair);
    } else if (pair.a != null) onlyA.push(pair.a);
    else if (pair.b != null) onlyB.push(pair.b);
  }
  flush();
  return out;
}
