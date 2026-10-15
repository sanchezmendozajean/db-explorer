import { useEffect, useRef, useState } from 'react';
import type { ToolFamily, ToolFamilyStatus, ToolImportResult } from '@shared/db-admin';
import { Button } from '../../components/Button';
import { Codicon } from '../../components/Codicon';
import { Modal } from '../../components/Modal';
import { es } from '../../i18n/es';
import { showToast } from '../../stores/toast-store';

const t = es.dbAdmin.tools;

/** Bibliotecas que acompañan a pg_dump y pg_restore en PostgreSQL 18 para Windows (orientativo; la lista real sale al importar). */
const POSTGRES_LIBRARIES = [
  'libpq.dll',
  'libssl-3-x64.dll',
  'libcrypto-3-x64.dll',
  'libiconv-2.dll',
  'libintl-9.dll',
  'libzstd.dll',
  'liblz4.dll',
  'libwinpthread-1.dll',
];

/**
 * Pide al usuario los binarios auxiliares de una familia (PostgreSQL, MariaDB o MySQL): se arrastran
 * a la caja o se eligen con un selector. Main los copia a una carpeta interna, comprueba que sean
 * ejecutables de la herramienta esperada y lee su versión.
 */
export function ToolsDialog({
  family,
  onDone,
  onClose,
}: {
  family: ToolFamily;
  onDone: (ready: boolean) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [status, setStatus] = useState<ToolFamilyStatus | null>(null);
  const [rejected, setRejected] = useState<ToolImportResult['rejected']>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const finished = useRef(false);
  const familyName = es.dbAdmin.families[family];

  useEffect(() => {
    let alive = true;
    void window.api.tools.status({}).then((r) => {
      if (alive && r.ok) setStatus(r.data.find((s) => s.family === family) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [family]);

  const finish = (ready: boolean): void => {
    if (finished.current) return;
    finished.current = true;
    onClose();
    onDone(ready);
  };

  const apply = (result: ToolImportResult): void => {
    setStatus(result.status);
    setRejected(result.rejected);
  };

  const importPaths = async (paths: string[]): Promise<void> => {
    if (paths.length === 0) return;
    setBusy(true);
    const r = await window.api.tools.import({ family, paths });
    setBusy(false);
    if (r.ok) apply(r.data);
    else showToast('error', r.error.message);
  };

  const pick = async (): Promise<void> => {
    setBusy(true);
    const r = await window.api.tools.pick({ family });
    setBusy(false);
    if (!r.ok) showToast('error', r.error.message);
    else if (r.data) apply(r.data);
  };

  const remove = async (): Promise<void> => {
    const r = await window.api.tools.remove({ family });
    if (r.ok) {
      setStatus(r.data);
      setRejected([]);
      showToast('info', t.removed(familyName));
    }
  };

  const files = status?.files ?? [];
  const ready = files.length > 0 && files.every((f) => f.installed);
  const anyInstalled = files.some((f) => f.installed);
  const windows = files.some((f) => f.name.toLowerCase().endsWith('.exe'));

  return (
    <Modal
      title={t.title(familyName)}
      onClose={() => finish(false)}
      width={560}
      footer={
        <>
          {anyInstalled && (
            <Button variant="secondary" className="footer-left" onClick={() => void remove()}>
              {t.remove}
            </Button>
          )}
          <Button variant="secondary" onClick={() => finish(false)}>
            {es.dialogs.cancel}
          </Button>
          <Button disabled={!ready || busy} onClick={() => finish(true)} data-autofocus>
            {t.continue}
          </Button>
        </>
      }
    >
      <p>{t.intro(familyName)}</p>

      <div className="tool-list" role="list" aria-label={t.needed} data-testid="tool-list">
        {files.map((f) => (
          <div key={f.name} role="listitem" className="tool-item">
            <div className="tool-row" data-installed={f.installed}>
              <Codicon
                name={f.installed ? 'check' : 'circle-outline'}
                color={f.installed ? 'var(--success)' : 'var(--fg-muted)'}
                size={14}
              />
              <span className="tool-name">{f.name}</span>
              <span className="tool-state" title={f.banner}>
                {f.installed ? t.installed(f.version) : t.missing}
              </span>
            </div>
            {f.libraries && (
              <div className="tool-libs" data-testid="tool-libs">
                <span>{t.libraries}</span>
                {f.libraries.map((lib) => (
                  <span key={lib.name} className={lib.installed ? 'tool-lib' : 'tool-lib is-missing'}>
                    {lib.name}
                    {!lib.installed && ` (${t.libraryMissing})`}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {family === 'postgres' && windows && files.some((f) => !f.libraries) && (
        <p className="form-hint" data-testid="expected-libs">
          {t.expectedLibraries(POSTGRES_LIBRARIES)}
        </p>
      )}

      <div
        className={['dropzone', dragging ? 'is-active' : '', busy ? 'is-busy' : ''].join(' ')}
        data-testid="tool-dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const paths = [...e.dataTransfer.files]
            .map((file) => window.api.tools.pathForFile(file))
            .filter((p) => p !== '');
          void importPaths(paths);
        }}
      >
        <Codicon
          name={busy ? 'loading' : 'cloud-upload'}
          className={busy ? 'codicon-modifier-spin' : ''}
          size={24}
        />
        <span>{busy ? t.checking : dragging ? t.dropActive : t.drop}</span>
        <Button variant="secondary" small disabled={busy} onClick={() => void pick()}>
          {t.pick}
        </Button>
      </div>

      {rejected.length > 0 && (
        <div className="tool-rejected" role="alert">
          <strong>{t.rejected}</strong>
          <ul>
            {rejected.map((r) => (
              <li key={r.path}>
                <span className="tool-name">{r.path.split(/[\\/]/).pop()}</span>: {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="form-hint">{t.copyNote}</p>
      {windows && <p className="form-hint">{t.dllNote}</p>}
      <p className="form-hint">{windows ? t.whereWindows(family) : t.whereOther}</p>
      {family !== 'postgres' && <p className="form-hint">{t.separate}</p>}
    </Modal>
  );
}
