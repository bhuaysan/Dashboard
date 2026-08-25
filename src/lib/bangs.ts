import type { Config } from "../config/schema";

export function resolveQuery(input: string, search: Config["search"]): string | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return undefined;
  const m = /^!(\S+)\s+([\s\S]+)$/.exec(trimmed);
  if (m) {
    const key = m[1] ?? "";
    const rest = m[2] ?? "";
    const tpl = Object.prototype.hasOwnProperty.call(search.bangs, key)
      ? search.bangs[key]
      : undefined;
    if (tpl) return tpl.replace("%s", encodeURIComponent(rest));
  }
  return search.default.replace("%s", encodeURIComponent(trimmed));
}
