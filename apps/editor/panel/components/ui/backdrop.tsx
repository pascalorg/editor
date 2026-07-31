'use client';

import { cn } from '@panel/lib/cn';

/**
 * The signature 3D perspective grid. `rotateX(60deg)` on an oversized plane,
 * scrolled by dtGridScroll, with a radial vignette painted over it.
 *
 * `paused` freezes the animation while a form is submitting — the prototype does
 * the same, and it is the difference between "the page is working" and "the page
 * is decorative".
 */
export function GridBackdrop({ paused = false, className }: { paused?: boolean; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 z-0 overflow-hidden', className)}
    >
      <div
        className="absolute -inset-x-1/2 -inset-y-1/2 will-change-transform"
        style={{
          backgroundImage:
            'linear-gradient(var(--dt-grid-line) 1.5px, transparent 1.5px), linear-gradient(90deg, var(--dt-grid-line) 1.5px, transparent 1.5px)',
          backgroundSize: '50px 50px',
          transform: 'perspective(500px) rotateX(60deg) translateY(-100px)',
          transformOrigin: 'center',
          opacity: 0.85,
          backfaceVisibility: 'hidden',
          animation: paused ? undefined : 'dtGridScroll 45s linear infinite',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(circle at center, transparent 15%, var(--dt-bg) 78%)',
        }}
      />
    </div>
  );
}

/**
 * Ambient indigo/teal glow blobs. Kept as the data/functional colour layer the
 * brand decision reserved them for — the yellow stays the single brand accent.
 */
export function GlowBlobs() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute -right-[120px] -top-[120px] z-0 h-[440px] w-[440px] rounded-full"
        style={{ background: 'rgba(129,140,248,0.06)', filter: 'blur(130px)' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-[140px] left-[38%] z-0 h-[420px] w-[420px] rounded-full"
        style={{ background: 'rgba(45,212,191,0.05)', filter: 'blur(120px)' }}
      />
    </>
  );
}

/** The hero pane's own grid — same transform, but vignetted onto --dt-hero. */
export function HeroGrid({ paused = false }: { paused?: boolean }) {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-1/2 -inset-y-1/2 z-0 will-change-transform"
        style={{
          backgroundImage:
            'linear-gradient(var(--dt-grid-line) 1.5px, transparent 1.5px), linear-gradient(90deg, var(--dt-grid-line) 1.5px, transparent 1.5px)',
          backgroundSize: '50px 50px',
          transform: 'perspective(500px) rotateX(60deg) translateY(-100px)',
          transformOrigin: 'center',
          opacity: 0.85,
          backfaceVisibility: 'hidden',
          animation: paused ? undefined : 'dtGridScroll 45s linear infinite',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{ background: 'radial-gradient(circle at center, transparent 15%, var(--dt-hero) 80%)' }}
      />
    </>
  );
}
