# Phase 1: Landing - Research

**Researched:** 2026-04-28
**Domain:** Next.js 16 App Router landing page — UI, SEO metadata, Open Graph image generation
**Confidence:** HIGH

## Summary

The landing page (`apps/editor/app/page.tsx`) already exists and is fully implemented — it contains a complete dark-mode UI with hero section, bento feature grid, pricing, use-cases, how-it-works, and footer. It uses Framer Motion, Lucide, and Tailwind 4. The global `layout.tsx` already exports a `Metadata` object with `openGraph` title/description/url and Twitter card fields. What is NOT done: there is no `opengraph-image.tsx` file, so social share previews will render with no image (the `og:image` meta tag is absent). The landing page also links to `/apply` for sign-up and `/login` for sign-in — both of which exist — satisfying LAND-02.

The two workstreams map cleanly to the planned deliverables: (01-01) review/polish the existing landing UI and verify responsive layout, navigation links, and all CTAs work correctly; (01-02) add `app/opengraph-image.tsx` using `ImageResponse` from `next/og` (bundled with Next.js — no extra install) and wire up the `images` property in the existing metadata object.

**Primary recommendation:** Don't rebuild the landing — it's done. Plan 01-01 as an audit + polish task, and Plan 01-02 as a new `app/opengraph-image.tsx` file using the file-convention approach.

---

## Standard Stack

### Core (already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.2.1 | App Router, metadata API, ImageResponse | Framework — all SEO/OG built in |
| next/og (ImageResponse) | bundled with next | Server-side OG image generation | Official API, no extra package needed |
| framer-motion | 11 | Scroll/entrance animations | Already used throughout page.tsx |
| lucide-react | ^1.8.0 | Icons (hero, bento, nav) | Already used throughout |
| tailwindcss | ^4.2.1 | Utility styling | Project standard |
| geist | ^1.7.0 | Font variable (`--font-geist-sans`) | Already loaded in layout.tsx |

### No Additional Installs Needed

All libraries for Phase 1 are already present. `ImageResponse` is imported from `next/og`, which ships with Next.js 16 — no separate `@vercel/og` package required.

---

## Architecture Patterns

### Existing File Structure (what's already there)

```
apps/editor/app/
├── page.tsx                  # Landing page — FULLY IMPLEMENTED
├── layout.tsx                # Root layout — metadata object present, no og:image yet
├── _components/
│   └── HeroCanvas.tsx        # Three.js animated city mass (lazy-loaded)
├── login/                    # Exists (LAND-02 satisfied — Sign In link works)
├── apply/                    # Exists (LAND-02 satisfied — Get Started CTA works)
└── (no opengraph-image.tsx)  # MISSING — must be created
```

### What Must Be Created

```
apps/editor/app/
└── opengraph-image.tsx       # New file — OG image via ImageResponse
```

Optionally:
```
apps/editor/app/
└── twitter-image.tsx         # Can re-export same image or be omitted (og:image is read by Twitter too)
```

### Pattern 1: File-Convention OG Image (App Router)

**What:** Place `opengraph-image.tsx` in the `app/` directory. Next.js automatically generates `og:image` meta tags pointing to this route. The file exports `alt`, `size`, `contentType` constants and a default async function that returns `ImageResponse`.

**When to use:** Static landing page with no per-page dynamic content — build-time generation (cached, no request-time APIs).

**Example:**
```typescript
// Source: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image
// File: apps/editor/app/opengraph-image.tsx

import { ImageResponse } from 'next/og'

export const alt = 'Archly — Collaborative 3D Building Design'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#09090b',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ fontSize: 64, fontWeight: 800, color: '#fff', marginBottom: 16 }}>
          archly
        </div>
        <div style={{ fontSize: 28, color: '#a1a1aa', maxWidth: 700, textAlign: 'center' }}>
          Collaborative 3D Building Design. Powered by WebGPU.
        </div>
      </div>
    ),
    { ...size }
  )
}
```

**Generated head output:**
```html
<meta property="og:image" content="https://archly.cloud/opengraph-image" />
<meta property="og:image:alt" content="Archly — Collaborative 3D Building Design" />
<meta property="og:image:type" content="image/png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
```

### Pattern 2: Wiring images into existing Metadata object

The existing `layout.tsx` `openGraph` object lacks the `images` field. After adding `opengraph-image.tsx`, Next.js auto-injects the `og:image` tag — **no manual change to layout.tsx is required**. However, if explicit control over the URL is needed:

```typescript
// Source: https://nextjs.org/docs/app/api-reference/functions/generate-metadata
export const metadata: Metadata = {
  openGraph: {
    // ... existing fields ...
    images: [{ url: '/opengraph-image', width: 1200, height: 630 }],
  },
}
```

**Recommendation:** Let the file convention handle it automatically. Don't duplicate into layout.tsx unless the team wants an explicit absolute URL fallback.

### Anti-Patterns to Avoid

- **Using `@vercel/og` as a separate package:** `ImageResponse` is now bundled in `next/og`. Importing from `@vercel/og` still works but adds an unnecessary dependency.
- **Using inline styles from Tailwind in ImageResponse JSX:** `ImageResponse` uses Satori, which only supports a subset of CSS via inline `style` props. Tailwind class names are NOT processed. Always use `style={{}}` objects.
- **Flexbox is mandatory:** Satori requires `display: 'flex'` on every container. `grid`, `block`, etc. will not render correctly.
- **Placing opengraph-image.tsx in a subfolder for the root route:** It must be at `app/opengraph-image.tsx` (same level as `app/page.tsx`) to apply to the root `/` URL.
- **Adding `'use client'` to opengraph-image.tsx:** OG image routes must be Server Components (default). Adding `'use client'` breaks them.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OG image generation | Canvas-based server route, puppeteer screenshot | `ImageResponse` from `next/og` | Built into Next.js, cached at build time, outputs PNG, handles fonts |
| SEO meta tags | Manual `<head>` injection | Next.js `Metadata` export in layout.tsx | Already handles deduplication, templating, and `<head>` injection correctly |
| Responsive hero animations | Custom CSS keyframes | Framer Motion (already installed) | Already used in page.tsx — consistent approach |

**Key insight:** Both SEO and OG image generation are solved problems within Next.js 16's built-in APIs. Any custom implementation would duplicate functionality that the framework handles automatically, including caching, content-type headers, and `<head>` tag injection.

---

## Common Pitfalls

### Pitfall 1: Missing `metadataBase` causes relative OG image URLs

**What goes wrong:** Social platforms receive a relative URL like `/opengraph-image` instead of `https://archly.cloud/opengraph-image` and fail to fetch the image.

**Why it happens:** Next.js resolves OG image URLs relative to `metadataBase`. If it's unset, URLs are relative.

**How to avoid:** `metadataBase` is already set in `layout.tsx`: `new URL('https://archly.cloud')`. This is correct — no action needed.

**Warning signs:** OG debugger tools (Facebook Sharing Debugger, Twitter Card Validator) show "Could not fetch image."

### Pitfall 2: Tailwind classes silently ignored in ImageResponse

**What goes wrong:** JSX inside `ImageResponse` renders with no styles applied.

**Why it happens:** Satori (the underlying renderer) parses inline `style` props only. Tailwind's CSS classes don't exist at render time.

**How to avoid:** Use `style={{ display: 'flex', color: '#fff', ... }}` exclusively inside the `Image()` function return.

**Warning signs:** Image renders with default browser styles (black text on white background, no layout).

### Pitfall 3: Custom fonts not loading in ImageResponse

**What goes wrong:** Fallback system font used instead of Geist, breaking brand appearance.

**Why it happens:** `ImageResponse` runs in Edge/Node runtime and cannot access CSS font variables.

**How to avoid:** Load font as `ArrayBuffer` using `readFile` from `node:fs/promises` and pass to `fonts` option:
```typescript
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
const fontData = await readFile(join(process.cwd(), 'app/fonts/GeistVF.woff'))
new ImageResponse(<...>, { ...size, fonts: [{ name: 'Geist', data: fontData, weight: 700 }] })
```
The Geist font files already exist at `apps/editor/app/fonts/GeistVF.woff`.

**Warning signs:** OG image renders with a different font than the brand.

### Pitfall 4: Landing page has `'use client'` at top but uses scroll-based animations

**What goes wrong:** If any section is extracted into a Server Component and Framer Motion's `whileInView` or `useInView` is used, it will error on the server.

**Why it happens:** `page.tsx` is a Client Component (`'use client'`). Framer Motion hooks require client context.

**How to avoid:** Keep `page.tsx` as a Client Component (it already is). Do not try to split sections into Server Components to add RSC optimizations — the page is static content with no server-side data fetching needs.

### Pitfall 5: `/apply` CTA vs `/signup` route

**What goes wrong:** LAND-02 requires navigation to sign-up and log-in. The existing page links hero and pricing CTAs to `/apply` (not `/signup`). There is a `/signup` route in the app.

**Why it happens:** The page was built with an "apply for beta" flow. Requirements reference standard sign-up.

**How to avoid:** During the 01-01 audit task, verify whether `/apply` is the intended sign-up entrypoint or whether CTAs should point to `/signup`. The navbar already has a "Sign In" link to `/login`. The primary CTA `href` may need updating if product direction has changed.

---

## Code Examples

Verified patterns from official sources:

### Minimal OG image (static, no fonts)
```typescript
// Source: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image
// File: app/opengraph-image.tsx
import { ImageResponse } from 'next/og'

export const alt = 'Archly — Collaborative 3D Building Design'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function Image() {
  return new ImageResponse(
    <div style={{ background: '#09090b', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 48, fontWeight: 800 }}>
      archly
    </div>,
    { ...size }
  )
}
```

### OG image with local font (Geist already in project)
```typescript
// Source: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image (Node.js runtime example)
import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const alt = 'Archly — Collaborative 3D Building Design'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default async function Image() {
  const geistFont = await readFile(join(process.cwd(), 'app/fonts/GeistVF.woff'))
  return new ImageResponse(
    (
      <div style={{ background: '#09090b', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontFamily: 'Geist', fontSize: 72, fontWeight: 800, color: '#fff', marginBottom: 16 }}>archly</div>
        <div style={{ fontFamily: 'Geist', fontSize: 28, color: '#a1a1aa', textAlign: 'center', maxWidth: 700 }}>
          Collaborative 3D Building Design. Powered by WebGPU.
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: 'Geist', data: geistFont, style: 'normal', weight: 800 }] }
  )
}
```

### Existing metadata in layout.tsx (already correct — no changes needed)
```typescript
// Source: apps/editor/app/layout.tsx (verified in codebase)
export const metadata: Metadata = {
  title: { default: 'Archly — Collaborative 3D Building Design', template: '%s | Archly' },
  description: 'Design, collaborate, and deploy 3D buildings in real-time...',
  openGraph: {
    title: 'Archly — Collaborative 3D Building Design',
    description: 'Where teams build in 3D...',
    url: 'https://archly.cloud',
    siteName: 'Archly',
    type: 'website',
    // og:image will be injected automatically by opengraph-image.tsx file convention
  },
  twitter: { card: 'summary_large_image', title: '...', description: '...' },
  metadataBase: new URL('https://archly.cloud'), // ✓ correct — absolute OG image URLs
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@vercel/og` separate package | `ImageResponse` from `next/og` (bundled) | Next.js 13.3+ | No extra install needed |
| Manual `<head>` tags for metadata | `export const metadata` in layout/page | Next.js 13 App Router | Deduplication and templating handled by framework |
| `pages/_document.tsx` for OG | `app/opengraph-image.tsx` file convention | Next.js 13.3+ | Co-located with route, auto-cached at build |
| `params` as plain object in opengraph-image | `params` is now a Promise | **Next.js 16.0** | Must `await params` — breaking change vs. older docs |

**Deprecated/outdated:**
- Any tutorial using `import { ImageResponse } from '@vercel/og'`: outdated — use `next/og` instead.
- Any tutorial with `params` as a synchronous object in OG image routes: broken in Next.js 16 — `params` is now a Promise.

---

## Open Questions

1. **`/apply` vs `/signup` as the sign-up CTA destination**
   - What we know: The landing page CTAs point to `/apply`. A `/signup` route also exists. The nav "Sign In" points to `/login` (correct).
   - What's unclear: Is `/apply` the intended beta onboarding flow, or should primary CTAs point to `/signup`?
   - Recommendation: Planner should add a verification step in 01-01 to confirm with product which route the "Get Started Free" CTA should target. Research cannot resolve this without product intent.

2. **Twitter card image separate from OG image**
   - What we know: `twitter-image.tsx` is a separate file convention. The existing `twitter` metadata exports `card: 'summary_large_image'` but no image URL. Twitter will fall back to `og:image` if no `twitter:image` is set (per Twitter/X documentation).
   - What's unclear: Whether the fallback behavior is reliable across all Twitter card validators.
   - Recommendation: Create a single `opengraph-image.tsx`. Skip `twitter-image.tsx` unless Twitter preview testing reveals the fallback isn't working.

---

## Sources

### Primary (HIGH confidence)
- `https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image` — Verified as Next.js 16.2.4 docs, last updated 2026-04-10. Covers file convention, `ImageResponse`, exports (`alt`, `size`, `contentType`), and the v16.0 `params` Promise breaking change.
- `apps/editor/app/page.tsx` — Read directly. Full landing page implementation confirmed.
- `apps/editor/app/layout.tsx` — Read directly. Metadata object confirmed, `metadataBase` confirmed, no `og:image` present.
- `apps/editor/package.json` — Read directly. All versions confirmed.

### Secondary (MEDIUM confidence)
- WebSearch: "Next.js 15 opengraph-image.tsx ImageResponse file convention App Router 2025" — Multiple results confirming file-convention approach. Consistent with official docs.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions read directly from package.json and next.config.ts
- Architecture patterns: HIGH — OG image pattern from official Next.js 16 docs (dated 2026-04-10)
- Pitfalls: HIGH for Satori CSS limitation (official), MEDIUM for Twitter fallback behavior (not verified against X platform docs)

**Research date:** 2026-04-28
**Valid until:** 2026-05-28 (stable Next.js APIs; re-check if Next.js minor version changes)
