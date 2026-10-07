import { useId, useState } from 'react';
import { TextInput } from '../../components/Inputs';

/** Una preferencia de la lista (specs/04 §15): el buscador filtra por sus textos. */
export interface PrefEntry {
  id: string;
  /** Codicon junto al título. */
  icon: string;
  title: string;
  description?: string;
  /** Otras palabras por las que se puede encontrar. */
  keywords?: string;
  /** Distinto del valor por defecto: muestra "Restablecer". */
  modified?: boolean;
  onReset?: () => void;
  /** Valor al que vuelve, para el botón "(Restablecer a …)". */
  resetTo?: string;
  render: () => React.ReactNode;
}

/**
 * Campo de texto o número que guarda al confirmar (Enter o al salir), no en
 * cada tecla: cada cambio se escribe en settings.json.
 */
export function CommitInput({
  value,
  onCommit,
  type = 'text',
  min,
  max,
  suggestions,
  disabled,
  ariaLabel,
  className,
}: {
  value: string | number;
  /** Guarda el texto confirmado; si no es válido, no guarda y el campo vuelve al valor actual. */
  onCommit: (text: string) => void;
  type?: 'text' | 'number';
  min?: number;
  max?: number;
  /** Valores sugeridos (lista desplegable del campo). */
  suggestions?: readonly string[];
  disabled?: boolean;
  ariaLabel: string;
  className?: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const listId = useId();
  const commit = (): void => {
    if (draft !== null && draft !== String(value)) onCommit(draft);
    setDraft(null);
  };
  return (
    <>
      <TextInput
        type={type}
        min={min}
        max={max}
        value={draft ?? String(value)}
        disabled={disabled}
        aria-label={ariaLabel}
        className={className}
        list={suggestions ? listId : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
      {suggestions && (
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </>
  );
}
