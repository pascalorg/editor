# WebSocket 鏁版嵁涓庨瑙堝姩鎬佺郴缁熷紑鍙戣鍒?
## 鐩爣

鎶婄紪杈戝櫒閲岀殑鈥滄暟鎹€濆拰鈥滃姩鎬佲€濇墦閫氭垚涓€涓畬鏁撮摼璺細

1. 椤圭洰鏍圭洰褰曟彁渚涗竴涓?WebSocket 妯℃嫙鏁版嵁宸ュ叿锛屾寔缁線澶栨帹閫佹ā鎷熷疄鏃舵暟鎹€?2. 妯℃嫙宸ュ叿鍚屾椂鎻愪緵 HTTP API锛屽墠绔彲浠ヨ幏鍙栧叏閮ㄥ彲缁戝畾鏁版嵁璺緞銆?3. 鐢诲竷涓嬫柟宸ュ叿鏍忕殑鈥滄暟鎹€濇ā鍧椾笉鍐嶅彧浣跨敤闈欐€佸亣鏁版嵁锛岃€屾槸鍙互瀵规帴 WebSocket 鏁版嵁璺緞銆?4. 浠绘剰鐢诲竷鐗╁搧锛屽寘鎷?assembly 涓嬬殑瀛愰儴浠讹紝閮藉彲浠ュ湪灞炴€ч潰鏉跨殑鈥滃姩鎬佲€濋〉绛鹃噷缁戝畾鏁版嵁璺緞鍜屽姩鎬佹晥鏋溿€?5. 鍔ㄦ€佹晥鏋滃彧鍦ㄧ偣鍑诲彸涓婅鈥滈瑙堚€濆悗杩愯锛岃璁℃€佸彧淇濆瓨閰嶇疆锛屼笉鎾斁鍔ㄧ敾锛屼笉姹℃煋鍦烘櫙鏁版嵁銆?6. 鏍规嵁鐗╁搧鐨勮涔夌被鍨嬪喅瀹氬彲閰嶇疆鍔ㄦ€侊細鏅€氱墿浣撳彧鏈夐€氱敤鍔ㄦ€侊紱绠￠亾鏈夆€滄祦閲忊€濓紱杈撻€佸甫鏈夆€滆緭閫佲€濓紱椋庢満鏈夆€滆浆鍔?閫熷害鈥濈瓑銆?7. LLM 鐢熸垚璁惧鏃惰緭鍑鸿涔夌被鍨嬶紝绯荤粺鏍规嵁鑳藉姏娉ㄥ唽琛ㄥ喅瀹氬畠鏀寔鍝簺鍔ㄦ€侊紝鑰屼笉鏄 LLM 浠绘剰鐢熸垚鍔ㄦ€佽兘鍔涖€?
---

## 褰撳墠浠ｇ爜鐜扮姸

### 鐢诲竷涓嬫柟鈥滄暟鎹€濆叆鍙?
鐜版湁鍏ュ彛鍦細

- `packages/editor/src/components/ui/action-menu/control-modes.tsx`
- `packages/editor/src/components/ui/action-menu/structure-tools.tsx`

褰撳墠閫昏緫锛?
- 鐐瑰嚮搴曢儴宸ュ叿鏍忊€滄暟鎹€濇寜閽悗锛岃繘鍏ワ細

```ts
phase: 'structure'
structureLayer: 'data'
mode: 'build'
tool: 'data-widget'
```

- 鈥滄暟鎹€濆伐鍏锋爮鐩墠鍙樉绀轰竴涓伐鍏凤細

```ts
dataTools = [
  { id: 'data-widget', iconSrc: '/icons/data-widget.svg', label: 'Data Widget' },
]
```

### Data Widget

鐩稿叧鏂囦欢锛?
- `packages/core/src/schema/nodes/data-widget.ts`
- `packages/core/src/live-data/static-live-data.ts`
- `packages/nodes/src/data-widget/panel.tsx`
- `packages/nodes/src/data-widget/renderer.tsx`
- `packages/nodes/src/data-widget/tool.tsx`

褰撳墠闂锛?
- `data-widget` 浣跨敤鐨勬槸 `STATIC_LIVE_DATA_OPTIONS`銆?- 鏁版嵁瀛楁鏄潤鎬佹灇涓撅紝涓嶆槸杩滅▼ WebSocket path銆?- renderer 閫氳繃 `renderLiveDataTemplate()` 璇诲彇闈欐€佹暟鎹€?- 鍚庣画闇€瑕佹妸瀹冩敼鎴愬彲浠ョ粦瀹氬疄鏃舵暟鎹矾寰勩€?
---

## 鎬讳綋鏋舵瀯

绯荤粺鍒嗕负鍥涘眰锛?
```txt
Mock 鏁版嵁鏈嶅姟灞?  HTTP paths API + WebSocket stream

鏁版嵁婧愮鐞嗗眰
  缂栬緫鍣ㄥ唴鐨?data source / live values store

閰嶇疆灞?  data-widget.dataBinding
  node.metadata.dynamicBindings
  node.metadata.semanticType

棰勮杩愯灞?  Preview Dynamic Runtime
  Runtime visual overrides
```

鏍稿績鍘熷垯锛?
> 璁捐鎬佸彧閰嶇疆锛涢瑙堟€佹墠杩炴帴 WebSocket 骞舵墽琛屽姩鎬併€?
绂佹鍦ㄩ瑙堝姩鎬佽繃绋嬩腑鐩存帴璋冪敤 `updateNode()` 淇敼鑺傜偣鐪熷疄鏁版嵁銆?
---

## 涓€銆佹牴鐩綍 WebSocket 妯℃嫙宸ュ叿

### 寤鸿璺緞

```txt
tools/mock-websocket/
  server.mjs
  signals.json
  README.md
```

### package.json 鑴氭湰

```json
{
  "scripts": {
    "mock:ws": "node tools/mock-websocket/server.mjs"
  }
}
```

### 绔彛

榛樿锛?
```txt
http://localhost:3102
ws://localhost:3102/ws
```

鍙€氳繃鐜鍙橀噺瑕嗙洊锛?
```txt
MOCK_WS_PORT=3102
```

### HTTP API

#### GET `/health`

鐢ㄤ簬鍋ュ悍妫€鏌ャ€?
杩斿洖锛?
```json
{
  "ok": true,
  "service": "pascal-mock-websocket"
}
```

#### GET `/paths`

杩斿洖鎵€鏈夊彲缁戝畾鏁版嵁璺緞銆?
杩斿洖绀轰緥锛?
```json
[
  {
    "path": "factory.conveyor.speed",
    "label": "杈撻€佸甫閫熷害",
    "type": "number",
    "unit": "m/s",
    "min": 0,
    "max": 2,
    "category": "conveyor"
  },
  {
    "path": "factory.pipe.flow",
    "label": "绠￠亾娴侀噺",
    "type": "number",
    "unit": "m鲁/h",
    "min": 0,
    "max": 100,
    "category": "pipe"
  },
  {
    "path": "factory.fan.running",
    "label": "椋庢満杩愯",
    "type": "boolean",
    "category": "fan"
  }
]
```

#### GET `/snapshot`

杩斿洖褰撳墠鏈€鏂板€笺€?
杩斿洖绀轰緥锛?
```json
{
  "ts": 1782278400000,
  "seq": 12,
  "values": {
    "factory.conveyor.speed": 1.2,
    "factory.pipe.flow": 56,
    "factory.fan.running": true
  }
}
```

### WebSocket `/ws`

鎸佺画鎺ㄩ€侊細

```json
{
  "ts": 1782278400000,
  "seq": 13,
  "values": {
    "factory.conveyor.speed": 1.35,
    "factory.pipe.flow": 61,
    "factory.fan.running": true
  }
}
```

### 渚濊禆閫夋嫨

Node 娌℃湁绋冲畾鍐呯疆 WebSocket server銆傜涓€鐗堝缓璁柊澧炰竴涓皬渚濊禆锛?
```txt
ws
```

濡傛灉鏆傛椂涓嶆兂鏂板渚濊禆锛屽彲浠ュ厛鐢?HTTP polling 楠岃瘉 UI 鍜屽姩鎬侀摼璺紝浣嗘渶缁?WebSocket 浠嶅缓璁敤 `ws`銆?
---

## 浜屻€佺粺涓€瀹炴椂鏁版嵁妯″瀷

### Signal path

```ts
export type LiveDataValueType = 'number' | 'boolean' | 'string'

export type LiveDataPath = {
  path: string
  label: string
  type: LiveDataValueType
  unit?: string
  min?: number
  max?: number
  values?: string[]
  category?: string
}
```

### Snapshot

```ts
export type LiveDataSnapshot = {
  ts: number
  seq: number
  values: Record<string, string | number | boolean | null>
}
```

### 鍓嶇寤鸿璺緞

```txt
packages/editor/src/lib/live-data/
  types.ts
  client.ts
  store.ts
  format.ts
```

### 鍓嶇鐘舵€?
```ts
type LiveDataState = {
  status: 'idle' | 'connecting' | 'connected' | 'error'
  endpoint: string
  paths: LiveDataPath[]
  snapshot: LiveDataSnapshot | null
  values: Record<string, string | number | boolean | null>
  error: string | null
}
```

---

## 涓夈€佸簳閮ㄥ伐鍏锋爮鈥滄暟鎹€濇ā鍧楀鎺?WebSocket

杩欐槸涓€涓嫭绔嬩絾蹇呴』绾冲叆绗竴闃舵鐨勯儴鍒嗐€?
### 褰撳墠琛屼负

搴曢儴宸ュ叿鏍忕偣鍑烩€滄暟鎹€濆悗锛屽彧鑳芥斁缃?Data Widget锛孌ata Widget 閫夋嫨闈欐€佸瓧娈碉細

```txt
machine.temperature
fan.speed
door.open
...
```

### 鐩爣琛屼负

搴曢儴鈥滄暟鎹€濇ā鍧楄礋璐ｆ斁缃拰閰嶇疆鏁版嵁灞曠ず缁勪欢銆傚畠搴旇鍜?WebSocket 鏁版嵁婧愭墦閫氾細

1. 鐐瑰嚮搴曢儴鈥滄暟鎹€濄€?2. 閫夋嫨/鏀剧疆 Data Widget銆?3. 閫変腑 Data Widget銆?4. 灞炴€ч潰鏉夸腑鈥滄暟鎹瓧娈碘€濅笅鎷夋浠?`/paths` 鑾峰彇銆?5. Data Widget 鍦ㄨ璁℃€佸彲浠ユ樉绀烘渶鏂?snapshot 鎴栧崰浣嶅€笺€?6. 棰勮鎬侀殢 WebSocket 瀹炴椂鍒锋柊銆?
### Data Widget schema 寤鸿

褰撳墠锛?
```ts
dataKey: string
template: string
```

寤鸿淇濈暀 `dataKey` 鍏煎褰撳墠缁撴瀯锛屼絾璇箟鍗囩骇涓?live data path锛?
```ts
dataKey: z.string().default('factory.machine.temperature')
```

鍚庣画鍙墿灞曪細

```ts
dataBinding: z
  .object({
    source: z.enum(['mock-websocket', 'manual', 'static']).default('mock-websocket'),
    path: z.string(),
    fallbackValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })
  .optional()
```

绗竴鐗堝彲浠ュ厛缁х画鐢?`dataKey`锛岄伩鍏?schema 鏀瑰姩杩囧ぇ銆?
### Data Widget 闈㈡澘鏀归€?
鏂囦欢锛?
```txt
packages/nodes/src/data-widget/panel.tsx
```

鏀归€犲唴瀹癸細

- 涓嶅啀鍙敤 `STATIC_LIVE_DATA_OPTIONS`銆?- 浠?editor live-data store 璇诲彇 paths銆?- 濡傛灉 WebSocket 鏈繛鎺ワ紝鏄剧ず锛?
```txt
鏈繛鎺ユ暟鎹簮
浣跨敤妯℃嫙鏁版嵁 / 杩炴帴涓?/ 閲嶈瘯
```

- 涓嬫媺鏄剧ず锛?
```txt
杈撻€佸甫閫熷害 factory.conveyor.speed
绠￠亾娴侀噺 factory.pipe.flow
椋庢満杩愯 factory.fan.running
```

### Data Widget renderer 鏀归€?
鏂囦欢锛?
```txt
packages/nodes/src/data-widget/renderer.tsx
```

鏀归€犲唴瀹癸細

- 璁捐鎬侊細
  - 浼樺厛鏄剧ず live-data store 涓渶鏂板€笺€?  - 娌℃湁鍊兼椂鏄剧ず fallback 鎴?`?`銆?- 棰勮鎬侊細
  - 鐢?WebSocket snapshot 瀹炴椂椹卞姩銆?
娉ㄦ剰锛?
`packages/nodes` 涓嶅簲璇ョ洿鎺ョ煡閬?editor store銆傞渶瑕侀€氳繃涓€涓法鍖呭畨鍏ㄦ柟妗堝鐞嗭細

#### 鏂规 A锛氭妸 live-data store 鏀惧埌 core

浼樼偣锛歯odes renderer 鍙互鐩存帴璇诲彇銆?
缂虹偣锛歝ore 浼氭壙鎷呰繍琛屾€佹暟鎹姸鎬侊紝鍙兘杈圭晫鍙橀噸銆?
#### 鏂规 B锛歞ata-widget renderer 浠嶅湪 nodes锛屼絾閫氳繃 core 鎻愪緵绾嚱鏁帮紝瀹炴椂鍊肩敱 viewer/editor context 娉ㄥ叆

浼樼偣锛氳竟鐣屾洿骞插噣銆?
缂虹偣锛氶渶瑕佽璁′竴涓?provider/hook銆?
#### 鎺ㄨ崘

绗竴鐗堜负浜嗗敖蹇墦閫氾紝鍙互鎶?live-data 鐨勭函绫诲瀷鍜屾牸寮忓寲宸ュ叿鏀?core锛屾妸 WebSocket client/store 鏀?editor銆侱ata Widget 杩愯鏃跺€奸€氳繃 scene/viewer 灞傚彲璁块棶鐨?lightweight store 鎴?provider 娉ㄥ叆锛岄伩鍏?nodes 鐩存帴 import editor銆?
---

## 鍥涖€佸姩鎬侀厤缃郴缁?
### 閰嶇疆瀛樻斁浣嶇疆

鍔ㄦ€佺粦瀹氬瓨鏀惧埌鑺傜偣 metadata锛?
```json
{
  "metadata": {
    "semanticType": "fan",
    "dynamicBindings": [
      {
        "id": "dyn_001",
        "type": "rotate",
        "path": "factory.fan.speed",
        "axis": "z",
        "speedRange": [0, 8]
      }
    ]
  }
}
```

### 涓轰粈涔堟斁 metadata

- 涓嶇牬鍧忕幇鏈夎妭鐐?schema銆?- assembly root 鍜?assembly child 閮藉彲浠ヤ娇鐢ㄣ€?- LLM 鐢熸垚鑺傜偣鏃跺彲浠ョ洿鎺ュ啓鍏ャ€?- 鏈瘑鍒瓧娈典笉浼氬奖鍝嶆棫鑺傜偣銆?
### 绫诲瀷瀹氫箟寤鸿璺緞

```txt
packages/core/src/dynamics/
  types.ts
  capabilities.ts
  metadata.ts
```

濡傛灉涓嶆兂绗竴闃舵瑙︾ core锛屽彲浠ュ厛鏀撅細

```txt
packages/editor/src/lib/dynamics/
```

浣嗛暱鏈熷缓璁牳蹇冪被鍨嬭繘鍏?core锛孶I 鍜?runtime 鐣欏湪 editor/viewer銆?
---

## 浜斻€佸姩鎬佽兘鍔涙敞鍐岃〃

### 閫氱敤鍔ㄦ€?
鎵€鏈夌墿浣撻粯璁ゆ敮鎸侊細

```txt
鍙 visible
绉诲姩 move
闂儊 blink
濉厖 fill
缂╂斁 scale
棰滆壊 color
杞姩 rotate
```

### 涓撳睘鍔ㄦ€?
鏍规嵁璇箟绫诲瀷杩藉姞锛?
```txt
pipe              鈫?flow
conveyor          鈫?conveyorFlow
conveyor_belt     鈫?conveyorFlow
tank              鈫?level
fan               鈫?rotate / speed
motor             鈫?rotate / speed
roller            鈫?rotate
valve             鈫?openClose / flow
pump              鈫?running / flow
light             鈫?brightness / blink
display           鈫?valueDisplay
```

### 绀轰緥

```ts
export const dynamicCapabilityRegistry = {
  common: ['visible', 'move', 'blink', 'fill', 'scale', 'color', 'rotate'],
  semanticTypes: {
    pipe: ['flow'],
    conveyor: ['conveyorFlow'],
    conveyor_belt: ['conveyorFlow'],
    tank: ['level'],
    fan: ['speed'],
    motor: ['speed'],
    roller: ['rotate'],
    valve: ['openClose', 'flow'],
    pump: ['running', 'flow'],
    light: ['brightness'],
    display: ['valueDisplay'],
  },
} as const
```

### 鏄剧ず瑙勫垯

```txt
娌℃湁 semanticType
  鈫?鍙樉绀洪€氱敤鍔ㄦ€?
semanticType = conveyor
  鈫?閫氱敤鍔ㄦ€?+ 杈撻€?
semanticType = pipe
  鈫?閫氱敤鍔ㄦ€?+ 娴侀噺
```

---

## 鍏€丩LM 鐢熸垚璁惧鎺ュ叆瑙勫垯

LLM 涓嶇洿鎺ュ喅瀹氬姩鎬佸垪琛ㄣ€侺LM 鍙緭鍑鸿涔夌被鍨嬨€?
绀轰緥锛?
```json
{
  "name": "鐨甫杈撻€佹満",
  "semanticType": "conveyor",
  "children": [
    {
      "name": "鐨甫",
      "semanticType": "conveyor_belt"
    },
    {
      "name": "婊氱瓛",
      "semanticType": "roller"
    },
    {
      "name": "鐢垫満",
      "semanticType": "motor"
    }
  ]
}
```

绯荤粺鏍规嵁 registry 鑷姩寰楀埌锛?
```txt
鐨甫杈撻€佹満 鈫?杈撻€?鐨甫       鈫?杈撻€?婊氱瓛       鈫?杞姩
鐢垫満       鈫?杞€?杞姩
```

### 鍏滃簳瑙勫垯

濡傛灉 LLM 鏈緭鍑?semanticType锛?
1. 榛樿鍙樉绀洪€氱敤鍔ㄦ€併€?2. 鐢ㄦ埛鍙互鍦ㄥ睘鎬ч潰鏉块珮绾у尯鍩熸墜鍔ㄩ€夋嫨鈥滆澶囩被鍨嬧€濄€?3. 鍚庣画鍙互鍋氬悕瀛楁帹鑽愶紝浣嗕笉瑕佸己鍒躲€?
---

## 涓冦€佸睘鎬ч潰鏉库€滃姩鎬佲€濋〉绛?
### 鐩爣

閫変腑浠讳綍鑺傜偣锛屽寘鎷?assembly 涓嬬殑瀛愰儴浠讹紝閮藉彲浠ヨ繘鍏モ€滃姩鎬佲€濋〉绛鹃厤缃€?
### UI 缁撴瀯

```txt
鍔ㄦ€?
[娣诲姞鍔ㄦ€乚

鍔ㄦ€?1
  绫诲瀷锛氳浆鍔?  鏁版嵁璺緞锛歠actory.fan.speed
  杞村悜锛歓
  閫熷害鑼冨洿锛? ~ 8

鍔ㄦ€?2
  绫诲瀷锛氶鑹?  鏁版嵁璺緞锛歠actory.machine.temperature
  鏄犲皠锛? 钃?/ 50 榛?/ 100 绾?```

### 鏂囦欢鍏ュ彛

鐜版湁椤电澶栧３锛?
```txt
packages/editor/src/components/ui/panels/panel-wrapper.tsx
```

涓嬩竴姝ラ渶瑕佽椤电涓嶅彧鏄瑙夊垏鎹紝鑰屾槸鐪熸鎺у埗锛?
- 鍩虹鍐呭鏄剧ず鍘熷睘鎬ч潰鏉?children銆?- 鍔ㄦ€佸唴瀹规樉绀虹粺涓€ Dynamic Inspector銆?
### 寤鸿缁勪欢

```txt
packages/editor/src/components/ui/panels/dynamic-inspector/
  dynamic-inspector.tsx
  dynamic-binding-card.tsx
  dynamic-type-select.tsx
  live-data-path-select.tsx
```

### assembly 瀛愰儴浠?
瑙勫垯锛?
```txt
閫変腑 assembly root
  鈫?dynamicBindings 鍐欏埌 assembly root metadata

閫変腑 assembly child
  鈫?dynamicBindings 鍐欏埌 child node metadata
```

涓嶈兘鎶婂瓙閮ㄤ欢鍔ㄦ€佸啓鍒?assembly root锛屽惁鍒欐棤娉曞崟鐙帶鍒堕鎵囥€佺閬撱€佸澹炽€?
---

## 鍏€侀瑙堝姩鎬佽繍琛屾椂

### 瑙﹀彂鐐?
鍙湪鐐瑰嚮鍙充笂瑙掆€滈瑙堚€濆悗鍚敤銆?
闇€瑕佸厛妫€鏌ョ幇鏈夐瑙堢姸鎬佸叆鍙ｏ紝鍐嶆帴鍏?runtime銆?
### 寤鸿鏂囦欢

```txt
packages/editor/src/lib/dynamics/runtime/
  preview-dynamic-runtime.ts
  evaluators.ts
  runtime-overrides.ts
```

### 杩愯娴佺▼

```txt
杩涘叆棰勮
  鈫?杩炴帴 WebSocket
  鈫?鑾峰彇 paths + snapshot
  鈫?鎵弿 scene 涓墍鏈?dynamicBindings
  鈫?姣忓抚璇诲彇鏈€鏂?values
  鈫?搴旂敤 visual override

閫€鍑洪瑙?  鈫?鏂紑 WebSocket
  鈫?娓呯┖鎵€鏈?override
  鈫?鎭㈠璁捐鎬?```

### 绂佹琛屼负

棰勮鏃朵笉瑕佽皟鐢細

```ts
useScene.getState().updateNode(...)
```

搴旇浣跨敤 runtime override锛?
```txt
visible override
position offset
rotation offset
scale multiplier
material color override
temporary clone objects
```

---

## 涔濄€佸姩鎬佹晥鏋滃疄鐜颁紭鍏堢骇

### 绗竴鎵癸細鏈€灏忛棴鐜?
浼樺厛鍋氾細

1. `visible` 鍙
2. `color` 棰滆壊
3. `scale` 缂╂斁
4. `rotate` 杞姩

杩欏洓涓渶瀹规槗绋冲畾楠岃瘉銆?
### 绗簩鎵癸細甯哥敤鍔ㄤ綔

5. `move` 绉诲姩
6. `blink` 闂儊

### 绗笁鎵癸細宸ヤ笟涓撳睘

7. `flow` 娴侀噺
8. `conveyorFlow` 杈撻€?9. `level` 娑蹭綅
10. `openClose` 闃€闂ㄥ紑鍏?11. `valueDisplay` 浠〃鏁版樉

---

## 鍗併€佽緭閫佸甫 conveyorFlow 璁捐

杩欎釜涓嶆槸鏅€氣€滅Щ鍔ㄢ€濓紝鑰屾槸瀹瑰櫒鍨嬪姩鎬併€?
### 鐢ㄦ埛閰嶇疆

閫変腑杈撻€佸甫鏃讹紝鍔ㄦ€侀噷鍑虹幇鈥滆緭閫佲€濄€?
閰嶇疆椤癸細

```txt
鏁版嵁璺緞锛歠actory.conveyor.speed
璐х墿妯℃澘锛氶€夋嫨鐢诲竷涓婄殑鏌愪釜鐗╀綋
鏂瑰悜锛歑 / Y / Z / 璺緞
璺濈锛?m
闂磋窛锛?.2m
閫熷害鑼冨洿锛? ~ 2m/s
寰幆锛氬紑鍚?```

### 淇濆瓨缁撴瀯

```json
{
  "id": "dyn_conveyor_001",
  "type": "conveyorFlow",
  "path": "factory.conveyor.speed",
  "itemTemplateNodeId": "box_001",
  "direction": "x",
  "distance": 6,
  "spacing": 1.2,
  "speedRange": [0, 2],
  "loop": true
}
```

### 棰勮琛ㄧ幇

璁捐鎬侊細

```txt
涓€涓緭閫佸甫 + 涓€涓揣鐗╂ā鏉?```

棰勮鎬侊細

```txt
澶氫釜涓存椂鍏嬮殕璐х墿娌胯緭閫佸甫寰幆绉诲姩
```

姣忓抚浣嶇疆锛?
```ts
position = (time * speed + index * spacing) % distance
```

涓存椂鍏嬮殕瀵硅薄涓嶈兘鍐欏叆 scene graph銆?
---

## 鍗佷竴銆佹祦閲?flow 璁捐

涓昏鐢ㄤ簬 pipe銆?
绗竴鐗堣〃鐜板彲浠ョ畝鍗曪細

```txt
娴侀噺鍊艰秺澶э紝棰滆壊瓒婁寒
娴侀噺鍊煎ぇ浜?0 鏃舵部绠￠亾鏄剧ず绉诲姩绠ご/鑴夊啿
娴侀噺涓?0 鏃跺仠姝?```

淇濆瓨缁撴瀯锛?
```json
{
  "id": "dyn_flow_001",
  "type": "flow",
  "path": "factory.pipe.flow",
  "direction": "forward",
  "speedRange": [0, 3],
  "color": "#35c8ff"
}
```

鍚庣画鍙互鍗囩骇涓?shader / texture offset銆?
---

## 鍗佷簩銆佸紑鍙戦噷绋嬬

### Milestone 1锛氭暟鎹簮涓?Data Widget 鎵撻€?
瀹屾垚锛?
- 鏂板 `tools/mock-websocket`銆?- 鏂板 `bun run mock:ws` 鎴?`npm run mock:ws` 鑴氭湰銆?- 鎻愪緵 `/paths`銆乣/snapshot`銆乣/health`銆乣/ws`銆?- 鍓嶇鏂板 live-data client/store銆?- 搴曢儴鈥滄暟鎹€濆伐鍏锋斁缃殑 Data Widget 鍙互閫夋嫨 WebSocket path銆?- Data Widget 鑳芥樉绀哄疄鏃?snapshot銆?
楠屾敹锛?
- 鍚姩 mock server銆?- 鎵撳紑缂栬緫鍣ㄣ€?- 鐐瑰嚮搴曢儴鈥滄暟鎹€濄€?- 鏀剧疆 Data Widget銆?- 涓嬫媺妗嗚兘鐪嬪埌 `/paths` 杩斿洖鐨勬暟鎹€?- WebSocket 鏁版嵁鍙樺寲鏃讹紝Data Widget 鏄剧ず闅忎箣鍙樺寲銆?
### Milestone 2锛氬姩鎬侀厤缃?UI

瀹屾垚锛?
- 灞炴€ч潰鏉库€滃熀纭€/鍔ㄦ€佲€濋〉绛剧湡姝ｅ垏鎹㈠唴瀹广€?- 鍔ㄦ€侀〉绛炬敮鎸佹坊鍔犮€佺紪杈戙€佸垹闄?dynamic binding銆?- 鍔ㄦ€佺被鍨嬫牴鎹?semanticType + registry 鐢熸垚銆?- 鏁版嵁璺緞涓嬫媺澶嶇敤 live-data paths銆?- 閰嶇疆淇濆瓨鍒?`metadata.dynamicBindings`銆?
楠屾敹锛?
- 鏅€氱墿浣撳彧鏈夐€氱敤鍔ㄦ€併€?- pipe 鏈夆€滄祦閲忊€濄€?- conveyor 鏈夆€滆緭閫佲€濄€?- assembly 瀛愰儴浠跺彲浠ュ崟鐙繚瀛樺姩鎬侀厤缃€?
### Milestone 3锛氶瑙堣繍琛屾椂鏈€灏忛棴鐜?
瀹屾垚锛?
- 鐐瑰嚮棰勮鍚庡惎鍔?dynamic runtime銆?- 閫€鍑洪瑙堝悗娓呯悊 runtime override銆?- 鏀寔 visible / color / scale / rotate銆?
楠屾敹锛?
- 璁捐鎬佺墿浣撲笉鍔ㄣ€?- 棰勮鎬?WebSocket 鏁版嵁椹卞姩鐗╀綋鍙樿壊銆佺缉鏀俱€佹樉绀洪殣钘忋€佹棆杞€?- 閫€鍑洪瑙堝悗涓€鍒囨仮澶嶃€?
### Milestone 4锛氬伐涓氫笓灞炲姩鎬?
瀹屾垚锛?
- pipe.flow銆?- conveyor.conveyorFlow銆?- tank.level銆?- valve.openClose銆?
楠屾敹锛?
- 绠￠亾鑳芥樉绀烘祦閲忔晥鏋溿€?- 杈撻€佸甫鑳界敤涓€涓揣鐗╂ā鏉跨敓鎴愬惊鐜緭閫佹晥鏋溿€?- 鏁版嵁鍙樺寲鑳藉奖鍝嶉€熷害/鐘舵€併€?
### Milestone 5锛歀LM 涓庤涔夌被鍨嬪畬鍠?
瀹屾垚锛?
- LLM 鐢熸垚璁惧鏃跺啓鍏?`metadata.semanticType`銆?- 瀛愰儴浠朵篃鍐欏叆 semanticType銆?- 鐢ㄦ埛鍙互鎵嬪姩淇敼璁惧绫诲瀷銆?- 鏈煡 semanticType 鍙樉绀洪€氱敤鍔ㄦ€併€?
楠屾敹锛?
- LLM 鐢熸垚杈撻€佸甫鍚庤嚜鍔ㄥ嚭鐜扳€滆緭閫佲€濆姩鎬併€?- LLM 鐢熸垚绠￠亾鍚庤嚜鍔ㄥ嚭鐜扳€滄祦閲忊€濆姩鎬併€?- LLM 鐢熸垚椋庢墖鍚庤嚜鍔ㄥ嚭鐜扳€滆浆鍔?閫熷害鈥濈浉鍏冲姩鎬併€?
---

## 鍗佷笁銆佹祴璇曡鍒?
### 鍗曞厓娴嬭瘯

瑕嗙洊锛?
- dynamic capability registry
- semanticType 鍒?dynamic types 鐨勬槧灏?- data path 绫诲瀷杩囨护
- value mapping evaluator
- template render

### 闆嗘垚娴嬭瘯

瑕嗙洊锛?
- mock server `/paths`
- mock server `/snapshot`
- WebSocket frame 鏍煎紡
- live-data client reconnect

### UI / E2E 娴嬭瘯

瑕嗙洊锛?
- 搴曢儴鐐瑰嚮鈥滄暟鎹€濆苟鏀剧疆 Data Widget銆?- Data Widget 闈㈡澘鏄剧ず WebSocket paths銆?- 閫変腑鏅€氱墿浣撴墦寮€鍔ㄦ€侀〉绛俱€?- 閫変腑 assembly 瀛愰儴浠舵墦寮€鍔ㄦ€侀〉绛俱€?- 鐐瑰嚮棰勮鍚庡姩鎬佽繍琛屻€?- 閫€鍑洪瑙堝悗鐘舵€佹仮澶嶃€?
---

## 鍗佸洓銆佹灦鏋勮竟鐣?
### core

閫傚悎鏀撅細

- 鍔ㄦ€佺粦瀹氱函绫诲瀷銆?- semanticType / capability 绾敞鍐岃〃銆?- live-data path 绫诲瀷銆?- template/value formatting 绾嚱鏁般€?
涓嶉€傚悎鏀撅細

- WebSocket client銆?- React UI銆?- Three.js runtime 鎿嶄綔銆?
### editor

閫傚悎鏀撅細

- WebSocket client/store銆?- 灞炴€ч潰鏉?UI銆?- 鏁版嵁婧愯繛鎺ョ姸鎬併€?- 棰勮妯″紡鎺у埗銆?- dynamic runtime orchestration銆?
### viewer

閫傚悎鏀撅細

- 瀵?Three.js object 鐨?runtime visual override 鑳藉姏銆?- 涓嶅簲鐭ラ亾鈥滃姩鎬侀潰鏉库€濃€淲ebSocket 涓氬姟鈥濃€渆ditor tool鈥濊繖浜涚紪杈戝櫒姒傚康銆?
### nodes

閫傚悎鏀撅細

- 鑺傜偣鑷繁鐨?panel/renderer銆?- Data Widget renderer銆?- 鑺傜偣灞€閮ㄥ姩鎬侀厤缃?UI 鍙互澶嶇敤 editor 鎻愪緵鐨勭粍浠躲€?
娉ㄦ剰锛?
`packages/nodes` 涓嶈兘闅忔剰 import `apps/editor`銆傚鏋滆浣跨敤 editor 鐘舵€侊紝闇€瑕侀€氳繃鍏叡鍖呮垨娉ㄥ叆鏈哄埗銆?
---

## 鍗佷簲銆佸凡鐭ラ闄?
1. **璁捐鎬佹薄鏌撻闄?*
   棰勮鍔ㄦ€佷笉鑳戒慨鏀圭湡瀹炶妭鐐规暟鎹€?
2. **assembly 瀛愰儴浠?ID 绋冲畾鎬?*
   鍔ㄦ€侀厤缃粦瀹?node id锛涘鏋滃瓙閮ㄤ欢閲嶅缓瀵艰嚧 id 鍙樺寲锛岄厤缃細涓€?
3. **Data Widget 璺ㄥ寘鐘舵€佽鍙?*
   闇€瑕佸皬蹇?core / editor / nodes 鐨勮竟鐣屻€?
4. **flow / conveyorFlow 鏁堟灉澶嶆潅**
   绗竴鐗堝厛鍋氬彲瑙佹晥鏋滐紝涓嶈拷姹傛渶缁?shader 璐ㄩ噺銆?
5. **LLM 璇箟閿欒**
   semanticType 蹇呴』璧扮櫧鍚嶅崟鍜岀敤鎴峰彲淇鏈哄埗銆?
6. **WebSocket 杩炴帴鐘舵€?*
   闇€瑕佸鐞嗘柇绾裤€侀噸杩炪€佹棤鏁版嵁銆佽矾寰勪笉瀛樺湪銆?
7. **涔辩爜闂**
   鐜版湁閮ㄥ垎鏂囦欢宸茬粡鏈?mojibake銆傛柊澧炰腑鏂囨枃鏈缓璁娇鐢?UTF-8 涓旈伩鍏?PowerShell 鍐欏叆鐮村潖锛涘繀瑕佹椂鐢?unicode escape銆?
---

## 绗竴闃舵鎺ㄨ崘瀹炴柦椤哄簭

1. 鏂板 mock WebSocket server銆?2. 鏂板 live-data types/client/store銆?3. 鏀归€?Data Widget path 涓嬫媺锛屽厛鎺?`/paths`銆?4. 鏀归€?Data Widget renderer锛屾樉绀哄疄鏃?value銆?5. 鍋?dynamic types + capability registry銆?6. 璁╁睘鎬ч潰鏉库€滃姩鎬佲€濋〉绛炬樉绀虹湡瀹?Dynamic Inspector銆?7. 淇濆瓨 dynamicBindings 鍒?metadata銆?8. 鍋氶瑙?runtime锛屽厛鏀寔 color / rotate / scale / visible銆?9. 鏈€鍚庡仛 flow / conveyorFlow銆?
---

## 鍐崇瓥鎽樿

鏈€缁堟柟鍚戯細

```txt
搴曢儴鈥滄暟鎹€?  鈫?绠＄悊瀹炴椂鏁版嵁灞曠ず缁勪欢 Data Widget
  鈫?鏁版嵁瀛楁鏉ヨ嚜 WebSocket paths

灞炴€ч潰鏉库€滃姩鎬佲€?  鈫?缁欎换浣曡妭鐐圭粦瀹氬姩鎬佽涓?  鈫?鍔ㄦ€佺被鍨嬬敱 semanticType + capability registry 鍐冲畾

鍙充笂瑙掆€滈瑙堚€?  鈫?杩炴帴 WebSocket
  鈫?鎵ц runtime visual overrides
  鈫?閫€鍑哄悗鎭㈠璁捐鎬?```

杩欎釜鏂规鍙互鍚屾椂鏀拺锛?
- 鏅€氱墿浣撳姩鎬併€?- assembly 瀛愰儴浠跺姩鎬併€?- LLM 鐢熸垚璁惧鍔ㄦ€佽兘鍔涖€?- 绠￠亾娴侀噺銆?- 杈撻€佸甫杩炵画杈撻€併€?- Data Widget 瀹炴椂鏁版嵁鏄剧ず銆?
