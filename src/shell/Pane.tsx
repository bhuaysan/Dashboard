import type { ReactNode, Ref } from "react";

type Props = {
  title: string;
  subtitle?: string;
  span?: 1 | 2 | "full";
  tall?: boolean;
  clip?: boolean;
  id?: string;
  ref?: Ref<HTMLElement>;
  children: ReactNode;
};

export function Pane({ title, subtitle, span = 1, tall = false, clip = false, id, ref, children }: Props) {
  const cls = [
    "pane",
    span === 2 ? "pane--wide" : "",
    span === "full" ? "pane--full" : "",
    tall ? "pane--tall" : "",
    clip ? "pane--clip" : "",
  ].filter(Boolean).join(" ");
  return (
    <section className={cls} id={id} tabIndex={-1} ref={ref}>
      <h2 className="pane-title">
        {title}
        {subtitle ? <span className="sub">— {subtitle}</span> : null}
      </h2>
      {clip ? <div className="pane-body">{children}</div> : children}
    </section>
  );
}
