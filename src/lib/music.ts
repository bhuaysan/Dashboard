// Geteilt zwischen Server und Browser — hier darf nichts Serverseitiges
// (process.env, node:*, undici) importiert werden, sonst bricht das Bundle.
export type MusicCommand = "toggle" | "next" | "prev" | "volumeUp" | "volumeDown" | "transfer";

export const MUSIC_COMMANDS: readonly MusicCommand[] = [
  "toggle", "next", "prev", "volumeUp", "volumeDown", "transfer",
];
