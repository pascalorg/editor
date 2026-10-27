import type { LinguiConfig } from '@lingui/conf'
import { formatter } from '@lingui/format-po'

const config: LinguiConfig = {
  catalogs: [
    {
      path: 'packages/editor/src/i18n/locales/{locale}/messages',
      include: [
        'packages/core/src',
        'packages/viewer/src',
        'packages/editor/src',
        'packages/nodes/src',
        'apps/editor',
      ],
      exclude: ['**/*.test.{ts,tsx}', '**/__fixtures__/**'],
    },
  ],
  compileNamespace: 'es',
  fallbackLocales: false,
  format: formatter({
    explicitIdAsDefault: true,
    lineNumbers: false,
    origins: true,
  }),
  locales: ['en', 'zh-CN', 'fr', 'es', 'ja'],
  orderBy: 'messageId',
  sourceLocale: 'en',
}

export default config
