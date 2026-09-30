import { useState } from 'react';
import { connectionAddress } from '@shared/connection';
import { Modal } from '../../components/Modal';
import { Button, IconButton } from '../../components/Button';
import { Checkbox, TextInput } from '../../components/Inputs';
import { es } from '../../i18n/es';
import { connectionById, useConnectionsStore } from '../../stores/connections-store';
import { connect } from '../connections/actions';

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={440}
      accentColor={danger ? 'var(--error)' : undefined}
      footer={
        <>
          {/* Cancelar tiene el foco por defecto (specs/04 §14). */}
          <Button variant="secondary" onClick={onClose} data-autofocus>
            {es.dialogs.cancel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onClose();
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}

export function PromptDialog({
  title,
  label,
  initialValue,
  confirmLabel,
  validate,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initialValue: string;
  confirmLabel: string;
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const submit = (): void => {
    const problem = validate?.(value) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    onClose();
    onSubmit(value);
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {es.dialogs.cancel}
          </Button>
          <Button onClick={submit}>{confirmLabel}</Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="form-field">
          <span className="form-label">{label}</span>
          <TextInput
            value={value}
            invalid={!!error}
            aria-label={label}
            data-autofocus
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
          />
          {error && <span className="form-error">{error}</span>}
        </label>
      </form>
    </Modal>
  );
}

/** Pide la contraseña al conectar (conexiones sin contraseña guardada). */
export function PasswordDialog({
  connectionId,
  onResult,
  onClose,
}: {
  connectionId: string;
  /** Se llama al terminar: true si quedó conectada. */
  onResult?: (connected: boolean) => void;
  onClose: () => void;
}): React.JSX.Element | null {
  const encryptionAvailable = useConnectionsStore((s) => s.encryptionAvailable);
  const conn = connectionById(connectionId);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [save, setSave] = useState(false);
  if (!conn) return null;
  const d = es.connectionDialog;

  const submit = async (): Promise<void> => {
    onClose();
    let connected = false;
    if (save && encryptionAvailable) {
      const r = await useConnectionsStore.getState().save({ ...conn, savePassword: true }, { password });
      if (r.ok) connected = await connect(conn.id);
    } else {
      connected = await connect(conn.id, password);
    }
    onResult?.(connected);
  };
  const cancel = (): void => {
    onClose();
    onResult?.(false);
  };

  return (
    <Modal
      title={es.connections.passwordTitle(conn.name)}
      onClose={cancel}
      width={420}
      footer={
        <>
          <Button variant="secondary" onClick={cancel}>
            {es.dialogs.cancel}
          </Button>
          <Button onClick={() => void submit()}>{es.connections.connect}</Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="muted">{es.connections.passwordPrompt(conn.user ?? '', connectionAddress(conn))}</p>
        <label className="form-field">
          <span className="form-label">{d.password}</span>
          <div className="password-input">
            <TextInput
              type={show ? 'text' : 'password'}
              value={password}
              autoComplete="off"
              aria-label={d.password}
              data-autofocus
              onChange={(e) => setPassword(e.target.value)}
            />
            <IconButton
              icon={show ? 'eye-closed' : 'eye'}
              label={show ? d.hidePassword : d.showPassword}
              onClick={() => setShow((s) => !s)}
            />
          </div>
        </label>
        {encryptionAvailable && (
          <Checkbox
            className="form-checkbox"
            label={d.savePassword}
            checked={save}
            onChange={(e) => setSave(e.target.checked)}
          />
        )}
      </form>
    </Modal>
  );
}
