/**
 * Netlog brand assets, path for path from the corporate file `nlg.svg` — not a
 * redraw. That file carries four variants on one canvas (Turkish and English
 * wording, each plain and reversed-out of a navy box); what is here is the
 * Turkish plain variant, the one the console needs because its wordmark can
 * take the theme.
 *
 * The source file is not kept in the tree — nothing loads it at runtime, and
 * these paths are the whole of what the app uses. Recover it from git when a
 * variant that is not here is needed:
 *
 *     git show b06626e:nlg.svg > nlg.svg
 *
 * Colours are `fill` attributes rather than the classes the source file uses.
 * An SVG `<style>` block inside an HTML document is **not** scoped to its own
 * svg — it applies document-wide, so two logos on one page would fight over
 * `.cls-3` and the last one drawn would win. Attributes cannot leak.
 *
 * The colour rule: the mark is #FFC629 in both themes because it is the brand
 * mark, not a themed accent. The wordmark follows --dt-wordmark (#F0F0F0 dark /
 * #002D74 light), which is the reversed-out and plain treatments the brand file
 * already ships.
 */

/** Tight box around the mark alone, measured from the asset. */
const MARK_VIEW = '111.3 65.6 94.9 69.8';
/** Tight box around mark + wordmark. */
const LOCKUP_VIEW = '111.3 65.6 181.8 69.8';

const MARK_PATHS = [
  'M149.5,65.7s-46.7,13.2-36.8,38.8c0,0,7.5,20.8,36.5,30.9,0,0-36.5-26.2-22.1-48.7,0,0,3.5-6.8,22.4-21.1Z',
  'M169.5,77.6s-42.2,8.2-36.8,25.3c0,0,4.6,13.6,36.5,23.5,0,0-34.6-20.1-21.8-33.6,0,0,3.6-5.6,22.2-15.2Z',
  'M188.8,86s-38.7,4.8-33.6,17.7c0,0,1.2,9.3,33.7,16.7,0,0-32.6-11.9-19.3-23.4,0,0,7.2-7,19.2-11Z',
  'M183.2,103.6c0-4.6,5.1-8.2,11.5-8.2s11.5,3.7,11.5,8.2-5.1,8.2-11.5,8.2-11.5-3.7-11.5-8.2Z',
];

const WORDMARK_PATHS = [
  'M226.6,86.7h-3.6l-5.8-10.1h0c.1,1.8.2,3,.2,3.8v6.3h-2.5v-13.3h3.6l5.8,10h0c0-1.7-.1-3-.1-3.7v-6.3h2.5v13.3Z',
  'M238,86.7h-7.7v-13.3h7.7v2.3h-4.8v2.9h4.5v2.3h-4.5v3.4h4.8v2.3Z',
  'M246.3,86.7h-2.8v-11h-3.6v-2.3h10v2.3h-3.6v11Z',
  'M252.3,86.7v-13.3h2.8v11h5.4v2.3h-8.2Z',
  'M275.3,80c0,2.2-.5,3.9-1.6,5.1s-2.7,1.8-4.7,1.8-3.6-.6-4.7-1.8-1.6-2.9-1.6-5.1.5-3.9,1.6-5.1c1.1-1.2,2.7-1.8,4.7-1.8s3.6.6,4.7,1.8c1.1,1.2,1.6,2.9,1.6,5.1ZM265.6,80c0,1.5.3,2.6.8,3.4.6.8,1.4,1.1,2.5,1.1,2.2,0,3.4-1.5,3.4-4.5s-1.1-4.5-3.4-4.5-2,.4-2.5,1.1c-.6.8-.9,1.9-.9,3.4Z',
  'M283.5,79.2h5.3v6.9c-.9.3-1.7.5-2.4.6s-1.5.2-2.3.2c-2,0-3.5-.6-4.6-1.8-1.1-1.2-1.6-2.9-1.6-5.1s.6-3.8,1.8-5c1.2-1.2,2.9-1.8,5.1-1.8s2.7.3,3.9.8l-.9,2.3c-1-.5-2-.7-3-.7s-2.2.4-2.9,1.2c-.7.8-1.1,1.9-1.1,3.3s.3,2.5.9,3.3,1.5,1.1,2.6,1.1,1.2,0,1.8-.2v-2.8h-2.5v-2.3Z',
  'M214.8,107.3v-13.3h2.8v11h5.4v2.3h-8.2Z',
  'M237.8,100.6c0,2.2-.5,3.9-1.6,5.1-1.1,1.2-2.7,1.8-4.7,1.8s-3.6-.6-4.7-1.8c-1.1-1.2-1.6-2.9-1.6-5.1s.5-3.9,1.6-5.1c1.1-1.2,2.7-1.8,4.7-1.8s3.6.6,4.7,1.8c1.1,1.2,1.6,2.9,1.6,5.1ZM228.1,100.6c0,1.5.3,2.6.8,3.4.6.8,1.4,1.1,2.5,1.1,2.2,0,3.4-1.5,3.4-4.5s-1.1-4.5-3.4-4.5-2,.4-2.5,1.1c-.6.8-.9,1.9-.9,3.4Z',
  'M239.5,111.2c-.6,0-1.2,0-1.7-.2v-2.3c.5.1.9.2,1.3.2.6,0,1.1-.2,1.3-.6s.4-1,.4-1.8v-12.5h2.8v12.4c0,1.6-.4,2.7-1.1,3.5s-1.8,1.2-3.1,1.2Z',
  'M247.4,91.4c0-.9.5-1.4,1.5-1.4s1.5.5,1.5,1.4-.1.8-.4,1c-.3.2-.6.4-1.1.4-1,0-1.5-.5-1.5-1.4ZM247.5,107.3v-13.3h2.8v13.3h-2.8Z',
  'M261.9,103.6c0,1.2-.4,2.1-1.3,2.8s-2.1,1-3.6,1-2.7-.3-3.8-.8v-2.6c.9.4,1.7.7,2.3.8.6.2,1.2.2,1.7.2s1.1-.1,1.4-.4c.3-.2.5-.6.5-1.1s0-.5-.2-.7c-.1-.2-.4-.4-.6-.6-.3-.2-.9-.5-1.7-.9-.8-.4-1.4-.7-1.8-1.1-.4-.4-.7-.8-1-1.2-.2-.5-.4-1-.4-1.6,0-1.2.4-2.1,1.2-2.8s1.9-1,3.3-1,1.4,0,2,.2c.6.2,1.3.4,2,.7l-.9,2.2c-.7-.3-1.3-.5-1.8-.6s-.9-.2-1.4-.2-.9.1-1.2.4c-.3.2-.4.6-.4,1s0,.5.2.6c.1.2.3.4.6.5.3.2.8.5,1.8.9,1.2.6,2.1,1.2,2.6,1.8.5.6.7,1.3.7,2.2Z',
  'M269.8,107.3h-2.8v-11h-3.6v-2.3h10v2.3h-3.6v11Z',
  'M275.7,91.4c0-.9.5-1.4,1.5-1.4s1.5.5,1.5,1.4-.1.8-.4,1c-.3.2-.6.4-1.1.4-1,0-1.5-.5-1.5-1.4ZM275.8,107.3v-13.3h2.8v13.3h-2.8Z',
  'M293.1,107.3h-3.2l-3.5-5.6-1.2.9v4.7h-2.8v-13.3h2.8v6.1l1.1-1.6,3.6-4.5h3.1l-4.6,5.9,4.7,7.4Z',
  'M219.9,120.4h5.3v6.9c-.9.3-1.7.5-2.4.6-.8.1-1.5.2-2.3.2-2,0-3.5-.6-4.6-1.8s-1.6-2.9-1.6-5.1.6-3.8,1.8-5,2.9-1.8,5.1-1.8,2.7.3,3.9.8l-.9,2.3c-1-.5-2-.7-3-.7s-2.2.4-2.9,1.2c-.7.8-1.1,1.9-1.1,3.3s.3,2.5.9,3.3,1.5,1.1,2.6,1.1,1.2,0,1.8-.2v-2.8h-2.5v-2.3Z',
  'M231.5,122.8v5.1h-2.8v-13.3h3.9c1.8,0,3.1.3,4,1,.9.7,1.3,1.7,1.3,3s-.2,1.5-.6,2.1c-.4.6-1,1.1-1.8,1.4,2,3,3.3,4.9,3.9,5.8h-3.1l-3.2-5.1h-1.5ZM231.5,120.5h.9c.9,0,1.5-.1,2-.4.4-.3.6-.8.6-1.4s-.2-1.1-.7-1.3-1.1-.4-2-.4h-.9v3.6Z',
  'M252.2,114.6v8.6c0,1-.2,1.8-.7,2.6-.4.7-1.1,1.3-1.9,1.7s-1.8.6-2.9.6c-1.7,0-3-.4-4-1.3-.9-.9-1.4-2.1-1.4-3.6v-8.6h2.8v8.1c0,1,.2,1.8.6,2.3.4.5,1.1.7,2,.7s1.6-.2,2-.7c.4-.5.6-1.2.6-2.3v-8.1h2.8Z',
  'M255.8,114.6h4.1c1.9,0,3.3.3,4.1.8.9.5,1.3,1.4,1.3,2.6s-.2,1.4-.6,2-.9.8-1.5.9h0c.8.3,1.5.6,1.8,1.1.4.5.6,1.2.6,2.1,0,1.2-.4,2.2-1.3,2.8-.9.7-2.1,1-3.6,1h-5v-13.3ZM258.7,119.8h1.6c.8,0,1.3-.1,1.7-.4.3-.2.5-.6.5-1.2s-.2-.9-.6-1.1c-.4-.2-1-.3-1.8-.3h-1.5v3ZM258.7,122.1v3.5h1.8c.8,0,1.3-.1,1.7-.4s.6-.8.6-1.4c0-1.1-.8-1.7-2.4-1.7h-1.7Z',
  'M279.5,114.6v8.6c0,1-.2,1.8-.7,2.6-.4.7-1.1,1.3-1.9,1.7s-1.8.6-2.9.6c-1.7,0-3-.4-4-1.3-.9-.9-1.4-2.1-1.4-3.6v-8.6h2.8v8.1c0,1,.2,1.8.6,2.3.4.5,1.1.7,2,.7s1.6-.2,2-.7c.4-.5.6-1.2.6-2.3v-8.1h2.8Z',
];

/**
 * The mark on its own.
 *
 * Used wherever the row is around 25–30 px tall — the console header, the auth
 * screens. The full lockup stacks its wordmark on three lines, which at that
 * height leaves roughly 7 px per line; the mark stays legible and the product
 * name sits beside it anyway.
 */
export function NetlogMark({ className, title = 'Netlog' }: { className?: string; title?: string }) {
  return (
    <svg viewBox={MARK_VIEW} role="img" aria-label={title} className={className} style={{ display: 'block' }}>
      <g fill="#FFC629" fillRule="evenodd">
        {MARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}

/** Mark plus the three-line wordmark. For places with vertical room. */
export function NetlogLogo({ className, title = 'Netlog Lojistik Grubu' }: { className?: string; title?: string }) {
  return (
    <svg viewBox={LOCKUP_VIEW} role="img" aria-label={title} className={className} style={{ display: 'block' }}>
      <g fill="#FFC629" fillRule="evenodd">
        {MARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <g fill="var(--dt-wordmark, rgb(240,240,240))">
        {WORDMARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}

/** Logo + hairline divider + product name — the lockup used in every header. */
export function BrandLockup({
  label,
  meta,
  // Height-driven: the mark is 94.9 × 69.8 in the asset, so a fixed width and
  // height would letterbox it inside its own box.
  logoClassName = 'h-[28px] w-auto',
  labelClassName = 'text-sm font-semibold tracking-[-0.01em]',
}: {
  label: string;
  meta?: string;
  logoClassName?: string;
  labelClassName?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-[10px] overflow-hidden">
      <NetlogMark className={`${logoClassName} shrink-0`} />
      <span className="h-5 w-px shrink-0 bg-border" />
      <span className={`${labelClassName} whitespace-nowrap text-fg`}>{label}</span>
      {meta ? (
        <span className="whitespace-nowrap font-mono text-[9px] tracking-[0.14em] text-muted-fg">{meta}</span>
      ) : null}
    </div>
  );
}
