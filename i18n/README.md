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
2. Translate every new entry in each bundled locale.
3. Keep the `Source-Hash` comment in sync and mark a reviewed entry
   `Review: human` without the `fuzzy` flag.
4. Review the copy in context, then run `bun run i18n:check`.

`i18n:check` needs no API key. It fails for extraction/compiled-catalog drift,
missing or stale translations, unreviewed entries, malformed ICU, changed
placeholders or tags, invalid target-locale plural branches, and glossary
violations. It is read-only: use `i18n:extract` or `i18n:compile` when catalogs
need to be written. It only warns when a new literal bypasses Lingui on the
converted viewer/build-panel surfaces.

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
