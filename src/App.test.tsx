import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";

describe("App", () => {
  it("rendert Panes, Suchzeile und Statusline", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <App />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Clock" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Homelab/ })).toBeTruthy();
    expect(screen.getByLabelText("Suche oder Kommando")).toBeTruthy();
    expect(screen.getByText("NORMAL")).toBeTruthy();
    expect(screen.getByText("Datasphere")).toBeTruthy();
  });
});
