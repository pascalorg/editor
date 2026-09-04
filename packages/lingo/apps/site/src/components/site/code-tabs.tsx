import { CodeTabsClient, type HighlightedCodeTab } from '@/components/site/code-tabs-client'
import { highlightCode } from '@/lib/highlight'

export async function CodeTabs({
  tabs,
  clampLongCode,
}: {
  tabs: ReadonlyArray<Omit<HighlightedCodeTab, 'html'>>
  clampLongCode?: boolean
}) {
  const highlighted = await Promise.all(
    tabs.map(async (tab) => ({
      ...tab,
      html: await highlightCode(tab.code, tab.lang),
    })),
  )

  return <CodeTabsClient clampLongCode={clampLongCode} tabs={highlighted} />
}
