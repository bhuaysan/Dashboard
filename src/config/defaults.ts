import type { Config } from "./schema";

export const defaultConfig: Config = {
  version: 1,
  updatedAt: "2026-08-05T00:00:00.000Z",
  theme: "system",
  clock: {
    secondary: [
      { label: "IBsolution", tz: "Europe/Berlin" },
      { label: "IST", tz: "Asia/Kolkata" },
      { label: "UTC", tz: "Etc/UTC" },
    ],
  },
  location: { label: "Heilbronn", lat: 49.1427, lon: 9.2109 },
  linkGroups: [
    {
      title: "SAP",
      links: [
        { label: "Datasphere", url: "https://datasphere.example/", hint: "gd" },
        { label: "Analytics Cloud", url: "https://sac.example/", hint: "gs" },
        { label: "BTP Cockpit", url: "https://cockpit.btp.example/", hint: "gb" },
        { label: "HANA Cloud Central", url: "https://hanacloud.example/", hint: "gn" },
      ],
    },
    {
      title: "Intern",
      links: [
        { label: "Jira", url: "https://jira.example/", hint: "gj" },
        { label: "Confluence", url: "https://confluence.example/", hint: "gc" },
        { label: "Zeiterfassung", url: "https://zeit.example/", hint: "gz" },
        { label: "Outlook Web", url: "https://outlook.example/", hint: "go" },
      ],
    },
    {
      title: "Homelab",
      links: [
        { label: "Proxmox", url: "https://10.0.10.10:8006/", hint: "gp" },
        { label: "Pi-hole", url: "http://10.0.10.11/admin/", hint: "gh" },
        { label: "Uptime Kuma", url: "http://uptime.local/", hint: "gk" },
        { label: "Jellyfin", url: "http://jellyfin.local/", hint: "gv" },
        { label: "Filebrowser", url: "http://filebrowser.local/", hint: "gf" },
        { label: "Home Assistant", url: "http://home.local/", hint: "ga" },
      ],
    },
    {
      title: "Dev",
      links: [
        { label: "GitHub", url: "https://github.com/", hint: "gu" },
        { label: "MDN", url: "https://developer.mozilla.org/", hint: "gm" },
      ],
    },
  ],
  feeds: [
    { label: "heise", url: "https://www.heise.de/rss/heise-atom.xml", limit: 4 },
    { label: "tagesschau", url: "https://www.tagesschau.de/index~rss2.xml", limit: 3 },
  ],
  calendars: [],
  search: {
    default: "https://duckduckgo.com/?q=%s",
    bangs: {
      g: "https://www.google.com/search?q=%s",
      gh: "https://github.com/search?q=%s",
      npm: "https://www.npmjs.com/search?q=%s",
      ddg: "https://duckduckgo.com/?q=%s",
      mdn: "https://developer.mozilla.org/search?q=%s",
    },
  },
  // Zeile 1: Uhr, Wetter, Monat. Zeile 2: Links, News, Termine. Darunter Homelab
  // über die volle Breite.
  layout: [
    { id: "clock", visible: true, span: 1 },
    { id: "weather", visible: true, span: 1 },
    { id: "month", visible: true, span: 1 },
    { id: "links", visible: true, span: 1 },
    { id: "news", visible: true, span: 1 },
    { id: "agenda", visible: true, span: 1 },
    { id: "homelab", visible: true, span: 1 },
  ],
  proxyAllowlist: [
    "api.open-meteo.com",
    "geocoding-api.open-meteo.com",
    "www.heise.de",
    "www.tagesschau.de",
  ],
  homelab: {
    node: "pve",
    uiUrl: "https://10.0.10.10:8006",
    expectRunning: [100, 101, 104, 105, 111, 112],
    thresholds: { cpu: 90, mem: 85, storage: 80, backupAgeHours: 36 },
    reachability: [],
  },
};
