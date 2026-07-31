'use client';

import { useEffect, useState } from 'react';

/**
 * Breakpoints are measured in JS against the real viewport, not declared in CSS
 * (section 08). That decision came out of a concrete bug: layout was keyed off a
 * simulated device rather than the actual window, so a narrow window in "desktop"
 * mode kept the two-pane layout and the content overlapped.
 *
 *   desktop  >= 1080   two-pane sign-in, 208 px console rail
 *   wide     >= 700    rail visible, full table header
 *   narrow   <  1080
 *   mobile   <   700   stacked layout, bottom tab strip
 *
 * Touch sizing (44 px targets) follows `mobile` only — not tablet, and not
 * mobile landscape, both of which produced oversized controls when it did.
 */
export interface Breakpoint {
  width: number;
  isDesktop: boolean;
  isWide: boolean;
  isNarrow: boolean;
  isMobile: boolean;
  /** Touch sizing gate — mobile portrait only. */
  touch: boolean;
  /** False until the first measurement, so SSR and hydration agree. */
  ready: boolean;
}

const SSR: Breakpoint = {
  width: 1920,
  isDesktop: true,
  isWide: true,
  isNarrow: false,
  isMobile: false,
  touch: false,
  ready: false,
};

function measure(width: number): Breakpoint {
  const isDesktop = width >= 1080;
  const isMobile = width < 700;
  return {
    width,
    isDesktop,
    isWide: width >= 700,
    isNarrow: !isDesktop,
    isMobile,
    touch: isMobile,
    ready: true,
  };
}

export function useBreakpoint(): Breakpoint {
  const [state, setState] = useState<Breakpoint>(SSR);

  useEffect(() => {
    const update = () => setState(measure(window.innerWidth));
    update();

    // resize covers orientation changes on every browser that matters; a
    // dedicated orientationchange listener would just fire a duplicate.
    window.addEventListener('resize', update, { passive: true });
    return () => window.removeEventListener('resize', update);
  }, []);

  return state;
}
