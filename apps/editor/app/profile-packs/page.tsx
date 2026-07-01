'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

type InstalledPack = {
  id: string
  name: string
  industry: string
  version: string
  profileCount: number
  layoutCount?: number
  partPresetCount?: number
  qualityRuleCount?: number
  enabled: boolean
  path: string
  description?: string
  dependsOn?: PackDependency[]
  dependedOnBy?: Array<{ id: string; version: string; path: string }>
}

type CloudPack = {
  id: string
  name: string
  industry: string
  version: string
  profileCount: number
  layoutCount?: number
  partPresetCount?: number
  qualityRuleCount?: number
  fileName: string
  installed: boolean
  enabled: boolean
  description?: string
  dependsOn?: PackDependency[]
  auditScore: number
  publishStatus: 'publishable' | 'needs_review' | 'blocked'
  packType: 'basic' | 'extension'
  releaseChannel: 'stable' | 'preview'
  dependencyStatus: 'none' | 'satisfied' | 'missing'
  governanceIssues: string[]
  governanceWarnings: string[]
}

type PackDependency = {
  id: string
  version?: string
}

type ProfileDebug = {
  id: string
  name: string
  source: string
  sourcePack?: { id: string; version: string }
  family: string
  layoutFamily?: string
  primarySemanticRole: string
  partCount: number
  overrides: Array<{
    id: string
    name: string
    source: string
    sourcePack?: { id: string; version: string }
  }>
}

type PackData = {
  packs?: InstalledPack[]
  profileDebug?: ProfileDebug[]
  conflicts?: Array<{
    id: string
    winner: { source: string; sourcePack?: { id: string; version: string } }
    overridden: ProfileDebug['overrides']
  }>
  warnings?: string[]
  summary?: {
    enabledCount?: number
    profileCount?: number
    loadedProfileCount?: number
    conflictCount?: number
  }
}

type CloudCatalog = {
  summary?: {
    packCount?: number
    industryCount?: number
    profileCount?: number
    installedCount?: number
    publishableCount?: number
    needsReviewCount?: number
    blockedCount?: number
  }
  industries?: Array<{
    id: string
    packCount: number
    profileCount: number
    publishableCount: number
    blockedCount: number
  }>
  issues?: string[]
  warnings?: string[]
}

async function jsonOrThrow(response: Response) {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    const message =
      typeof data.message === 'string'
        ? data.message
        : typeof data.error === 'string'
          ? data.error
          : '请求失败'
    throw new Error(translateUiMessage(message))
  }
  return data
}

function packLabel(pack?: { id: string; version: string }) {
  return pack ? `${pack.id}@${pack.version}` : '未归属资源包'
}

const INDUSTRY_LABELS: Record<string, string> = {
  cement: '水泥',
  'discrete-manufacturing': '离散制造',
  'electrolytic-aluminum': '电解铝',
  'fine-chemical': '精细化工',
  'fine-chemical.pharma-intermediate': '医药中间体',
  logistics: '厂内物流',
  'machine-tools': '机床加工',
  process: '流程行业',
  refinery: '炼油',
  robotics: '工业机器人',
  'water-treatment': '水处理',
}

const PACK_NAME_LABELS: Record<string, string> = {
  'industry.cement.basic': '水泥行业基础设备包',
  'industry.discrete-manufacturing.basic': '离散制造基础设备包',
  'industry.electrolytic-aluminum.basic': '电解铝基础设备包',
  'industry.fine-chemical.basic': '精细化工基础设备包',
  'industry.fine-chemical.pharma-intermediate': '精细化工医药中间体扩展包',
  'industry.logistics.basic': '厂内物流基础设备包',
  'industry.machine-tools.basic': '机床基础设备包',
  'industry.process.basic': '流程行业基础设备包',
  'industry.refinery.basic': '炼油厂基础行业包',
  'industry.robotics.basic': '工业机器人基础设备包',
  'industry.water-treatment.basic': '水处理基础设备包',
}

const PACK_DESCRIPTION_LABELS: Record<string, string> = {
  'industry.cement.basic':
    '水泥厂常用生产线设备资源包，覆盖烧成、粉磨、输送、储存、收尘和包装等场景。',
  'industry.discrete-manufacturing.basic':
    '离散制造基础包，覆盖 CNC 加工中心、装配工位、AGV 牵引车、工装台、测试台、物料车和码垛工作站等典型设备。',
  'industry.electrolytic-aluminum.basic':
    '电解铝厂基础设备资源包，覆盖电解车间、氧化铝输送、整流供电、多功能天车、烟气净化、铝液转运、阳极组装、保温炉和铸锭等场景。',
  'industry.fine-chemical.basic':
    '精细化工通用流程设备资源包，覆盖批量反应、分离、换热、干燥、储存、投料和公用工程撬装等场景。',
  'industry.fine-chemical.pharma-intermediate':
    '医药中间体扩展资源包；安装时会自动安装精细化工基础包作为依赖。',
  'industry.logistics.basic': '厂内物流基础设备资源包，覆盖 AGV/AMR 等物料搬运平台。',
  'industry.machine-tools.basic': '机床基础设备资源包，可覆盖内置的通用 CNC 回退模型。',
  'industry.process.basic':
    '流程行业基础包，覆盖搅拌、换热、过滤、离心、干燥、包装、储罐、管廊、阀组、粉体料仓、鼓风机和空压机撬等通用流程设备。',
  'industry.refinery.basic':
    '面向一句话创建炼油厂的基础行业包，覆盖原油罐区、常减压、转化/加氢、硫回收、火炬、公用工程和产品罐区。',
  'industry.robotics.basic':
    '工业机器人几何知识基础包，包含关节机器人设备档案、布局、预设和质量规则。',
  'industry.water-treatment.basic':
    '水处理与污水处理基础设备资源包，覆盖沉淀、加药、过滤、泵送、管廊和污泥脱水等场景。',
}

const PACK_TYPE_LABELS: Record<CloudPack['packType'], string> = {
  basic: '基础包',
  extension: '扩展包',
}

const RELEASE_CHANNEL_LABELS: Record<CloudPack['releaseChannel'], string> = {
  stable: '稳定版',
  preview: '预览版',
}

const PUBLISH_STATUS_LABELS: Record<CloudPack['publishStatus'], string> = {
  publishable: '可发布',
  needs_review: '需复核',
  blocked: '已阻止',
}

const DEPENDENCY_STATUS_LABELS: Record<CloudPack['dependencyStatus'], string> = {
  none: '无依赖',
  satisfied: '已满足',
  missing: '缺失',
}

const SOURCE_LABELS: Record<string, string> = {
  builtin: '内置',
  'profile-pack': '资源包',
  catalog: '目录',
  native: '原生解析器',
}

const FAMILY_LABELS: Record<string, string> = {
  robot: '机器人',
  robotics: '机器人',
  process: '流程设备',
  logistics: '物流设备',
  'machine-tools': '机床',
  conveyor: '输送设备',
  storage: '储存设备',
  utility: '公用工程',
}

function displayIndustry(industry: string) {
  return INDUSTRY_LABELS[industry] ?? industry
}

function displayPackName(pack: { id: string; name?: string }) {
  return PACK_NAME_LABELS[pack.id] ?? pack.name ?? pack.id
}

function displayPackDescription(pack: { id: string; description?: string }) {
  return PACK_DESCRIPTION_LABELS[pack.id] ?? pack.description ?? '暂无说明。'
}

function displaySource(source: string) {
  return SOURCE_LABELS[source] ?? source
}

function displayFamily(family: string) {
  return FAMILY_LABELS[family] ?? family
}

function translateGovernanceMessage(message: string) {
  return message
    .replace(
      /^pack\.json id "([^"]+)" should match industry\.\{industry\}\.\{basic\|extension\}\.$/,
      'pack.json id "$1" 应匹配 industry.{industry}.{basic|extension}。',
    )
    .replace(
      /^pack\.json version "([^"]+)" must be semver\.$/,
      'pack.json version "$1" 必须是语义化版本。',
    )
    .replace(
      /^pack\.json schemaVersion "([^"]+)" is not the current 1\.1\.$/,
      'pack.json schemaVersion "$1" 不是当前版本 1.1。',
    )
    .replace(
      /^pack\.json description is recommended for cloud publishing\.$/,
      '建议在 pack.json 中填写 description，便于云端发布。',
    )
    .replace(
      /^pack\.json locale is recommended for cloud publishing\.$/,
      '建议在 pack.json 中填写 locale，便于云端发布。',
    )
    .replace(
      /^Pack includes factory resources but does not declare capabilities: \["factory_creation"\]\.$/,
      '资源包包含工厂资源，但未声明 capabilities: ["factory_creation"]。',
    )
    .replace(
      /^Duplicate profile id "([^"]+)" in package\.$/,
      '资源包中存在重复的设备档案 ID "$1"。',
    )
    .replace(/^Duplicate (.+) id "([^"]+)" in package\.$/, '资源包中存在重复的 $1 ID "$2"。')
    .replace(
      /^Factory-capable pack must include at least one factoryArchitectures resource in pack\.json\.$/,
      '支持工厂创建的资源包必须在 pack.json 中包含至少一个 factoryArchitectures 资源。',
    )
    .replace(
      /^Factory-capable pack must include at least one processTemplates resource in pack\.json\.$/,
      '支持工厂创建的资源包必须在 pack.json 中包含至少一个 processTemplates 资源。',
    )
    .replace(
      /^Profile ([^ ]+) should declare aliases for inference\.$/,
      '设备档案 $1 建议声明 aliases 以便推理匹配。',
    )
    .replace(
      /^Profile ([^ ]+) industry "([^"]+)" differs from package industry "([^"]+)"\.$/,
      '设备档案 $1 的行业 "$2" 与资源包行业 "$3" 不一致。',
    )
    .replace(
      /^Profile ([^ ]+) references missing layoutTemplate "([^"]+)"\.$/,
      '设备档案 $1 引用了缺失的布局模板 "$2"。',
    )
    .replace(
      /^Profile ([^ ]+) references missing editableSchemaRef "([^"]+)"\.$/,
      '设备档案 $1 引用了缺失的可编辑结构 "$2"。',
    )
    .replace(
      /^Profile ([^ ]+) partPresets\.([^ ]+) references missing preset "([^"]+)"\.$/,
      '设备档案 $1 的 partPresets.$2 引用了缺失的预设 "$3"。',
    )
    .replace(
      /^Stable profile ([^ ]+) must reference qualityRules\.$/,
      '稳定设备档案 $1 必须引用 qualityRules。',
    )
    .replace(
      /^Profile ([^ ]+) references missing qualityRules "([^"]+)"\.$/,
      '设备档案 $1 引用了缺失的质量规则 "$2"。',
    )
    .replace(
      /^Quality rule ([^ ]+) should declare requiredRoles\.$/,
      '质量规则 $1 建议声明 requiredRoles。',
    )
    .replace(
      /^Quality rule ([^ ]+) does not explicitly include primarySemanticRole "([^"]+)"\.$/,
      '质量规则 $1 未显式包含 primarySemanticRole "$2"。',
    )
    .replace(/^Invalid source package ([^:]+): (.+)$/, '源资源包 $1 无效：$2')
    .replace(/^Invalid cloud zip ([^:]+): (.+)$/, '云端 ZIP $1 无效：$2')
}

function translateUiMessage(message: string) {
  return translateGovernanceMessage(message)
    .replace(/^Cloud profile pack not found\.$/, '未找到云端资源包。')
    .replace(
      /^Cloud profile pack is blocked by governance checks: (.+)$/,
      '云端资源包未通过治理检查：$1',
    )
    .replace(/^Profile pack dependency cycle detected at (.+)\.$/, '检测到资源包依赖循环：$1。')
    .replace(/^Required profile pack dependency not found: (.+)\.$/, '未找到必需的资源包依赖：$1。')
    .replace(/^Invalid cloud profile pack filename\.$/, '云端资源包文件名无效。')
    .replace(/^Cloud profile pack path escapes cloud root\.$/, '云端资源包路径超出云目录。')
    .replace(/^Profile pack not found\.$/, '未找到资源包。')
    .replace(
      /^Profile pack is required by enabled pack\(s\): (.+)\.$/,
      '该资源包正被已启用资源包依赖：$1。',
    )
    .replace(/^Profile pack path escapes store root\.$/, '资源包路径超出存储目录。')
}

export default function ProfilePacksPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [installedPacks, setInstalledPacks] = useState<InstalledPack[]>([])
  const [cloudPacks, setCloudPacks] = useState<CloudPack[]>([])
  const [cloudCatalog, setCloudCatalog] = useState<CloudCatalog | null>(null)
  const [profileDebug, setProfileDebug] = useState<ProfileDebug[]>([])
  const [conflicts, setConflicts] = useState<PackData['conflicts']>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [installedResponse, cloudResponse] = await Promise.all([
      fetch('/api/profile-packs', { cache: 'no-store' }),
      fetch('/api/profile-packs/cloud', { cache: 'no-store' }),
    ])
    const installedData = (await jsonOrThrow(installedResponse)) as PackData
    const cloudData = (await jsonOrThrow(cloudResponse)) as {
      packs?: CloudPack[]
      catalog?: CloudCatalog
    }
    setInstalledPacks(Array.isArray(installedData.packs) ? installedData.packs : [])
    setProfileDebug(Array.isArray(installedData.profileDebug) ? installedData.profileDebug : [])
    setConflicts(Array.isArray(installedData.conflicts) ? installedData.conflicts : [])
    setWarnings(Array.isArray(installedData.warnings) ? installedData.warnings : [])
    setCloudPacks(Array.isArray(cloudData.packs) ? cloudData.packs : [])
    setCloudCatalog(cloudData.catalog ?? null)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    refresh()
      .catch((error) => {
        if (!cancelled) {
          setMessage(translateUiMessage(error instanceof Error ? error.message : String(error)))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  async function runAction(key: string, action: () => Promise<string>) {
    setBusyKey(key)
    setMessage(null)
    try {
      const nextMessage = await action()
      await refresh()
      setMessage(nextMessage)
    } catch (error) {
      setMessage(translateUiMessage(error instanceof Error ? error.message : String(error)))
    } finally {
      setBusyKey(null)
    }
  }

  async function importLocalPack(file: File | undefined) {
    if (!file) return
    await runAction(`import:${file.name}`, async () => {
      const form = new FormData()
      form.set('file', file)
      const data = (await jsonOrThrow(
        await fetch('/api/profile-packs', { method: 'POST', body: form }),
      )) as { pack?: InstalledPack }
      return data.pack
        ? `已导入并启用 ${displayPackName(data.pack)}（${data.pack.profileCount} 个设备档案）。`
        : '已导入资源包。'
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const enabledPacks = installedPacks.filter((pack) => pack.enabled)
  const enabledProfileCount = enabledPacks.reduce((sum, pack) => sum + pack.profileCount, 0)

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f6f8fb] px-5 py-5 text-[#101114] sm:px-6">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(15,23,42,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.045)_1px,transparent_1px)] bg-[size:72px_72px]" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_78%_0%,rgba(166,132,255,0.18),transparent_30%),radial-gradient(circle_at_12%_16%,rgba(45,212,191,0.16),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.25),rgba(246,248,251,0.9))]" />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="relative overflow-hidden rounded-lg border border-slate-900/80 bg-[#0b0d12] p-5 text-white shadow-xl shadow-slate-300/80">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.055)_1px,transparent_1px)] bg-[size:56px_56px]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_78%_0%,rgba(166,132,255,0.24),transparent_32%),radial-gradient(circle_at_18%_24%,rgba(45,212,191,0.14),transparent_28%)]" />
          <div className="relative flex flex-wrap items-center justify-between gap-5">
            <div>
              <div className="text-white/82">
                <span className="font-medium text-sm text-white">supOS 3D Factory</span>
                <span className="ml-2 align-middle font-mono text-[10px]">
                  <span className="bg-gradient-to-r from-[#a684ff] to-cyan-500 bg-clip-text text-transparent">
                    AI-Powered
                  </span>
                  <span className="text-white/48"> Industrial Modeling</span>
                </span>
              </div>
              <h1 className="mt-2 font-semibold text-3xl tracking-normal text-white">
                行业资源包管理
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-white/58 leading-6">
                管理行业知识包、设备档案和质量规则，让 AI 生成的厂区设备更稳定、更可复用。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                className="rounded-md border border-white/12 bg-white/[0.045] px-3 py-2 text-sm text-white/78 transition-colors hover:border-white/24 hover:bg-white/[0.08] hover:text-white"
                href="/"
              >
                返回
              </Link>
              <input
                accept=".zip,application/zip,application/x-zip-compressed"
                className="hidden"
                onChange={(event) => void importLocalPack(event.currentTarget.files?.[0])}
                ref={fileInputRef}
                type="file"
              />
              <button
                className="rounded-md border border-cyan-200/45 bg-gradient-to-r from-cyan-300 to-[#a684ff] px-3 py-2 text-[#071013] text-sm shadow-[0_0_24px_rgba(45,212,191,0.18)] transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busyKey != null}
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                导入 ZIP
              </button>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="已安装资源包" value={installedPacks.length} />
          <Stat label="已启用资源包" value={enabledPacks.length} />
          <Stat label="已启用设备档案" value={enabledProfileCount} />
          <Stat label="覆盖冲突" value={conflicts?.length ?? 0} />
          <Stat label="行业数量" value={cloudCatalog?.summary?.industryCount ?? 0} />
          <Stat label="设备档案数" value={cloudCatalog?.summary?.profileCount ?? 0} />
          <Stat label="可用行业包" value={cloudCatalog?.summary?.publishableCount ?? 0} />
          <Stat label="阻止资源包" value={cloudCatalog?.summary?.blockedCount ?? 0} />
        </section>

        {message ? (
          <div className="rounded-md border border-[#a684ff]/20 bg-[#a684ff]/8 px-3 py-2 text-[#4f3da3] text-sm">
            {message}
          </div>
        ) : null}

        <section className="overflow-hidden rounded-lg border border-slate-900/10 bg-white/42 shadow-sm shadow-slate-200/60 backdrop-blur">
          <div className="flex items-end justify-between gap-3 border-slate-900/10 border-b bg-slate-950 px-4 py-3 text-white">
            <div>
              <div className="font-mono text-[11px] text-cyan-200/70">Industry Packs</div>
              <h2 className="font-semibold text-white text-xl">行业包信息</h2>
            </div>
          </div>
          {cloudPacks.length === 0 ? (
            <div className="p-4">
              <EmptyState text="暂无可用行业包信息。" />
            </div>
          ) : (
            <div className="grid gap-3 p-4 lg:grid-cols-2">
              {cloudPacks.map((pack) => (
                <CloudPackCard
                  busy={busyKey != null}
                  key={pack.fileName}
                  pack={pack}
                  onInstall={() =>
                    runAction(`cloud:${pack.id}@${pack.version}`, async () => {
                      const data = (await jsonOrThrow(
                        await fetch('/api/profile-packs/cloud', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id: pack.id, version: pack.version }),
                        }),
                      )) as {
                        pack?: InstalledPack
                        installedDependencies?: InstalledPack[]
                      }
                      const dependencyNames =
                        data.installedDependencies
                          ?.map((dependency) => displayPackName(dependency))
                          .filter(Boolean) ?? []
                      return data.pack
                        ? `已下载并启用 ${displayPackName(data.pack)}${
                            dependencyNames.length
                              ? `，同时安装 ${dependencyNames.join('、')}。`
                              : '。'
                          }`
                        : `已下载 ${displayPackName(pack)}。`
                    })
                  }
                />
              ))}
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-lg border border-white/70 bg-white/35 shadow-sm shadow-slate-200/50 backdrop-blur">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 border-white/10 border-b bg-[#151824] px-4 py-3">
              <h2 className="font-semibold text-white text-xl">已安装资源包</h2>
              <button
                className="rounded-md border border-white/12 bg-white/[0.06] px-2.5 py-1.5 text-white/68 text-xs transition-colors hover:border-cyan-200/35 hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                disabled={loading || busyKey != null}
                onClick={() => void runAction('refresh', async () => '资源包状态已刷新。')}
                type="button"
              >
                刷新
              </button>
            </div>
            {loading ? (
              <div className="px-4 pb-4">
                <EmptyState text="正在加载资源包..." />
              </div>
            ) : installedPacks.length === 0 ? (
              <div className="px-4 pb-4">
                <EmptyState text="尚未安装资源包。可以导入本地 ZIP 开始使用。" />
              </div>
            ) : (
              <div className="grid gap-3 px-4 pb-4">
                {installedPacks.map((pack) => (
                  <PackCard
                    busy={busyKey != null}
                    key={pack.path}
                    pack={pack}
                    onDelete={() =>
                      runAction(`delete:${pack.path}`, async () => {
                        await jsonOrThrow(
                          await fetch(`/api/profile-packs/${encodeURIComponent(pack.path)}`, {
                            method: 'DELETE',
                          }),
                        )
                        return `已删除 ${displayPackName(pack)}。`
                      })
                    }
                    onToggle={() =>
                      runAction(`toggle:${pack.path}`, async () => {
                        await jsonOrThrow(
                          await fetch(`/api/profile-packs/${encodeURIComponent(pack.path)}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ enabled: !pack.enabled }),
                          }),
                        )
                        return pack.enabled
                          ? `已停用 ${displayPackName(pack)}。`
                          : `已启用 ${displayPackName(pack)}。`
                      })
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-3">
            <h2 className="font-semibold text-[#111318] text-xl">覆盖冲突</h2>
            {conflicts?.length ? (
              <div className="grid gap-3">
                {conflicts.map((conflict) => (
                  <article
                    className="rounded-lg border border-white/80 bg-white/82 p-4 shadow-sm shadow-slate-200/70 backdrop-blur"
                    key={conflict.id}
                  >
                    <div className="font-medium">{conflict.id}</div>
                    <div className="mt-1 text-slate-500 text-sm">
                      生效来源：{displaySource(conflict.winner.source)} /{' '}
                      {packLabel(conflict.winner.sourcePack)}
                    </div>
                    <div className="mt-2 space-y-1 text-slate-500 text-xs">
                      {conflict.overridden.map((entry) => (
                        <div key={`${entry.source}:${entry.id}:${packLabel(entry.sourcePack)}`}>
                          覆盖 {displaySource(entry.source)} / {packLabel(entry.sourcePack)}
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState text="当前没有启用中的设备档案覆盖。" />
            )}
          </div>

          <div className="space-y-3">
            <h2 className="font-semibold text-[#111318] text-xl">设备档案调试</h2>
            <div className="max-h-[420px] overflow-auto rounded-lg border border-white/80 bg-white/82 shadow-sm shadow-slate-200/70 backdrop-blur">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-white/95 text-slate-500 text-xs backdrop-blur">
                  <tr>
                    <th className="px-3 py-2">设备档案</th>
                    <th className="px-3 py-2">来源</th>
                    <th className="px-3 py-2">类别</th>
                    <th className="px-3 py-2">部件</th>
                  </tr>
                </thead>
                <tbody>
                  {profileDebug.map((profile) => (
                    <tr
                      className="border-slate-100 border-t"
                      key={`${profile.source}:${profile.id}`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-medium">{profile.name}</div>
                        <div className="font-mono text-slate-400 text-xs">{profile.id}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {displaySource(profile.source)}
                        {profile.sourcePack ? (
                          <div className="font-mono text-xs">{packLabel(profile.sourcePack)}</div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {displayFamily(profile.family)}
                        <div className="font-mono text-xs">
                          {profile.layoutFamily ? displayFamily(profile.layoutFamily) : '无布局'}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {profile.partCount}
                        <div className="font-mono text-xs">{profile.primarySemanticRole}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {warnings.length ? (
          <section className="rounded-lg border border-amber-500/30 bg-amber-50/90 p-4 shadow-sm shadow-amber-100/70">
            <h2 className="font-medium text-amber-700 text-sm dark:text-amber-300">加载警告</h2>
            <ul className="mt-2 space-y-1 text-slate-600 text-xs">
              {warnings.map((warning) => (
                <li key={warning}>{translateGovernanceMessage(warning)}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {cloudCatalog?.issues?.length || cloudCatalog?.warnings?.length ? (
          <section className="rounded-lg border border-white/80 bg-white/82 p-4 shadow-sm shadow-slate-200/70 backdrop-blur">
            <h2 className="font-medium text-sm">云端治理提示</h2>
            <ul className="mt-2 space-y-1 text-slate-600 text-xs">
              {cloudCatalog.issues?.map((issue) => (
                <li className="text-destructive" key={issue}>
                  {translateGovernanceMessage(issue)}
                </li>
              ))}
              {cloudCatalog.warnings?.map((warning) => (
                <li key={warning}>{translateGovernanceMessage(warning)}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-white/80 bg-white/78 p-3 shadow-sm shadow-slate-200/70 backdrop-blur sm:p-4">
      <div className="text-slate-500 text-xs">{label}</div>
      <div className="mt-1 font-semibold text-2xl text-[#111318] sm:text-3xl">{value}</div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-white/58 p-8 text-center text-slate-500 text-sm">
      {text}
    </div>
  )
}

function PackMeta({ pack }: { pack: CloudPack | InstalledPack }) {
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
        <span className="rounded border border-slate-200 bg-white/70 px-1.5 py-0.5">
          {displayIndustry(pack.industry)}
        </span>
        <span className="rounded border border-slate-200 bg-white/70 px-1.5 py-0.5">
          v{pack.version}
        </span>
        <span className="rounded border border-slate-200 bg-white/70 px-1.5 py-0.5">
          {pack.profileCount} 个设备档案
        </span>
        {'packType' in pack ? (
          <span className="rounded border border-slate-200 bg-white/70 px-1.5 py-0.5">
            {PACK_TYPE_LABELS[pack.packType]}
          </span>
        ) : null}
        {'releaseChannel' in pack ? (
          <span className="rounded border border-slate-200 bg-white/70 px-1.5 py-0.5">
            {RELEASE_CHANNEL_LABELS[pack.releaseChannel]}
          </span>
        ) : null}
        {'fileName' in pack ? (
          <span className="rounded border border-slate-200 bg-white/70 px-1.5 py-0.5">
            {pack.fileName}
          </span>
        ) : null}
      </div>
      {pack.dependsOn?.length ? (
        <div className="mt-2 text-slate-500 text-xs">
          将自动安装：{' '}
          {pack.dependsOn
            .map((dependency) =>
              dependency.version
                ? `${PACK_NAME_LABELS[dependency.id] ?? dependency.id} ${dependency.version}`
                : (PACK_NAME_LABELS[dependency.id] ?? dependency.id),
            )
            .join('、')}
        </div>
      ) : null}
    </>
  )
}

function CloudGovernanceBadge({ status }: { status: CloudPack['publishStatus'] }) {
  const className =
    status === 'publishable'
      ? 'border-emerald-500/35 bg-emerald-50 text-emerald-700'
      : status === 'blocked'
        ? 'border-red-500/35 bg-red-50 text-red-700'
        : 'border-amber-500/35 bg-amber-50 text-amber-700'
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[11px] ${className}`}>
      {PUBLISH_STATUS_LABELS[status]}
    </span>
  )
}

function CloudGovernanceMeta({ pack }: { pack: CloudPack }) {
  const score = Math.round(pack.auditScore * 100)
  return (
    <div className="mt-2 space-y-1 text-slate-500 text-xs">
      <div>
        QA 得分：{score} / 依赖状态：{DEPENDENCY_STATUS_LABELS[pack.dependencyStatus]}
      </div>
      {pack.governanceIssues.length ? (
        <ul className="space-y-1 text-red-600">
          {pack.governanceIssues.slice(0, 3).map((issue) => (
            <li key={issue}>{translateGovernanceMessage(issue)}</li>
          ))}
        </ul>
      ) : null}
      {!pack.governanceIssues.length && pack.governanceWarnings.length ? (
        <div>{pack.governanceWarnings.length} 条治理警告</div>
      ) : null}
    </div>
  )
}

function CloudPackCard({
  busy,
  onInstall,
  pack,
}: {
  busy: boolean
  onInstall: () => Promise<void>
  pack: CloudPack
}) {
  return (
    <article className="rounded-lg border border-white/80 bg-white/82 p-4 shadow-sm shadow-slate-200/70 backdrop-blur transition-colors hover:border-[#a684ff]/35">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{displayPackName(pack)}</h3>
            <CloudGovernanceBadge status={pack.publishStatus} />
          </div>
          <p className="mt-2 text-slate-500 text-sm">{displayPackDescription(pack)}</p>
          <PackMeta pack={pack} />
          <CloudGovernanceMeta pack={pack} />
        </div>
        <button
          className="shrink-0 rounded-md border border-[#a684ff]/45 bg-[#a684ff]/12 px-2.5 py-1.5 text-[#5c45bd] text-sm transition-colors hover:bg-[#a684ff]/20 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy || pack.publishStatus === 'blocked'}
          onClick={() => void onInstall()}
          type="button"
        >
          {pack.installed ? '重新安装' : '下载'}
        </button>
      </div>
    </article>
  )
}

function PackCard({
  busy,
  pack,
  onDelete,
  onToggle,
}: {
  busy: boolean
  pack: InstalledPack
  onDelete: () => Promise<void>
  onToggle: () => Promise<void>
}) {
  return (
    <article className="rounded-lg border border-white/80 bg-white/82 p-4 shadow-sm shadow-slate-200/70 backdrop-blur transition-colors hover:border-[#a684ff]/35">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{displayPackName(pack)}</h3>
            <span
              className={
                pack.enabled
                  ? 'rounded border border-emerald-500/35 bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700'
                  : 'rounded border border-slate-200 bg-white/70 px-1.5 py-0.5 text-[11px] text-slate-500'
              }
            >
              {pack.enabled ? '已启用' : '已停用'}
            </span>
          </div>
          <p className="mt-2 text-slate-500 text-sm">{displayPackDescription(pack)}</p>
          <PackMeta pack={pack} />
          {pack.dependedOnBy?.length ? (
            <div className="mt-2 text-slate-500 text-xs">
              被以下资源包依赖：{' '}
              {pack.dependedOnBy
                .map((dependent) => PACK_NAME_LABELS[dependent.id] ?? dependent.id)
                .join('、')}
            </div>
          ) : null}
          <div className="mt-2 font-mono text-[11px] text-slate-400">{pack.path}</div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            className="rounded-md border border-slate-200 bg-white/75 px-2.5 py-1.5 text-slate-700 text-sm transition-colors hover:border-[#a684ff]/45 hover:bg-[#a684ff]/8 hover:text-[#5c45bd] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => void onToggle()}
            type="button"
          >
            {pack.enabled ? '停用' : '启用'}
          </button>
          <button
            className="rounded-md border border-red-200 bg-white/75 px-2.5 py-1.5 text-red-600 text-sm transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => void onDelete()}
            type="button"
          >
            删除
          </button>
        </div>
      </div>
    </article>
  )
}
