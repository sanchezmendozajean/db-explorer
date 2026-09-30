import { useState } from 'react';
import { Codicon } from '../../components/Codicon';
import { IconButton } from '../../components/Button';
import { es } from '../../i18n/es';
import { notAvailable } from '../../app/app-commands';
import { SAMPLE_RESULT, sampleConnection } from '../../sample/sample-data';
import type { EditorTab } from '../../stores/workbench-store';
import { ResultsFooter, ResultsGrid, ResultsToolbar } from '../results/ResultsGrid';

const SUBTABS = [
  { id: 'data', label: es.editor.object.data },
  { id: 'structure', label: es.editor.object.structure },
  { id: 'ddl', label: es.editor.object.ddl },
] as const;

/** Pestaña de objeto (specs/04 §9) con datos falsos. La funcionalidad llega en M7. */
export function ObjectView({ tab }: { tab: EditorTab }): React.JSX.Element {
  const conn = sampleConnection(tab.connectionId);
  const [filter, setFilter] = useState('');
  const crumbs = [conn?.database, conn?.schema].filter((c): c is string => !!c);

  return (
    <div className="object-view" data-focus-context="editorFocus" tabIndex={-1}>
      <div className="object-header">
        <nav className="breadcrumb" aria-label={tab.tooltip}>
          {conn && (
            <span className="breadcrumb-item">
              <span className="env-dot" style={{ background: `var(--env-${conn.environment})` }} />
              {conn.name}
            </span>
          )}
          {crumbs.map((c, i) => (
            <span key={c} className="breadcrumb-item">
              <Codicon name="chevron-right" size={14} className="breadcrumb-sep" />
              <Codicon name={i === 0 ? 'database' : 'symbol-namespace'} size={14} />
              {c}
            </span>
          ))}
          <span className="breadcrumb-item">
            <Codicon name="chevron-right" size={14} className="breadcrumb-sep" />
            <Codicon name="table" size={14} color="var(--icon-table)" />
            {tab.title}
          </span>
        </nav>
        <div className="pills" role="tablist">
          {SUBTABS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === 'data'}
              className={['pill', s.id === 'data' ? 'is-active' : ''].join(' ')}
              onClick={() => s.id !== 'data' && notAvailable(s.label)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="object-filters">
        <label className="clause-input">
          <span>WHERE</span>
          <input spellCheck={false} aria-label="WHERE" />
        </label>
        <label className="clause-input is-order">
          <span>ORDER BY</span>
          <input spellCheck={false} aria-label="ORDER BY" />
        </label>
        <IconButton
          icon="play"
          color="var(--success)"
          label={es.results.rerun}
          onClick={() => notAvailable(es.results.rerun)}
        />
      </div>
      <ResultsToolbar filter={filter} onFilter={setFilter} />
      <div className="panel-body">
        <ResultsGrid filter={filter} />
      </div>
      <ResultsFooter rowCount={SAMPLE_RESULT.rows.length} />
    </div>
  );
}
