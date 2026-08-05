import { useEffect, useState } from "react";
import { configSchema, type Config } from "../config/schema";

type Guest = { vmid: number; name: string };

type Props = {
  open: boolean;
  config: Config;
  guests: Guest[];
  onClose: () => void;
  onSave: (cfg: Config) => void;
};

const SECTIONS = [
  ["links", "Links"],
  ["feeds", "Feeds"],
  ["cal", "Kalender"],
  ["place", "Ort & Zeit"],
  ["layout", "Layout"],
  ["lab", "Homelab"],
  ["search", "Suche"],
  ["proxy", "Proxy"],
] as const;
type Sec = (typeof SECTIONS)[number][0];

function RowActs({ first, last, onMove, onDel }: {
  first: boolean; last: boolean; onMove: (delta: number) => void; onDel: () => void;
}) {
  return (
    <span className="rowacts">
      <button type="button" className="rowact" disabled={first} onClick={() => onMove(-1)} aria-label="nach oben">↑</button>
      <button type="button" className="rowact" disabled={last} onClick={() => onMove(1)} aria-label="nach unten">↓</button>
      <button type="button" className="rowact rowact--del" onClick={onDel} aria-label="löschen">✕</button>
    </span>
  );
}

function move<T>(arr: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  next[i] = arr[j] as T;
  next[j] = arr[i] as T;
  return next;
}

export function SettingsPane({ open, config, guests, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<Config>(config);
  const [sec, setSec] = useState<Sec>("links");
  const [error, setError] = useState<string | undefined>(undefined);
  const [placeQuery, setPlaceQuery] = useState(config.location.label);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(config);
      setPlaceQuery(config.location.label);
      setError(undefined);
    }
  }, [open, config]);

  const upd = (fn: (d: Config) => Config) => setDraft((d) => fn(d));

  async function searchPlace() {
    setSearching(true);
    setError(undefined);
    try {
      const target = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(placeQuery)}&count=1&language=de`;
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(target)}`);
      const j = (await res.json()) as { results?: { name: string; latitude: number; longitude: number }[] };
      const hit = j.results?.[0];
      if (!hit) {
        setError(`Ort „${placeQuery}" nicht gefunden.`);
      } else {
        upd((d) => ({ ...d, location: { label: hit.name, lat: hit.latitude, lon: hit.longitude } }));
      }
    } catch {
      setError("Ortssuche fehlgeschlagen.");
    } finally {
      setSearching(false);
    }
  }

  function save() {
    const hints = draft.linkGroups.flatMap((g) => g.links.map((l) => l.hint)).filter((h): h is string => !!h);
    if (new Set(hints).size !== hints.length) {
      setError("Doppelte Link-Kürzel — jedes Kürzel darf nur einmal vorkommen.");
      return;
    }
    // Getippt wird g und dann ein Zeichen; das Kürzel enthält das g, sonst wird es nie erkannt.
    const badHint = hints.find((h) => !/^g.$/u.test(h));
    if (badHint !== undefined) {
      setError(`Kürzel „${badHint}" ist ungültig — es muss mit g beginnen und genau zwei Zeichen haben.`);
      return;
    }
    const badUrl = draft.linkGroups
      .flatMap((g) => g.links)
      .find((l) => !/^https?:\/\//i.test(l.url));
    if (badUrl) {
      setError(`Adresse von „${badUrl.label}" muss mit http:// oder https:// beginnen.`);
      return;
    }
    for (const [label, tpl] of [
      ["Standardsuche", draft.search.default] as const,
      ...Object.entries(draft.search.bangs).map(([k, v]) => [`Bang !${k}`, v] as const),
    ]) {
      if (!/^https?:\/\//i.test(tpl)) {
        setError(`${label} muss mit http:// oder https:// beginnen.`);
        return;
      }
    }
    for (const z of draft.clock.secondary) {
      try {
        new Intl.DateTimeFormat("de-DE", { timeZone: z.tz });
      } catch {
        setError(`Unbekannte Zeitzone: ${z.tz}`);
        return;
      }
    }
    const parsed = configSchema.safeParse(draft);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue && issue.path.length > 0 ? ` bei ${issue.path.join(".")}` : "";
      setError(`Ungültiger Wert${path}.`);
      return;
    }
    onSave(parsed.data);
  }

  if (!open) return null;

  return (
    <div className="overlay">
      <div className="overlay-box set-box">
        <div className="set-head">
          <h2>Einstellungen</h2>
          <span className="path">config.json auf dem Server — gilt nach dem Speichern auf allen Geräten</span>
        </div>

        <div className="set-layout">
          <nav className="set-nav">
            <ul>
              {SECTIONS.map(([id, label]) => (
                <li
                  key={id}
                  className={sec === id ? "is-active" : undefined}
                  tabIndex={0}
                  onClick={() => setSec(id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setSec(id); }}
                >
                  {label}
                </li>
              ))}
            </ul>
          </nav>

          <div className="set-body">
            {sec === "links" && (
              <section>
                <p className="set-hint">Kürzel beginnen mit <b>g</b> und sind genau zwei Zeichen lang — <b>gd</b> heißt: erst g, dann d. Doppelte Kürzel werden beim Speichern abgelehnt.</p>
                {draft.linkGroups.map((g, gi) => (
                  <div key={gi}>
                    <div className="grouprow">
                      <input
                        className="inp"
                        style={{ maxWidth: "24ch" }}
                        value={g.title}
                        aria-label="Gruppenname"
                        onChange={(e) => upd((d) => ({
                          ...d,
                          linkGroups: d.linkGroups.map((x, i) => i === gi ? { ...x, title: e.target.value } : x),
                        }))}
                      />
                      <span className="rowacts">
                        <button type="button" className="rowact rowact--del" aria-label="Gruppe löschen"
                          onClick={() => upd((d) => ({ ...d, linkGroups: d.linkGroups.filter((_, i) => i !== gi) }))}>✕</button>
                      </span>
                    </div>
                    <div className="tbl tbl--links">
                      <div className="tbl-head"><span>Kürzel</span><span>Name</span><span>URL</span><span /></div>
                      {g.links.map((l, li) => (
                        <div className="tbl-row" key={li}>
                          <input className="inp inp--hint" value={l.hint ?? ""} maxLength={2} aria-label="Kürzel"
                            onChange={(e) => upd((d) => ({
                              ...d,
                              linkGroups: d.linkGroups.map((x, i) => i !== gi ? x : {
                                ...x,
                                links: x.links.map((y, j) => j === li ? { ...y, hint: e.target.value } : y),
                              }),
                            }))}
                          />
                          <input className="inp" value={l.label} aria-label="Name"
                            onChange={(e) => upd((d) => ({
                              ...d,
                              linkGroups: d.linkGroups.map((x, i) => i !== gi ? x : {
                                ...x,
                                links: x.links.map((y, j) => j === li ? { ...y, label: e.target.value } : y),
                              }),
                            }))}
                          />
                          <input className="inp" value={l.url} aria-label="URL"
                            onChange={(e) => upd((d) => ({
                              ...d,
                              linkGroups: d.linkGroups.map((x, i) => i !== gi ? x : {
                                ...x,
                                links: x.links.map((y, j) => j === li ? { ...y, url: e.target.value } : y),
                              }),
                            }))}
                          />
                          <RowActs first={li === 0} last={li === g.links.length - 1}
                            onMove={(delta) => upd((d) => ({
                              ...d,
                              linkGroups: d.linkGroups.map((x, i) => i === gi ? { ...x, links: move(x.links, li, delta) } : x),
                            }))}
                            onDel={() => upd((d) => ({
                              ...d,
                              linkGroups: d.linkGroups.map((x, i) => i === gi ? { ...x, links: x.links.filter((_, j) => j !== li) } : x),
                            }))}
                          />
                        </div>
                      ))}
                    </div>
                    <p className="addline">
                      <button type="button" className="btn" onClick={() => upd((d) => ({
                        ...d,
                        linkGroups: d.linkGroups.map((x, i) => i === gi
                          ? { ...x, links: [...x.links, { label: "Neuer Link", url: "https://", hint: "" }] }
                          : x),
                      }))}>+ Link</button>
                    </p>
                  </div>
                ))}
                <p className="addline">
                  <button type="button" className="btn" onClick={() => upd((d) => ({
                    ...d,
                    linkGroups: [...d.linkGroups, { title: "Neue Gruppe", links: [] }],
                  }))}>+ Gruppe</button>
                </p>
              </section>
            )}

            {sec === "feeds" && (
              <section>
                <p className="set-hint">Feeds werden über den eigenen Server geladen. Der Host muss zusätzlich in der Proxy-Allowlist stehen.</p>
                <div className="tbl tbl--feeds">
                  <div className="tbl-head"><span>Name</span><span>URL</span><span>Anzahl</span><span /></div>
                  {draft.feeds.map((f, i) => (
                    <div className="tbl-row" key={i}>
                      <input className="inp" value={f.label} aria-label="Name"
                        onChange={(e) => upd((d) => ({ ...d, feeds: d.feeds.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} />
                      <input className="inp" value={f.url} aria-label="URL"
                        onChange={(e) => upd((d) => ({ ...d, feeds: d.feeds.map((x, j) => j === i ? { ...x, url: e.target.value } : x) }))} />
                      <input className="inp inp--num" value={String(f.limit)} inputMode="numeric" aria-label="Anzahl"
                        onChange={(e) => upd((d) => ({ ...d, feeds: d.feeds.map((x, j) => j === i ? { ...x, limit: Math.max(1, Number(e.target.value) || 1) } : x) }))} />
                      <RowActs first={i === 0} last={i === draft.feeds.length - 1}
                        onMove={(delta) => upd((d) => ({ ...d, feeds: move(d.feeds, i, delta) }))}
                        onDel={() => upd((d) => ({ ...d, feeds: d.feeds.filter((_, j) => j !== i) }))} />
                    </div>
                  ))}
                </div>
                <p className="addline">
                  <button type="button" className="btn" onClick={() => upd((d) => ({
                    ...d, feeds: [...d.feeds, { label: "neu", url: "https://", limit: 5 }],
                  }))}>+ Feed</button>
                </p>
              </section>
            )}

            {sec === "cal" && (
              <section>
                <p className="set-hint">ICS-Adresse eines veröffentlichten Kalenders. Liegt die Datei auf dem Dashboard-Server selbst, genügt ein Pfad wie <b>/static/arbeit.ics</b>.</p>
                <div className="tbl tbl--feeds">
                  <div className="tbl-head"><span>Name</span><span>ICS-URL</span><span /><span /></div>
                  {draft.calendars.map((c, i) => (
                    <div className="tbl-row" key={i}>
                      <input className="inp" value={c.label} aria-label="Name"
                        onChange={(e) => upd((d) => ({ ...d, calendars: d.calendars.map((x, j) => j === i ? { ...x, label: e.target.value } : x) }))} />
                      <input className="inp" value={c.url} aria-label="ICS-URL"
                        onChange={(e) => upd((d) => ({ ...d, calendars: d.calendars.map((x, j) => j === i ? { ...x, url: e.target.value } : x) }))} />
                      <span />
                      <RowActs first={i === 0} last={i === draft.calendars.length - 1}
                        onMove={(delta) => upd((d) => ({ ...d, calendars: move(d.calendars, i, delta) }))}
                        onDel={() => upd((d) => ({ ...d, calendars: d.calendars.filter((_, j) => j !== i) }))} />
                    </div>
                  ))}
                </div>
                <p className="addline">
                  <button type="button" className="btn" onClick={() => upd((d) => ({
                    ...d, calendars: [...d.calendars, { label: "neu", url: "" }],
                  }))}>+ Kalender</button>
                </p>
              </section>
            )}

            {sec === "place" && (
              <section>
                <div className="field">
                  <label htmlFor="s-city">Ort suchen</label>
                  <span style={{ display: "flex", gap: ".5rem" }}>
                    <input className="inp" id="s-city" value={placeQuery}
                      onChange={(e) => setPlaceQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void searchPlace(); }} />
                    <button type="button" className="btn" disabled={searching} onClick={() => void searchPlace()}>
                      {searching ? "sucht…" : "suchen"}
                    </button>
                  </span>
                </div>
                <div className="field">
                  <label>Koordinaten</label>
                  <span className="dim">{draft.location.label} · {draft.location.lat} · {draft.location.lon}</span>
                </div>
                <p className="set-hint" style={{ marginTop: "1rem" }}>Zweite Zeitzonen, erscheinen unter der Uhr.</p>
                <div className="tbl tbl--zones">
                  <div className="tbl-head"><span>Label</span><span>Zeitzone</span><span /></div>
                  {draft.clock.secondary.map((z, i) => (
                    <div className="tbl-row" key={i}>
                      <input className="inp" value={z.label} aria-label="Label"
                        onChange={(e) => upd((d) => ({ ...d, clock: { secondary: d.clock.secondary.map((x, j) => j === i ? { ...x, label: e.target.value } : x) } }))} />
                      <input className="inp" value={z.tz} aria-label="Zeitzone"
                        onChange={(e) => upd((d) => ({ ...d, clock: { secondary: d.clock.secondary.map((x, j) => j === i ? { ...x, tz: e.target.value } : x) } }))} />
                      <RowActs first={i === 0} last={i === draft.clock.secondary.length - 1}
                        onMove={(delta) => upd((d) => ({ ...d, clock: { secondary: move(d.clock.secondary, i, delta) } }))}
                        onDel={() => upd((d) => ({ ...d, clock: { secondary: d.clock.secondary.filter((_, j) => j !== i) } }))} />
                    </div>
                  ))}
                </div>
                <p className="addline">
                  <button type="button" className="btn" onClick={() => upd((d) => ({
                    ...d, clock: { secondary: [...d.clock.secondary, { label: "UTC", tz: "Etc/UTC" }] },
                  }))}>+ Zeitzone</button>
                </p>
              </section>
            )}

            {sec === "layout" && (
              <section>
                <div className="field">
                  <label htmlFor="s-theme">Theme</label>
                  <span>
                    <select className="inp" id="s-theme" style={{ maxWidth: "16ch" }} value={draft.theme}
                      onChange={(e) => upd((d) => ({ ...d, theme: e.target.value as Config["theme"] }))}>
                      <option value="system">system</option>
                      <option value="dark">dark</option>
                      <option value="light">light</option>
                    </select>
                  </span>
                </div>
                <p className="set-hint" style={{ marginTop: "1rem" }}>Breite in Spalten.</p>
                <div className="tbl tbl--panes">
                  <div className="tbl-head"><span>Pane</span><span>Sichtbar</span><span>Breite</span></div>
                  {draft.layout.map((l, i) => (
                    <div className="tbl-row" key={l.id}>
                      <span>{l.id}</span>
                      <label className="check">
                        <input type="checkbox" checked={l.visible}
                          onChange={(e) => upd((d) => ({ ...d, layout: d.layout.map((x, j) => j === i ? { ...x, visible: e.target.checked } : x) }))} />
                      </label>
                      {l.id === "homelab" ? (
                        <span className="dim">volle Breite</span>
                      ) : (
                        <span>
                          <select className="inp" style={{ maxWidth: "7ch" }} value={l.span}
                            onChange={(e) => upd((d) => ({ ...d, layout: d.layout.map((x, j) => j === i ? { ...x, span: Number(e.target.value) as 1 | 2 } : x) }))}>
                            <option value={1}>1</option>
                            <option value={2}>2</option>
                          </select>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {sec === "lab" && (
              <section>
                <div className="field">
                  <label htmlFor="s-node">Node-Name</label>
                  <input className="inp" id="s-node" style={{ maxWidth: "16ch" }} value={draft.homelab.node}
                    onChange={(e) => upd((d) => ({ ...d, homelab: { ...d.homelab, node: e.target.value } }))} />
                </div>
                <div className="field">
                  <label htmlFor="s-uiurl">Proxmox-Oberfläche</label>
                  <input className="inp" id="s-uiurl" value={draft.homelab.uiUrl}
                    onChange={(e) => upd((d) => ({ ...d, homelab: { ...d.homelab, uiUrl: e.target.value } }))} />
                </div>
                <p className="set-hint">Ziel der Konsolen-Links in der Gästetabelle. Die Daten selbst holt der Server, nicht der Browser.</p>
                <p className="set-hint" style={{ marginTop: "1rem" }}>Gäste, die laufen sollen. Ist einer davon gestoppt, erscheint eine Alarmzeile. Alle anderen werden nur angezeigt.</p>
                <div className="checks">
                  {guests.map((g) => (
                    <label className="check" key={g.vmid}>
                      <input type="checkbox" checked={draft.homelab.expectRunning.includes(g.vmid)}
                        onChange={(e) => upd((d) => ({
                          ...d,
                          homelab: {
                            ...d.homelab,
                            expectRunning: e.target.checked
                              ? [...d.homelab.expectRunning, g.vmid]
                              : d.homelab.expectRunning.filter((v) => v !== g.vmid),
                          },
                        }))} />
                      {g.vmid} {g.name}
                    </label>
                  ))}
                </div>
                <p className="set-hint" style={{ marginTop: "1.1rem" }}>Schwellwerte in Prozent, Backup-Alter in Stunden.</p>
                {(["cpu", "mem", "storage", "backupAgeHours"] as const).map((key) => (
                  <div className="field" key={key}>
                    <label htmlFor={`s-${key}`}>
                      {key === "cpu" ? "CPU" : key === "mem" ? "Speicher" : key === "storage" ? "Storage" : "Backup-Alter"}
                    </label>
                    <input className="inp inp--num" id={`s-${key}`} inputMode="numeric"
                      value={String(draft.homelab.thresholds[key])}
                      onChange={(e) => upd((d) => ({
                        ...d,
                        homelab: {
                          ...d.homelab,
                          thresholds: { ...d.homelab.thresholds, [key]: Math.max(0, Number(e.target.value) || 0) },
                        },
                      }))} />
                  </div>
                ))}
                <p className="set-hint" style={{ marginTop: "1.1rem" }}>Erreichbarkeit: leer lassen, wenn Uptime Kuma das schon übernimmt.</p>
                <div className="tbl tbl--reach">
                  <div className="tbl-head"><span>Label</span><span>Host</span><span>Port</span><span /></div>
                  {draft.homelab.reachability.map((r, i) => (
                    <div className="tbl-row" key={i}>
                      <input className="inp" value={r.label} aria-label="Label"
                        onChange={(e) => upd((d) => ({ ...d, homelab: { ...d.homelab, reachability: d.homelab.reachability.map((x, j) => j === i ? { ...x, label: e.target.value } : x) } }))} />
                      <input className="inp" value={r.host} aria-label="Host"
                        onChange={(e) => upd((d) => ({ ...d, homelab: { ...d.homelab, reachability: d.homelab.reachability.map((x, j) => j === i ? { ...x, host: e.target.value } : x) } }))} />
                      <input className="inp inp--num" inputMode="numeric" value={String(r.port)} aria-label="Port"
                        onChange={(e) => upd((d) => ({ ...d, homelab: { ...d.homelab, reachability: d.homelab.reachability.map((x, j) => j === i ? { ...x, port: Math.max(1, Number(e.target.value) || 1) } : x) } }))} />
                      <RowActs first={i === 0} last={i === draft.homelab.reachability.length - 1}
                        onMove={(delta) => upd((d) => ({ ...d, homelab: { ...d.homelab, reachability: move(d.homelab.reachability, i, delta) } }))}
                        onDel={() => upd((d) => ({ ...d, homelab: { ...d.homelab, reachability: d.homelab.reachability.filter((_, j) => j !== i) } }))} />
                    </div>
                  ))}
                </div>
                <p className="addline">
                  <button type="button" className="btn" onClick={() => upd((d) => ({
                    ...d, homelab: { ...d.homelab, reachability: [...d.homelab.reachability, { label: "neu", host: "", port: 80 }] },
                  }))}>+ Ziel</button>
                </p>
              </section>
            )}

            {sec === "search" && (
              <section>
                <div className="field">
                  <label htmlFor="s-def">Standardsuche</label>
                  <input className="inp" id="s-def" value={draft.search.default}
                    onChange={(e) => upd((d) => ({ ...d, search: { ...d.search, default: e.target.value } }))} />
                </div>
                <p className="set-hint" style={{ marginTop: "1rem" }}><b>%s</b> wird durch die Eingabe ersetzt. Bang wird als <b>!kürzel suchbegriff</b> getippt.</p>
                <div className="tbl tbl--bangs">
                  <div className="tbl-head"><span>Bang</span><span>URL-Vorlage</span><span /></div>
                  {Object.entries(draft.search.bangs).map(([key, tpl], i, arr) => (
                    <div className="tbl-row" key={key}>
                      <input className="inp inp--hint" value={key} aria-label="Bang"
                        onChange={(e) => upd((d) => {
                          const bangs = Object.fromEntries(Object.entries(d.search.bangs).map(([k, v], j) => [j === i ? e.target.value : k, v]));
                          return { ...d, search: { ...d.search, bangs } };
                        })} />
                      <input className="inp" value={tpl} aria-label="URL-Vorlage"
                        onChange={(e) => upd((d) => ({ ...d, search: { ...d.search, bangs: { ...d.search.bangs, [key]: e.target.value } } }))} />
                      <RowActs first={i === 0} last={i === arr.length - 1}
                        onMove={() => undefined}
                        onDel={() => upd((d) => {
                          const bangs = { ...d.search.bangs };
                          delete bangs[key];
                          return { ...d, search: { ...d.search, bangs } };
                        })} />
                    </div>
                  ))}
                </div>
                <p className="addline">
                  <button type="button" className="btn" onClick={() => upd((d) => ({
                    ...d, search: { ...d.search, bangs: { ...d.search.bangs, neu: "https://" } },
                  }))}>+ Bang</button>
                </p>
              </section>
            )}

            {sec === "proxy" && (
              <section>
                <p className="set-hint">Nur diese Hosts darf der Server abrufen. Private Adressen sind grundsätzlich gesperrt und lassen sich hier nicht freigeben.</p>
                <div className="tbl tbl--hosts">
                  {draft.proxyAllowlist.map((h, i) => (
                    <div className="tbl-row" key={i}>
                      <input className="inp" value={h} aria-label="Host"
                        onChange={(e) => upd((d) => ({ ...d, proxyAllowlist: d.proxyAllowlist.map((x, j) => j === i ? e.target.value : x) }))} />
                      <RowActs first={i === 0} last={i === draft.proxyAllowlist.length - 1}
                        onMove={(delta) => upd((d) => ({ ...d, proxyAllowlist: move(d.proxyAllowlist, i, delta) }))}
                        onDel={() => upd((d) => ({ ...d, proxyAllowlist: d.proxyAllowlist.filter((_, j) => j !== i) }))} />
                    </div>
                  ))}
                </div>
                <p className="addline">
                  <button type="button" className="btn" onClick={() => upd((d) => ({
                    ...d, proxyAllowlist: [...d.proxyAllowlist, ""],
                  }))}>+ Host</button>
                </p>
              </section>
            )}
          </div>
        </div>

        <div className="set-foot">
          <button type="button" className="btn btn--primary" onClick={save}>Speichern</button>
          <button type="button" className="btn" onClick={onClose}>Abbrechen</button>
          <span className="note">Esc verwirft</span>
          {error && <span className="set-error" role="alert">{error}</span>}
          <span className="spacer note">:export sichert als Datei · :import liest sie zurück</span>
        </div>
      </div>
    </div>
  );
}
