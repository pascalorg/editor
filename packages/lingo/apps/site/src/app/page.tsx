import type { Metadata } from 'next'
import Link from 'next/link'

import { BrandIcon } from '@/components/site/brand-icon'
import { CommandBlock } from '@/components/site/command-block'
import { LandingSections } from '@/components/site/landing-sections'
import { LegacyHashRedirect } from '@/components/site/legacy-hash-redirect'
import { UniversalInput } from '@/components/site/universal-input'
import { buttonVariants } from '@/components/ui/button'

export const metadata: Metadata = {
  alternates: { canonical: '/' },
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareSourceCode',
  name: 'lingo',
  url: 'https://lingo.pascal.app/',
  mainEntityOfPage: 'https://lingo.pascal.app/docs',
  description:
    'Make forms easier and LLM tools safer with natural-language values parsed into typed, span-backed TypeScript data.',
  programmingLanguage: 'TypeScript',
  runtimePlatform: 'JavaScript',
  license: 'MIT',
  codeRepository: 'https://github.com/pascalorg/lingo',
}

export default function Home() {
  return (
    <>
      <LegacyHashRedirect />
      <script
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
        type="application/ld+json"
      />
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 pt-6 pb-8 sm:px-6 sm:pt-10 lg:px-8 lg:py-4">
        {/* The hero keeps its full-height feel on lg; the crawlable content
            sections flow beneath it. */}
        <section className="grid gap-5 py-4 sm:gap-10 sm:py-8 lg:min-h-[calc(100dvh-12rem)] lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:content-center lg:items-center">
          <div className="relative z-30 flex min-w-0 max-w-lg flex-col gap-5">
            <h1 className="text-balance font-semibold text-3xl tracking-normal sm:text-5xl min-[360px]:text-4xl">
              <span className="block text-nowrap">Make forms easier,</span>
              <span className="block text-nowrap">LLM tools safer.</span>
            </h1>
            <div className="flex min-w-0 flex-col gap-5">
              <p className="text-base text-muted-foreground leading-7">
                Use one zero-dependency parser for user-entered quantities, dates, ranges, and model
                tool arguments. Store typed values, canonical units, spans, and warnings.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link className={buttonVariants()} href="/docs">
                  Read the docs
                </Link>
                <a
                  aria-label="npm package"
                  className={buttonVariants({ variant: 'secondary' })}
                  href="https://www.npmjs.com/package/@pascal-app/lingo"
                >
                  <BrandIcon brand="npm" className="opacity-70" data-icon="inline-start" />
                  npm package
                </a>
              </div>
              <CommandBlock className="max-w-md" command="npm install @pascal-app/lingo" />
            </div>
          </div>
          {/* No autoFocus: stealing focus on landing harms keyboard/SR users
              and fights the typewriter demo (Codex a11y review). */}
          <UniversalInput />
        </section>
        <LandingSections />
      </div>
    </>
  )
}
