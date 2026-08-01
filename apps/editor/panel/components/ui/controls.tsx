'use client';

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useApp } from '@panel/components/app-providers';
import { Caps } from '@panel/components/ui/caps';
import { useBreakpoint } from '@panel/lib/hooks/use-breakpoint';
import { cn } from '@panel/lib/cn';

/* Height pairs are the prototype's: 38 px desktop / 48 px touch for full-width
   actions, 28 / 44 for header controls. Touch sizing is gated on mobile portrait
   only, which is what stopped controls from ballooning in mobile landscape. */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  full?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', full = true, className, children, ...rest },
  ref,
) {
  const { touch, isMobile } = useBreakpoint();

  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'flex items-center justify-center gap-2 rounded-[8px] font-semibold',
        touch ? 'h-12' : 'h-[38px]',
        isMobile ? 'text-sm' : 'text-[13px]',
        full ? 'w-full' : 'px-4',
        variant === 'primary' && 'bg-primary text-primary-fg shadow-e2 hover:opacity-92',
        variant === 'secondary' && 'border border-border bg-field font-medium text-fg hover:bg-hover',
        variant === 'ghost' && 'bg-transparent font-medium text-muted-fg hover:text-fg',
        variant === 'destructive' &&
          'border border-destructive bg-field font-medium text-destructive hover:bg-hover',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/** Uppercase mono field label — the pattern used on every form row. */
export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="text-[10px] font-medium tracking-[0.12em] text-muted-fg">
      <Caps>{children}</Caps>
    </label>
  );
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  icon?: ReactNode;
  /** Extra right padding when a trailing control sits inside the field. */
  trailing?: ReactNode;
  invalid?: boolean;
  valid?: boolean;
};

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { icon, trailing, invalid, valid, className, ...rest },
  ref,
) {
  const { touch } = useBreakpoint();

  return (
    <div className="relative flex min-w-0 items-center">
      {icon ? (
        <span className="pointer-events-none absolute left-[11px] flex h-[15px] w-[15px] items-center text-muted-fg">
          {icon}
        </span>
      ) : null}
      <input
        ref={ref}
        className={cn(
          'w-full min-w-0 rounded-[8px] bg-field text-[13px] text-fg outline-none',
          'border focus:shadow-[0_0_0_3px_var(--dt-hover)]',
          invalid ? 'border-destructive' : valid ? 'border-ring' : 'border-input focus:border-ring',
          touch ? 'h-[46px]' : 'h-[38px]',
          icon ? 'pl-[34px]' : 'pl-[11px]',
          trailing ? (touch ? 'pr-[52px]' : 'pr-[44px]') : 'pr-[11px]',
          className,
        )}
        {...rest}
      />
      {trailing}
    </div>
  );
});

/** Card shell shared by every single-column auth screen: 376 px, 14 px radius. */
export function AuthCard({
  children,
  width = 376,
  gap = 20,
}: {
  children: ReactNode;
  width?: number;
  gap?: number;
}) {
  return (
    <div
      className="relative flex w-full flex-col rounded-[14px] border border-border bg-sidebar p-7 shadow-e4"
      style={{ maxWidth: width, gap, animation: 'dtFade 0.25s ease' }}
    >
      {children}
    </div>
  );
}

/**
 * One button, cycling System → Light → Dark. System is the default and keeps
 * following the OS; picking Light or Dark pins it until the cycle comes round
 * again. Three separate controls for one setting was one too many.
 */
export function ThemeToggle() {
  const { t, themeChoice, setThemeChoice } = useApp();
  const { touch, isMobile } = useBreakpoint();

  const order = ['system', 'light', 'dark'] as const;
  const next = order[(order.indexOf(themeChoice) + 1) % order.length] ?? 'system';
  const label =
    themeChoice === 'system' ? t.themeSystem : themeChoice === 'light' ? t.themeLight : t.themeDark;

  return (
    <button
      type="button"
      onClick={() => setThemeChoice(next)}
      title={label}
      aria-label={label}
      className={cn(
        'flex shrink-0 items-center justify-center border border-border bg-field text-fg hover:bg-hover',
        touch ? 'h-11 w-11' : 'h-7 w-7',
        isMobile ? 'rounded-[10px]' : 'rounded-[8px]',
      )}
    >
      {themeChoice === 'system' ? (
        <Monitor className="block h-[15px] w-[15px]" strokeWidth={2.5} />
      ) : themeChoice === 'light' ? (
        <Sun className="block h-[15px] w-[15px]" strokeWidth={2.5} />
      ) : (
        <Moon className="block h-[15px] w-[15px]" strokeWidth={2.5} />
      )}
    </button>
  );
}

export function LangToggle() {
  const { lang, toggleLang } = useApp();
  const { touch, isMobile } = useBreakpoint();

  return (
    <button
      type="button"
      onClick={toggleLang}
      title={lang === 'en' ? 'Türkçeye geç' : 'Switch to English'}
      className={cn(
        'flex shrink-0 items-center justify-center border border-border bg-field font-mono tracking-[0.06em] text-fg hover:bg-hover',
        touch ? 'h-11 w-11' : 'h-7 w-7',
        isMobile ? 'rounded-[10px] text-[11px]' : 'rounded-[8px] text-[9.5px]',
      )}
    >
      {/* Shows the language you would switch TO, matching the prototype. */}
      {lang === 'en' ? 'TR' : 'EN'}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block h-[13px] w-[13px] rounded-full border-2', className)}
      style={{
        borderColor: 'rgba(10,10,10,0.25)',
        borderTopColor: 'var(--dt-primary-fg)',
        animation: 'dtSpin 0.7s linear infinite',
      }}
    />
  );
}

/** Segmented control — the seg() helper, 44 px minimum on touch. */
export function SegBar({ children }: { children: ReactNode }) {
  const { isMobile } = useBreakpoint();
  return (
    <div
      className={cn(
        'dt-scroll-x flex max-w-full shrink-0 items-center gap-[2px] border border-border bg-panel',
        isMobile ? 'h-12 rounded-[12px] p-1' : 'h-[30px] rounded-[8px] p-[2px]',
      )}
    >
      {children}
    </div>
  );
}

export function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const { isMobile } = useBreakpoint();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'whitespace-nowrap rounded-[6px] px-[10px] text-[11px] font-medium',
        isMobile ? 'h-11' : 'h-[26px]',
        active ? 'bg-panel-hi text-fg shadow-e2' : 'bg-transparent text-muted-fg',
      )}
    >
      {children}
    </button>
  );
}

export function Checkbox({
  checked,
  onChange,
  children,
  align = 'center',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
  align?: 'center' | 'start';
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer select-none gap-[9px]',
        align === 'center' ? 'items-center' : 'items-start',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={cn('h-[14px] w-[14px] shrink-0 cursor-pointer', align === 'start' && 'mt-[2px]')}
        style={{ accentColor: 'var(--dt-primary)' }}
      />
      <span className="text-[12.5px] leading-[1.5] text-muted-fg">{children}</span>
    </label>
  );
}
