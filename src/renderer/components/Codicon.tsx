import type { CSSProperties } from 'react';

export interface CodiconProps {
  name: string;
  size?: number;
  color?: string;
  spin?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

/** Icono de `@vscode/codicons`. Decorativo salvo que se indique `title`. */
export function Codicon({
  name,
  size,
  color,
  spin,
  className,
  style,
  title,
}: CodiconProps): React.JSX.Element {
  const classes = ['codicon', `codicon-${name}`, spin ? 'codicon-modifier-spin' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <i
      className={classes}
      style={{ fontSize: size, color, ...style }}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      title={title}
    />
  );
}
