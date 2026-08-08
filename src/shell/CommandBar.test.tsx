import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CommandBar, type FlatLink } from "./CommandBar";
import { defaultConfig } from "../config/defaults";

const links: FlatLink[] = [
  { label: "Einstellungen", url: "https://example.com/settings", hint: "gs", group: "Intern" },
];

function Harness({ onCommand }: { onCommand: (command: string) => void }) {
  const [mode, setMode] = useState<"NORMAL" | "INSERT" | "COMMAND">("INSERT");
  return (
    <CommandBar
      mode={mode}
      seed={null}
      links={links}
      search={defaultConfig.search}
      onModeChange={setMode}
      onCommand={onCommand}
    />
  );
}

describe("CommandBar", () => {
  it("behält beim Wechsel von INSERT zu COMMAND den eingegebenen Text", () => {
    render(<Harness onCommand={vi.fn()} />);
    const input = screen.getByLabelText("Suche oder Kommando");
    fireEvent.change(input, { target: { value: ":settings" } });
    expect((input as HTMLInputElement).value).toBe(":settings");
  });

  it("führt ein per Touch oder Paste eingegebenes settings-Kommando aus", () => {
    const onCommand = vi.fn();
    render(<Harness onCommand={onCommand} />);
    const input = screen.getByLabelText("Suche oder Kommando");
    fireEvent.change(input, { target: { value: ":settings" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommand).toHaveBeenCalledWith("settings");
  });

  it("behält den Resttext, wenn der Doppelpunkt wieder gelöscht wird", () => {
    render(<Harness onCommand={vi.fn()} />);
    const input = screen.getByLabelText("Suche oder Kommando");
    fireEvent.change(input, { target: { value: ":settings" } });
    fireEvent.change(input, { target: { value: "settings" } });
    expect((input as HTMLInputElement).value).toBe("settings");
  });

  it("verwendet für Vorschau und Suche dieselbe normalisierte Eingabe", () => {
    render(<Harness onCommand={vi.fn()} />);
    const input = screen.getByLabelText("Suche oder Kommando");
    fireEvent.change(input, { target: { value: " Einstellungen " } });
    expect(screen.getByText("Einstellungen")).toBeTruthy();
  });

  it("bezeichnet einen unbekannten Bang als Standardsuche", () => {
    render(<Harness onCommand={vi.fn()} />);
    const input = screen.getByLabelText("Suche oder Kommando");
    fireEvent.change(input, { target: { value: "!xx foo" } });
    expect(screen.getByText("Websuche nach „!xx foo“")).toBeTruthy();
    expect(screen.queryByText(/Websuche mit Bang/)).toBeNull();
  });
});
