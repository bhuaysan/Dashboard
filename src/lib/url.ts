// Nur http und https: die Adressen kommen aus der Config und — bei News — aus fremden
// Feeds. javascript: oder data: würden als Skript in der eigenen Seite landen.
export function safeHref(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let target: URL;
  try {
    target = new URL(url, window.location.href);
  } catch {
    return undefined;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return undefined;
  return target.href;
}

export function openUrl(url: string, newTab: boolean): void {
  const href = safeHref(url);
  if (href === undefined) return;
  if (newTab) window.open(href, "_blank", "noopener");
  else window.location.assign(href);
}

export function buildConsoleUrl(base: string, node: string, vmid: number): string {
  const url = new URL(base);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  url.searchParams.set("console", "kvm");
  url.searchParams.set("novnc", "1");
  url.searchParams.set("vmid", String(vmid));
  url.searchParams.set("node", node);
  return url.toString();
}
