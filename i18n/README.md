# Localization

English UI copy stays beside the component that renders it:

```tsx
const t = useTranslate()
t('viewer.camera.topView', 'Top view')
```

The in-code text is the fallback and source of truth. Scene data, exports,
catalog content, MCP/agent text, and developer errors are not translated.

## Add or adapt a language

1. Run `bun run i18n:extract` after adding or changing `t()` calls.
2. Add a catalog in `packages/editor/src/i18n/catalogs/<locale>.json`, or run
   `bun run i18n:translate -- <locale>` for an existing bundled locale.
3. Review every translation in context. The AI command only prepares a diff;
   it never runs in the app or CI.
4. Add the locale to `packages/editor/src/i18n/locales.ts` when it should ship
   with the editor.
5. Run `bun run i18n:check`.

Each translation records the hash of its English source. Changing the English
message makes the translation stale until a person updates or approves it.
`i18n:check` also rejects missing keys and changed placeholders.

To adapt a bundled pack without forking, register an override after it:

```ts
import { registerMessages, setLocale } from '@pascal-app/core/i18n'
import { registerBundledLocales } from '@pascal-app/editor/locales'

registerBundledLocales()
registerMessages('fr', 'viewer', {
  'camera.topView': 'Vue en plan',
})
setLocale('fr')
```

Later registrations win. Regional fallback is automatic (`pt-BR` → `pt` →
the English literal). An embedding host can set the locale before mount, pass
`<Editor locale="fr" />`, or use `?lang=fr` in the standalone app and iframe.
Calling `setLocale` later switches the mounted UI.

Community packs use the same `registerMessages(locale, namespace, messages)`
contract. Keep namespaces with their owner: `core.*`, `viewer.*`, `editor.*`,
`node.<kind>.*`, or `plugin.<id>.*`.

## AI-assisted fill

`bun run i18n:translate -- fr` refreshes only missing or stale entries. Set:

- `I18N_PROVIDER=openai`, `OPENAI_API_KEY`, and `I18N_MODEL`; or
- `I18N_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, and `I18N_MODEL`.

`OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL` are optional. The command sends the
English copy, source context, and `i18n/glossary.json` to the selected provider,
validates placeholders, and writes JSON only. API keys are never required by
`i18n:check` and must not be committed. Human review remains mandatory,
especially for architecture/CAD terminology and short controls.
