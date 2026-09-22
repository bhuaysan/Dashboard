import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PaneGrid } from "./PaneGrid";

describe("PaneGrid", () => {
  it("renders only non-empty grouped columns and keeps the full pane outside them", () => {
    const { container } = render(
      <PaneGrid
        columns={[
          { id: "left", children: [<div key="clock">clock</div>] },
          { id: "center", children: [] },
          { id: "right", children: [<div key="month">month</div>] },
        ]}
        full={[
          <div className="pane--full" key="homelab">homelab</div>,
          <div className="pane--full" key="uptime">uptime</div>,
        ]}
      />,
    );

    const grid = container.firstElementChild;
    expect(grid?.classList.contains("grid--grouped")).toBe(true);
    expect(grid?.classList.contains("grid--grouped-2")).toBe(true);
    expect(grid?.querySelectorAll(".column")).toHaveLength(2);
    expect(grid?.querySelectorAll(".column--center")).toHaveLength(0);
    expect(screen.getByText("homelab").parentElement).toBe(container.firstElementChild);
    expect(Array.from(grid?.children ?? []).some((child) => child.classList.contains("pane--full"))).toBe(true);
    expect(Array.from(grid?.children ?? []).slice(-2).map((child) => child.textContent)).toEqual(["homelab", "uptime"]);
  });

  it("preserves direct children for legacy span layouts", () => {
    const { container } = render(
      <PaneGrid>
        <div className="pane--wide">weather</div>
        <div>clock</div>
      </PaneGrid>,
    );

    const grid = container.firstElementChild;
    expect(grid?.querySelectorAll(".column")).toHaveLength(0);
    expect(Array.from(grid?.children ?? []).some((child) => child.classList.contains("pane--wide"))).toBe(true);
    expect(container.textContent).toContain("clock");
  });
});
