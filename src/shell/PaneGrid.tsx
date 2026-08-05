import type { ReactNode } from "react";

export function PaneGrid({ children }: { children: ReactNode }) {
  return <div className="grid">{children}</div>;
}
