'use client'

import type { ReactNode } from 'react'

export function FieldHint({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-[10px] leading-relaxed">{children}</p>
}

export function FieldExampleList({ items }: { items: string[] }) {
  return (
    <ul className="list-inside list-disc space-y-0.5 text-[10px] text-muted-foreground leading-relaxed">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

const DEG = '\u00b0'

export function CatalogPlacementFieldGuide() {
  return (
    <details className="rounded-lg border border-border/60 bg-muted/15 px-2.5 py-2 text-xs">
      <summary className="cursor-pointer font-medium text-muted-foreground text-xs select-none">
        フィールド説明と数値例（展開）
      </summary>
      <div className="mt-2 space-y-3 border-border/40 border-t pt-2">
        <section className="space-y-1">
          <p className="font-medium text-[11px]">dimensions（幅 × 高さ × 奥行、メートル）</p>
          <FieldHint>
            配置時の<strong className="font-medium text-foreground">赤/緑のプレースホルダ</strong>
            と、配置可否・衝突判定を決めます。<strong className="font-medium text-foreground">GLB 自体は</strong>
            拡大縮小しません。
          </FieldHint>
          <FieldExampleList
            items={[
              '0.1 × 0.1 × 0.1 — 約 10cm の小物',
              '0.9 × 2.1 × 0.12 — 単開きドア穴の目安（幅 90cm、高 2.1m、厚 12cm）',
              '1.0 × 1.0 × 1.0 — 約 1m 立方（椅子・小テーブルなど）',
              '枠とモデルが合わないときは dimensions を変え、scale で代用しない',
            ]}
          />
        </section>

        <section className="space-y-1">
          <p className="font-medium text-[11px]">scale（GLB の拡大縮小）</p>
          <FieldHint>
            <strong className="font-medium text-foreground">見た目のモデルサイズ</strong>
            のみ変更。赤/緑枠は変わりません。
          </FieldHint>
          <FieldExampleList
            items={[
              '1 — メートル単位の GLB（組み込み家具は多くが 1）',
              '0.1 — ファイルが 10 倍大きいとき、表示を約 1/10 に',
              '0.001 — ミリ単位 CAD（例：900×2100×120 → 約 0.9×2.1×0.12 m）',
              '3 軸は通常同じ値。scale だけでは「置ける」判定は緑になりません',
            ]}
          />
        </section>

        <section className="space-y-1">
          <p className="font-medium text-[11px]">offset（GLB の平行移動、メートル）</p>
          <FieldHint>
            配置点からモデルを移動。<strong className="font-medium text-foreground">枠は動きません</strong>
            。底面接地・扉の壁寄せなどの微調整用。
          </FieldHint>
          <FieldExampleList
            items={[
              '[0, 0, 0] — 追加移動なし（rotation の調整が別途必要なことも）',
              'y = 0.065 — 約 6.5cm 上へ（壁付け照明など）',
              'y = -0.05 — 約 5cm 下へ（浮いているとき）',
            ]}
          />
        </section>

        <section className="space-y-1">
          <p className="font-medium text-[11px]">rotation（ラジアン）</p>
          <FieldHint>
            <strong className="font-medium text-foreground">GLB のみ</strong>回転。枠は回りません。π ≈ 3.1416、90° = π/2 ≈ 1.5708。
          </FieldHint>
          <FieldExampleList
            items={[
              '[0, 0, 0] — エクスポート向きのまま',
              `x = -1.5708（約 -90${DEG}、X 軸）— Z-up の CAD 扉・壁部品を立てる例`,
              `z = 1.5708（約 90${DEG}、Z 軸）— 扉を横にする例`,
            ]}
          />
        </section>

        <section className="space-y-1">
          <p className="font-medium text-[11px]">attachTo（取り付け先）</p>
          <FieldExampleList
            items={[
              '（空）— 床に配置。カーソルは床',
              'wall — 壁厚の中央、両面に占有（スイッチ、貫通部品）',
              'wall-side — 壁の片面（扉、壁付け灯、棚）',
              'ceiling — 天井',
            ]}
          />
        </section>

        <section className="space-y-1 rounded-md bg-background/60 p-2">
          <p className="font-medium text-[11px]">参考：単開きドア（ミリ GLB、壁付け）</p>
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-muted-foreground leading-relaxed">
            {`dimensions: [0.9, 2.1, 0.12]
offset: [0, 0, 0]
rotation: [-1.5708, 0, 0]   // 約 -90° X
scale: [0.001, 0.001, 0.001]
attachTo: 'wall-side'`}
          </pre>
          <FieldHint>モデル URL を入力 →「自動入力」→ 上表で微調整。配置時は壁面にカーソルを合わせる。</FieldHint>
        </section>
      </div>
    </details>
  )
}

export const DIMENSIONS_HINT = (
  <>
    <FieldHint>単位：メートル。赤/緑枠と配置可否を決め、モデルは拡大しません。</FieldHint>
    <FieldExampleList
      items={[
        '0.1 — 約 10cm 角（小物）',
        '1.0 — 約 1m 角（家具の目安）',
        '0.9 × 2.1 — ドア開口の幅・高の目安',
      ]}
    />
  </>
)

export const SCALE_HINT = (
  <>
    <FieldHint>見た目の GLB のみ拡大縮小。枠は dimensions で変更。</FieldHint>
    <FieldExampleList
      items={['1 — メートル単位', '0.001 — ミリ CAD', '0.1 — ファイルが 10 倍大きいとき']}
    />
  </>
)

export const OFFSET_HINT = (
  <>
    <FieldHint>モデルを移動（メートル）。枠は動きません。浮いていれば y、壁付けは z。</FieldHint>
    <FieldExampleList items={['0 — 移動なし', '0.065 — 約 6.5cm 上へ']} />
  </>
)

export const ROTATION_HINT = (
  <>
    <FieldHint>ラジアン。モデルのみ回転。90° ≈ 1.5708。</FieldHint>
    <FieldExampleList items={['0 — 回転なし', '-1.5708 — Z-up CAD を立てる例（X 軸）']} />
  </>
)

export function AttachToHint({ attachTo }: { attachTo: '' | 'wall' | 'wall-side' | 'ceiling' }) {
  if (attachTo === 'wall') {
    return (
      <FieldHint>
        壁厚の中央。両面に占有。非対称の扉 GLB では片側だけ把手が見えることがあります。offset / cutout や wall-side の検討を。
      </FieldHint>
    )
  }
  if (attachTo === 'wall-side') {
    return (
      <FieldHint>
        壁の片面（背面が壁、室内側へ）。単開き扉・壁付け灯向け。カーソルを壁面に合わせて配置。
      </FieldHint>
    )
  }
  if (attachTo === 'ceiling') {
    return <FieldHint>天井下に吊る。カーソルは天井。</FieldHint>
  }
  if (attachTo === '') {
    return <FieldHint>床に配置。カーソルは床。赤/緑枠の底辺が床に付きます。</FieldHint>
  }
  return (
    <FieldHint>
      床：床をクリック。wall / wall-side：壁面をクリック。詳細は上の「フィールド説明」。
    </FieldHint>
  )
}
