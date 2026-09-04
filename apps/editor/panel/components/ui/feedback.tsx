'use client';

import { useRef, type ReactNode } from 'react';
import { Check, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Caps } from '@panel/components/ui/caps';
import { useModalFocus } from '@panel/components/ui/modal-focus';
import { useEscapeLayer } from '@panel/lib/escape-layers';
import { cn } from '@panel/lib/cn';

/** Destructive inline error box — shakes once, as the prototype does. */
export function ErrorBox({ children, shield = true }: { children: ReactNode; shield?: boolean }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-[8px] border border-destructive bg-field px-[11px] py-[9px]"
      style={{ animation: 'dtShake 0.3s ease' }}
    >
      {shield ? (
        <ShieldAlert className="mt-px block h-[15px] w-[15px] shrink-0 text-destructive" strokeWidth={2.2} />
      ) : (
        <span className="mt-[6px] h-[5px] w-[5px] shrink-0 rounded-full bg-destructive" />
      )}
      <span className="text-xs leading-[1.45] text-destructive">{children}</span>
    </div>
  );
}

/** Brand-accented notice — SSO enforcement, security banner, invite state. */
export function NoticeBox({
  title,
  children,
  icon,
  accent = true,
}: {
  title?: ReactNode;
  children: ReactNode;
  icon?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-[9px] rounded-[8px] border border-border bg-field px-3 py-[10px]',
        accent && 'border-l-2 border-l-brand',
      )}
    >
      <span className="mt-px block h-[15px] w-[15px] shrink-0 text-brand-fg">
        {icon ?? <ShieldCheck className="h-[15px] w-[15px]" strokeWidth={2.1} />}
      </span>
      <div className="flex min-w-0 flex-col gap-[2px]">
        {title ? <span className="text-xs font-semibold text-fg">{title}</span> : null}
        <span className="text-[11.5px] leading-[1.45] text-muted-fg text-pretty">{children}</span>
      </div>
    </div>
  );
}

/** The 32 px yellow tick that opens every "done" state in the auth flows. */
export function SuccessMark() {
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-brand bg-field text-brand-fg">
      <Check className="block h-4 w-4" strokeWidth={2.5} />
    </div>
  );
}

export function Kicker({ children }: { children: string }) {
  return <Caps className="font-mono text-[9px] tracking-[0.14em] text-muted-fg">{children}</Caps>;
}

export function ScreenTitle({ title, lead }: { title: ReactNode; lead?: ReactNode }) {
  return (
    <>
      <h1 className="m-0 mt-1 text-[18px] font-semibold tracking-[-0.01em]">{title}</h1>
      {lead ? (
        <p className="m-0 mt-[2px] text-[12.5px] leading-[1.55] text-muted-fg text-pretty">{lead}</p>
      ) : null}
    </>
  );
}

/**
 * Modal shell. Traps nothing by itself — each caller wires Escape into the
 * layer chain (menu → palette → drawer → dialog → inline edit) so Escape only
 * ever closes the topmost layer.
 */
export function Dialog({
  labelledBy,
  role = 'dialog',
  width = 344,
  onClose,
  children,
}: {
  labelledBy?: string;
  role?: 'dialog' | 'alertdialog';
  width?: number;
  /**
   * Dismissal. Pass it and the dialog joins the Escape chain as its topmost
   * layer; leave it out only for a dialog the user genuinely must answer.
   */
  onClose?: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useModalFocus(ref);
  useEscapeLayer(Boolean(onClose), onClose ?? noop);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-6 backdrop-blur-[3px]"
      style={{ background: 'rgba(0,0,0,0.6)', animation: 'dtFade 0.15s ease' }}
    >
      <div
        ref={ref}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        // Focusable as a last resort: a dialog whose controls are all disabled
        // still has to be able to receive focus, or it receives nothing.
        tabIndex={-1}
        className="flex w-full flex-col gap-[14px] rounded-[12px] border border-border bg-popover p-[22px] shadow-e4 outline-none"
        style={{ maxWidth: width, animation: 'dtScale 0.18s ease' }}
      >
        {children}
      </div>
    </div>
  );
}

function noop(): void {}

/** Live-region toast. Success and error share one surface, per O6. */
export function Toast({ message, tone }: { message: string; tone: 'success' | 'error' }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed bottom-5 left-1/2 z-[140] -translate-x-1/2 rounded-[10px] border px-4 py-[10px] text-[12.5px] font-medium shadow-e4',
        tone === 'success' ? 'border-border bg-popover text-fg' : 'border-destructive bg-popover text-destructive',
      )}
      style={{ animation: 'dtFade 0.18s ease' }}
    >
      {message}
    </div>
  );
}
