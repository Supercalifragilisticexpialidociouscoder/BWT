import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { LoaderCircle } from 'lucide-react';
import clsx from 'clsx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap select-none rounded-[var(--radius-sm)] ' +
  'transition-[background-color,border-color,color,transform,opacity] duration-[var(--dur-fast)] ease-[var(--ease-standard)] ' +
  'active:translate-y-px disabled:opacity-45 disabled:active:translate-y-0';

const variants: Record<Variant, string> = {
  primary: 'bg-signal text-signal-ink hover:bg-signal-2',
  secondary: 'bg-ink-800 text-paper border border-line hover:border-line-strong hover:bg-ink-700',
  ghost: 'text-paper-2 hover:text-paper hover:bg-ink-800',
  danger: 'text-bad border border-bad/40 hover:bg-bad/10 hover:border-bad/70',
  quiet: 'text-paper-2 underline decoration-line-strong underline-offset-4 hover:text-paper hover:decoration-paper-2',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-[15px]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, iconRight, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={clsx(base, variants[variant], sizes[size], variant === 'quiet' && '!h-auto !px-0', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
      {!loading && iconRight}
    </button>
  );
});

export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  className,
  children,
  ...rest
}: LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode; iconRight?: ReactNode }) {
  return (
    <Link className={clsx(base, variants[variant], sizes[size], className)} {...rest}>
      {icon}
      {children}
      {iconRight}
    </Link>
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        'inline-flex size-9 items-center justify-center rounded-[var(--radius-sm)] text-paper-2 transition-colors duration-[var(--dur-fast)] hover:bg-ink-800 hover:text-paper',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
