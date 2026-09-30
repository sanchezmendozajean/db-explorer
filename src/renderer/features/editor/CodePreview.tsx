import { Codicon } from '../../components/Codicon';
import { es } from '../../i18n/es';

const KEYWORDS = new Set(
  'select from where order by desc asc limit and or as join on update set insert into values delete is null not in true false group having with'.split(
    ' ',
  ),
);

const TOKEN_RE = /(--.*$)|('(?:[^']|'')*')|("[^"]*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|(.)/g;

function tokenize(line: string): { text: string; className?: string }[] {
  const out: { text: string; className?: string }[] = [];
  for (const m of line.matchAll(TOKEN_RE)) {
    let className: string | undefined;
    if (m[1]) className = 'tok-comment';
    else if (m[2]) className = 'tok-string';
    else if (m[3]) className = 'tok-identifier';
    else if (m[4]) className = 'tok-number';
    else if (m[5] && KEYWORDS.has(m[5].toLowerCase())) className = 'tok-keyword';
    out.push({ text: m[0], className });
  }
  return out;
}

export interface CodePreviewProps {
  lines: string[];
  /** Rango (1-based, inclusivo) de la sentencia activa. */
  activeRange: [number, number];
  cursor: [number, number];
}

/**
 * Vista estática del script con el aspecto de Monaco (datos falsos de M1).
 * El editor real (Monaco) la reemplaza en el hito M3.
 */
export function CodePreview({ lines, activeRange, cursor }: CodePreviewProps): React.JSX.Element {
  const [from, to] = activeRange;
  return (
    <div
      className="code-preview"
      tabIndex={0}
      data-focus-context="editorFocus"
      aria-label={es.editor.previewNotice}
    >
      {lines.map((line, i) => {
        const n = i + 1;
        const inActive = n >= from && n <= to;
        const isCursorLine = n === cursor[0];
        return (
          <div
            key={n}
            className={[
              'code-line',
              inActive ? 'is-active-stmt' : '',
              isCursorLine ? 'is-cursor-line' : '',
            ].join(' ')}
          >
            <span className="code-glyph">
              {n === from && <Codicon name="pass" size={14} color="var(--success)" />}
            </span>
            <span className={['code-number', isCursorLine ? 'is-current' : ''].join(' ')}>{n}</span>
            <span className="code-bar" />
            <span className="code-text">
              {tokenize(line).map((tok, j) => (
                <span key={j} className={tok.className}>
                  {tok.text}
                </span>
              ))}
              {/* En la maqueta el cursor está al final de la línea. */}
              {isCursorLine && <span className="code-cursor" />}
            </span>
          </div>
        );
      })}
    </div>
  );
}
