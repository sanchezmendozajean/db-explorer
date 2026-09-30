import { useState } from 'react';
import { Codicon } from '../../components/Codicon';
import { IconButton } from '../../components/Button';
import { Tabs } from '../../components/Tabs';
import { es } from '../../i18n/es';
import { SAMPLE_RESULT } from '../../sample/sample-data';
import { useUiStore } from '../../stores/ui-store';
import { ResultsFooter, ResultsGrid, ResultsToolbar } from './ResultsGrid';

/** Panel de resultados (specs/04 §10). `hasResults` = la pestaña activa ya ejecutó algo. */
export function ResultsPanel({ hasResults }: { hasResults: boolean }): React.JSX.Element {
  const maximized = useUiStore((s) => s.panel.maximized);
  const toggleMaximize = useUiStore((s) => s.toggleMaximizePanel);
  const togglePanel = useUiStore((s) => s.togglePanel);
  const [tab, setTab] = useState('result-1');
  const [filter, setFilter] = useState('');

  const items = [
    ...(hasResults
      ? [
          {
            id: 'result-1',
            label: SAMPLE_RESULT.title,
            icon: 'table',
            iconColor: 'var(--icon-table)',
            extra: <Codicon name="pin" size={12} className="tab-pin" title={es.results.pin} />,
          },
        ]
      : []),
    { id: 'messages', label: es.results.messages },
    { id: 'history', label: es.results.history },
  ];
  const activeTab = items.some((i) => i.id === tab) ? tab : items[0]!.id;

  return (
    <section
      className="panel"
      data-focus-context="resultsFocus"
      tabIndex={-1}
      aria-label={es.results.panelLabel}
    >
      <div className="panel-header">
        <Tabs items={items} activeId={activeTab} onChange={setTab} ariaLabel={es.results.tabsLabel} />
        <div className="panel-actions">
          <IconButton
            icon={maximized ? 'chevron-down' : 'chevron-up'}
            label={maximized ? es.results.restore : es.results.maximize}
            onClick={toggleMaximize}
          />
          <IconButton icon="close" label={es.results.hide} onClick={togglePanel} />
        </div>
      </div>
      {activeTab === 'result-1' ? (
        <>
          <ResultsToolbar filter={filter} onFilter={setFilter} />
          <div className="panel-body">
            <ResultsGrid filter={filter} />
          </div>
          <ResultsFooter rowCount={SAMPLE_RESULT.rows.length} />
        </>
      ) : (
        <div className="panel-body panel-empty">
          <p>{activeTab === 'messages' && hasResults ? es.results.noMessages : es.results.empty}</p>
        </div>
      )}
    </section>
  );
}
