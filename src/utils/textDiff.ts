export type DiffSegment = { text: string; kind: 'same' | 'add' | 'del' };

/** Word-level diff (whitespace kept as its own tokens). Returns the old text with deletions and the new text with additions marked. */
export function diffWords(oldText: string, newText: string): { old: DiffSegment[]; next: DiffSegment[] } {
  const a = oldText.split(/(\s+)/).filter((t) => t !== '');
  const b = newText.split(/(\s+)/).filter((t) => t !== '');
  // LCS table
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const old: DiffSegment[] = [];
  const next: DiffSegment[] = [];
  const push = (list: DiffSegment[], text: string, kind: DiffSegment['kind']) => {
    const last = list[list.length - 1];
    if (last && last.kind === kind) last.text += text;
    else list.push({ text, kind });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(old, a[i], 'same');
      push(next, b[j], 'same');
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(old, a[i++], 'del');
    } else {
      push(next, b[j++], 'add');
    }
  }
  while (i < a.length) push(old, a[i++], 'del');
  while (j < b.length) push(next, b[j++], 'add');
  return { old, next };
}
