'use client';

import type { ReactNode } from 'react';
import { GlowBlobs, GridBackdrop } from '@panel/components/ui/backdrop';
import { LangToggle, ThemeToggle } from '@panel/components/ui/controls';
import { useBreakpoint } from '@panel/lib/hooks/use-breakpoint';

/**
 * The shared frame for the six single-column auth screens (sign-in has its own
 * two-pane layout). Centred column, 400 px card ceiling, grid backdrop behind.
 * Below 700 px the card takes the full width and the backdrop grid switches off,
 * which is what keeps a phone from paying for a decorative animation.
 */
export function AuthShell({
  children,
  label,
  paused = false,
}: {
  children: ReactNode;
  label: string;
  paused?: boolean;
}) {
  const { isMobile } = useBreakpoint();

  return (
    <div
      data-screen-label={label}
      className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg px-6 py-10 text-fg"
    >
      {!isMobile ? (
        <>
          <GridBackdrop paused={paused} />
          <GlowBlobs />
        </>
      ) : null}

      {/* A landmark, not a div: the console shell already wraps its content in
          <main>, and without the same here every auth screen offered a screen
          reader no way to skip the backdrop and the two toggles. */}
      <main className="relative z-10 flex w-full max-w-[420px] flex-col items-center gap-4">
        <div className="flex w-full items-center justify-end gap-[6px]">
          <ThemeToggle />
          <LangToggle />
        </div>
        {children}
      </main>
    </div>
  );
}

/** The mono signature line that closes every auth screen. */
export function AuthFooter({ protectedUpper, signature }: { protectedUpper: string; signature: string }) {
  return (
    // No text-transform here: one uppercase pass over mixed Turkish and brand
    // text is always wrong for half of it, so the literals carry their own case.
    <p className="m-0 font-mono text-[9px] leading-[1.6] tracking-[0.1em] text-muted-fg">
      {protectedUpper} · {signature}
    </p>
  );
}
