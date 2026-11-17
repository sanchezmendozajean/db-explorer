import { useEffect, useState } from 'react';
import type { TableDetails } from '@shared/metadata';
import {
  COMMON_TYPES,
  LOCKED_REASON,
  editableFields,
  type DesignColumn,
  type DesignIssue,
} from '@shared/table-design';
import { Button, IconButton } from '../../components/Button';
import { Checkbox } from '../../components/Inputs';
import { Codicon } from '../../components/Codicon';
import { es } from '../../i18n/es';
import { connectionById } from '../../stores/connections-store';
import type { EditorTab } from '../../stores/workbench-store';
import { invalidateDetails, tableDetails } from './object-details';
import {
  addColumn,
  discardDesign,
  isDesignDirty,
  loadDesign,
  moveColumn,
  patchColumn,
  pendingStatements,
  removeColumn,
  saveDesign,
  useDesignStore,
} from './table-design';

const t = es.objects;

function issueText(issue: DesignIssue): string {
  const i = t.issues;
  switch (issue.code) {
    case 'nameRequired':
    case 'noColumns':
    case 'autoIncrementMany':
      return i[issue.code];
    case 'columnDuplicate':
      return i.columnDuplicate(issue.column + 1, issue.name);
    default:
      return i[issue.code](issue.column + 1);
  }
}

/** Índices y restricciones (solo lectura) de una tabla existente; se vuelven a leer al recargar el diseño. */
function useDetails(tab: EditorTab, version: string | undefined): TableDetails | null {
  const [details, setDetails] = useState<TableDetails | null>(null);
  useEffect(() => {
    let alive = true;
    if (!tab.object || !tab.connectionId || tab.newTable) return;
    tableDetails(tab.connectionId, tab.object)
      .then((d) => alive && setDetails(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [tab.connectionId, tab.object, tab.newTable, version]);
  return details;
}

/**
 * Pestaña Estructura (specs/04 §9): columnas editables en línea (como el editor de tablas de DBeaver),
 * índices y restricciones de solo lectura. Los cambios quedan pendientes hasta "Guardar", que muestra
 * el SQL (`CREATE TABLE` o `ALTER TABLE`) antes de aplicarlo.
 */
export function StructureView({ tab }: { tab: EditorTab }): React.JSX.Element {
  const conn = connectionById(tab.connectionId);
  const state = useDesignStore((s) => s.byTab[tab.id]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const details = useDetails(tab, state?.base);

  useEffect(() => {
    loadDesign(tab.id).catch((err: unknown) =>
      setLoadError(err instanceof Error ? err.message : String(err)),
    );
  }, [tab.id]);

  if (loadError) {
    return (
      <div className="panel-body panel-empty">
        <p className="object-error">
          <Codicon name="error" color="var(--error)" /> {loadError}
        </p>
      </div>
    );
  }
  if (!state || !conn || !tab.object) {
    return (
      <div className="panel-body panel-empty">
        <p>{t.loading}</p>
      </div>
    );
  }

  const engine = conn.engine;
  const isTable = tab.object.kind === 'table';
  const readOnly = !isTable || !!conn.readOnly;
  const newTable = !!tab.newTable;
  const dirty = isDesignDirty(tab.id);
  const statementCount = pendingStatements(tab.id).length;
  const yes = (v: boolean): string => (v ? '✓' : '');
  const reload = (): void => {
    if (tab.connectionId && tab.object) invalidateDetails(tab.connectionId, tab.object);
    void loadDesign(tab.id, { force: true }).catch((err: unknown) =>
      setLoadError(err instanceof Error ? err.message : String(err)),
    );
  };

  const lockedTitle = (
    c: DesignColumn,
    field: 'type' | 'primaryKey' | 'autoIncrement' | 'comment',
  ): string | undefined => {
    if (field === 'comment') return LOCKED_REASON.comment;
    if (field === 'primaryKey') return LOCKED_REASON.existingKey;
    if (field === 'autoIncrement') return LOCKED_REASON.existingAuto;
    return c.original && engine === 'sqlite' ? LOCKED_REASON.sqlite : undefined;
  };

  return (
    <div className="structure" data-testid="structure">
      <div className="structure-actions">
        {!readOnly && (
          <>
            <Button
              small
              variant="secondary"
              icon="add"
              disabled={state.saving}
              data-testid="column-add"
              onClick={() => addColumn(tab.id)}
            >
              {t.addColumn}
            </Button>
            <Button
              small
              variant="primary"
              icon="save"
              data-testid="structure-save"
              disabled={(!dirty && !newTable) || state.saving}
              onClick={() => void saveDesign(tab.id)}
            >
              {newTable ? t.createTable : t.save}
              {statementCount > 0 && !newTable ? ` (${statementCount})` : ''}
            </Button>
            <Button
              small
              variant="secondary"
              icon="discard"
              data-testid="structure-discard"
              disabled={!dirty || state.saving}
              onClick={() => discardDesign(tab.id)}
            >
              {t.discard}
            </Button>
          </>
        )}
        {!newTable && <IconButton icon="refresh" label={t.refresh} disabled={dirty} onClick={reload} />}
      </div>

      {conn.readOnly && isTable && <p className="form-hint">{es.dbAdmin.readOnly}</p>}
      {state.showIssues && state.issues.length > 0 && (
        <ul className="form-error structure-issues" role="alert" data-testid="structure-issues">
          {state.issues.map((issue, i) => (
            <li key={i}>{issueText(issue)}</li>
          ))}
        </ul>
      )}
      {state.error && (
        <pre className="backup-error" role="alert" data-testid="structure-error">
          {state.error}
        </pre>
      )}

      <h3>{t.columns}</h3>
      <datalist id={`types-${tab.id}`}>
        {COMMON_TYPES[engine].map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
      <table className="structure-table is-editable" data-testid="structure-columns">
        <thead>
          <tr>
            <th>#</th>
            <th>{t.name}</th>
            <th>{t.type}</th>
            <th>{t.nullable}</th>
            <th>{t.default}</th>
            <th>PK</th>
            <th>{t.auto}</th>
            <th>{t.comment}</th>
            {!readOnly && <th aria-label={t.actions} />}
          </tr>
        </thead>
        <tbody>
          {state.design.columns.map((c, i) => {
            const can = editableFields(engine, newTable, c);
            const off = readOnly || !!c.deleted || state.saving;
            const status = c.deleted ? 'is-deleted' : !c.original ? 'is-new' : '';
            const changed =
              !!c.original &&
              (c.name !== c.original.name ||
                c.type.trim().toLowerCase() !== c.original.nativeType.trim().toLowerCase() ||
                c.nullable !== c.original.nullable ||
                c.defaultValue.trim() !== (c.original.defaultValue ?? '').trim() ||
                c.comment.trim() !== (c.original.comment ?? '').trim());
            return (
              <tr
                key={c.key}
                className={[status, changed ? 'is-changed' : ''].join(' ')}
                data-testid="structure-row"
              >
                <td className="num">{i + 1}</td>
                <td>
                  <input
                    className="cell-input"
                    value={c.name}
                    spellCheck={false}
                    disabled={off || !can.name}
                    aria-label={`${t.name} ${i + 1}`}
                    data-testid="column-name"
                    onChange={(e) => patchColumn(tab.id, c.key, { name: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className="cell-input mono"
                    value={c.type}
                    list={`types-${tab.id}`}
                    spellCheck={false}
                    disabled={off || !can.type}
                    title={!can.type ? lockedTitle(c, 'type') : undefined}
                    aria-label={`${t.type} ${i + 1}`}
                    data-testid="column-type"
                    onChange={(e) => patchColumn(tab.id, c.key, { type: e.target.value })}
                  />
                </td>
                <td className="center">
                  <Checkbox
                    checked={c.nullable && !c.primaryKey}
                    disabled={off || !can.nullable}
                    title={!can.nullable ? lockedTitle(c, 'type') : undefined}
                    aria-label={`${t.nullable} ${i + 1}`}
                    data-testid="column-nullable"
                    onChange={(e) => patchColumn(tab.id, c.key, { nullable: e.target.checked })}
                  />
                </td>
                <td>
                  <input
                    className="cell-input mono"
                    value={c.defaultValue}
                    spellCheck={false}
                    placeholder={can.defaultValue && !off ? t.defaultPlaceholder : undefined}
                    disabled={off || !can.defaultValue}
                    title={!can.defaultValue ? lockedTitle(c, 'type') : t.defaultHint}
                    aria-label={`${t.default} ${i + 1}`}
                    data-testid="column-default"
                    onChange={(e) => patchColumn(tab.id, c.key, { defaultValue: e.target.value })}
                  />
                </td>
                <td className="center">
                  {can.primaryKey && !off ? (
                    <Checkbox
                      checked={c.primaryKey}
                      aria-label={`PK ${i + 1}`}
                      data-testid="column-pk"
                      onChange={(e) =>
                        patchColumn(tab.id, c.key, {
                          primaryKey: e.target.checked,
                          nullable: e.target.checked ? false : c.nullable,
                          autoIncrement: e.target.checked ? c.autoIncrement : false,
                        })
                      }
                    />
                  ) : c.primaryKey ? (
                    <Codicon name="key" size={14} color="var(--warning)" />
                  ) : (
                    ''
                  )}
                </td>
                <td className="center">
                  {can.autoIncrement && !off ? (
                    <Checkbox
                      checked={c.autoIncrement}
                      aria-label={`${t.auto} ${i + 1}`}
                      data-testid="column-auto"
                      onChange={(e) =>
                        patchColumn(tab.id, c.key, {
                          autoIncrement: e.target.checked,
                          primaryKey: e.target.checked ? true : c.primaryKey,
                          nullable: e.target.checked ? false : c.nullable,
                        })
                      }
                    />
                  ) : (
                    yes(c.autoIncrement)
                  )}
                </td>
                <td>
                  <input
                    className="cell-input"
                    value={c.comment}
                    spellCheck={false}
                    disabled={off || !can.comment}
                    title={!can.comment ? lockedTitle(c, 'comment') : undefined}
                    aria-label={`${t.comment} ${i + 1}`}
                    data-testid="column-comment"
                    onChange={(e) => patchColumn(tab.id, c.key, { comment: e.target.value })}
                  />
                </td>
                {!readOnly && (
                  <td className="structure-row-actions">
                    {newTable && (
                      <>
                        <IconButton
                          icon="arrow-up"
                          label={t.moveUp}
                          disabled={i === 0}
                          onClick={() => moveColumn(tab.id, c.key, -1)}
                        />
                        <IconButton
                          icon="arrow-down"
                          label={t.moveDown}
                          disabled={i === state.design.columns.length - 1}
                          onClick={() => moveColumn(tab.id, c.key, 1)}
                        />
                      </>
                    )}
                    <IconButton
                      icon={c.deleted ? 'discard' : 'trash'}
                      label={c.deleted ? t.restoreColumn : t.removeColumn}
                      disabled={state.saving}
                      data-testid="column-remove"
                      onClick={() => removeColumn(tab.id, c.key)}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>

      {!newTable && details && (
        <>
          <h3>{t.indexes}</h3>
          {details.indexes.length === 0 ? (
            <p className="structure-empty">{t.none}</p>
          ) : (
            <table className="structure-table">
              <thead>
                <tr>
                  <th>{t.name}</th>
                  <th>{t.indexColumns}</th>
                  <th>{t.unique}</th>
                  <th>{t.primary}</th>
                </tr>
              </thead>
              <tbody>
                {details.indexes.map((x) => (
                  <tr key={x.name}>
                    <td>{x.name}</td>
                    <td className="mono">{x.columns.join(', ')}</td>
                    <td className="center">{yes(x.unique)}</td>
                    <td className="center">{yes(x.primary)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <h3>{t.constraints}</h3>
          {details.constraints.length === 0 ? (
            <p className="structure-empty">{t.none}</p>
          ) : (
            <table className="structure-table">
              <thead>
                <tr>
                  <th>{t.name}</th>
                  <th>{t.constraintType}</th>
                  <th>{t.indexColumns}</th>
                  <th>{t.definition}</th>
                </tr>
              </thead>
              <tbody>
                {details.constraints.map((c, i) => (
                  <tr key={`${c.type}:${c.name}:${i}`}>
                    <td>{c.name || '—'}</td>
                    <td>{t.constraintTypes[c.type]}</td>
                    <td className="mono">{c.columns.join(', ')}</td>
                    <td className="mono">{c.definition ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
