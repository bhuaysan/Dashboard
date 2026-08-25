function score(needle: string, hay: string): number {
  const n = needle.toLowerCase();
  const h = hay.toLowerCase();
  let i = 0;
  let s = 0;
  let last = -1;
  for (let c = 0; c < h.length && i < n.length; c++) {
    if (h[c] === n[i]) {
      s += c === 0 || h[c - 1] === " " ? 6 : 2;
      if (last === c - 1) s += 3;
      last = c;
      i++;
    }
  }
  return i === n.length ? s : -1;
}

export function fuzzyFilter<T>(query: string, items: T[], label: (item: T) => string, max = 8): T[] {
  if (query.trim() === "") return [];
  return items
    .map((item) => ({ item, score: score(query, label(item)) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.item);
}
