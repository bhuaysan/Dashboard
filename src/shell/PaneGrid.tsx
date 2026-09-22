import type { ReactNode } from "react";

export type PaneColumn = {
  id: string;
  children: ReactNode[];
};

type Props = {
  children?: ReactNode;
  columns?: readonly PaneColumn[];
  full?: ReactNode;
};

export function PaneGrid({ children, columns, full }: Props) {
  if (columns === undefined) {
    return <div className="grid grid--legacy">{children}</div>;
  }

  const visibleColumns = columns.filter((column) => column.children.length > 0);
  return (
    <div className={`grid grid--grouped grid--grouped-${visibleColumns.length}`}>
      {visibleColumns.map((column) => (
        <div className={`column column--${column.id}`} key={column.id}>
          {column.children}
        </div>
      ))}
      {full}
    </div>
  );
}
