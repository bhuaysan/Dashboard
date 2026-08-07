import { describe, expect, it } from "vitest";
import { buildMusic, clampVolume, emptyMusic, pickDeviceId, VOLUME_STEP, type SpotifyPlayer } from "./spotify.ts";

const NOW = 1_754_500_000_000;

function player(overrides: Partial<SpotifyPlayer> = {}): SpotifyPlayer {
  return {
    is_playing: true,
    progress_ms: 134_000,
    device: { name: "Küche", volume_percent: 62 },
    item: {
      name: "Lied",
      duration_ms: 227_000,
      artists: [{ name: "Artist A" }, { name: "Artist B" }],
      album: { name: "Album" },
    },
    ...overrides,
  };
}

describe("buildMusic", () => {
  it("laufender Track: alle Felder belegt, Artists zusammengefasst", () => {
    const d = buildMusic(player(), NOW);
    expect(d).toMatchObject({
      configured: true,
      active: true,
      playing: true,
      title: "Lied",
      artist: "Artist A, Artist B",
      album: "Album",
      device: "Küche",
      elapsedMs: 134_000,
      durationMs: 227_000,
      volume: 62,
      fetchedAt: NOW,
    });
  });

  it("kein aktives Gerät (null): configured, aber nicht active", () => {
    const d = buildMusic(null, NOW);
    expect(d).toMatchObject({ configured: true, active: false, playing: false, fetchedAt: NOW });
  });

  it("item null (Werbeblock o.ä.) behandelt wie kein Gerät", () => {
    const d = buildMusic(player({ item: null }), NOW);
    expect(d.active).toBe(false);
  });

  it("Episode ohne Album: album leer statt Fehler", () => {
    const p = player();
    const item = p.item;
    if (item === null) throw new Error("Fixture");
    const d = buildMusic({ ...p, item: { ...item, album: null } }, NOW);
    expect(d.album).toBe("");
  });

  it("Fortschritt wird auf die Dauer begrenzt", () => {
    const d = buildMusic(player({ progress_ms: 300_000 }), NOW);
    expect(d.elapsedMs).toBe(227_000);
  });

  it("fehlende Lautstärke wird -1, nicht 0", () => {
    const d = buildMusic(player({ device: { name: "TV", volume_percent: null } }), NOW);
    expect(d.volume).toBe(-1);
  });

  it("emptyMusic ist der nicht-konfigurierte Zustand", () => {
    expect(emptyMusic).toMatchObject({ configured: false, active: false, playing: false });
  });
});

describe("pickDeviceId", () => {
  const devices = [
    { id: "aaa", name: "Küche", is_active: false },
    { id: "bbb", name: "Homelab", is_active: false },
    { id: null, name: "Kaputt", is_active: false },
  ];

  it("findet das Gerät zum Namen, Groß-/Kleinschreibung egal", () => {
    expect(pickDeviceId(devices, "homelab")).toBe("bbb");
    expect(pickDeviceId(devices, "Homelab")).toBe("bbb");
  });

  it("unbekannter Name ergibt undefined, nicht das erste Gerät", () => {
    expect(pickDeviceId(devices, "Wohnzimmer")).toBeUndefined();
  });

  it("leere Geräteliste ergibt undefined", () => {
    expect(pickDeviceId([], "Homelab")).toBeUndefined();
  });
});

describe("clampVolume", () => {
  it("begrenzt auf 0 bis 100", () => {
    expect(clampVolume(95 + VOLUME_STEP)).toBe(100);
    expect(clampVolume(5 - VOLUME_STEP)).toBe(0);
    expect(clampVolume(62)).toBe(62);
  });
});
