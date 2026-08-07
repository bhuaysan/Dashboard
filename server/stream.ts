import { createReadStream, openSync, type ReadStream } from "node:fs";

/**
 * WAV-Header für einen PCM-Strom unbekannter Länge. go-librespot schreibt
 * s16le, 44,1 kHz, stereo in die FIFO — daraus wird mit Header „audio/wav",
 * das jedes <audio>-Element direkt abspielt. Unkomprimiert (~1,4 Mbit/s),
 * im LAN egal; dafür braucht es weder Encoder noch Icecast.
 * Datenlänge 0x7FFFFFFF: die ehrliche Antwort „unbekannt" für einen Strom.
 */
export function buildWavHeader(
  sampleRate = 44_100,
  channels = 2,
  bitsPerSample = 16,
): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) header[offset + i] = s.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, 0x7fffffff, true);          // Dateigröße unbekannt
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);                 // PCM-Teilblock
  view.setUint16(20, 1, true);                  // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  text(36, "data");
  view.setUint32(40, 0x7fffffff, true);         // Strom ohne bekanntes Ende
  return header;
}

type Sink = { write: (chunk: Uint8Array) => Promise<unknown>; close: () => void };

/**
 * Ein Leser auf der FIFO, viele Hörer: eine FIFO liefert jedes Byte genau
 * einmal — zwei eigene ReadStreams würden sich die Daten wegnehmen. Deshalb
 * liest diese Stelle allein und verteilt. Ohne Hörer wird die FIFO nicht
 * geöffnet, go-librespot läuft dann einfach gegen den vollen Pipe-Puffer.
 */
export class PcmBroadcaster {
  private source: ReadStream | undefined;
  private clients = new Set<Sink>();
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /**
   * Hält die FIFO dauerhaft offen und liest immer — notfalls in den Abfluss.
   * Geöffnet wird O_RDWR: rein lesend zu öffnen blockiert, bis ein Writer da
   * ist — und go-librespot öffnet nicht-blockierend schreibend, sieht dann
   * keinen Leser und bricht die Wiedergabe mit ENXIO ab. O_RDWR zählt als
   * beide Seiten und entkommt dem Henne-Ei-Problem.
   */
  start(): void {
    if (this.source !== undefined) return;
    let fd: number;
    try {
      // openSync, nicht fs.promises.open: ein FileHandle, dem man den fd entzieht,
      // wird vom Garbage Collector eingesammelt und schließt den fd dabei mit.
      // O_RDWR zählt bei einer FIFO als beide Seiten — rein lesend würde blockieren,
      // und go-librespot öffnet schreibend, sieht keinen Leser und bricht mit ENXIO ab.
      fd = openSync(this.path, "r+");
    } catch {
      // FIFO (noch) nicht da — go-librespot legt sie beim Start an. Nachfassen.
      setTimeout(() => this.start(), 5_000).unref();
      return;
    }
    this.source = createReadStream(this.path, { fd, highWaterMark: 64 * 1024 });
    this.source.on("data", (chunk: string | Buffer) => {
      if (this.clients.size === 0) return;   // Abfluss: niemand hört zu
      const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
      for (const client of this.clients) {
        client.write(bytes).catch(() => this.remove(client));
      }
    });
    this.source.on("error", () => {
      for (const client of this.clients) client.close();
      this.clients.clear();
      this.source = undefined;
    });
  }

  add(sink: Sink): void {
    this.clients.add(sink);
    this.start();
  }

  remove(sink: Sink): void {
    this.clients.delete(sink);
  }
}
