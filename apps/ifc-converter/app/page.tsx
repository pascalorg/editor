'use client'

import IfcConverter from '@/components/IfcConverter'
import { useTranslations } from '@/lib/i18n'

export default function HomePage() {
  const t = useTranslations()
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-100 py-12">
      <div className="max-w-3xl mx-auto px-6 pb-12 space-y-4">
        <h1 className="text-3xl font-bold text-gray-900">{t('ifcConverter.page.title')}</h1>
        <p className="text-gray-600 leading-relaxed">
          {t('ifcConverter.page.subtitle.start')}
          <em>{t('ifcConverter.page.subtitle.loadBuild')}</em>
          {t('ifcConverter.page.subtitle.end')}
        </p>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">{t('ifcConverter.page.banner.title')}</span>{' '}
          {t('ifcConverter.page.banner.bodyBefore')}{' '}
          <a
            className="font-medium underline decoration-amber-400 underline-offset-2 hover:text-amber-700"
            href="https://github.com/pascalorg/editor/tree/main/apps/ifc-converter"
            rel="noopener noreferrer"
            target="_blank"
          >
            {t('ifcConverter.page.banner.link')}
          </a>{' '}
          {t('ifcConverter.page.banner.bodyAfter')}
        </div>
      </div>
      <IfcConverter />
    </main>
  )
}