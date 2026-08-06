import type { ReactNode, Ref } from "react";

type Props = {
  title: string;
  /** Deutscher Name des Landmarks. Der Pane-Titel bleibt englisch (AGENTS.md Regel 6). */
  label: string;
  subtitle?: string;
  span?: 1 | 2 | "full";
  clip?: boolean;
  id?: string;
  ref?: Ref<HTMLElement>;
  children: ReactNode;
};

export function Pane({ title, label, subtitle, span = 1, clip = false, id, ref, children }: Props) {
  const cls = [
    "pane",
    span === 2 ? "pane--wide" : "",
    span === "full" ? "pane--full" : "",
    clip ? "pane--clip" : "",
  ].filter(Boolean).join(" ");
  return (
    <section className={cls} id={id} tabIndex={-1} ref={ref} aria-label={label}>
      <h2 className="pane-title">
        {title}
        {subtitle ? <span className="sub"> — {subtitle}</span> : null}
      </h2>
      {clip ? <div className="pane-body">{children}</div> : children}
    </section>
  );
}
