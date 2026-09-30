import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { forwardRef, useId } from 'react';
import { Codicon } from './Codicon';

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Icono a la izquierda (p. ej. `filter`, `search`). */
  icon?: string;
  invalid?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { icon, invalid, className, ...rest },
  ref,
) {
  return (
    <div
      className={['input', icon ? 'has-icon' : '', invalid ? 'is-invalid' : '', className ?? ''].join(' ')}
    >
      {icon && <Codicon name={icon} size={14} className="input-icon" />}
      <input ref={ref} spellCheck={false} autoComplete="off" {...rest} />
    </div>
  );
});

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[];
}

/** Select nativo con estilo VS Code (accesible y con teclado del sistema). */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, className, ...rest },
  ref,
) {
  return (
    <div className={['select', className ?? ''].join(' ')}>
      <select ref={ref} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Codicon name="chevron-down" size={14} className="select-chevron" />
    </div>
  );
});

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
}

export function Checkbox({ label, className, id, ...rest }: CheckboxProps): React.JSX.Element {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <label className={['checkbox', className ?? ''].join(' ')} htmlFor={inputId}>
      <input id={inputId} type="checkbox" {...rest} />
      <span className="checkbox-box" aria-hidden>
        <Codicon name="check" size={14} />
      </span>
      {label && <span className="checkbox-label">{label}</span>}
    </label>
  );
}
