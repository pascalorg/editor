# Localization

> The localization API is experimental and unreleased. Its signatures may
> change before the first i18n-capable package release.

Pascal uses Lingui 6 for ICU MessageFormat, React updates, extraction, and
catalog compilation. A thin Pascal registry keeps the ownership contract that
an embeddable editor needs: namespaced host and plugin packs, ordered
overrides, locale fallback, isolated request/editor scopes, and locale-aware
number formatting.

Published packages use Lingui’s plain runtime call form, not macros:

```tsx
const i18n = usePascalI18n()

i18n._({
  id: 'viewer.camera.topView',
  message: 'Top view',
})
```

Hosts therefore need no Lingui compiler plugin or extra transform. English UI
copy stays beside the component that renders it and is also compiled into the
bundled English catalog. Scene data, exports, catalog content, MCP/agent text,
and developer errors are not translated.

## Catalogs

The source and translated catalogs are PO files under
`packages/editor/src/i18n/locales/<locale>/messages.po`. Compiled TypeScript
catalogs next to them are what the browser loads; PO files and the ICU compiler
are not part of the normal rendering path.

After adding or changing a runtime message:

1. Run `bun run i18n:extract`. Lingui updates the PO catalogs and compiled
   modules.
2. Translate every new entry in each bundled locale, by hand or with
   `bun run i18n:translate` (below).
3. Keep the `Source-Hash` comment in sync. An entry a fluent reviewer approved
   is `Review: human` without the `fuzzy` flag; an AI or otherwise unreviewed
   draft is `fuzzy` with `Review: required`.
4. Review the copy in context, then run `bun run i18n:check`.

`i18n:check` needs no API key. It fails for extraction/compiled-catalog drift,
missing or stale translations, malformed ICU, changed placeholders or tags,
invalid target-locale plural branches, glossary violations, an unreviewed entry
that is not flagged `fuzzy` + `Review: required`, and new hardcoded UI
literals (see the literal guard below). It is read-only: use `i18n:extract` or
`i18n:compile` when catalogs need to be written.

CI and releases allow drafts, never regressions:

- In a pull request, drafts awaiting review pass `i18n:check` but are never
  shown: compiled packs omit them, so that locale shows the English source
  until a reviewer removes `fuzzy` and sets `Review: human`. `i18n:check`
  prints how many entries each locale still has awaiting review.
- A translation that is `Review: human` on the base branch must stay reviewed
  while its English is unchanged. A PR may edit it, but turning it back into a
  draft fails CI.
- To rename a reviewed ID, declare it on the new descriptor:
  `i18n._({ id: 'editor.panel.advancedSection', message: 'Advanced', comment: 'renamed-from: editor.panel.advanced' })`.
  `bun run i18n:extract` then carries the reviewed translation over while the
  English is unchanged, and CI fails if a declared rename arrives without it.
  An undeclared new ID that shares English with a removed reviewed ID is only
  reported as a possible rename (console and job summary): it may be an
  unrelated addition, and a missed carry-over just shows English. CI compares with the
  pull request's base commit, or on a push with the commit before the push;
  locally `i18n:check` compares with the merge base of `origin/main`, or
  `I18N_BASE_REF`.
- Releases ship drafts as English until they are reviewed.
- `bun scripts/i18n.ts release-check` runs in the release workflow and, as part
  of `i18n:check`, in CI. It compares the committed catalogs with a base
  revision. In CI that is the pull request base. In a release it is the latest
  `@pascal-app/editor@<version>` tag reachable from HEAD (the release workflow
  tags every package `@pascal-app/<pkg>@<version>`, and the catalogs ship in
  the editor package), or `--base <rev>`. When that tag predates the catalogs
  it falls back to `origin/main` if that is another commit with catalogs, then
  to the commit that introduced the catalogs. It never compares with a base
  that has no catalogs: with none available it fails and asks for `--base`.
  It fails when a reviewed entry with the same English became a draft, or when
  a compiled pack contains any draft. Both jobs write the per-locale draft
  count, and the base used, to the job summary.
- `bun scripts/i18n.ts check --reviewed` is the manual sign-off for a locale:
  it fails on every remaining draft.

## Literal guard and migration codemod

`bun run i18n:literals -- check` (run by `i18n:check`) scans the TSX in
`apps/editor` and `packages/{editor,viewer,nodes,core,ui}` for user-visible
literals: JSX text, string-valued `aria-*`, `title`, `placeholder`, `alt`,
`label`, `tooltip`, `description`… props, display keys (`label`, `title`,
`placeholder`, `tooltip`…) in objects, and `toast`/`alert`/`confirm`/`setError`
payloads (also in `.ts` modules), including `const` strings rendered by name
in JSX, a UI prop or inside a sentence, and copy built with `+`. Hyphenated
words ("Read-only") count as copy; icon names, paths and snake_case keys do
not. JSX text and attribute values are recorded as they render (whitespace rules,
entities, `{' '}` joins; a no-break space is content), so equivalent spellings
match, and the allowlist applies to the joined text. `i18n/literal-baseline.json` lists, per
file, the legacy candidates by text. A file may only contain copy its entry
lists, so adding or swapping a string fails, and a file missing from the
baseline (every new file) must have none. When a PR converts copy, run
`bun run i18n:literals -- update` to remove it from the baseline. The baseline
may only shrink, measured across the repository: CI fails when it lists a text
more often than the base branch's baseline does. Copy that moves with a
renamed, split or extracted file therefore passes after `update`.

Not every literal is copy. Exemptions are explicit and reviewed; the allowlist,
like the baseline, may not gain entries relative to the base:

- `i18n/literal-allowlist.json` lists exact strings that are never translated
  (brands, file formats, unit symbols, modifier key names) and developer-only
  paths, each path with its reason.
- `// i18n-ignore: <reason>` (or `{/* i18n-ignore: <reason> */}` in JSX) on a
  literal's own line, or alone on the line before it, exempts it, e.g. an
  authored or scene value. A trailing ignore does not reach the next line. A
  bare `i18n-ignore` without a reason exempts nothing.

`bun run i18n:literals -- report [--files] [path…]` lists the remaining
candidates per area or per line. The one-time migration codemod rewrites them:

```bash
bun run i18n:literals -- convert packages/editor/src/components/ui/sidebar   # dry run
bun run i18n:literals -- convert --apply packages/editor/src/components/ui/sidebar
```

It turns JSX text, UI props, conditional and template-literal copy, and
notification payloads into `i18n._({ id, message, values })`. Adjacent text and
simple interpolations become one message (`Shared with {count} people`). It
adds `const i18n = usePascalI18n()` to the owning component or hook and the
import. IDs follow the owning package and path (`app.editorNavbar.share`,
`editor.sidebar.sitePanel.addLevel`, `node.roofSegment.inspector.pitch`).
Copy is ICU-encoded so the message renders exactly the original text. The
codemod leaves these for a person and lists them as `MANUAL`: module-level data
(unless asked, below), complex template interpolations, concatenated copy,
string constants, copy inside named callbacks or async functions, and modules a
host can render on the server (app modules and editor package entry exports
without `'use client'`). A second run changes nothing, including a repeated
`--vars` pass.

Module data (option arrays, label maps) cannot call a hook. Name its keys or
variables and the codemod turns those values into lazy descriptors that Lingui
extracts:

```bash
bun run i18n:literals -- convert --apply --keys=name,detail --vars=levelModeLabels apps/editor/components/viewer-toolbar.tsx
# { name: 'Solid' }  →  { name: /* i18n */ { id: 'app.viewerToolbar.solid', message: 'Solid' } }
```

Type the field as `MessageDescriptor` (exported by `@pascal-app/core`) and
render it with `i18n._(option.name)` inside the component; the type checker
lists every consumer to update. Review the diff, run `bun run i18n:extract`, and translate.

## Pseudo-locale audit

`en-XA` is generated from English on every extract/compile: letters are
accented, text is ~30 % longer and bracketed (`[Šĥáŕé ~~]`), and ICU arguments
and tags are kept. The standalone app registers it in development and test
builds only (`apps/editor/lib/dev-locales.ts`; production bundles never include
the catalog), so `?lang=en-XA` shows at a glance
which copy bypasses the catalog and which controls clip longer text.

With the app running (`bun dev`), the audit opens every surface in
`i18n/pseudo-surfaces.ts` in Chrome, saves a screenshot per surface, and lists
any visible text or accessible name that still contains plain ASCII words:

```bash
bun run i18n:pseudo-audit -- --base http://localhost:3002 --out .i18n-audit [surface…]
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if Chrome is not at
`/usr/local/bin/google-chrome`. A PR that localizes a surface adds it to the
manifest (with the steps that open menus or dialogs) and includes the
screenshots. Copy from external plugins (`@pascal-app/plugin-*`) is the
plugin's own to translate through `registerMessages`.

`bun run i18n:compile` runs Lingui’s strict compiler directly when only the
generated runtime catalogs need refreshing.

To bundle another language, add its locale to `lingui.config.ts` and
`packages/editor/src/i18n/locales.ts`, extract, translate, compile, and add it
to the locale-pack test.

## Hosts, plugins, and overrides

Keep namespaces with their owner: `core.*`, `viewer.*`, `editor.*`,
`node.<kind>.*`, or `plugin.<id>.*`. Raw community and host packs use ICU
strings and are compiled atomically through the lazy authoring path:

```ts
import { registerMessages, setLocale } from '@pascal-app/core/i18n'
import { registerBundledLocales } from '@pascal-app/editor/locales'

registerBundledLocales()

await registerMessages('fr', 'viewer', {
  'camera.topView': 'Vue en plan',
})
await registerMessages('en', 'viewer', {
  'camera.topView': 'Plan view',
})

setLocale('fr')
```

Later registrations win, including English overrides. Regional fallback is
automatic (`pt-BR` → `pt` → the English literal), while Simplified Chinese
script tags can use the `zh-CN` pack without crossing into Traditional Chinese.

Pack authors that already compile with Lingui may call the synchronous
`registerCompiledMessages(locale, namespace, messages)` instead. Raw
`registerMessages` is intentionally asynchronous because it loads the ICU
compiler only for that authoring/host path.

For server rendering, create one isolated scope per request and render the same
scope on the client:

```tsx
const i18n = createI18n({ locale: requestedLocale })

return <PascalI18nProvider i18n={i18n}>{children}</PascalI18nProvider>
```

The standalone app resolves `?lang=` in its request proxy, so localized text
and numbers are present in the server response and match hydration.
`<Editor locale="fr" />` creates the same kind of isolated scope for embeds.
Unscoped editors follow the default `setLocale`; scoped hosts switch at runtime
with `i18n.setLocale(...)`.

## AI-assisted fill

`bun run i18n:translate -- fr` sends only missing or source-stale PO entries
through the Vercel AI SDK. Configure one provider and model:

- `I18N_PROVIDER=openai`, `OPENAI_API_KEY`, and `I18N_MODEL`; or
- `I18N_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, and `I18N_MODEL`.

`OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL` are optional. The structured-output
request includes the English ICU source, source locations, and
`i18n/glossary.json`. Every returned ID, ICU message, placeholder, tag, plural
branch, and applicable glossary term is validated before any PO file is
written.

AI output is always marked `fuzzy`, `Review: required`, and records provider,
model, and review notes. It never becomes a shipping translation until a human
reviews it, removes `fuzzy`, and changes the review marker to `human`.
Translation never runs in the app or ordinary CI, and API keys must not be
committed.
