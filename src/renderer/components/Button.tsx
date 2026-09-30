import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { Codicon } from './Codicon';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: string;
  small?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', icon, small, className, children, type = 'button', ...rest },
  ref,
) {
  const classes = ['btn', `btn-${variant}`, small ? 'btn-small' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} type={type} className={classes} {...rest}>
      {icon && <Codicon name={icon} size={small ? 14 : 16} />}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  icon: string;
  /** Texto accesible y tooltip (obligatorio: los botones de solo icono deben tener nombre). */
  label: string;
  active?: boolean;
  color?: string;
  size?: number;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, active, color, size = 16, className, type = 'button', ...rest },
  ref,
) {
  const classes = ['icon-btn', active ? 'is-active' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={classes} title={label} aria-label={label} {...rest}>
      <Codicon name={icon} size={size} color={color} />
    </button>
  );
});
