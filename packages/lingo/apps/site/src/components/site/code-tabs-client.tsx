'use client'

import { CodeBlockFrame } from '@/components/site/code-block-frame'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export interface HighlightedCodeTab {
  code: string
  filename?: string
  html: string
  label: string
  lang: string
  value: string
}

export function CodeTabsClient({
  tabs,
  clampLongCode = true,
}: {
  tabs: HighlightedCodeTab[]
  clampLongCode?: boolean
}) {
  return (
    <Tabs className="gap-2" defaultValue={tabs[0]?.value}>
      <TabsList className="h-auto flex-wrap justify-start">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          <CodeBlockFrame
            clampLongCode={clampLongCode}
            code={tab.code}
            filename={tab.filename}
            html={tab.html}
            lang={tab.lang}
          />
        </TabsContent>
      ))}
    </Tabs>
  )
}
