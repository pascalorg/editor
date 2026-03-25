import { Keyboard } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from './../../../../../components/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './../../../../../components/ui/primitives/dialog'

type Shortcut = {
  keys: string[]
  action: string
  note?: string
}

type ShortcutCategory = {
  title: string
  shortcuts: Shortcut[]
}

const KEY_DISPLAY_MAP: Record<string, string> = {
  'Arrow Up': '↑',
  'Arrow Down': '↓',
  Esc: '⎋',
  Shift: '⇧',
  Space: '␣',
}

const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  {
    title: 'エディタ移動',
    shortcuts: [
      { keys: ['1'], action: 'Site フェーズに切り替え' },
      { keys: ['2'], action: 'Structure フェーズに切り替え' },
      { keys: ['3'], action: 'Furnish フェーズに切り替え' },
      { keys: ['S'], action: 'Structure レイヤーに切り替え' },
      { keys: ['F'], action: 'Furnish レイヤーに切り替え' },
      { keys: ['Z'], action: 'Zones レイヤーに切り替え' },
      {
        keys: ['Cmd/Ctrl', 'Arrow Up'],
        action: '現在の建物で次のレベルを選択',
      },
      {
        keys: ['Cmd/Ctrl', 'Arrow Down'],
        action: '現在の建物で前のレベルを選択',
      },
      { keys: ['Cmd/Ctrl', 'B'], action: 'サイドバーを切り替え' },
      { keys: ['Cmd/Ctrl', 'Shift', 'B'], action: 'サイドバー UI の表示を切り替え' },
      { keys: ['Cmd/Ctrl', 'Shift', 'P'], action: 'インスペクターパネルの表示を切り替え' },
    ],
  },
  {
    title: 'モードと履歴',
    shortcuts: [
      { keys: ['V'], action: 'Select モードに切り替え' },
      { keys: ['B'], action: 'Build モードに切り替え' },
      {
        keys: ['Esc'],
        action: 'ツールを中止し、選択を解除して Build モードを終了',
      },
      { keys: ['Delete / Backspace'], action: '選択中のオブジェクトを削除' },
      { keys: ['Cmd/Ctrl', 'Z'], action: '元に戻す' },
      { keys: ['Cmd/Ctrl', 'Shift', 'Z'], action: 'やり直す' },
    ],
  },
  {
    title: '選択',
    shortcuts: [
      {
        keys: ['Cmd/Ctrl', 'Click'],
        action: '複数選択にオブジェクトを追加または削除',
        note: 'Select モードで動作します。',
      },
    ],
  },
  {
    title: '作図ツール',
    shortcuts: [
      {
        keys: ['Shift'],
        action: 'wall、slab、ceiling 作図中の角度スナップを一時的に無効化',
        note: '作図中に押し続けます。',
      },
    ],
  },
  {
    title: 'アイテム配置',
    shortcuts: [
      { keys: ['R'], action: 'アイテムを 90 度時計回りに回転' },
      { keys: ['T'], action: 'アイテムを 90 度反時計回りに回転' },
      {
        keys: ['Shift'],
        action: '配置制約チェックを一時的に無効化',
        note: '配置中に押し続けます。',
      },
    ],
  },
  {
    title: 'カメラ',
    shortcuts: [
      {
        keys: ['Space', 'Drag'],
        action: 'カメラを移動',
        note: 'マウスドラッグ中に Space を押し続けます。',
      },
      {
        keys: ['Trackpad scroll'],
        action: 'プレビューでズーム',
      },
      {
        keys: ['Shift', 'Trackpad scroll'],
        action: 'プレビューで移動',
      },
      {
        keys: ['Alt/Option', 'Trackpad scroll'],
        action: 'プレビューで回転',
      },
    ],
  },
]

function getDisplayKey(key: string, isMac: boolean): string {
  if (key === 'Cmd/Ctrl') return isMac ? '⌘' : 'Ctrl'
  if (key === 'Delete / Backspace') return isMac ? '⌫' : 'Backspace'
  return KEY_DISPLAY_MAP[key] ?? key
}

function ShortcutKeys({ keys }: { keys: string[] }) {
  const [isMac, setIsMac] = useState(true)

  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().indexOf('MAC') >= 0)
  }, [])

  return (
    <div className="flex flex-wrap items-center gap-1">
      {keys.map((key, index) => (
        <div className="flex items-center gap-1" key={`${key}-${index}`}>
          {index > 0 ? <span className="text-[10px] text-muted-foreground">+</span> : null}
          <kbd
            className="inline-flex h-6 items-center rounded border border-border bg-muted px-2 font-medium font-mono text-[11px] text-muted-foreground"
            title={key}
          >
            {getDisplayKey(key, isMac)}
          </kbd>
        </div>
      ))}
    </div>
  )
}

export function KeyboardShortcutsDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="w-full justify-start gap-2" variant="outline">
          <Keyboard className="size-4" />
          キーボードショートカット
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>キーボードショートカット</DialogTitle>
          <DialogDescription>
            ショートカットは現在のフェーズやツールに応じて変わります。
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-4">
          {SHORTCUT_CATEGORIES.map((category) => (
            <section className="space-y-2" key={category.title}>
              <h3 className="font-medium text-sm">{category.title}</h3>
              <div className="overflow-hidden rounded-md border border-border/80">
                {category.shortcuts.map((shortcut, index) => (
                  <div
                    className="grid grid-cols-[minmax(130px,220px)_1fr] gap-3 px-3 py-2"
                    key={`${category.title}-${shortcut.action}`}
                  >
                    <ShortcutKeys keys={shortcut.keys} />
                    <div>
                      <p className="text-sm">{shortcut.action}</p>
                      {shortcut.note ? (
                        <p className="text-muted-foreground text-xs">{shortcut.note}</p>
                      ) : null}
                    </div>
                    {index < category.shortcuts.length - 1 ? (
                      <div className="col-span-2 border-border/60 border-b" />
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
