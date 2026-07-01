import {
  ArrowRight,
  Bot,
  Building2,
  Factory,
  FolderOpen,
  Layers3,
  type LucideIcon,
  Package,
  Sparkles,
} from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { CreateSceneButton } from '@/components/save-button'

type Pillar = {
  body: string
  icon: LucideIcon
  title: string
}

const pillars: Pillar[] = [
  {
    title: '搭建厂区空间',
    body: '用站点、建筑、楼层、墙体、楼板、屋顶和区域组织 3D 场景，支持 2D / 3D 协同审阅。',
    icon: Building2,
  },
  {
    title: '生成可编辑设备',
    body: 'AI harness 将自然语言转成 primitive、assembly 与工业设备草稿，并保留可编辑结构。',
    icon: Bot,
  },
  {
    title: '沉淀行业资产',
    body: '通过行业资源包、设备档案、材质资产、数据节点和场景保存能力复用工程成果。',
    icon: Factory,
  },
]

function HeaderLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <Link
      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.035] px-3 font-medium text-sm text-white/78 transition-colors hover:border-white/22 hover:bg-white/[0.065] hover:text-white"
      href={href}
    >
      {children}
    </Link>
  )
}

function SceneActionLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <Link
      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#a684ff]/60 bg-[#a684ff]/18 px-4 font-medium text-sm text-white transition-colors hover:bg-[#a684ff]/28"
      href={href}
    >
      {children}
    </Link>
  )
}

function FactoryPreview() {
  return (
    <div className="relative overflow-hidden rounded-lg border border-white/10 bg-[#0b0d10]">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:48px_48px]" />
      <div className="absolute inset-0 bg-[linear-gradient(140deg,rgba(166,132,255,0.16),transparent_32%,rgba(45,212,191,0.1)_72%,transparent)]" />

      <div className="relative aspect-[1.08] min-h-[340px] sm:aspect-[1.35]">
        <div className="absolute left-[12%] top-[34%] h-[30%] w-[62%] skew-y-[-18deg] border border-[#a684ff]/55 bg-[#a684ff]/10 shadow-[0_0_48px_rgba(166,132,255,0.16)]" />
        <div className="absolute left-[32%] top-[20%] h-[25%] w-[52%] skew-y-[-18deg] border border-cyan-200/40 bg-cyan-200/8" />
        <div className="absolute left-[44%] top-[49%] h-[23%] w-[38%] skew-y-[-18deg] border border-emerald-200/36 bg-emerald-200/8" />

        <div className="absolute left-[24%] top-[18%] h-[46%] w-1.5 skew-y-[-18deg] bg-white/16" />
        <div className="absolute left-[52%] top-[28%] h-[38%] w-1.5 skew-y-[-18deg] bg-white/16" />
        <div className="absolute left-[66%] top-[41%] h-[31%] w-1.5 skew-y-[-18deg] bg-white/16" />

        <div className="absolute right-5 bottom-5 rounded-md border border-white/10 bg-[#101114]/80 px-3 py-2 backdrop-blur">
          <div className="flex items-center gap-2">
            <Sparkles aria-hidden className="size-3.5 text-[#a684ff]" />
            <span className="font-medium text-white text-xs">AI layout ready</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function PillarCard({ pillar }: { pillar: Pillar }) {
  const Icon = pillar.icon

  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-md border border-[#a684ff]/35 bg-[#a684ff]/10 text-[#d8ccff]">
          <Icon aria-hidden className="size-4" strokeWidth={1.8} />
        </span>
        <h3 className="font-medium text-white text-sm">{pillar.title}</h3>
      </div>
      <p className="mt-4 text-[13px] text-white/56 leading-6">{pillar.body}</p>
    </article>
  )
}

export default function Home() {
  return (
    <main className="min-h-screen bg-[#07080a] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.026)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.026)_1px,transparent_1px)] bg-[size:86px_86px]" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_64%_12%,rgba(166,132,255,0.16),transparent_34%),linear-gradient(180deg,transparent,rgba(45,212,191,0.055)_82%,transparent)]" />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col px-5 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4">
          <Link className="flex min-w-0 items-center gap-3" href="/">
            <span className="grid size-8 shrink-0 grid-cols-2 gap-1 rounded-md border border-white/10 bg-white/[0.04] p-1.5">
              <span className="rounded-sm bg-white/90" />
              <span className="rounded-sm bg-[#a684ff]" />
              <span className="rounded-sm bg-cyan-200/80" />
              <span className="rounded-sm bg-white/45" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-sm text-white/88">supOS 3D Factory</span>
              <span className="font-mono text-[9px]">
                <span className="bg-gradient-to-r from-[#a684ff] to-cyan-200 bg-clip-text text-transparent">
                  AI-Powered
                </span>
                <span className="text-white/52"> Industrial Modeling</span>
              </span>
            </span>
          </Link>

          <nav className="flex items-center gap-2">
            <HeaderLink href="/scenes">
              <FolderOpen aria-hidden className="size-4" />
              <span className="sr-only sm:not-sr-only">全部场景</span>
            </HeaderLink>
            <HeaderLink href="/profile-packs">
              <Package aria-hidden className="size-4" />
              <span className="sr-only sm:not-sr-only">资源包</span>
            </HeaderLink>
          </nav>
        </header>

        <section className="grid min-h-[calc(100vh-88px)] items-center gap-12 py-16 lg:grid-cols-[0.9fr_1.1fr] lg:py-20">
          <div>
            <p className="font-mono text-[11px] text-[#d8ccff] uppercase">
              AI-native 3D factory workspace
            </p>
            <h1 className="mt-5 max-w-3xl font-semibold text-5xl text-white leading-[1.02] tracking-normal sm:text-6xl">
              supOS 3D Factory
              <span className="mt-3 block font-mono font-normal text-sm tracking-normal sm:text-base">
                <span className="bg-gradient-to-r from-[#a684ff] to-cyan-200 bg-clip-text text-transparent">
                  AI-Powered
                </span>
                <span className="text-white/58"> Industrial Modeling</span>
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-base text-white/60 leading-8">
              面向工业厂区的三维场景编辑器。把空间结构、设备资产、AI
              生成与行业知识包收在一个清爽的工作台里。
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <div className="[&_button]:h-11 [&_button]:min-w-36 [&_button]:rounded-md [&_button]:border-cyan-200/55 [&_button]:!bg-[linear-gradient(135deg,rgba(45,212,191,0.95),rgba(166,132,255,0.78))] [&_button]:px-6 [&_button]:py-0 [&_button]:font-semibold [&_button]:text-[#071013] [&_button]:text-sm [&_button]:shadow-[0_0_26px_rgba(45,212,191,0.22)] [&_button]:transition-[filter,transform] [&_button:hover]:!bg-[linear-gradient(135deg,rgba(103,232,249,1),rgba(166,132,255,0.9))] [&_button:hover]:brightness-110">
                <CreateSceneButton label="新建场景" />
              </div>
              <SceneActionLink href="/scenes">
                打开场景库
                <ArrowRight aria-hidden className="size-4" />
              </SceneActionLink>
            </div>
          </div>

          <FactoryPreview />
        </section>

        <section className="border-white/10 border-t py-16">
          <div className="max-w-2xl">
            <p className="font-mono text-[11px] text-[#a684ff] uppercase">Core capabilities</p>
            <h2 className="mt-3 font-semibold text-3xl text-white">核心能力</h2>
          </div>

          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {pillars.map((pillar) => (
              <PillarCard key={pillar.title} pillar={pillar} />
            ))}
          </div>

          <div className="mt-10 rounded-lg border border-white/10 bg-white/[0.025] p-5 sm:flex sm:items-center sm:justify-between sm:gap-8">
            <div className="flex items-center gap-3">
              <Layers3 aria-hidden className="size-4 text-cyan-200" />
              <span className="font-medium text-sm text-white">功能覆盖</span>
            </div>
            <p className="mt-3 max-w-3xl text-[13px] text-white/52 leading-6 sm:mt-0">
              空间建模、2D / 3D 协同、AI
              可编辑几何、行业资源包、材质资产、数据节点、场景保存与导出。
            </p>
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-white/10 border-t py-5 text-[11px] text-white/38">
          <span>supOS 3D Factory · AI-Powered Industrial Modeling</span>
          <span>@pascal-app/core / viewer / editor</span>
        </footer>
      </div>
    </main>
  )
}
