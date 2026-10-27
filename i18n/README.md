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

Drafts awaiting review are valid in ordinary CI but never published: compiled
packs omit them, so that locale shows the English source until a reviewer
removes `fuzzy` and sets `Review: human`. `i18n:check` prints how many entries
each locale still has awaiting review. `bun scripts/i18n.ts check --reviewed`
is the locale sign-off gate: it also fails on every draft.

## Literal guard and migration codemod

`bun run i18n:literals -- check` (run by `i18n:check`) scans the TSX in
`apps/editor` and `packages/{editor,viewer,nodes,core,ui}` for user-visible
literals: JSX text, string-valued `aria-*`, `title`, `placeholder`, `alt`,
`label`, `tooltip`, `description`… props, display keys (`label`, `title`,
`placeholder`, `tooltip`…) in objects, and `toast`/`alert`/`confirm`/`setError`
payloads (also in `.ts` modules). `i18n/literal-baseline.json` records how many
legacy candidates each file still has. A file may not exceed its count, and a
file missing from the baseline (every new file) must have none. When a PR
converts copy, run `bun run i18n:literals -- update` to lower the baseline.

Not every literal is copy. Exemptions are explicit:

- `i18n/literal-allowlist.json` lists exact strings that are never translated
  (brands, file formats, unit symbols, key names) and developer-only paths,
  each path with its reason.
- `// i18n-ignore: <reason>` (or `{/* i18n-ignore: <reason> */}` in JSX) on
  the line before a literal exempts it, e.g. an authored or scene value.

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
`editor.sidebar.sitePanel.addLevel`, `node.roofSegment.inspector.pitch`). The
codemod never rewrites module-level data, server components or complex
template interpolations. It lists them as `MANUAL` for a person to
restructure, usually as a translated lookup inside the component. A second run
changes nothing. Review the diff, run `bun run i18n:extract`, and translate.

## Pseudo-locale audit

`en-XA` is generated from English on every extract/compile: letters are
accented, text is ~30 % longer and bracketed (`[Šĥáŕé ~~]`), and ICU arguments
and tags are kept. The standalone app registers it outside production builds
(`@pascal-app/editor/locales/pseudo`), so `?lang=en-XA` shows at a glance
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
