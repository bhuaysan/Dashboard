import { describe, expect, it } from "vitest";
import { resolveQuery } from "./bangs";

const search = {
  default: "https://duckduckgo.com/?q=%s",
  bangs: { g: "https://www.google.com/search?q=%s" },
};

describe("resolveQuery", () => {
  it("Bang am Anfang nutzt die eigene Suchmaschine", () => {
    expect(resolveQuery("!g foo bar", search)).toBe("https://www.google.com/search?q=foo%20bar");
  });

  it("Bang mitten im Text ist eine normale Suche", () => {
    expect(resolveQuery("foo !g", search)).toBe("https://duckduckgo.com/?q=foo%20!g");
  });

  it("unbekannter Bang fällt auf die Standardsuche zurück", () => {
    expect(resolveQuery("!xx foo", search)).toBe("https://duckduckgo.com/?q=!xx%20foo");
  });

  it("leere Eingabe ergibt undefined", () => {
    expect(resolveQuery("", search)).toBeUndefined();
    expect(resolveQuery("   ", search)).toBeUndefined();
  });

  it("behandelt geerbte Objekteigenschaften als unbekannte Bangs", () => {
    expect(resolveQuery("!toString test", search)).toBe(
      "https://duckduckgo.com/?q=!toString%20test",
    );
  });
});
