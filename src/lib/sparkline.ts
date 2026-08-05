const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇"] as const;

export function sparkline(values: number[]): string {
  if (values.length === 0) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return BLOCKS[3].repeat(values.length);
  return values.map((v) => {
    const i = Math.round(((v - min) / (max - min)) * (BLOCKS.length - 1));
    return BLOCKS[i] ?? BLOCKS[0];
  }).join("");
}

