import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KeymapOverlay } from "./KeymapOverlay";

describe("KeymapOverlay", () => {
  it("hat einen zugänglichen Schließen-Button und einen Focus-Trap", () => {
    const onClose = vi.fn();
    render(<KeymapOverlay open onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Tastenbelegung" });
    const close = screen.getByRole("button", { name: "Schließen" });
    close.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
