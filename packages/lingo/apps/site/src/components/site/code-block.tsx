import { CodeBlockFrame } from '@/components/site/code-block-frame'
import { highlightCode } from '@/lib/highlight'

export async function CodeBlock({
  code,
  lang = 'ts',
  filename,
  className,
}: {
  code: string
  lang?: string
  filename?: string
  className?: string
}) {
  const html = await highlightCode(code, lang)

  return (
    <CodeBlockFrame className={className} code={code} filename={filename} html={html} lang={lang} />
  )
}
