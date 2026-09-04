# Site design contract

The binding design rules for `apps/site`, distilled from the original redesign
spec. Read this before restyling anything; `AGENTS.md` covers commands and
workflow.

## Aesthetic (shadcn default, monochrome)

- Neutral base only — background/foreground, muted, border, ring. Color appears
  ONLY as semantic state (destructive for errors, green for success chips) and
  sparingly. No brand accent color.
- ui.shadcn.com docs feel: `text-sm` body, headings `font-semibold
  tracking-tight`, secondary text `text-muted-foreground`, generous vertical
  rhythm, inline code `bg-muted rounded px-[0.3rem] py-[0.2rem] font-mono`.
- "Less chrome, more content": separation via spacing, separators, and type
  hierarchy — not nested cards. **One-signal rule:** a surface is separated by
  border OR shadow OR fill, never stacked; max one bordered level per
  composition.
- Both themes are first-class (local class strategy, pre-hydration theme
  initializer, System/Light/Dark control). Every interactive state must hold
  contrast in BOTH themes.
- Elevation: demo stages and primary cards use the elevation scale
  (`src/styles/elevation.css`) with no border; header stays hairline border-b.
- Nested radii: inner = outer − padding (`rounded-lg p-1` → `rounded-md`
  children).

## Motion

- Tokens only: `--motion-instant/fast/base/moderate/slow` (50/150/200/280/380ms)
  and `--ease-out`; no ad-hoc durations. `transition-all` is BANNED — use
  `transition-colors`/`transform`/`shadow`.
- `:active { scale-[0.97] }` on buttons. All animation respects
  `prefers-reduced-motion` (including smooth scroll), falling back to plain
  fades.
- Parse choreography is the site's ONE flourish (it is the product): failed
  commit → danger border + 12%-alpha ring + decaying shake + error message in
  pre-reserved space; resolving parse → result tokens stagger in;
  superseded results exit blur+fade only. Transition-driven (interruptible per
  keystroke); keyframes only for the one-shot shake.

## Layout & content

- One page (`/docs`), scroll-to sections: sticky header (h-14, border-b,
  backdrop-blur), sidebar rail nav, content `max-w-3xl`, xl-only TOC.
- Demos sit in tinted stages (`bg-muted/40`, no border/shadow) with title,
  one-line caption, and copy affordance BELOW the stage.
- **Captions state the parser's RULE, not the widget** — one-line aphorisms:
  "1.9999 m is 6′7″, never 5′12″."
- Prose diet: behavioral present tense, ≤15 words per option description, no
  why-sections, no exclamation marks.
- No layout shift on state change: copy buttons and swapping badges reserve
  width; `tabular-nums` wherever a live value renders.
- Code blocks: shiki server-rendered, dual-theme via CSS variables
  (`defaultColor: false`), ring-shadow container, header row with filename +
  copy button (fixed-square icon, no width shift).

## Agent readiness

- `/llms.txt` — spec-compliant agent index (generated from `docs-catalog.ts`).
- `/llms-full.txt` — complete docs narrative as markdown (`src/lib/docs.md.ts`).
- `/llms-small.txt` — npm-shipped compressed reference (synced by `scripts/sync-site.mjs`).
- `/docs/<section>.md` — self-contained per-topic markdown slices.
- `/llms.md` — legacy full markdown export (compat); prefer `/llms-full.txt`.
- `<link rel="alternate" type="text/markdown">` and `text/plain` for `/llms.txt`.
