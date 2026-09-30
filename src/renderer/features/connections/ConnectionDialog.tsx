import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ConnectionConfig, Engine, Environment, ServerInfo, SslMode } from '@shared/connection';
import { CompleteConnectionSchema, DEFAULT_PORTS, newConnectionDefaults } from '@shared/connection';
import { Modal } from '../../components/Modal';
import { Button, IconButton } from '../../components/Button';
import { Checkbox, Select, TextInput } from '../../components/Inputs';
import { Codicon } from '../../components/Codicon';
import { es } from '../../i18n/es';
import { useConnectionsStore } from '../../stores/connections-store';

const ENGINES: { engine: Engine; badge: string }[] = [
  { engine: 'postgres', badge: 'PG' },
  { engine: 'mariadb', badge: 'MY' },
  { engine: 'sqlite', badge: 'LT' },
  { engine: 'sqlserver', badge: 'MS' },
];

const ENVIRONMENTS: Environment[] = ['local', 'dev', 'qa', 'prod'];
const SSL_MODES: SslMode[] = ['disable', 'require', 'verify-ca', 'verify-full'];

type FieldErrors = Partial<
  Record<'name' | 'host' | 'port' | 'file' | 'connectTimeout' | 'queryTimeout' | 'extra', string>
>;

type TestState =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; info: ServerInfo }
  | { state: 'error'; message: string };

function Field({
  label,
  error,
  children,
  wide,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  wide?: boolean;
}): React.JSX.Element {
  return (
    <label className={['form-field', wide ? 'is-wide' : ''].join(' ')}>
      <span className="form-label">{label}</span>
      {children}
      {error && <span className="form-error">{error}</span>}
    </label>
  );
}

function Section({
  title,
  children,
  collapsible,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="form-section">
      {collapsible ? (
        <button
          type="button"
          className="form-section-title is-toggle"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Codicon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
          {title}
        </button>
      ) : (
        <h3 className="form-section-title">{title}</h3>
      )}
      {open && <div className="form-grid">{children}</div>}
    </section>
  );
}

function extraToText(extra: Record<string, string> | undefined): string {
  return Object.entries(extra ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function parseExtra(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) return null;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function parseIntField(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  return Number(text.trim());
}

export function ConnectionDialog({
  editId,
  folder,
  onClose,
}: {
  editId?: string;
  folder?: string;
  onClose: () => void;
}): React.JSX.Element {
  const d = es.connectionDialog;
  const store = useConnectionsStore();
  const existing = editId ? store.connections.find((c) => c.id === editId) : undefined;
  const hasSavedPassword = existing ? store.savedPasswordIds.has(existing.id) : false;

  const [draft, setDraft] = useState<ConnectionConfig | null>(existing ?? null);
  const [portText, setPortText] = useState(existing?.port !== undefined ? String(existing.port) : '');
  const [connectTimeoutText, setConnectTimeoutText] = useState(String(existing?.connectTimeoutSec ?? 15));
  const [queryTimeoutText, setQueryTimeoutText] = useState(String(existing?.queryTimeoutSec ?? 0));
  const [extraText, setExtraText] = useState(extraToText(existing?.extra));
  const [password, setPassword] = useState('');
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(!!existing);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [test, setTest] = useState<TestState>({ state: 'idle' });
  const [saving, setSaving] = useState(false);

  const folderOptions = useMemo(
    () => [{ value: '', label: d.noFolder }, ...store.folders.map((f) => ({ value: f, label: f }))],
    [store.folders, d.noFolder],
  );

  const chooseEngine = (engine: Engine): void => {
    const base = newConnectionDefaults(engine, crypto.randomUUID());
    if (folder) base.folder = folder;
    if (!store.encryptionAvailable) base.savePassword = false;
    setDraft(base);
    setPortText(base.port !== undefined ? String(base.port) : '');
  };

  const update = (patch: Partial<ConnectionConfig>): void => {
    setDraft((cur) => (cur ? { ...cur, ...patch } : cur));
    setTest({ state: 'idle' });
  };

  /** Construye la configuración a guardar/probar; devuelve null y marca errores si no es válida. */
  const build = (): ConnectionConfig | null => {
    if (!draft) return null;
    const next: FieldErrors = {};
    const e = d.errors;
    const port = portText.trim() ? parseIntField(portText) : undefined;
    if (port === null || (port !== undefined && (port < 1 || port > 65535))) next.port = e.port;
    const connectTimeout = parseIntField(connectTimeoutText);
    if (connectTimeout === null || connectTimeout < 1) next.connectTimeout = e.number;
    const queryTimeout = parseIntField(queryTimeoutText);
    if (queryTimeout === null) next.queryTimeout = e.number;
    const extra = parseExtra(extraText);
    if (extra === null) next.extra = e.extra;

    const trimmed = (v: string | undefined): string | undefined => (v?.trim() ? v.trim() : undefined);
    const config: ConnectionConfig = {
      ...draft,
      name: draft.name.trim(),
      folder: trimmed(draft.folder),
      host: draft.engine === 'sqlite' ? undefined : trimmed(draft.host),
      port: draft.engine === 'sqlite' ? undefined : (port ?? undefined),
      instance: draft.engine === 'sqlserver' ? trimmed(draft.instance) : undefined,
      database: trimmed(draft.database),
      user: draft.engine === 'sqlite' ? undefined : draft.user,
      file: draft.engine === 'sqlite' ? trimmed(draft.file) : undefined,
      connectTimeoutSec: connectTimeout ?? 15,
      queryTimeoutSec: queryTimeout ?? 0,
      extra: extra && Object.keys(extra).length > 0 ? extra : undefined,
    };
    // Sin claves con valor undefined en el JSON guardado.
    const clean = Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined));

    const parsed = CompleteConnectionSchema.safeParse(clean);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'name' || field === 'host' || field === 'file') next[field] = e.required;
        if (field === 'port') next.port = e.port;
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0 && parsed.success ? parsed.data : null;
  };

  const runTest = async (): Promise<void> => {
    const config = build();
    if (!config) return;
    setTest({ state: 'testing' });
    const r = await window.api.conn.test({
      config,
      password: passwordTouched || !hasSavedPassword ? password : undefined,
      useSavedPasswordOf: existing && hasSavedPassword && !passwordTouched ? existing.id : undefined,
    });
    setTest(r.ok ? { state: 'ok', info: r.data } : { state: 'error', message: r.error.message });
  };

  const save = async (): Promise<void> => {
    const config = build();
    if (!config) return;
    setSaving(true);
    let pw: string | null | undefined;
    if (!config.savePassword) pw = null;
    else if (passwordTouched || !existing) pw = password;
    const r = await store.save(config, { password: pw });
    setSaving(false);
    if (r.ok) onClose();
    else setTest({ state: 'error', message: r.error.message });
  };

  if (!draft) {
    return (
      <Modal title={d.newTitle} onClose={onClose} width={640}>
        <p className="muted">{d.chooseEngine}</p>
        <div className="engine-cards">
          {ENGINES.map(({ engine, badge }, i) => (
            <button
              key={engine}
              type="button"
              className="engine-card"
              onClick={() => chooseEngine(engine)}
              data-autofocus={i === 0 || undefined}
            >
              <span className="engine-badge is-large">{badge}</span>
              <span>{es.connections.engines[engine]}</span>
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  const isSqlite = draft.engine === 'sqlite';
  const isSqlServer = draft.engine === 'sqlserver';

  const browse = async (kind: 'sqlite' | 'ca'): Promise<void> => {
    const r = await window.api.app.openFileDialog(
      kind === 'sqlite'
        ? {
            title: d.sqliteDialogTitle,
            defaultPath: draft.file,
            allowCreate: true,
            filters: [
              { name: d.sqliteFilter, extensions: ['db', 'sqlite', 'sqlite3', 'db3'] },
              { name: d.allFiles, extensions: ['*'] },
            ],
          }
        : {
            title: d.caDialogTitle,
            defaultPath: draft.ssl?.caFile,
            filters: [
              { name: d.caFilter, extensions: ['pem', 'crt', 'cer'] },
              { name: d.allFiles, extensions: ['*'] },
            ],
          },
    );
    if (!r.ok || !r.data.path) return;
    if (kind === 'sqlite') update({ file: r.data.path });
    else update({ ssl: { mode: draft.ssl?.mode ?? 'verify-ca', ...draft.ssl, caFile: r.data.path } });
  };

  const footer = (
    <>
      <div className="dialog-footer-left">
        <Button variant="secondary" onClick={() => void runTest()} disabled={test.state === 'testing'}>
          {test.state === 'testing' ? d.testing : d.test}
        </Button>
        {test.state === 'ok' && (
          <span className="test-result is-ok" data-testid="test-result">
            <Codicon name="pass" color="var(--success)" />
            {d.testOk(test.info.product, test.info.latencyMs)}
          </span>
        )}
        {test.state === 'error' && (
          <span className="test-result is-error" data-testid="test-result" title={test.message}>
            <Codicon name="error" color="var(--error)" />
            {test.message}
          </span>
        )}
      </div>
      {!existing && (
        <Button variant="secondary" onClick={() => setDraft(null)}>
          {d.back}
        </Button>
      )}
      <Button variant="secondary" onClick={onClose}>
        {es.dialogs.cancel}
      </Button>
      <Button onClick={() => void save()} disabled={saving}>
        {d.save}
      </Button>
    </>
  );

  return (
    <Modal
      title={`${existing ? d.editTitle : d.newTitle} — ${es.connections.engines[draft.engine]}`}
      onClose={onClose}
      width={640}
      footer={footer}
    >
      <form
        className="connection-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Section title={d.general}>
          <Field label={d.name} error={errors.name} wide>
            <TextInput
              value={draft.name}
              placeholder={d.namePlaceholder}
              onChange={(e) => update({ name: e.target.value })}
              invalid={!!errors.name}
              data-autofocus
              aria-label={d.name}
            />
          </Field>
          <Field label={d.folder}>
            <Select
              value={draft.folder ?? ''}
              options={folderOptions}
              onChange={(e) => update({ folder: e.target.value || undefined })}
              aria-label={d.folder}
            />
          </Field>
          <Field label={d.environment}>
            <div className="env-select">
              <span
                className="env-dot"
                style={{ background: draft.color ?? `var(--env-${draft.environment})` }}
              />
              <Select
                value={draft.environment}
                options={ENVIRONMENTS.map((env) => ({ value: env, label: es.environments[env] }))}
                onChange={(e) => {
                  const environment = e.target.value as Environment;
                  update({
                    environment,
                    // Producción confirma escrituras por defecto (specs/08), salvo que el usuario lo haya cambiado.
                    ...(confirmTouched ? {} : { confirmWrites: environment === 'prod' }),
                  });
                }}
                aria-label={d.environment}
              />
            </div>
          </Field>
          <div className="form-field is-wide form-inline">
            <Checkbox
              label={d.customColor}
              checked={draft.color !== undefined}
              onChange={(e) => update({ color: e.target.checked ? '#3794ff' : undefined })}
            />
            {draft.color !== undefined && (
              <input
                type="color"
                className="color-input"
                value={draft.color}
                aria-label={d.customColor}
                onChange={(e) => update({ color: e.target.value })}
              />
            )}
          </div>
        </Section>

        {isSqlite ? (
          <Section title={d.file}>
            <Field label={d.sqliteFile} error={errors.file} wide>
              <div className="form-inline">
                <TextInput
                  className="grow"
                  value={draft.file ?? ''}
                  onChange={(e) => update({ file: e.target.value })}
                  invalid={!!errors.file}
                  aria-label={d.sqliteFile}
                />
                <Button variant="secondary" icon="folder-opened" onClick={() => void browse('sqlite')}>
                  {d.browse}
                </Button>
              </div>
            </Field>
            <div className="form-field is-wide form-inline">
              <Checkbox
                label={d.sqliteReadOnly}
                checked={!!draft.sqliteReadOnly}
                onChange={(e) => update({ sqliteReadOnly: e.target.checked })}
              />
              <Checkbox
                label={d.sqliteCreate}
                checked={!!draft.sqliteCreate}
                onChange={(e) => update({ sqliteCreate: e.target.checked })}
              />
            </div>
          </Section>
        ) : (
          <Section title={d.server}>
            <Field label={d.host} error={errors.host}>
              <TextInput
                value={draft.host ?? ''}
                onChange={(e) => update({ host: e.target.value })}
                invalid={!!errors.host}
                aria-label={d.host}
              />
            </Field>
            <Field label={d.port} error={errors.port}>
              <TextInput
                value={portText}
                inputMode="numeric"
                placeholder={String(DEFAULT_PORTS[draft.engine] ?? '')}
                onChange={(e) => {
                  setPortText(e.target.value);
                  setTest({ state: 'idle' });
                }}
                invalid={!!errors.port}
                aria-label={d.port}
              />
            </Field>
            {isSqlServer && (
              <Field label={d.instance}>
                <TextInput
                  value={draft.instance ?? ''}
                  onChange={(e) => update({ instance: e.target.value })}
                  aria-label={d.instance}
                />
              </Field>
            )}
            <Field label={d.database}>
              <TextInput
                value={draft.database ?? ''}
                onChange={(e) => update({ database: e.target.value })}
                aria-label={d.database}
              />
            </Field>
            <Field label={d.user}>
              <TextInput
                value={draft.user ?? ''}
                onChange={(e) => update({ user: e.target.value })}
                aria-label={d.user}
              />
            </Field>
            <Field label={d.password}>
              <div className="password-input">
                <TextInput
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  placeholder={hasSavedPassword && !passwordTouched ? d.passwordSavedPlaceholder : ''}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordTouched(true);
                    setTest({ state: 'idle' });
                  }}
                  autoComplete="new-password"
                  aria-label={d.password}
                />
                <IconButton
                  icon={showPassword ? 'eye-closed' : 'eye'}
                  label={showPassword ? d.hidePassword : d.showPassword}
                  onClick={() => setShowPassword((s) => !s)}
                />
              </div>
            </Field>
            <div className="form-field is-wide">
              <Checkbox
                label={d.savePassword}
                checked={draft.savePassword}
                disabled={!store.encryptionAvailable}
                onChange={(e) => update({ savePassword: e.target.checked })}
              />
              {!store.encryptionAvailable && (
                <span className="form-hint is-warning">{d.encryptionUnavailable}</span>
              )}
            </div>
          </Section>
        )}

        {!isSqlite && (
          <Section title={d.ssl} collapsible defaultOpen={(draft.ssl?.mode ?? 'disable') !== 'disable'}>
            <Field label={d.sslMode}>
              <Select
                value={draft.ssl?.mode ?? 'disable'}
                options={SSL_MODES.map((m) => ({ value: m, label: d.sslModes[m] }))}
                onChange={(e) => update({ ssl: { ...draft.ssl, mode: e.target.value as SslMode } })}
                aria-label={d.sslMode}
              />
            </Field>
            <Field label={d.caFile}>
              <div className="form-inline">
                <TextInput
                  className="grow"
                  value={draft.ssl?.caFile ?? ''}
                  onChange={(e) =>
                    update({
                      ssl: {
                        mode: draft.ssl?.mode ?? 'verify-ca',
                        ...draft.ssl,
                        caFile: e.target.value || undefined,
                      },
                    })
                  }
                  aria-label={d.caFile}
                />
                <IconButton icon="folder-opened" label={d.browse} onClick={() => void browse('ca')} />
              </div>
            </Field>
            {isSqlServer && (
              <div className="form-field is-wide form-inline">
                <Checkbox
                  label={d.encrypt}
                  checked={!!draft.ssl?.encrypt}
                  onChange={(e) =>
                    update({
                      ssl: { mode: draft.ssl?.mode ?? 'disable', ...draft.ssl, encrypt: e.target.checked },
                    })
                  }
                />
                <Checkbox
                  label={d.trustServerCertificate}
                  checked={!!draft.ssl?.trustServerCertificate}
                  onChange={(e) =>
                    update({
                      ssl: {
                        mode: draft.ssl?.mode ?? 'disable',
                        ...draft.ssl,
                        trustServerCertificate: e.target.checked,
                      },
                    })
                  }
                />
              </div>
            )}
          </Section>
        )}

        <Section title={d.advanced} collapsible defaultOpen={false}>
          <div className="form-field is-wide">
            <Checkbox
              label={d.readOnly}
              checked={draft.readOnly}
              onChange={(e) => update({ readOnly: e.target.checked })}
            />
            {isSqlServer && <span className="form-hint">{d.readOnlySqlServerHint}</span>}
          </div>
          <div className="form-field is-wide">
            <Checkbox
              label={d.confirmWrites}
              checked={draft.confirmWrites}
              onChange={(e) => {
                setConfirmTouched(true);
                update({ confirmWrites: e.target.checked });
              }}
            />
          </div>
          <div className="form-field is-wide">
            <Checkbox
              label={d.showSystemObjects}
              checked={draft.showSystemObjects}
              onChange={(e) => update({ showSystemObjects: e.target.checked })}
            />
          </div>
          <Field label={d.connectTimeout} error={errors.connectTimeout}>
            <TextInput
              value={connectTimeoutText}
              inputMode="numeric"
              onChange={(e) => setConnectTimeoutText(e.target.value)}
              aria-label={d.connectTimeout}
            />
          </Field>
          <Field label={d.queryTimeout} error={errors.queryTimeout}>
            <TextInput
              value={queryTimeoutText}
              inputMode="numeric"
              onChange={(e) => setQueryTimeoutText(e.target.value)}
              aria-label={d.queryTimeout}
            />
          </Field>
          <Field label={d.extra} error={errors.extra} wide>
            <textarea
              className="textarea"
              rows={3}
              spellCheck={false}
              value={extraText}
              onChange={(e) => setExtraText(e.target.value)}
              aria-label={d.extra}
            />
          </Field>
        </Section>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
