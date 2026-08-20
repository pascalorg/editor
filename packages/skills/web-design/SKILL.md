---
name: web-design
description: Web design reference for building production-grade interfaces. Covers layout, typography, color, spacing, shadows, animation, accessibility, responsive design, components, performance, and UX psychology. Use when building UI, reviewing design quality, choosing design tokens, or making any visual design decision.
metadata:
  author: pascalorg
  version: "1.0.0"
---

# Web Design

A practitioner-sourced reference for building web interfaces well. Synthesized from Refactoring UI, Tailwind CSS, shadcn/ui, Laws of UX, animations.dev, detail.design, Every Layout, Web Interface Guidelines, jakub.kr, userinterface.wiki (Raphael Salaja), and other authoritative sources.

Use this skill whenever you are building, reviewing, or improving a web interface.

## Implementation Priority

When building or reviewing a UI, work through these tiers in order. Each tier depends on the ones above it — fixing a shadow detail is wasted effort if the layout is broken.

### Tier 1: Structure (get this right first)

1. **Semantic HTML.** Correct elements (`<button>`, `<nav>`, `<main>`, headings in order). Everything else builds on this.
2. **Layout.** Grid/flex structure, spacing scale, content width constraints (`max-w-prose`, 12-col grid). Does the page hold together at every viewport?
3. **Responsive behavior.** Mobile-first, intrinsic sizing (`auto-fill` grids, `clamp()`, `flex-wrap`). No content hidden on small screens without reason.
4. **Typography fundamentals.** Type scale, line height (1.5 body, 1.1-1.25 headings), line length (`max-width: 65ch`), `rem` units for font sizes.

### Tier 2: Visual System (the design backbone)

5. **Color and contrast.** Palette applied, semantic tokens set, WCAG AA contrast met (4.5:1 text, 3:1 UI). Dark mode if needed.
6. **Visual hierarchy.** Four text levels working (foreground, muted, muted/70, muted/50). Primary action obvious. Squint test passes.
7. **Component states.** Every interactive element has hover, focus-visible, active, disabled, loading, error, and empty states accounted for.
8. **Spacing and proportion.** Outer padding >= inner padding. No ambiguous gaps. Button padding ratio (2x horizontal : 1x vertical). Input heights match button heights.

### Tier 3: Interaction and Motion (make it feel alive)

9. **Keyboard and accessibility.** Focus styles, tab order, skip links, `aria` attributes, touch targets (44px+). Test with keyboard only.
10. **Transitions.** Hover/active feedback (150ms ease-out), state transitions (200-300ms), correct easing per direction (ease-out for enter, ease-in for exit).
11. **Animation.** Stagger entrances, subtle exits, interruptible transitions, `prefers-reduced-motion` respected. Spring physics where appropriate.

### Tier 4: Polish (the last 10% that makes it feel crafted)

12. **Shadows and depth.** Layered shadows, shadows-instead-of-borders where appropriate, consistent light source. Dark mode: surface lightness instead of shadows.
13. **Optical adjustments.** Icon-side button padding, concentric border radii, play button offset, tabular-nums on data, image outlines.
14. **Micro-interactions.** Contextual icon animation, blur on stagger entrances, copy-to-clipboard feedback, optimistic updates.
15. **Defensive CSS.** `min-width: 0` on flex children, `overflow-wrap: break-word`, `scrollbar-gutter: stable`, text truncation, safe-area padding.
16. **Final checks.** Squint test, grayscale test, swap test, "would a human ship this?" test. No AI slop (gratuitous gradients, identical metric cards, centered everything).

**Rule of thumb:** If you're debating a shadow opacity while the layout breaks at 768px, stop and go back to Tier 1.

## Table of Contents

1. [Layout and Spacing](#1-layout-and-spacing)
2. [Typography](#2-typography)
3. [Color](#3-color)
4. [Shadows and Depth](#4-shadows-and-depth)
5. [Visual Hierarchy](#5-visual-hierarchy)
6. [Animation and Motion](#6-animation-and-motion)
7. [Components](#7-components)
8. [Responsive Design](#8-responsive-design)
9. [Accessibility](#9-accessibility)
10. [Performance](#10-performance)
11. [UX Psychology](#11-ux-psychology)
12. [Design Tokens](#12-design-tokens)
13. [Polish and Craft](#13-polish-and-craft)
14. [Microcopy and UX Writing](#14-microcopy-and-ux-writing)
15. [AI Slop Prevention](#15-ai-slop-prevention)
16. [Advanced Craft](#16-advanced-craft)
17. [Defensive CSS](#17-defensive-css)
18. [Modern CSS Reset](#18-modern-css-reset)
19. [Predictive Prefetching](#19-predictive-prefetching)
20. [Audio Feedback and Sound Design](#20-audio-feedback-and-sound-design)

---

## 1. Layout and Spacing

### Spacing Scale

Use a consistent mathematical scale rooted in a base unit. The standard base is **4px** (0.25rem). Every spacing value should be a multiple of this base.

| Token | Value | Use |
|-------|-------|-----|
| 0.5 | 2px | Hairline gaps, icon padding |
| 1 | 4px | Tight inline spacing |
| 1.5 | 6px | Small component internal padding |
| 2 | 8px | Default gap between related items |
| 3 | 12px | Compact card padding |
| 4 | 16px | Standard card/section padding |
| 5 | 20px | Comfortable padding |
| 6 | 24px | Section padding |
| 8 | 32px | Section gaps |
| 10 | 40px | Large section gaps |
| 12 | 48px | Page section spacing |
| 16 | 64px | Major page divisions |
| 20 | 80px | Hero spacing |
| 24 | 96px | Large hero spacing |

### Spacing Rules

- **Outer padding >= inner padding.** A card's outer margin must equal or exceed its internal padding. Interior elements relate more closely to each other than to external elements.
- **Proximity signals relationship.** Elements closer together are perceived as related (Gestalt Law of Proximity). Use spacing deliberately to group or separate.
- **Eliminate ambiguous spacing.** If the gap between two elements could belong to either, it's ambiguous. Make relationships clear through asymmetric spacing.
- **Eliminate dead zones.** Use padding on child elements instead of margins on containers. Every pixel between interactive items should be clickable.
- **Use consistent increments.** Don't pick arbitrary values. Constrain to the scale. Three similar spacings (14px, 16px, 18px) look like mistakes -- pick one.

### Layout Primitives

These CSS patterns create responsive layouts without media queries:

**Stack** -- Vertical flow with consistent gaps:
```css
.stack > * + * { margin-block-start: var(--space); }
```

**Cluster** -- Horizontal wrapping with gaps:
```css
.cluster { display: flex; flex-wrap: wrap; gap: var(--space); }
```

**Sidebar** -- Two columns where one is fixed:
```css
.sidebar { display: flex; flex-wrap: wrap; gap: var(--space); }
.sidebar > :first-child { flex-basis: 20rem; flex-grow: 1; }
.sidebar > :last-child { flex-basis: 0; flex-grow: 999; min-inline-size: 60%; }
```

**Grid (auto-fill)** -- Responsive columns without breakpoints:
```css
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr)); gap: var(--space); }
```

**Center** -- Constrained width with centering:
```css
.center { max-inline-size: var(--measure); margin-inline: auto; padding-inline: var(--space); }
```

### Grid and Flex Guidance

- Use **CSS Grid** for two-dimensional layouts (rows and columns together).
- Use **Flexbox** for one-dimensional layouts (single row or column).
- Prefer `fr` units over percentages in Grid -- `fr` distributes space after gaps, preventing overflow.
- Use `gap` instead of margins between items.
- A **12-column grid** provides maximum flexibility (divisible by 1, 2, 3, 4, 6).
- Set `min-width: 0` on flex children to prevent content overflow.
- Use `align-self: start` on sticky sidebar elements inside grid layouts.

### In Practice: Tailwind Layout Patterns

**Page shell with sidebar:**
```tsx
<div className="flex min-h-screen">
  <aside className="hidden lg:flex w-64 flex-col border-r bg-muted/40 p-4">
    <nav className="flex flex-col gap-1">{/* nav items */}</nav>
  </aside>
  <main className="flex-1 p-6">
    <div className="mx-auto max-w-4xl space-y-8">{children}</div>
  </main>
</div>
```

**Card grid that adapts without breakpoints:**
```tsx
<div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-4">
  {items.map(item => <Card key={item.id} {...item} />)}
</div>
```

**Content section with consistent vertical rhythm:**
```tsx
<section className="space-y-6 py-12">
  <h2 className="text-2xl font-semibold tracking-tight">Features</h2>
  <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
    {features.map(f => <FeatureCard key={f.id} {...f} />)}
  </div>
</section>
```

**Card with proper spacing hierarchy (outer > inner):**
```tsx
<div className="rounded-lg border bg-card p-6">      {/* outer: p-6 */}
  <div className="space-y-4">                          {/* inner gap: 4 */}
    <h3 className="font-semibold leading-tight">Title</h3>
    <p className="text-sm text-muted-foreground">Description text here.</p>
  </div>
</div>
```

---

## 2. Typography

### Type Scale

Use a mathematical ratio to generate harmonious font sizes. Choose the ratio based on context:

| Ratio | Name | Best For |
|-------|------|----------|
| 1.067 | Minor Second | Dense UI, dashboards |
| 1.125 | Major Second | Compact interfaces |
| 1.200 | Minor Third | General purpose (recommended default) |
| 1.250 | Major Third | Content-heavy sites |
| 1.333 | Perfect Fourth | Marketing, editorial |
| 1.414 | Augmented Fourth | Bold presentation |
| 1.500 | Perfect Fifth | Dramatic hierarchy |
| 1.618 | Golden Ratio | High-impact landing pages |

### Font Size Rules

- **Body text minimum: 16px (1rem).** This is the browser default. Never go smaller for primary reading content.
- **Use `rem` for font sizes.** This respects both browser zoom and the user's default font size preference. Pixels prevent users from scaling text.
- **Use `rem` for media queries.** When users increase their default font size, rem-based breakpoints trigger mobile layouts on wider screens, giving them more room.
- **Use `px` for padding, borders, and decorative elements.** These shouldn't scale with text size.
- **Use `rem` for vertical margins.** Spacing between paragraphs should grow with text.

### Fluid Typography

Use `clamp()` for responsive sizing that scales smoothly between breakpoints:

```css
/* Heading: 32px on small screens, 48px on large, fluid between */
font-size: clamp(2rem, 1.5rem + 2vw, 3rem);
```

Define a small-screen scale (e.g., 1.2x at 320px) and a large-screen scale (e.g., 1.333x at 1500px). The browser interpolates between them.

### Line Height

- **Body text: 1.5.** This meets WCAG criteria and improves readability for all users.
- **Headings: 1.1 - 1.25.** Larger text needs tighter leading.
- **The bigger the text, the less line-height it needs.** Scale inversely.
- **Headings and buttons: 1.1** is a good default.

### Line Length

- **Optimal: 60-75 characters** (about 8-10 words per line).
- **Maximum: 80 characters.** Beyond this, readers lose their place.
- **Use `max-width: 65ch`** on content containers to enforce this.

### Letter Spacing

- **Large text: reduce letter-spacing.** Bigger text needs less space between characters.
- **Small text: increase letter-spacing slightly.**
- **All-caps text: add +0.05 to +0.1em letter-spacing.** Uppercase letters crowd each other without extra space.
- **Use `font-variant-numeric: tabular-nums`** in tables and timers so digits maintain consistent width.

### Text Wrapping

```css
/* Balanced line breaks for headings */
h1, h2, h3, h4, h5, h6 { text-wrap: balance; }

/* Avoid orphans in paragraphs */
p { text-wrap: pretty; }

/* Prevent overflow from long words/URLs */
p, h1, h2, h3, h4, h5, h6 { overflow-wrap: break-word; }
```

### Font Rendering

```css
body { -webkit-font-smoothing: antialiased; }
html { text-rendering: optimizeLegibility; -webkit-text-size-adjust: 100%; }
```

### Font Weight

- Never use weights below 400 -- they become illegible on most screens.
- Use 500-600 for medium headings.
- Use 700 for strong emphasis.
- **Prevent layout shift from weight changes:** Use a hidden `::after` pseudo-element with bold text to reserve the bold width, preventing jitter when toggling active states.

### OpenType Features

Modern fonts ship with OpenType features that dramatically improve typographic quality. Enable them intentionally:

| Feature | CSS | Use |
|---------|-----|-----|
| Tabular numbers | `font-variant-numeric: tabular-nums` | Tables, dashboards, pricing, timers -- equal-width digits align in columns |
| Oldstyle numbers | `font-variant-numeric: oldstyle-nums` | Body text/prose -- digits with ascenders/descenders blend with lowercase |
| Slashed zero | `font-variant-numeric: slashed-zero` | Code-adjacent UIs, IDs, error codes -- disambiguate 0 from O |
| Proper fractions | `font-variant-numeric: diagonal-fractions` | Recipes, specs -- converts 1/2 to typographic fraction |
| Contextual alternates | `font-feature-settings: "calt" 1` | Usually on by default -- keep enabled for smart glyph adjustments |
| Disambiguation set | `font-feature-settings: "ss02"` | Code UIs -- distinguish I/l/1 and 0/O (font-dependent) |

```css
/* Data display: aligned, disambiguated */
.data { font-variant-numeric: tabular-nums slashed-zero; }

/* Prose: numbers that blend with text */
.prose { font-variant-numeric: oldstyle-nums; }

/* Code-adjacent UI */
.code-ui { font-variant-numeric: tabular-nums slashed-zero; font-feature-settings: "ss02"; }
```

- **`font-optical-sizing: auto`** -- leave at default. The font adjusts glyph shapes per size (thicker strokes at small sizes, finer details at large).
- **`font-synthesis: none`** -- disable to prevent the browser from generating faux bold/italic when the font lacks those weights. Forces you to load proper font files.
- **Variable fonts accept any weight 100-900**, not just standard stops. Use precise values like 450 or 550 for fine-grained hierarchy without loading extra files.
- **`text-decoration-skip-ink: auto`** is the default and correctly skips descenders. Add `text-underline-offset: 3px` to push underlines below descenders for cleaner links.

### Typeface Pairing

- **Limit to two typefaces.** One for headings, one for body. A second typeface should reinforce the design concept.
- A monospace third face for code is acceptable.
- If using a single typeface, differentiate hierarchy through weight, size, and color instead.

### In Practice: Next.js + Tailwind Typography

**Font setup in `app/layout.tsx`:**
```tsx
import { Inter, JetBrains_Mono } from "next/font/google"

const sans = Inter({ subsets: ["latin"], variable: "--font-sans" })
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" })

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
```

**Tailwind type scale in use (shadcn conventions):**
```tsx
{/* Page heading */}
<h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Dashboard</h1>

{/* Section heading */}
<h2 className="text-2xl font-semibold tracking-tight">Recent Activity</h2>

{/* Card title */}
<h3 className="font-semibold leading-tight">Monthly Revenue</h3>

{/* Body text with constrained width */}
<p className="max-w-prose text-muted-foreground">
  Your revenue increased 12% compared to last month.
</p>

{/* Small label */}
<span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
  Status
</span>

{/* Tabular numbers in a data display */}
<td className="tabular-nums text-right font-medium">$12,450.00</td>
```

---

## 3. Color

### Color System Structure

A working palette needs three categories:

1. **Neutrals (Greys):** 8-10 shades. Used for text, backgrounds, panels, form controls -- almost everything.
2. **Primary Colors:** 1-2 colors for primary actions, navigation, and branding. 5-10 shades each.
3. **Accent/Semantic Colors:** Red (destructive/error), yellow/amber (warning), green/emerald (success), blue (info). 5-10 shades each.

### The 9-Shade System

For each color, define 9 shades numbered 50-900:

| Shade | Use |
|-------|-----|
| 50 | Subtle tinted backgrounds |
| 100 | Hover backgrounds, light fills |
| 200 | Active backgrounds, badges |
| 300 | Borders, rings |
| 400 | Placeholder text, disabled states |
| 500 | Primary buttons, icons, links |
| 600 | Hover on primary buttons |
| 700 | Active/pressed states |
| 800 | Heading text on light backgrounds |
| 900 | Body text on light backgrounds |
| 950 | Darkest shade for high contrast |

### Color Format

- **Use OKLCH** as the primary color format. It's perceptually uniform (colors at the same lightness actually look equally light), supported in all modern browsers, and used by Tailwind v4 and shadcn/ui. Format: `oklch(lightness chroma hue)`.
- **HSL** remains a solid alternative when OKLCH tooling is unavailable. It's intuitive: adjusting lightness creates shades, adjusting saturation creates tints.
- **Store color channels as CSS variables** for maximum flexibility:

```css
:root {
  /* OKLCH approach (preferred) */
  --primary: oklch(62% 0.21 260);

  /* HSL approach (alternative) */
  --primary-h: 221;
  --primary-s: 72%;
  --primary-l: 62%;
  --primary-hsl: hsl(var(--primary-h) var(--primary-s) var(--primary-l));
}
```

### Color Rules

- **Use near-black and near-white, not pure.** Pure black (#000) on pure white (#fff) creates uncomfortable contrast. Use `#0a0a0a` / `#111` and `#fafafa` / `#f5f5f5` instead.
- **Saturate your neutrals.** Add a hint of your primary hue to grey tones (keep saturation under 5% in HSB). This creates palette cohesion.
- **Maintain consistent color temperature.** Use either warm or cool tinted neutrals, not both.
- **Colors must differ in brightness, not just hue.** Two colors at the same lightness compete visually. Vary brightness to create distinction.
- **Rotate hue for vibrant variants.** When creating lighter shades, rotate hue toward a brighter anchor (yellow, cyan). For darker shades, rotate toward a deeper anchor (blue, violet). This prevents washed-out pastels.
- **Don't rely on color alone to convey meaning.** Always pair color with text, icons, or patterns for accessibility.
- **Use `color-mix()` for dynamic variations:**
```css
background: color-mix(in oklch, var(--primary), transparent 95%);
```

### Dark Mode

- Swap light and dark values (900 becomes foreground, 50 becomes background).
- Don't just invert -- dark backgrounds need reduced contrast. Container brightness should differ from background by max 12%.
- Avoid pure white text on dark backgrounds. Use near-white (e.g., `#e5e5e5`).
- Shadows are ineffective in dark mode -- use subtle borders or lighter elevated surfaces instead.
- Respect `prefers-color-scheme` as the default. Don't add a theme toggle unless specifically needed.

### In Practice: shadcn/ui Theming

**`app/globals.css` -- semantic color tokens (shadcn/ui pattern):**
```css
@layer base {
  :root {
    --background: oklch(1 0 0);
    --foreground: oklch(0.145 0 0);
    --card: oklch(1 0 0);
    --card-foreground: oklch(0.145 0 0);
    --primary: oklch(0.205 0 0);
    --primary-foreground: oklch(0.985 0 0);
    --secondary: oklch(0.965 0 0);
    --secondary-foreground: oklch(0.205 0 0);
    --muted: oklch(0.965 0 0);
    --muted-foreground: oklch(0.556 0 0);
    --accent: oklch(0.965 0 0);
    --accent-foreground: oklch(0.205 0 0);
    --destructive: oklch(0.577 0.245 27.325);
    --border: oklch(0.922 0 0);
    --input: oklch(0.922 0 0);
    --ring: oklch(0.708 0 0);
    --radius: 0.625rem;
  }
  .dark {
    --background: oklch(0.145 0 0);
    --foreground: oklch(0.985 0 0);
    --card: oklch(0.205 0 0);
    --card-foreground: oklch(0.985 0 0);
    --primary: oklch(0.985 0 0);
    --primary-foreground: oklch(0.205 0 0);
    --muted: oklch(0.269 0 0);
    --muted-foreground: oklch(0.708 0 0);
    --border: oklch(0.269 0 0);
  }
}
```

**Dark mode toggle with `next-themes` (only add when users need manual control; system preference is the default):**
```tsx
// app/layout.tsx
import { ThemeProvider } from "next-themes"

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}

// components/theme-toggle.tsx
"use client"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import { Moon, Sun } from "lucide-react"

export function ThemeToggle() {
  const { setTheme, theme } = useTheme()
  return (
    <Button variant="ghost" size="icon"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-[transform,opacity] dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-[transform,opacity] dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
```

---

## 4. Shadows and Depth

### Shadow Principles

- **Single consistent light source.** All shadows should share the same angle ratio (typically above and slightly left). Every shadow on the page must use the same offset ratio.
- **Elevation mapping.** As elements rise: offset increases, blur grows, opacity decreases. This mimics physical light behavior.
- **Layer multiple shadows for realism.** A single `box-shadow` looks flat. Stack 2-5 layers with geometrically increasing values. (Shadow color uses HSL below for readability; any color format works.)

```css
/* Low elevation */
box-shadow: 0 1px 2px hsl(var(--shadow-color) / 0.3);

/* Medium elevation */
box-shadow:
  0 1px 2px hsl(var(--shadow-color) / 0.2),
  0 2px 4px hsl(var(--shadow-color) / 0.2),
  0 4px 8px hsl(var(--shadow-color) / 0.2);

/* High elevation */
box-shadow:
  0 1px 2px hsl(var(--shadow-color) / 0.12),
  0 2px 4px hsl(var(--shadow-color) / 0.12),
  0 4px 8px hsl(var(--shadow-color) / 0.12),
  0 8px 16px hsl(var(--shadow-color) / 0.12),
  0 16px 32px hsl(var(--shadow-color) / 0.12);
```

- **Match shadow color to the environment.** Don't use pure black/grey shadows -- tint them with the background's hue for vibrant, natural depth.
- **Shadow blur = 2x shadow distance.** A 4px vertical offset pairs with 8px blur.
- **Elements closer to the user appear lighter.** Mimic real-world light: surfaces near the light source are brighter.
- **Avoid shadows in dark interfaces.** They lack visual logic. Use subtle borders or surface lightness variation instead.
- **Don't mix depth techniques.** Pick one approach (shadows, borders, or surface lightness) and use it consistently.
- **Never animate layered shadows directly.** It's too expensive. Instead, animate `opacity` between two shadow states using pseudo-elements.

### Border Radius

- **Nest corner radii correctly.** Inner radius = outer radius - gap between elements. If outer is 12px and padding is 8px, inner should be 4px.
- **Container borders need dual contrast.** They must be distinguishable from both the container's background and the page background.

### Shadows Instead of Borders

Subtle layered `box-shadow` adds depth better than solid borders and adapts to any background through transparency:

```css
/* Multi-shadow composition — replaces border with soft depth */
box-shadow:
  0px 0px 0px 1px rgba(0, 0, 0, 0.06),
  0px 1px 2px -1px rgba(0, 0, 0, 0.06),
  0px 2px 4px 0px rgba(0, 0, 0, 0.04);

/* Hover: slightly increase opacity for lift effect */
box-shadow:
  0px 0px 0px 1px rgba(0, 0, 0, 0.08),
  0px 1px 2px -1px rgba(0, 0, 0, 0.08),
  0px 2px 4px 0px rgba(0, 0, 0, 0.06);
```

- The first layer (`0px 0px 0px 1px`) acts as the border replacement — a zero-blur spread gives a crisp 1px edge.
- Works on image backgrounds and color backgrounds where solid `border-color` would clash.
- Transition `box-shadow` on hover for interactive lift. Use `transition: box-shadow 150ms ease` (or Tailwind's `transition-shadow`).

### Image Outlines

Add a 1px outline to images for consistent visual framing and depth:

```css
img {
  outline: 1px solid rgba(0, 0, 0, 0.1);
  outline-offset: -1px;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  img { outline-color: rgba(255, 255, 255, 0.1); }
}
```

This is simpler than the inset ring technique and works on any `<img>` directly. Use `outline-offset: -1px` so the outline sits inside the image bounds.

### In Practice: Tailwind Shadow and Depth

**Elevation classes from Tailwind mapped to use cases:**
```tsx
{/* Flat surface — default cards */}
<div className="rounded-lg border bg-card shadow-sm">

{/* Raised — hover state, dropdown trigger */}
<div className="rounded-lg border bg-card shadow-md hover:shadow-lg transition-shadow">

{/* Floating — dropdowns, popovers, command palette */}
<div className="rounded-xl border bg-popover shadow-xl">

{/* Dialog/modal backdrop + elevated panel */}
<div className="fixed inset-0 bg-black/50 backdrop-blur-sm">
  <div className="rounded-xl border bg-card shadow-2xl">
```

**Shadow instead of border (card with hover lift):**
```tsx
<div className="rounded-lg bg-card p-4
  shadow-[0px_0px_0px_1px_rgba(0,0,0,0.06),0px_1px_2px_-1px_rgba(0,0,0,0.06),0px_2px_4px_0px_rgba(0,0,0,0.04)]
  hover:shadow-[0px_0px_0px_1px_rgba(0,0,0,0.08),0px_1px_2px_-1px_rgba(0,0,0,0.08),0px_2px_4px_0px_rgba(0,0,0,0.06)]
  transition-shadow">
  <h3 className="font-semibold">No border needed</h3>
  <p className="text-sm text-muted-foreground">Shadow provides the edge.</p>
</div>
```

**Image with inset outline (simple approach):**
```tsx
<img
  src={src} alt={alt}
  className="rounded-lg outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
/>
```

**Nested border radius (card with inner image):**
```tsx
{/* Outer: rounded-xl (12px), padding: p-2 (8px), so inner = 12-8 = 4px = rounded-sm */}
<div className="rounded-xl border bg-card p-2">
  <img className="rounded-sm w-full" src={src} alt={alt} />
  <div className="p-3">
    <h3 className="font-semibold">Title</h3>
  </div>
</div>
```

---

## 5. Visual Hierarchy

### Core Principles

- **Size, weight, and color communicate importance.** Primary content is larger, bolder, and higher contrast. Secondary content is smaller, lighter, and lower contrast.
- **De-emphasize secondary content instead of over-emphasizing primary content.** It's more effective to make supporting elements quieter than to make everything louder.
- **Semantic hierarchy != visual hierarchy.** An `<h2>` doesn't always need to look like a big heading. Style for the role the content plays in the layout, not its HTML tag.
- **Reduce label reliance.** When context makes meaning clear, labels are redundant. "john@example.com" doesn't need an "Email:" label -- the format itself communicates.
- **Use weight and contrast as separate levers.** Bold dark text and regular grey text occupy different hierarchy levels. Combining size + weight + color gives you three independent hierarchy controls.
- **High contrast for important elements, low contrast for structural elements.** Draw attention to actions and content, not chrome and borders.

### Visual Weight Ordering

- Arrange series of elements in descending visual weight. The heaviest element sits at the outer edge.
- Use fewer borders. Replace borders with spacing, background color differences, or shadows for cleaner separation.
- **Accent borders (3-5px)** on one edge of a card or callout add visual interest and hierarchy without heavy separation.

### Alignment

- **Align everything with something.** Alignment shows that elements are related and that placement is intentional.
- **Prefer optical alignment over mathematical.** Triangular shapes (play buttons, arrows) have visual centers that differ from their geometric centers. Trust your eyes.
- **Measure spacing between high-contrast points.** Eyes find element edges based on contrast, not bounding boxes.

### Four-Level Text Hierarchy

Every interface needs exactly four text levels. More creates noise, fewer creates flatness:

```tsx
{/* Level 1: Primary — the main content the user came to see */}
<p className="text-foreground">Invoice #1234 — $2,400.00</p>

{/* Level 2: Secondary — supporting info that adds context */}
<p className="text-muted-foreground">Due March 15, 2026</p>

{/* Level 3: Tertiary — metadata, timestamps, IDs */}
<span className="text-xs text-muted-foreground/70">Created 2 days ago</span>

{/* Level 4: Muted — disabled, placeholder, non-essential */}
<span className="text-xs text-muted-foreground/50">Optional</span>
```

### Surface Elevation (Dark Mode Depth)

In dark mode, shadows are invisible. Instead, use lightness shifts to create depth. Each elevated layer gets a few percentage points brighter:

```tsx
{/* Level 0: Page background */}
<div className="bg-background">                        {/* darkest */}
  {/* Level 1: Card surface */}
  <div className="bg-card">                             {/* slightly lighter */}
    {/* Level 2: Dropdown / popover on top of card */}
    <div className="bg-popover">                         {/* lighter still */}
    </div>
  </div>
</div>
```

The lightness difference between levels should be subtle (2-5% in OKLCH lightness). Larger jumps fragment the interface into disconnected "worlds."

### Quality Checks

- **Squint test.** Blur your eyes and look at the page. Hierarchy should still be visible -- headings distinct from body, primary actions distinct from secondary.
- **Swap test.** If you replaced the typeface with a system font, would the design still hold? If not, the hierarchy depends on the font, not the structure.
- **Grayscale test.** Convert to grayscale. If elements that were distinct now merge, you're relying on hue alone (an accessibility failure).

---

## 6. Animation and Motion

### When to Animate

- **Feedback:** Confirm that the system recognized an action (button press, form submit, toggle).
- **State transitions:** Signal changes between interface modes or views.
- **Spatial navigation:** Help users understand their position in a hierarchy (zoom = depth, slide = lateral movement).
- **Signifiers:** Show how to interact with an element (drag direction, swipeable area).

### When NOT to Animate

- **High-frequency interactions.** Actions performed many times daily should feel instant -- no animation.
- **Keyboard-initiated actions.** These should be immediate and feel connected to the input.
- **When performance suffers.** A janky animation is worse than no animation. 60fps or nothing.
- **Repetitive daily-use elements.** Animations seen repeatedly throughout the day become annoying.
- **Gratuitous motion.** If it doesn't clarify interaction or explain functionality, remove it.

### Easing Functions

| Easing | Use For |
|--------|---------|
| `ease-out` | Elements entering the screen, appearing, expanding. **Default choice.** |
| `ease-in-out` | Elements moving while already visible on screen. |
| `ease` | Hover effects, color transitions. |
| `linear` | Continuous/looping animations only (spinners, progress fills). |
| `ease-in` | Elements leaving the screen. Never for elements that remain visible. |

Custom curves are strongly preferred over built-in CSS easings. Example production curve: `cubic-bezier(0.32, 0.72, 0, 1)` (iOS sheet behavior, used at 500ms).

### Duration Guidelines

| Context | Duration |
|---------|----------|
| Hover effects | 100-150ms |
| Button press feedback | ~160ms |
| Tooltip enter/exit | ~125ms |
| Dropdown/select open | ~180ms |
| General UI transitions | 150-300ms |
| Toast notifications | ~400ms |
| Drawer/sheet open | ~500ms |
| Hold-to-confirm (destructive) | 2000ms (safety) |
| Hold release feedback | 200ms |

- **Asymmetric timing for safety:** Slow, predictable timing for destructive actions paired with fast release feedback.
- **Entry != exit.** Differentiate enter vs. exit animations. Entry should feel decisive; exit should feel natural.
- **Exit animations should be subtler than entrances.** Use less movement on exit — a fixed small value (e.g., `y: -12px`) instead of the full distance (e.g., `y: calc(-100% - 4px)`). The exiting element needs just enough motion for directional indication, not a full departure animation. Add a light `blur(4px)` on exit to soften the disappearance.

### Animation Techniques

**Scale on press:** `scale(0.97)` on `:active` for instant tactile feedback.

**Never scale from 0.** Start from `scale(0.9)` or higher. Even a deflated balloon has a visible shape.

**Origin-aware popover:** Scale from the trigger point using `transform-origin`, not center.

**Tooltip delay pattern:** First tooltip shows with delay. Subsequent tooltips while hovering appear instantly.

**Blur as rescue:** When easing adjustments still feel off, add `filter: blur(2px)` during the transition.

**Use `clip-path` for reveals:** Hardware-accelerated with no layout shifts. `clip-path: inset(0 0 100% 0)` to `inset(0 0 0 0)`.

**Make animations interruptible.** CSS transitions interpolate toward the latest state and can be interrupted mid-action — use them for interactions (hovers, toggles, drags). CSS keyframe animations run a fixed timeline and cannot retarget — use them for staged sequences that play once (page load entrances, celebration effects). Users change intent mid-interaction; interruptible animations feel responsive, non-interruptible ones feel broken.

**Animate icons contextually.** When icons appear or disappear conditionally (e.g., a checkmark replacing a copy icon), animate `opacity`, `scale`, and `blur` together for a smooth transition instead of an instant swap. Use spring physics or short transitions (150-200ms). This applies to any element that swaps in/out based on state.

### Staging and Choreography (from Disney's 12 Principles)

- **One focal point at a time.** Only one element should animate prominently. If two things move simultaneously, the eye doesn't know where to look.
- **Context menus animate on exit only, not entrance.** They should appear instantly and animate away.
- **Squash and stretch range: 0.95-1.05 scale.** Anything beyond looks cartoonish in UI.
- **Stagger delays: max 50ms per item.** Longer stagger feels sluggish. For a 5-item list: 0ms, 50ms, 100ms, 150ms, 200ms.
- **Split and stagger for impact.** Instead of animating an entire block at once, break it into smaller chunks (sections, lines, even words) and animate each individually. Combine `opacity`, `blur(4-5px)`, and `translateY(6-8px)` for the initial state. Use CSS custom properties for clean stagger control: `animation-delay: calc(var(--stagger-delay, 80ms) * var(--stagger-index, 0))`. Three tiers of granularity: container-level (simple), section-level (balanced), word-level (dramatic).
- **Dim backgrounds on overlays.** Darkened backdrops direct focus to the foreground element.
- **Use spring physics for bounce-and-settle effects.** Don't fake it with easing curves. Framer Motion `type: "spring"` with `stiffness: 300, damping: 20` is a good starting point.

### Properties Safe to Animate

- `transform` (translate, rotate, scale) -- GPU-accelerated
- `opacity` -- GPU-accelerated
- `clip-path` -- GPU-accelerated

### Properties to Avoid Animating

- `width`, `height`, `padding`, `margin` -- triggers layout recalculation
- `top`, `left`, `right`, `bottom` -- triggers layout recalculation
- `background-color` -- triggers repaint (expensive)

### Performance Ranking

1. CSS Animations/Transitions (best -- runs off main thread)
2. Web Animations API (good -- survives main-thread congestion)
3. JavaScript `requestAnimationFrame` (worst -- lags when browser is busy)

### Accessibility

Always respect `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### In Practice: Tailwind + Framer Motion

**Button with press feedback (CSS only, Tailwind).** Duration matches the ~160ms guideline (Tailwind's closest: `duration-150`):
```tsx
<button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground
  transition-[background-color,transform] duration-150 ease-out
  hover:bg-primary/90
  active:scale-[0.97]">
  Save Changes
</button>
```

**Animated dialog with Framer Motion + shadcn:**
```tsx
"use client"
import { motion, AnimatePresence } from "motion/react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

export function AnimatedDialog({ open, onOpenChange, children }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogContent forceMount asChild>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
            >
              {children}
            </motion.div>
          </DialogContent>
        )}
      </AnimatePresence>
    </Dialog>
  )
}
```

**Staggered list entrance:**
```tsx
import { motion } from "motion/react"

export function StaggeredList({ items }) {
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <motion.li key={item.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05, duration: 0.25, ease: "easeOut" }}
          className="rounded-lg border bg-card p-4"
        >
          {item.label}
        </motion.li>
      ))}
    </ul>
  )
}
```

**Staggered entrance with blur (CSS-only, higher impact):**
```css
@keyframes stagger-in {
  from {
    opacity: 0;
    filter: blur(5px);
    transform: translateY(8px);
  }
}

.stagger-item {
  animation: stagger-in 800ms cubic-bezier(0.25, 0.46, 0.45, 0.94) both;
  animation-delay: calc(var(--stagger-index, 0) * 80ms);
}
```
```tsx
{/* Assign --stagger-index per element */}
<div className="stagger-item" style={{ "--stagger-index": 0 } as React.CSSProperties}>Section 1</div>
<div className="stagger-item" style={{ "--stagger-index": 1 } as React.CSSProperties}>Section 2</div>
<div className="stagger-item" style={{ "--stagger-index": 2 } as React.CSSProperties}>Section 3</div>
```

**Subtle exit animation (Framer Motion — less motion than entrance):**
```tsx
<AnimatePresence>
  {show && (
    <motion.div
      initial={{ opacity: 0, y: 8, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -12, filter: "blur(4px)" }}
      transition={{ type: "spring", duration: 0.45, bounce: 0 }}
    >
      {children}
    </motion.div>
  )}
</AnimatePresence>
```

**Skeleton loading with Tailwind animate-pulse:**
```tsx
function CardSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-3 w-full animate-pulse rounded bg-muted" />
      <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
    </div>
  )
}
```

### Spring Physics vs Easing Decision Framework

Choose the right timing model based on what drives the motion:

| Motion Type | Use | Why |
|-------------|-----|-----|
| User-driven (drag, flick, swipe) | Spring | Survives interruption, preserves velocity |
| System-driven (state change, feedback) | Easing | Clear start/end, predictable timing |
| Time representation (progress, loading) | Linear | 1:1 relationship between time and progress |
| High-frequency (typing, fast toggles) | None | Animation adds noise, feels slower |
| Keyboard-initiated actions | None | Must feel instant and connected to input |

**Spring parameter guidance:** Start with `stiffness: 300, damping: 20` (slight bounce) or `stiffness: 500, damping: 30` (snappy, minimal overshoot). Avoid `damping < 10` with high stiffness -- creates excessive oscillation. Always pass `velocity` from drag events to preserve input energy:

```tsx
onDragEnd={(e, info) => {
  animate(target, { x: 0 }, {
    type: "spring",
    velocity: info.velocity.x,
    stiffness: 500,
    damping: 30,
  });
}}
```

**When an animation feels slow**, shorten the duration first -- don't change the easing curve. The duration is almost always the problem.

### Container Bounds Animation

Animating `width` or `height` triggers layout recalculation. Use this pattern instead:

**Two-div pattern:** Outer div animates (via `motion.div`), inner div measures (via ref). Never measure and animate the same element -- it creates a feedback loop.

```tsx
function AnimatedContainer({ children }) {
  const [ref, bounds] = useMeasure()
  return (
    <motion.div
      animate={{ height: bounds.height }}
      transition={{ duration: 0.2, delay: 0.05 }}
      style={{ overflow: "hidden" }}>
      <div ref={ref}>{children}</div>
    </motion.div>
  )
}
```

**Measurement hook using ResizeObserver** (not `getBoundingClientRect` which causes layout thrashing):

```tsx
function useMeasure() {
  const [element, setElement] = useState(null)
  const [bounds, setBounds] = useState({ width: 0, height: 0 })
  const ref = useCallback((node) => setElement(node), [])

  useEffect(() => {
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setBounds({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return [ref, bounds]
}
```

- Use **callback ref** (not `useRef`) so the observer attaches when the DOM node is ready.
- Set `overflow: hidden` on the animated container to clip content during transitions.
- Guard `bounds === 0` on initial render -- fall back to `"auto"` height.
- **Use sparingly:** buttons, accordions, expandable sections. Not every container.

### AnimatePresence Deep Patterns

- **`mode="wait"` doubles perceived duration** because exit completes before enter starts. Halve your timing values when using it.
- **`mode="sync"` causes layout conflicts** -- entering and exiting elements coexist briefly. Use `popLayout` for list reordering instead.
- **Disable interactions on exiting elements.** Use `useIsPresent()` and set `disabled={!isPresent}` or `pointer-events: none` on elements during their exit animation -- otherwise users click elements that are animating away.
- **Nested AnimatePresence** needs the `propagate` prop so parent exit triggers child exits.
- **Exit should mirror initial** for symmetric feel, but use less motion on exit (fixed small `y: -12px` instead of full distance, add `blur(4px)` to soften).

### View Transitions API

For page-level and cross-document transitions, prefer the native View Transitions API over JS animation libraries:

```css
/* 1. Assign unique transition names to elements that persist across views */
.hero-image { view-transition-name: hero; }
.page-title { view-transition-name: title; }

/* 2. Style the transition pseudo-elements */
::view-transition-group(hero) {
  animation-duration: 300ms;
  animation-timing-function: cubic-bezier(0.32, 0.72, 0, 1);
}
```

- Every `view-transition-name` must be **unique during a transition** (no two elements can share the same name simultaneously).
- **Clean up transition names** after completion if they were dynamically assigned.
- Falls back gracefully in unsupported browsers -- the page just navigates without animation.

---

## 7. Components

### Component Philosophy

- **Copy and own, don't install.** The shadcn/ui model: components are source code you paste into your project and customize, not opaque npm packages. You own the code.
- **Build on accessible primitives.** Use headless UI libraries (Radix, Base UI, React Aria) for behavior, then style with your own design tokens.
- **Compound component pattern.** Break complex components into composable parts: `Dialog.Root`, `Dialog.Trigger`, `Dialog.Content`, `Dialog.Title`. Each part is independently addressable.
- **Use `cn()` for class logic.** The `clsx` + `tailwind-merge` utility is standard in the shadcn/ui ecosystem for conditionally merging Tailwind classes:
```ts
// lib/utils.ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
```
- **Expose component APIs via CSS variables.** Components accept customization through CSS custom properties, not endless prop variants:
```css
.button { background: var(--button-bg, var(--primary)); }
```

### Component Design Tokens (shadcn/ui model)

See the full token set in [Section 3: In Practice](#in-practice-shadcnui-theming). The standard semantic tokens are: `--background`, `--foreground`, `--card`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--radius` (each with a `-foreground` counterpart where applicable). Values use OKLCH format.

### Button Patterns

- **Horizontal padding = 2x vertical padding.** This creates the recognizable button shape.
- **Default height: 32-36px** for standard density. 40px for comfortable.
- **Use `min-width`** instead of fixed `width` to accommodate varying label lengths.
- **Labels describe outcomes, not processes.** "Save" not "Click to save your changes."
- **Primary, Secondary, Ghost, Destructive** -- four variants cover nearly all cases.

### Form Patterns

- **Associate every input with a `label`** using `for`/`id`.
- **Use `fieldset` and `legend`** for grouped inputs.
- **Input heights must match button heights.** When buttons and inputs appear side by side in inline forms, they must align perfectly. Use the same height token (32-36px default).
- **Form elements must inherit font:** `input, button, textarea, select { font: inherit; }`
- **Display errors inline** near the field, not in distant toasts. Connect error messages to inputs with `aria-describedby`.
- **Prevent errors rather than reporting them.** Use constraints, good defaults, and real-time validation.
- **Placeholder is not a label.** Placeholders disappear on focus. Use floating labels or persistent labels above the field.
- **Apply `autocomplete` attributes** for familiar fields (name, email, address).
- **Tame Chrome's autofill styling.** Chrome forces a blue background and overrides text color on autofilled inputs via `:-webkit-autofill` with `!important` at the user-agent level. Tailwind's `autofill:` variant alone can't override it. Use this global rule:

```css
input:-webkit-autofill,
input:-webkit-autofill:hover,
input:-webkit-autofill:focus,
input:-webkit-autofill:active {
  -webkit-box-shadow: 0 0 0px 1000px var(--background) inset !important;
  -webkit-text-fill-color: var(--foreground) !important;
  border-color: var(--input) !important;
  transition: background-color 5000s ease-in-out 0s;
  caret-color: var(--foreground);
}
```

  The inset box-shadow covers Chrome's blue background. `-webkit-text-fill-color` forces your text color (regular `color` gets overridden). The `transition: background-color 5000s` delays Chrome's background change indefinitely. Target all four states (base, hover, focus, active) or Chrome re-applies its styles on interaction. **Caveat:** the 5000s transition delay means autofilled backgrounds won't update on live theme switches (light/dark toggle) — only affects sites with runtime theme toggling.

### Icons

- **Standard sizes:** 16px (inline/dense), 20px (default), 24px (prominent). Decorative icons in empty states or hero sections can be larger (32-48px).
- **Stroke width:** 1.5px-2px. Match the visual weight of your text.
- **Consistent `viewBox`:** All icons in a set should share the same viewBox (typically `0 0 24 24`).
- **Optical alignment with text:** Use `display: inline-flex; align-items: center` and occasionally a -1px to -2px vertical offset for visual centering.
- **Lower icon contrast when paired with text.** Icons appear visually heavier than text at the same color. Reduce icon opacity or use `text-muted-foreground` color.
- Use `aria-hidden="true"` on decorative icons. Provide `aria-label` on icon-only buttons.

### Tables and Data Display

- **Right-align numbers and currency.** Left-align text. This keeps decimal points aligned for scannability.
- **Use `font-variant-numeric: tabular-nums`** so digits maintain equal width across rows.
- **Use semantic markup:** `<table>`, `<thead>`, `<tbody>`, `<th scope="col">`, `<caption>`.
- **Responsive pattern:** Wrap tables in a horizontally scrollable container on small screens:
```css
.table-wrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; }
```
- **Zebra striping** (alternating row backgrounds) or **horizontal dividers** improve readability on wide tables.
- **Sticky headers:** `thead th { position: sticky; top: 0; }` for long scrollable tables.

### Loading States

- **Delay spinners by 400ms.** If the operation completes faster, the user never sees loading UI. This prevents flash-of-loading.
- **Skeleton screens** over spinners for content-heavy layouts. Animate with subtle pulsing opacity (`animate-pulse`), not harsh gradient sweeps.
- **Skeletons must match the layout** of the content they replace to prevent layout shift.
- **Optimistic updates:** Show the expected result immediately, roll back on error. This is the gold standard for perceived performance.
- **Progress indicators** for operations over 2-3 seconds. Provide determinate progress when possible (percentage), indeterminate when not.

### Modals and Overlays

- **Backdrop:** Semi-transparent overlay (`rgba(0,0,0,0.5)` or `backdrop-filter: blur(4px)`).
- **Focus trapping:** Tab key must cycle within the modal. Focus the first interactive element on open, restore focus to the trigger on close.
- **Prevent body scroll:** Use `overflow: hidden` on `<body>` or `overscroll-behavior: contain` on the modal. Note: `overscroll-behavior: contain` also prevents pull-to-refresh on mobile -- test this trade-off.
- **Escape to close:** Always support keyboard dismissal.
- **`isolation: isolate`** on the app root prevents z-index conflicts with portaled modals.

### Empty States

- Treat empty states as design opportunities, not afterthoughts.
- Provide clear guidance on what to do next.
- Use illustration or subtle animation to make the state feel intentional.

### Error Pages

- Treat 404 and error pages as craft opportunities.
- Maintain the site's personality and navigation.
- Provide helpful next steps (search, popular pages, home link).

### In Practice: shadcn/ui Component Patterns

**Form with validation (React Hook Form + Zod + shadcn):**
```tsx
"use client"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  name: z.string().min(2, "Name must be at least 2 characters"),
})

export function SignupForm() {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
  })

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" {...register("name")} />
        {errors.name && (
          <p className="text-sm text-destructive">{errors.name.message}</p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoComplete="email" {...register("email")} />
        {errors.email && (
          <p className="text-sm text-destructive">{errors.email.message}</p>
        )}
      </div>
      <Button type="submit" className="w-full">Create account</Button>
    </form>
  )
}
```

**Empty state component:**
```tsx
import { Inbox } from "lucide-react"
import { Button } from "@/components/ui/button"

export function EmptyState({ title, description, action, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
      <Inbox className="h-10 w-10 text-muted-foreground/50" />
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground max-w-sm">{description}</p>
      {action && (
        <Button onClick={onAction} className="mt-4" size="sm">{action}</Button>
      )}
    </div>
  )
}
```

**Data table with shadcn (key patterns):**
```tsx
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table"

export function InvoiceTable({ invoices }) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Invoice</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map(inv => (
            <TableRow key={inv.id}>
              <TableCell className="font-medium">{inv.id}</TableCell>
              <TableCell>
                <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5
                  text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  {inv.status}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{inv.amount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
```

**Loading with delayed spinner (prevents flash):**
```tsx
"use client"
import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

export function DelayedSpinner({ delay = 400 }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), delay)
    return () => clearTimeout(timer)
  }, [delay])

  if (!show) return null
  return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
}
```

---

## 8. Responsive Design

### Breakpoint Strategy

Define breakpoints based on **content needs**, not device names. Use the fewest breakpoints necessary.

| Token | Width | Typical Use |
|-------|-------|-------------|
| sm | 640px (40rem) | Phone landscape |
| md | 768px (48rem) | Tablet portrait |
| lg | 1024px (64rem) | Tablet landscape / small laptop |
| xl | 1280px (80rem) | Desktop |
| 2xl | 1536px (96rem) | Large desktop |

### Responsive Rules

- **Design mobile-first.** Start with the smallest layout and expand.
- **Use `rem` for breakpoint values** so layouts respond to user font size preferences.
- **Use container queries for component-level responsiveness.** Components should adapt to their container, not the viewport:
```css
@container (min-inline-size: 400px) {
  .card { flex-direction: row; }
}
```
- **Prefer intrinsic sizing over breakpoints.** Use `auto-fill`/`auto-fit` grids, `flex-wrap`, and `clamp()` to create layouts that adapt without media queries.
- **Never hide content solely because the screen is small.** Small screens don't mean users need less information.
- **Optimize line length.** Add breakpoints when text exceeds 75 characters per line.
- **Test for text readability at 200% zoom** (WCAG requirement).
- **Check interaction modes.** Use `@media (hover: hover)` and `@media (pointer: coarse)` to adapt for touch vs. mouse:
```css
@media (pointer: coarse) {
  .button { min-height: 48px; }
}
```

### In Practice: Tailwind Responsive Patterns

**Responsive card layout (mobile stack -> desktop grid):**
```tsx
<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
  {items.map(item => <Card key={item.id} {...item} />)}
</div>
```

**Navigation that adapts (sidebar on desktop, sheet on mobile):**
```tsx
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Menu } from "lucide-react"

export function AppShell({ nav, children }) {
  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 flex-col border-r p-4">{nav}</aside>

      {/* Mobile sheet */}
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden fixed top-4 left-4 z-40">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-4">{nav}</SheetContent>
      </Sheet>

      <main className="flex-1 p-6 lg:p-8">{children}</main>
    </div>
  )
}
```

**Container query with Tailwind (component adapts to parent width):**
```tsx
<div className="@container">
  <div className="flex flex-col @md:flex-row @md:items-center gap-4">
    <img className="w-full @md:w-48 rounded-lg" src={src} alt={alt} />
    <div className="space-y-2">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  </div>
</div>
```

---

## 9. Accessibility

### Contrast Ratios (WCAG 2.1)

| Element | AA Minimum | AAA Minimum |
|---------|-----------|-------------|
| Normal text | 4.5:1 | 7:1 |
| Large text (18px+ bold, 24px+) | 3:1 | 4.5:1 |
| UI components and icons | 3:1 | -- |
| Input borders | 3:1 | -- |

### Keyboard Navigation

- All interactive elements must be keyboard-accessible.
- Provide **visible focus styles** on every interactive element. Use `:focus-visible` (not `:focus`) to show outlines only for keyboard users:
```css
:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
```
- **Tab order must match visual order.** Never use CSS Grid/Flexbox `order` to reorder content in a way that breaks keyboard navigation.
- Implement **skip links** to bypass navigation.
- **Remove invisible focusable elements** from the tab order.
- Support `Escape` to close overlays, `Enter`/`Space` to activate buttons.

### Semantic HTML

- Use landmark elements: `<header>`, `<nav>`, `<main>`, `<footer>`, `<aside>`.
- Use proper heading hierarchy: one `<h1>` per page, no skipped levels.
- Use `<button>` for actions, `<a>` for navigation.
- Use `<ul>`/`<ol>` for lists, `<table>` for tabular data.
- Include `lang` attribute on `<html>`.
- Provide unique, descriptive `<title>` for each page.

### Images and Media

- Every `<img>` needs an `alt` attribute. Decorative images get `alt=""`.
- Add `width` and `height` to images to prevent layout shift.
- Disable autoplay on audio and video.
- Provide captions for video, transcripts for audio.
- Ensure media controls are keyboard-accessible.

### Forms

- Never rely on color alone for error/warning/success states. Pair with text, icons, or patterns.
- Use `aria-describedby` to connect error messages to inputs.
- Display form errors in a list above the form for screen reader users.
- Make error messages actionable: state the problem and suggest the fix.
- **Disabled submit buttons must explain why.** Show what's missing: "Complete all required fields" or keep the button enabled and validate on submit.
- **Toasts must not be the only way to convey critical info.** Toasts disappear. Persistent errors, confirmations of destructive actions, and important status changes need inline UI.
- **Loading states need `aria-busy="true"`** on the loading region, plus visible status text.
- **Associate helper text with inputs** via `aria-describedby`, not just visual proximity.

### Motion

- Respect `prefers-reduced-motion`. Reduce or remove non-essential animation.
- Avoid content that flashes more than 3 times per second (seizure risk).
- Allow users to pause any auto-playing content.

### Touch Targets & Hit Areas

- **Minimum touch target: 44×44px** (WCAG), 48×48px preferred (Material Design).
- Separate interactive elements by at least 8px to prevent accidental taps.
- **Expand hit areas beyond visual size** using pseudo-elements positioned absolutely — this doesn't affect layout:

```css
/* Small checkbox (20×20) with expanded 44×44 hit area */
.checkbox {
  position: relative;
  width: 20px;
  height: 20px;
}
.checkbox::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 44px;
  height: 44px;
}
```

Tailwind equivalent:

```html
<button class="relative size-5 after:absolute after:top-1/2 after:left-1/2 after:size-11 after:-translate-1/2">
  <CheckIcon />
</button>
```

- **Collision rule:** If an expanded hit area overlaps another interactive element, shrink it — but keep it as large as possible without colliding. Two interactive elements must never have overlapping hit areas.
- **Eliminate interaction dead zones.** Common problem: a checkbox in a table cell has padding around it, but only the tiny checkbox is clickable. Expand the hit area to fill the entire cell so clicking anywhere in the padded area works.
- **Bridge visual gaps in navigation.** Sidebar nav items with `gap-y-px` look separated but should feel continuous — expand hit areas to cover the gaps so there are no dead spots between items.
- **Use `hit-area` utilities** ([bazza.dev/r/hit-area](https://bazza.dev/r/hit-area)) for a Tailwind-native approach. Install via `npx shadcn@latest add https://bazza.dev/r/hit-area`. Supports uniform (`hit-area-4`), directional (`hit-area-l-8 hit-area-r-4`), axis (`hit-area-x-4 hit-area-y-6`), and custom (`hit-area-[21px]`) expansion. Use `hit-area-debug` to visualize during development.

---

## 10. Performance

### Core Web Vitals Thresholds

| Metric | Good | Description |
|--------|------|-------------|
| LCP | < 2.5s | Largest Contentful Paint (loading) |
| INP | < 200ms | Interaction to Next Paint (responsiveness) |
| CLS | < 0.1 | Cumulative Layout Shift (visual stability) |

### Performance Rules

- **Set `width` and `height` on all images** to prevent layout shift.
- **Use `loading="lazy"` on below-fold images.**
- **Apply `max-width: 100%` and `display: block`** to all media elements.
- **Subset fonts** to include only needed characters. Reduce payload.
- **Use `font-display: swap`** to prevent invisible text during font loading.
- **Prefer CSS animations over JavaScript.** CSS transitions run off the main thread.
- **Only animate `transform`, `opacity`, and `clip-path`** for 60fps performance.
- **Use `will-change: transform`** sparingly to hint GPU acceleration.
- **Use `content-visibility: auto`** for off-screen content to skip rendering.
- **Use `scrollbar-gutter: stable`** to prevent layout shift when scrollbars appear.
- Avoid `transition: all`. Be explicit about which properties animate.
- **Never interleave DOM reads and writes.** Reading `getBoundingClientRect()` then writing `style.left` in the same frame causes layout thrashing. Batch all reads before all writes.
- **Use the FLIP technique** (First, Last, Invert, Play) for layout-like animations: measure start position, apply final state, calculate difference, animate the inverse transform.
- **Keep blur animations small (<=8px)** and short (one-shot effects only). Never animate blur continuously or on large surfaces.
- **Apply `will-change` only during active animation.** Add on `mouseenter`, remove on `transitionend`. Never leave it on permanently.
- **Use `h-dvh` instead of `h-screen`** in Tailwind. `dvh` accounts for mobile browser chrome (address bar, toolbar). `h-screen` causes content to be hidden behind browser UI on mobile.

### Image Optimization

- Serve modern formats: WebP, AVIF with fallbacks.
- Use responsive images: `srcset` and `sizes` attributes.
- Set explicit dimensions to reserve space: `aspect-ratio: 16/9`.
- Use `object-fit: cover` to handle unexpected aspect ratios.

### In Practice: Next.js Performance

**Next.js Image component (handles srcset, WebP/AVIF, lazy loading):**
```tsx
import Image from "next/image"

// Replaces <img> — automatically optimized, lazy-loaded, prevents CLS
<Image
  src="/hero.jpg"
  alt="Product screenshot"
  width={1200}
  height={630}
  className="rounded-lg"
  priority  // Add for above-fold hero images only
/>

// For fill mode (unknown dimensions):
<div className="relative aspect-video">
  <Image src={url} alt={alt} fill className="object-cover rounded-lg" />
</div>
```

**Font optimization in Next.js (automatic subsetting + swap):**
```tsx
// next/font handles subsetting, font-display: swap, and self-hosting automatically
import { Inter } from "next/font/google"
const inter = Inter({ subsets: ["latin"] })
// Generates: font-display: swap, optimal subsetting, no layout shift
```

**Dynamic imports for heavy components:**
```tsx
import dynamic from "next/dynamic"

// Chart library only loads when needed, with skeleton fallback
const Chart = dynamic(() => import("@/components/chart"), {
  loading: () => <div className="h-64 animate-pulse rounded-lg bg-muted" />,
  ssr: false,
})
```

**Optimistic update pattern (React):**
```tsx
"use client"
import { useOptimistic } from "react"

function TodoList({ todos, addTodo }) {
  const [optimisticTodos, addOptimistic] = useOptimistic(
    todos,
    (state, newTodo) => [...state, { ...newTodo, pending: true }]
  )

  async function handleAdd(formData) {
    const todo = { text: formData.get("text"), id: crypto.randomUUID() }
    addOptimistic(todo)       // Show immediately
    await addTodo(todo)       // Server action — rolls back on error
  }

  return (
    <ul className="space-y-1">
      {optimisticTodos.map(todo => (
        <li key={todo.id} className={todo.pending ? "opacity-50" : ""}>
          {todo.text}
        </li>
      ))}
    </ul>
  )
}
```

---

## 11. UX Psychology

### Key Laws

**Fitts's Law.** The time to reach a target depends on distance and size. Make important actions large and close to the cursor. Reduce distance to common targets. Edge/corner placement in desktop interfaces gives "infinite" dimension along one axis.

**Hick's Law.** Decision time increases with the number and complexity of choices. Minimize choices at each step. Break complex tasks into smaller decisions. Use progressive disclosure. Recommend defaults.

**Miller's Law.** Working memory holds roughly 7 (+/-2) items. Chunk information into digestible groups. Don't use this as an excuse to limit UI to 7 items -- use it to inform grouping strategy.

**Jakob's Law.** Users spend most of their time on other sites. They expect yours to work the same way. Follow platform conventions. Don't innovate on interaction patterns without good reason.

**Doherty Threshold.** Productivity soars when system response time is under 400ms. Use skeleton screens, optimistic updates, and loading indicators to maintain perceived speed.

**Aesthetic-Usability Effect.** Users perceive attractive designs as more usable. Invest in visual polish -- it directly affects perceived quality and user patience with issues.

**Von Restorff Effect (Isolation Effect).** The item that stands out from a group is most remembered. Use visual distinctiveness for the most important element (CTA, key metric).

**Peak-End Rule.** People judge experiences by the peak moment and the ending, not the average. Invest disproportionately in climactic moments and final impressions.

**Zeigarnik Effect.** People remember incomplete tasks better than complete ones. Progress bars and step indicators use this to drive completion.

**Tesler's Law (Conservation of Complexity).** Every system has irreducible complexity. The question is who bears it -- the user or the system. Absorb complexity in the implementation so the interface stays simple.

**Postel's Law.** Be liberal in what you accept, strict in what you produce. Accept varied input formats. Output clean, consistent formats.

### Additional Laws

**Choice Overload.** Too many options overwhelm users and reduce satisfaction. Enable filtering, recommend defaults, break complex decisions into steps.

**Goal-Gradient Effect.** People accelerate as they approach a goal. Show progress bars, pre-fill partial progress, and keep multi-step processes visible.

**Serial Position Effect.** Users remember the first and last items in a list best. Place key navigation items at the beginning and end. Put less important items in the middle.

**Pareto Principle (80/20).** 80% of usage comes from 20% of features. Identify and optimize the critical 20%.

**Selective Attention (Banner Blindness).** Users ignore anything that looks like an ad. Don't style real content like advertisements.

### Gestalt Principles

- **Proximity.** Objects near each other are perceived as a group.
- **Similarity.** Objects that look alike are perceived as related.
- **Continuity.** Elements arranged in a line or curve are perceived as related.
- **Closure.** The mind completes incomplete shapes.
- **Common Region.** Elements within the same boundary are perceived as a group.
- **Figure-Ground.** The mind separates foreground from background.

---

## 12. Design Tokens

### Token Architecture

Organize tokens in layers:

1. **Primitive tokens.** Raw values: `--blue-500: #3b82f6`. These are the palette.
2. **Semantic tokens.** Purpose-mapped: `--color-primary: var(--blue-500)`. These encode meaning.
3. **Component tokens.** Scoped: `--button-bg: var(--color-primary)`. These allow component-level overrides.

### Standard Token Categories

**Color:** background, foreground, primary, secondary, muted, accent, destructive, border, input, ring, plus semantic (success, warning, info, error).

**Typography:** font-family (sans, heading, mono), font sizes (xs through 4xl), font weights (normal, medium, semibold, bold), line heights, letter spacings.

**Spacing:** Based on 4px grid (see Section 1).

**Borders:** radius (sm, md, lg, xl, full), width (1px, 2px), color (from color tokens).

**Shadows:** sm, md, lg, xl, 2xl (see Section 4).

**Motion:** Duration (fast: 150ms, normal: 250ms, slow: 500ms), easing functions.

**Z-index:** Layered scale: base(0), dropdown(1000), sticky(1100), modal(1200), popover(1300), toast(1400).

### CSS Custom Properties Pattern

```css
:root {
  /* Primitives */
  --gray-50: #fafafa;
  --gray-900: #171717;
  --blue-500: #3b82f6;

  /* Semantic */
  --background: var(--gray-50);
  --foreground: var(--gray-900);
  --primary: var(--blue-500);

  /* Component */
  --button-bg: var(--primary);
  --button-text: white;
  --card-bg: var(--background);
  --card-border: var(--gray-200);
}

.dark {
  --background: var(--gray-900);
  --foreground: var(--gray-50);
  --primary: var(--blue-400);
}
```

### Responsive Tokens

Change token values at breakpoints without touching components:

```css
:root {
  --space-section: 2rem;
  --text-hero: 2rem;
}
@media (min-width: 768px) {
  :root {
    --space-section: 4rem;
    --text-hero: 3.5rem;
  }
}
```

---

## 13. Polish and Craft

### What Separates Good from Great

The difference between amateur and professional design is the accumulation of hundreds of small, intentional decisions. No single detail transforms a product, but their aggregate creates the feeling of quality users describe as "this just feels right."

### Design Principles to Live By

1. **Unified.** Every piece contributes to a coherent system. No isolated features.
2. **Universal.** Products should be welcoming and accessible to a global community.
3. **Iconic.** Be focused in both design and function. Speak boldly and clearly.
4. **Conversational.** Motion breathes life into products. Communicate in easily understood ways.
5. **Thorough to the last detail.** Care about every screen -- error pages, empty states, footers.
6. **As little design as possible.** Good design is as little design as possible. Less, but better.
7. **Make the hard work invisible.** Do the hard work to make things simple for users.
8. **Don't make me think.** Interfaces should be self-evident. If it needs explanation, it needs redesign.

### Amateur vs Professional Patterns

| Amateur | Professional |
|---------|-------------|
| Arbitrary animation duration | Deliberate durations: 100-300ms range, scaled to trigger size |
| Layout shifts during state changes | Hidden pseudo-elements reserve bold text width |
| Hard borders on images | Inset `box-shadow` with semi-transparent color |
| Hit targets match visual size exactly | Invisible `::before` expands clickable area |
| Neglects error pages, empty states, footers | Every screen is a craft opportunity |
| Hover effects fire on touch devices | `@media (hover: hover)` isolates hover states |
| CSS transitions fire during theme changes | Disable transitions, apply theme, re-enable one frame later |
| Same animation for all interactions | Minimize motion for frequent actions; reserve it for meaningful state changes |
| Dropdowns open on `click` | Trigger on `mousedown` for perceived immediacy |
| Waits for server to update UI | Optimistic updates with rollback on error |

### Finishing Touches

- **Accent borders.** A 3-5px colored border on one side of a card adds visual interest without heaviness.
- **Background decoration.** Subtle gradients, dots, or grid patterns prevent flat empty areas.
- **Custom selection colors.** Style `::selection` for brand consistency (but ensure sufficient contrast).
- **SVG favicons with dark mode.** Use `prefers-color-scheme` media query inside SVG for adaptive favicons.
- **Custom scrollbars** where appropriate (use sparingly, ensure usability).

### In Practice: Polish Patterns in React + Tailwind

**Accent border card (left-side colored bar):**
```tsx
<div className="rounded-lg border-l-4 border-l-blue-500 bg-card p-4 shadow-sm">
  <h3 className="font-semibold">New deployment</h3>
  <p className="text-sm text-muted-foreground">Production build completed in 42s.</p>
</div>
```

**Image with natural inset border (no hard edges):**
```tsx
<div className="relative overflow-hidden rounded-lg">
  <img src={src} alt={alt} className="w-full" />
  <div className="absolute inset-0 rounded-lg ring-1 ring-inset ring-black/5" />
</div>
```

**Hover-only effects isolated from touch (Tailwind):**
```tsx
<button className="rounded-lg bg-secondary px-4 py-2
  transition-colors
  hover:[@media(hover:hover)]:bg-secondary/80
  active:scale-[0.97]">
  Action
</button>
```

**Custom selection color in globals.css:**
```css
::selection { background-color: oklch(0.8 0.1 250); color: oklch(0.2 0 0); }
```

**Skip link for keyboard users:**
```tsx
<a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4
  focus:z-50 focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:text-sm
  focus:shadow-lg focus:ring-2 focus:ring-ring">
  Skip to content
</a>
<main id="main">{children}</main>
```

**Responsive SVG favicon with dark mode (`app/icon.svg`):**
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <style>
    circle { fill: #111 }
    @media (prefers-color-scheme: dark) { circle { fill: #eee } }
  </style>
  <circle cx="16" cy="16" r="14" />
</svg>
```

---

## 14. Microcopy and UX Writing

### Core Principles

- **Brevity wins.** Button labels should be 1-3 words. "Save" not "Click to save your changes." "Copy" not "Copy this text to your clipboard."
- **Labels describe outcomes, not processes.** "Join" not "Submit your registration." "Delete" not "Permanently remove this item from the database."
- **Action-oriented language.** CTAs use verbs: "Join waitlist," "Get started," "Continue." Never noun phrases.
- **Match copy weight to action weight.** Destructive actions warrant more serious copy. A delete confirmation should be weightier than a toggle label.
- **Progressive disclosure applies to copy too.** Reveal information in digestible steps, not all at once.

### Button and CTA Labels

| Pattern | Example |
|---------|---------|
| Single-word verbs | Save, Copy, Delete, Join, Share |
| Short phrases | Join waitlist, Get started, Learn more |
| State-changing labels | Copy -> Copied, Save -> Saved, Send -> Sent |
| Directional navigation | Previous / Next, Back / Continue |

### Loading and Progress States

- **Three-state progression:** "Thinking..." -> "Generating..." -> "Done"
- **Describe what the system is doing**, not what the user should do.
- **Use ellipsis for ongoing states** (Saving..., Loading...) and none for completion (Done, Saved).
- **Progressive specificity:** Start abstract ("Processing..."), end concrete ("Done").

### Error Messages

- **Prevent errors rather than reporting them.** Real-time validation beats post-submit error lists.
- **State the problem, suggest the fix.** "Password must include a number" not "Invalid password."
- **Pair text with visual feedback.** Shake animations, red borders, and inline messages together.
- **Use plain language.** "That email is already registered" not "Error 409: Conflict."

### Success and Confirmation

- **Brief and self-dismissing.** Toast: "Copied" with auto-dismiss after 1.5-2s.
- **Warm at completion.** "You're all set" is better than "Operation completed successfully."
- **Suggest next steps.** After confirmation, offer a relevant follow-up action.

### Tone Guidelines

- **Conversational but precise.** Informal yet technically correct.
- **Confident, not hedged.** "This will delete your account" not "This might delete your account."
- **Instructional at input stages, celebratory at completion.**
- **Never patronizing.** Avoid exclamation marks on routine actions. Save them for genuine milestones.

---

## 15. AI Slop Prevention

Patterns that AI code generators default to that look generic, low-quality, or obviously machine-made. Avoid these.

### Visual Anti-Patterns

- **No purple or multicolor gradients** unless the brand specifically uses them. This is the single most recognizable AI-generated aesthetic.
- **No glow effects as primary affordances.** Glows are decorative, not functional. A button should be recognizable without a glow.
- **No generic font stacks.** Don't default to Inter, Roboto, or system-ui for everything. Pick a typeface that fits the project's personality. If no brand direction exists, Inter is acceptable -- but acknowledge it as a starting point, not a design choice.
- **One accent color per view.** Multiple competing accent colors create visual noise. Pick one for primary actions and let everything else be neutral.
- **No gradients unless requested.** Default to solid colors. Gradients are a conscious design choice, not a fallback.
- **No decorative SVG blobs, mesh gradients, or abstract shapes** unless they serve the content. They're filler that signals "no design direction."

### Structural Anti-Patterns

- **No identical metric cards.** The "icon left, big number, small label" pattern repeated 4x in a grid screams template. Vary card internal structure by content type.
- **No cookie-cutter sidebar + card grid.** Every dashboard layout looks the same because AI defaults to this. Start from the user's primary task and build the layout around it.
- **Don't center everything.** Centered text, centered cards, centered hero -- this is the AI default. Left-align by default. Center only when content is short and intentionally symmetrical (hero headlines, empty states).
- **No landing pages that are just sections stacked vertically** with alternating left/right image-text blocks. Break the rhythm.

### Code Anti-Patterns

- **No `h-screen`.** Use `h-dvh` (dynamic viewport height). `h-screen` hides content behind mobile browser chrome.
- **No `z-[9999]`.** Use the token scale: dropdown(1000), sticky(1100), modal(1200), popover(1300), toast(1400).
- **No `transition-all`.** Specify exactly which properties transition.
- **No inline styles for design decisions.** Use Tailwind utilities or CSS variables. Inline styles for layout values (calculated widths, positions from JS) are fine.
- **No `useEffect` for render logic.** Derived state should be computed during render, not in effects.

### The "Would a Human Ship This?" Test

Before considering UI work done, check:
1. **Signature element:** Can you point to one thing that makes this design specific to this product? If not, it's a template.
2. **Squint test:** Blur your eyes. Is the hierarchy clear? Is the primary action obvious?
3. **Swap test:** Replace the logo. Could this be any other product? If yes, the design lacks identity.
4. **Fresh eyes:** Look at it tomorrow. Does it still feel right, or does something nag?

---

## 16. Advanced Craft

Techniques that separate polished production interfaces from prototypes.

### Natural Shadows

Tailwind's default shadows use grey. For richer depth, tint shadows with the background's hue:

```css
:root {
  --shadow-color: 220deg 60% 50%; /* match your background hue */
}
.card-natural-shadow {
  box-shadow:
    0 1px 1px hsl(var(--shadow-color) / 0.075),
    0 2px 2px hsl(var(--shadow-color) / 0.075),
    0 4px 4px hsl(var(--shadow-color) / 0.075),
    0 8px 8px hsl(var(--shadow-color) / 0.075);
}
```

Change `--shadow-color` per section or theme to keep shadows coherent with their environment. In dark mode, replace shadows with subtle `border` + lighter surface (`bg-card`) since shadows lose visual logic on dark backgrounds.

### Color Palette Generation

To create color states from a single base color (in HSB/HSL):
- **Darker variant (hover, active):** Decrease lightness, increase saturation. Optionally shift hue toward blue/violet.
- **Lighter variant (tinted background, badge):** Increase lightness, decrease saturation. Optionally shift hue toward yellow/cyan.
- **Disabled:** Drop saturation significantly, raise lightness.

```tsx
{/* Primary button with derived hover/active states */}
<button className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800
  text-white transition-colors">
  Confirm
</button>

{/* Tinted background from same color family */}
<div className="bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 rounded-lg p-4">
  Info message using the same blue family at lower intensity.
</div>
```

### Gradients Without Mud

Standard CSS gradients interpolate in sRGB, causing muddy midpoints between saturated colors. Fix by specifying OKLCH interpolation:

```css
/* Muddy (default sRGB interpolation) */
background: linear-gradient(to right, #ff0 , #00f);

/* Clean (perceptually uniform) */
background: linear-gradient(to right in oklch, oklch(0.9 0.4 110), oklch(0.5 0.3 264));
```

In Tailwind, use arbitrary values:
```tsx
<div className="bg-[linear-gradient(to_right_in_oklch,oklch(0.8_0.15_200),oklch(0.7_0.2_280))]" />
```

### Corner Smoothing (Squircles)

CSS `border-radius` creates a circular arc that meets the straight edge at a hard tangent point. iOS uses a superellipse (squircle) that starts curving before the arc, creating a smoother, more organic shape.

**CSS-only approach (good enough for most cases):** Use larger radii. A `border-radius` of ~22-28% of the smaller dimension approximates the squircle feel. Tailwind's `rounded-2xl` (16px) to `rounded-3xl` (24px) on cards looks close on typical card sizes.

**For pixel-perfect iOS fidelity**, use a clip-path with an SVG superellipse or the `figma-squircle` package:
```tsx
import { getSvgPath } from "figma-squircle"

function Squircle({ width, height, children }) {
  const path = getSvgPath({
    width, height,
    cornerRadius: 20,
    cornerSmoothing: 0.6,  // 0 = CSS radius, 1 = full squircle
  })
  return (
    <div style={{ clipPath: `path('${path}')`, width, height }}>
      {children}
    </div>
  )
}
```

**When it matters:** App icons, hero cards, and premium product images. For standard UI cards, `rounded-xl` or `rounded-2xl` is sufficient.

### Glassmorphism / Frosted Glass

```tsx
<div className="rounded-xl border border-white/20 bg-white/10 p-6
  backdrop-blur-xl shadow-xl">
  <h3 className="font-semibold text-white">Glass Card</h3>
</div>
```

Rules:
- `backdrop-blur-md` (12px) for subtle, `backdrop-blur-xl` (24px) for strong frosting.
- Background must be semi-transparent (`bg-white/10` to `bg-white/20`).
- Add a `border border-white/20` for the glass edge catch.
- Works best over busy or colorful backgrounds where the blur effect is visible.
- Test performance on mobile -- `backdrop-filter` is GPU-intensive.
- Falls back gracefully: without `backdrop-filter` support, you get a semi-transparent card (still usable).

### Noise and Texture

Flat surfaces can feel sterile. A subtle noise overlay adds organic warmth:

```css
.textured {
  position: relative;
}
.textured::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.7' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  opacity: 0.03;
  pointer-events: none;
  mix-blend-mode: overlay;
  border-radius: inherit;
}
```

Keep opacity between 0.02-0.05. Higher makes the surface look dirty.

### Gradient Masks (Scroll Fade)

Fade content at scroll container boundaries:

```tsx
<div className="relative max-h-64 overflow-y-auto
  [mask-image:linear-gradient(to_bottom,transparent,black_16px,black_calc(100%-16px),transparent)]">
  {/* scrollable content */}
</div>
```

### Inset Ring vs Border

For image containers and avatar frames, an inset ring looks more natural than a border because it doesn't add to the element's dimensions and blends with the content:

```tsx
{/* Hard border (adds 2px to dimensions, feels rigid) */}
<img className="rounded-full border-2 border-gray-200" />

{/* Inset ring (no dimension change, blends naturally) */}
<div className="relative rounded-full overflow-hidden">
  <img className="rounded-full" src={src} alt={alt} />
  <div className="absolute inset-0 rounded-full ring-1 ring-inset ring-black/10" />
</div>

{/* Shorthand for non-image elements */}
<div className="rounded-lg shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]">
```

### Typed CSS Custom Properties

Use `@property` to enable animation on custom properties and catch invalid values:

```css
@property --gradient-angle {
  syntax: "<angle>";
  initial-value: 0deg;
  inherits: false;
}

.rotating-border {
  --gradient-angle: 0deg;
  border-image: conic-gradient(from var(--gradient-angle), #e92a67, #a853ba, #2a8af6, #e92a67) 1;
  animation: rotate-gradient 3s linear infinite;
}

@keyframes rotate-gradient {
  to { --gradient-angle: 360deg; }
}
```

Without `@property`, CSS can't interpolate custom properties -- the animation would snap between values instead of transitioning smoothly.

### Button Shadow Anatomy (Six-Layer)

Polished buttons use six layered techniques working together to mimic real-world light physics:

```css
.button-polished {
  /* Subtle gradient for dimension */
  background: linear-gradient(
    to bottom,
    color-mix(in oklch, var(--primary), white 4%),
    var(--primary)
  );

  box-shadow:
    /* 1. Outer cut: thin dark edge */
    0 0 0 0.5px rgba(0, 0, 0, 0.15),
    /* 2. Inner ambient highlight: light from all sides */
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),
    /* 3. Inner top highlight: primary light from above */
    inset 0 1px 0 rgba(255, 255, 255, 0.15),
    /* 4-6. Layered depth shadows */
    0 1px 2px rgba(0, 0, 0, 0.15),
    0 2px 4px rgba(0, 0, 0, 0.1),
    0 4px 8px rgba(0, 0, 0, 0.05);

  /* Text shadow for contrast */
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.1);
}
```

This technique replaces flat buttons with physically convincing depth. The gradient adds dimension, the inset shadows simulate environmental and directional light, and the outer shadows create depth.

### Semi-Transparent Borders

Use alpha-based border colors instead of hardcoded hex values. Semi-transparent borders adapt automatically to any background:

```css
/* Hardcoded (breaks on different backgrounds) */
border: 1px solid #e5e5e5;

/* Adaptive (works on any background) */
border: 1px solid rgba(0, 0, 0, 0.12);
/* Dark mode equivalent */
border: 1px solid rgba(255, 255, 255, 0.12);
```

This removes the need for separate light/dark border tokens in many cases.

### CSS Pseudo-Element Patterns

Native pseudo-elements and selectors that reduce DOM complexity:

- **`::marker`** for custom list bullets -- replaces background-image hacks:
```css
li::marker { color: var(--muted-foreground); font-size: 0.8em; }
```

- **`::first-line`** for typographic treatments -- automatically adapts when viewport changes:
```css
.article p:first-of-type::first-line {
  font-variant-caps: small-caps;
  font-weight: 500;
}
```

- **`::backdrop`** for dialog/popover overlays -- replaces extra overlay divs:
```css
dialog::backdrop { background: rgba(0, 0, 0, 0.5); backdrop-filter: blur(4px); }
```

- **`::placeholder`** for input styling (keep at lower contrast than actual input text).

### Optical Adjustments

Small corrections the eye expects but math doesn't provide:

- **Play button icons** need 1-2px right offset to appear centered (the triangle's visual weight sits left of its bounding box). Best practice: fix the offset within the SVG itself to avoid additional CSS adjustments.
- **Buttons with text + icon** need reduced padding on the icon side. The icon's whitespace within its bounding box creates visual imbalance — reduce that side's padding by 2-4px to compensate.
- **Circular icons in square containers** appear smaller. Increase circular icon size by ~5% or reduce container padding.
- **Text next to checkboxes/radio buttons** needs negative top margin of 1-2px at small sizes because the baseline sits above the visual center.
- **Pill badges** (`rounded-full`) need slightly more horizontal padding than their border-radius suggests -- add 2-4px extra.
- **All-caps text in buttons** appears vertically off-center. Add 1px more bottom padding, or use `leading-none` and manually center with padding.

---

## 17. Defensive CSS

Patterns that prevent common layout breakage:

```css
/* Prevent flex items from overflowing */
.flex-child { min-width: 0; overflow-wrap: break-word; }

/* Prevent images from breaking layout */
img { max-width: 100%; display: block; object-fit: cover; }

/* Prevent scroll chaining through modals */
.modal { overscroll-behavior: contain; }

/* Always use auto overflow, not scroll */
.scrollable { overflow-y: auto; }

/* Reserve scrollbar space to prevent layout shift */
.page { scrollbar-gutter: stable; }

/* Use min-height, not height, for variable content */
.hero { min-height: 400px; } /* NOT height: 400px */

/* Use min-width, not width, for buttons */
.button { min-width: 100px; } /* NOT width: 100px */

/* Fallback backgrounds for failed images */
.card-image { background-color: var(--muted); }

/* Fallback for CSS variables */
.element { width: var(--sidebar-width, 250px); }

/* Prevent flex containers from hiding overflow */
.grid-child { min-width: 0; }

/* Use auto-fill to prevent stretching with few items */
grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));

/* Sticky elements in grid need align-self */
.sidebar { align-self: start; position: sticky; top: 1rem; }

/* Single-line text truncation */
.truncate { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Multi-line text truncation (e.g., 3 lines) */
.line-clamp-3 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}

/* Safe area padding for full-bleed layouts on notched devices */
.safe-area { padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }

/* Never use arbitrary z-index values. Always map to a token layer. */
/* z-base: 0, z-dropdown: 1000, z-sticky: 1100, z-modal: 1200, z-popover: 1300, z-toast: 1400 */
```

---

## 18. Modern CSS Reset

A sensible starting point for any project:

```css
/* 1. Use border-box for everything */
*, *::before, *::after { box-sizing: border-box; }

/* 2. Remove default margins */
* { margin: 0; }

/* 3. Enable smooth keyword animations (respects motion prefs) */
@media (prefers-reduced-motion: no-preference) {
  html { interpolate-size: allow-keywords; }
}

/* 4. Accessible body defaults */
body {
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

/* 5. Responsive media */
img, picture, video, canvas, svg {
  display: block;
  max-width: 100%;
}

/* 6. Form elements inherit fonts */
input, button, textarea, select { font: inherit; }

/* 7. Prevent text overflow */
p, h1, h2, h3, h4, h5, h6 { overflow-wrap: break-word; }

/* 8. Better text wrapping */
p { text-wrap: pretty; }
h1, h2, h3, h4, h5, h6 { text-wrap: balance; }

/* 9. Root stacking context */
#root, #__next { isolation: isolate; }
```

---

## 19. Predictive Prefetching

Loading content before the user clicks by analyzing cursor trajectory, reducing perceived latency by 100-200ms.

### Trajectory Prediction vs Hover

Standard hover-based prefetching (`onMouseEnter`) waits until the user has stopped moving and is already on the element. **Trajectory prediction** calculates where the cursor is heading while still in motion, reclaiming the ~100-200ms that hover-based approaches waste.

```tsx
// Hover-based (too late — fires after the user has arrived)
<Link href="/about" onMouseEnter={() => router.prefetch("/about")}>About</Link>

// Trajectory-based (fires while cursor is still moving toward the element)
const { elementRef } = useForesight({
  callback: () => router.prefetch("/about"),
  hitSlop: 20,   // expand invisible prediction area by 20px
  name: "about-link",
})
<Link ref={elementRef} href="/about">About</Link>
```

### Rules

- **Prefetch by intent, not viewport.** Don't prefetch all visible links. Most users don't click most visible links. Use trajectory prediction or hover to determine intent.
- **Use `hitSlop` to start predictions earlier.** Expanding the invisible area (e.g., 20px) around elements begins loading sooner without visual changes.
- **Fall back gracefully on touch devices.** Touch has no cursor trajectory. Fall back to `touchstart` or viewport-based strategies.
- **Prefetch on keyboard navigation.** Monitor focus changes and prefetch when the user is a few tab stops away from a target.
- **Use selectively.** Predictive prefetching is most valuable for data-heavy dashboards, multi-page apps with slow APIs, and e-commerce. Skip it for static sites with instant navigation.

Reference: [ForesightJS](https://foresightjs.com)

---

## 20. Audio Feedback and Sound Design

Audio is a UI tool, not decoration. Used correctly, it reinforces actions and creates a sense of physical interaction. Used incorrectly, it annoys.

### When to Use Sound

| Interaction | Sound? | Reason |
|-------------|--------|--------|
| Payment success | Yes | Significant confirmation |
| Form submission | Yes | User needs assurance |
| Error state | Yes | Can't be overlooked |
| Notification | Yes | User may not be looking at screen |
| Significant button (e.g., send) | Maybe | Only for milestone actions |
| Typing | No | Too frequent |
| Hover | No | Decorative, no informational value |
| Scroll | No | Too frequent |
| Navigation | No | Keyboard nav would be noisy |

### Accessibility Rules

- **Every sound must have a visual equivalent.** Sound supplements visual feedback; never replaces it.
- **Provide a toggle to disable sounds.** Respect user preference.
- **Respect `prefers-reduced-motion`** -- reduce or disable sound alongside motion.
- **Sound weight matches action weight.** Soft click for toggles, success chime for purchases. Never a fanfare for a checkbox.
- **Sound duration matches action duration.** Click sounds: 5-15ms. Confirmation: ~200ms. Long sounds for instant actions feel wrong.
- **Informative, not punishing.** Gentle alert for validation errors, not a harsh buzzer.

### Implementation

```tsx
// Preload sounds to avoid first-play delay
const sounds = {
  success: new Audio("/sounds/success.mp3"),
  error: new Audio("/sounds/error.mp3"),
  click: new Audio("/sounds/click.mp3"),
}
Object.values(sounds).forEach(a => { a.volume = 0.3; a.load() })

function playSound(name: keyof typeof sounds) {
  sounds[name].currentTime = 0   // reset so rapid re-triggering works
  sounds[name].play()
}
```

- **Default volume: 0.3** (30%). Never 1.0 -- it startles.
- **Reset `currentTime = 0`** before every play for rapid re-triggering.
- **Preload audio files** to prevent delay on first trigger.

### Procedural Sound with Web Audio API

For UI sounds without audio files -- generate clicks and tones programmatically:

```ts
// Singleton AudioContext (never create per sound)
let ctx: AudioContext | null = null
function getCtx() { return ctx ??= new AudioContext() }

// Click sound: filtered noise burst (5-15ms)
function playClick() {
  const ctx = getCtx()
  if (ctx.state === "suspended") ctx.resume()

  const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.008, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / 50)
  }

  const source = ctx.createBufferSource()
  source.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = "bandpass"
  filter.frequency.value = 4000  // 3000-6000Hz for crisp clicks
  filter.Q.value = 3             // 2-5 for focused but natural
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.3, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05)

  source.connect(filter).connect(gain).connect(ctx.destination)
  source.start()
  source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect() }
}

// Tonal sound: oscillator with pitch sweep (confirmations, pops)
function playTone() {
  const ctx = getCtx()
  if (ctx.state === "suspended") ctx.resume()
  const t = ctx.currentTime
  const osc = ctx.createOscillator()
  osc.frequency.setValueAtTime(400, t)
  osc.frequency.exponentialRampToValueAtTime(600, t + 0.04)  // upward sweep
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.3, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08)

  osc.connect(gain).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + 0.08)
  osc.onended = () => { osc.disconnect(); gain.disconnect() }
}
```

Key rules for Web Audio:
- **Reuse a single `AudioContext`** -- never create per sound (browser limits to ~6).
- **Resume suspended context** before playing (`ctx.state === "suspended"`). Browsers suspend AudioContext until user interaction.
- **Disconnect nodes after playback** to prevent memory leaks.
- **Exponential ramps for decay** (not linear). Target `0.001` (not `0` -- exponential ramps can't reach zero).
- **Noise for percussive sounds** (clicks, taps). **Oscillators for tonal sounds** (pops, confirmations) -- add pitch sweep for musicality.

| User Feedback | Fix |
|---------------|-----|
| "too harsh" | Lower filter frequency, reduce Q |
| "too muffled" | Higher filter frequency |
| "too long" | Shorter buffer duration, faster decay |
| "cuts off abruptly" | Use exponential decay instead of linear |
| "more mechanical" | Higher Q, faster decay |
| "softer" | Lower gain, use triangle wave |

---

## Quick Reference: Common Values

| Property | Recommended Default |
|----------|-------------------|
| Body font size | 16px (1rem) |
| Body line height | 1.5 |
| Heading line height | 1.1 - 1.25 |
| Max content width | 65ch |
| Spacing base unit | 4px |
| Border radius (sm) | 4px |
| Border radius (md) | 8px |
| Border radius (lg) | 12px |
| Border radius (full) | 9999px |
| Border radius (shadcn default) | 0.625rem (10px) |
| Transition (fast) | 150ms ease-out |
| Transition (normal) | 250ms ease-out |
| Transition (slow) | 500ms ease-out |
| Min touch target | 44px (48px preferred) |
| Min contrast (text) | 4.5:1 |
| Min contrast (large text) | 3:1 |
| Min contrast (UI elements) | 3:1 |
| Max line length | 60-75 characters optimal, 80 max |
| Button/input height | 32-36px (standard), 40px (comfortable) |
| Icon sizes | 16px (dense), 20px (default), 24px (prominent) |
| Button padding ratio | 2x horizontal : 1x vertical |
| Shadow blur ratio | 2x the offset distance |
| Spinner delay | 400ms before showing |
| System response target | < 400ms (Doherty Threshold) |
| Color format | OKLCH (preferred), HSL (alternative) |
| Focus ring | 2px solid, 2px offset |
| Z-index layers | dropdown:1000, sticky:1100, modal:1200, popover:1300, toast:1400 |
