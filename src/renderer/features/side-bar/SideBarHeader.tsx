import type { ReactNode } from 'react';

export function SideBarHeader({ title, actions }: { title: string; actions?: ReactNode }): React.JSX.Element {
  return (
    <div className="sidebar-header">
      <h2 className="sidebar-title">{title}</h2>
      {actions && <div className="sidebar-actions">{actions}</div>}
    </div>
  );
}

/** Resalta en `accent` la primera coincidencia (sin distinguir mayúsculas). */
export function Highlight({ text, query }: { text: string; query: string }): React.JSX.Element {
  if (!query) return <>{text}</>;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <span className="match">{text.slice(index, index + query.length)}</span>
      {text.slice(index + query.length)}
    </>
  );
}
