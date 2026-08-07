import { describe, expect, it } from "vitest";
import { buildWavHeader, paceMsForChunk, PCM_BYTE_RATE } from "./stream.ts";

function ascii(h: Uint8Array, from: number, len: number): string {
  return String.fromCharCode(...h.slice(from, from + len));
}

describe("buildWavHeader", () => {
  const h = buildWavHeader();
  const view = new DataView(h.buffer);

  it("ist ein 44-Byte-RIFF/WAVE-Header", () => {
    expect(h.length).toBe(44);
    expect(ascii(h, 0, 4)).toBe("RIFF");
    expect(ascii(h, 8, 4)).toBe("WAVE");
    expect(ascii(h, 12, 4)).toBe("fmt ");
    expect(ascii(h, 36, 4)).toBe("data");
  });

  it("beschreibt s16le, 44,1 kHz, stereo", () => {
    expect(view.getUint16(20, true)).toBe(1);        // PCM
    expect(view.getUint16(22, true)).toBe(2);        // Kanäle
    expect(view.getUint32(24, true)).toBe(44_100);   // Sample-Rate
    expect(view.getUint32(28, true)).toBe(176_400);  // Byte-Rate
    expect(view.getUint16(32, true)).toBe(4);        // Block-Align
    expect(view.getUint16(34, true)).toBe(16);       // Bits
  });

  it("deklariert unbekannte Länge für den Strom", () => {
    expect(view.getUint32(40, true)).toBe(0x7fffffff);
  });
});

describe("paceMsForChunk", () => {
  it("eine Sekunde Musik dauert eine Sekunde", () => {
    expect(paceMsForChunk(PCM_BYTE_RATE)).toBe(1000);
  });

  it("ein 64-KB-Chunk bremst knapp 400 ms", () => {
    expect(paceMsForChunk(64 * 1024)).toBeCloseTo(371, 0);
  });
});
