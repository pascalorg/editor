# CAD Import — Plan

DWG/DXF çizimini **düzenlenemez bir referans altlığı** olarak çalışma
düzlemine yerleştirmek ve üzerinden 3D model çizerken snap edebilmek.

Amaç **otomatik dönüşüm değil**. Çizimden duvar/kapı çıkarımı yapılmaz;
kullanıcı altlığa snap ederek modeli kendi çizer.

## Kapsam kararları

| Konu | Karar |
|---|---|
| Görünüm | 2D plan **ve** 3D — `wiki/architecture/tools.md` paritesi gereği ikisi aynı PR'da |
| Snap kapsamı | Tüm çizim araçları (duvar, çit, döşeme/zone poligonu, kolon/item, ölçüm, merdiven, asansör) |
| Format | DXF önce (saf client-side), DWG sonra (sunucu tarafı `dwg2dxf`) |

---

## Mevcut kodun snap haritası

İki ayrı snap sistemi var; CAD ikisine de girmeli.

### A. Draft-point snap — çizim sırasındaki nokta yakalama

Çekirdek: `packages/editor/src/components/tools/wall/`
- `wall-snap-geometry.ts` — saf geometri: köşe → orta nokta → kesişim → gövde,
  her biri kendi yarıçapıyla (`findWallSpecialPointSnap`)
- `wall-drafting.ts:409` — `snapWallDraftPointDetailed({ point, walls, magnetic, ... })`

Tüketiciler:

| Dosya | Ne çiziyor |
|---|---|
| `packages/nodes/src/wall/tool.tsx:652,743,780` | Duvar (3D) |
| `packages/nodes/src/wall/floorplan-affordances.ts:208` | Duvar (2D) |
| `packages/nodes/src/wall/move-endpoint-tool.tsx:396` | Duvar uç noktası taşıma |
| `packages/editor/src/components/tools/fence/fence-drafting.ts:184` | Çit |
| `packages/nodes/src/slab/tool.tsx:163` | Döşeme poligonu |
| `packages/nodes/src/shared/polygon-vertex-affordance.ts:158,246` | **Paylaşılan** — zone/slab köşe düzenleme |
| `packages/nodes/src/shared/path-point-affordance.ts:106` | **Paylaşılan** — duct/pipe/lineset yol noktaları |
| `packages/nodes/src/shared/floor-placement.ts` | **Paylaşılan** — zemine yerleşen her kind |
| `packages/editor/src/components/tools/stair/stair-tool.tsx:437` | Merdiven (yerel `alignPoint`) |
| `packages/editor/src/components/tools/elevator/elevator-tool.tsx:212,261` | Asansör (yerel `alignPoint`) |

`shared/*` dosyaları çok sayıda kind'ı tek noktadan besliyor — asıl kaldıraç orada.

> **Dikkat:** Bu tüketicilerin bir kısmı bugün sadece `snapPointToGrid`
> çağırıyor; yani hiç manyetik geometri snap'i yok. Onlara CAD snap'i eklemek,
> daha önce olmayan bir davranışı eklemek demek. Her biri için 2D/3D parite
> testi gerekir.

### B. Alignment anchors — taşıma/yerleştirme hizalama kılavuzları

- `packages/core/src/services/alignment-anchors.ts:371` — `collectAlignmentAnchors(nodes, excludeId, levelId)`
- `packages/core/src/services/alignment.ts:164` — `resolveAlignment(...)`

Tüketiciler: `wall/tool.tsx:499`, `measurement/selection.tsx:280`,
`slab/move-tool.tsx`, `move-registry-node-tool.tsx:644`,
`floorplan-registry-move-overlay.tsx:597`, `floorplan-group-move.tsx:193`,
`group-move-3d.ts:195`.

`collectAlignmentAnchors` `nodes` sözlüğünden okuyor. CAD verisi `nodes`'ta
**olmayacak** (aşağıya bkz.), o yüzden core'a CAD sızdırmadan bir enjeksiyon
noktası gerekiyor: çağıranlar editor tarafında ek anchor listesi merge eder.

### Emsal desen

`packages/nodes/src/wall/tool.tsx:645`:

```ts
const snapWalls = [...walls, ...getBelowLevelWalls()]
```

Alt kattaki duvarlar zaten "çizilmeyen, düzenlenmeyen, sadece snap hedefi olan
referans geometri" olarak havuza giriyor. CAD referansı da aynı noktadan girer.

### Diğer ilgili altyapı

| Ne | Yer |
|---|---|
| 2D plan = SVG; `def.floorplan(node, ctx) → FloorplanGeometry` | `packages/core/src/registry/types.ts:363` |
| Tıklanamazlık (2D) | `FloorplanStyle.pointerEvents: 'none'` |
| 3D geometri | `def.geometry(node, ctx) → Object3D` |
| Node şablonu (altlık, `bake:'strip'`, `dirtyTracking:false`, `asset://`) | `packages/nodes/src/guide/` |
| 2 nokta ölçek kalibrasyonu | `GuideScaleReference` — `packages/core/src/schema/nodes/guide.ts` |
| Asset saklama | `saveAsset()` / `loadAssetUrl()` — `packages/core/src/lib/asset-storage.ts` |
| Toplu node oluşturma, tek undo | `createNodes(ops)` — `packages/core/src/store/use-scene.ts:1222` |
| Import onay diyaloğu deseni | `settings-panel/index.tsx:229` + `LoadBuildDialog` |
| Snap modu (`'lines'` = magnetic) | `packages/editor/src/lib/snapping-mode.ts` |
| Snap beacon (kind taşıyor) | `useWallSnapIndicator` |

**Worker altyapısı yok** — repo genelinde `new Worker` geçmiyor. İlk deseni bu
özellik kuracak.

---

## Mimari kararlar

### 1. Vektör veri node'un içinde değil, asset'te

Bir DXF'te 50–200 bin segment olabilir. `nodes` sözlüğüne konursa scene JSON,
her kayıt, her undo adımı ve `/api/scenes` payload'ı şişer.

```ts
CadUnderlayNode = {
  url: AssetUrl,                    // parse edilmiş geometri (kompakt binary)
  sourceUrl: AssetUrl,              // orijinal DXF/DWG
  position, rotation, scale,
  opacity,
  layers: Record<string, { visible: boolean; color: string }>,
  locked: boolean,                  // kalibrasyon dışında daima true
}
```

`guide` / `scan` node'larıyla aynı yol.

### 2. Snap primitiflerini `WallNode`'dan soyutla

`wall-snap-geometry.ts` `SnapSegment = { id, start, end, curveOffset? }`
üzerinden çalışsın; `WallNode[] → SnapSegment[]` bir adaptör olsun. CAD
segmentleri ikinci kaynak olarak girer.

Gerekçe: "tüm çizim araçları" kapsamıyla bu soyutlama artık taşıyıcı — 10+
çağrı noktasına ayrı ayrı CAD snap kodu kopyalanamaz. Mevcut
`wall-snap-geometry.test.ts` davranış değişmediği için yeşil kalmalı; refactor'ın
doğruluk kanıtı odur.

### 3. Snap için kalıcı olmayan uzamsal indeks

Aday havuzu bugün O(n) taranıyor (n = onlarca duvar). 100k segmentte bu her
pointer hareketinde donma demek.

`packages/editor/src/lib/cad-snap-index.ts` — uniform grid spatial hash, snap
yarıçapındaki hücreleri sorgular. Saf, testli, store'a girmez; import anında bir
kez kurulur. Alignment anchor'ları da buradan, imleç çevresinden sınırlı sayıda
(örn. 2 m içinde en fazla 200) üretilir.

### 4. Katman sınırları

- `packages/cad-import` — saf parse/geometri, DOM ve React yok
  (`packages/ifc-converter` emsali)
- `packages/nodes/src/cad-underlay` — node kind
- `packages/editor` — import UI, kalibrasyon, snap indeksi
- `packages/viewer` bu özelliği **bilmez** (`wiki/architecture/viewer-isolation.md`)
- `packages/core` CAD'den haberdar olmaz; alignment anchor'ları editor tarafında merge edilir

---

## Fazlar

### Faz 0 — Spike ✅ tamamlandı

13.3 MB / 200k entity'lik sentetik ama yapısal olarak gerçekçi bir plan
üzerinde ölçüldü (Türkçe + AIA katman adları, LWPOLYLINE + bulge, ARC, CIRCLE,
BLOCK/INSERT, DEFPOINTS):

| Aday | Süre | Heap | Not |
|---|---|---|---|
| `@dxfom/dxf` | — | — | **GPL-3.0**, elendi (repo MIT, npm'e yayınlanıyor) |
| `dxf@5.3.1` | 32.713 ms | 645 MB | Aktif bakımlı olan bu, ama kullanılamaz |
| `dxf-parser@1.1.2` | ~170 ms | 67 MB | Sadece nesne ağacı; düzleştirme hâlâ üstüne gelir. 2021'den beri güncellenmemiş |
| **elle yazılan streamer** | **~150 ms** | 117 MB | Parse + düzleştirme + segment + bounds, **sıfır bağımlılık** |

**Karar: kendi group-code streamer'ımız.** İhtiyacımız olan entity kümesi dar,
DXF ASCII düz bir (kod, değer) akışı, ve çıktıyı doğrudan flat typed array'e
yazabiliyoruz — üçüncü parti çözümlerin ara nesne ağacı bizim için saf kayıp.

DWG yolu kararı değişmedi: sunucu tarafı `dwg2dxf` (Faz 5).

### Faz 1 — `packages/cad-import` ✅ tamamlandı
```
src/types.ts      CadDrawing / CadLayer / CadUnits / CadParseStats
src/units.ts      $INSUNITS → metre; unitless → null (calibration gerekir)
src/flatten.ts    Transform2D, SegmentSink, arc/circle/bulge → segment
src/parse.ts      group-code streamer; LINE/ARC/CIRCLE/LWPOLYLINE/POLYLINE/INSERT
src/serialize.ts  CadDrawing ⇄ binary asset (JSON manifest + Float32/Uint16)
```
38 test geçiyor. Kapsanan davranışlar: CCW arc sarması, bulge işareti ve
sagittası, R12 POLYLINE/VERTEX pariteti, blok base point + non-uniform scale +
özyineleme kesme, katman off/frozen, OCS ayna (`230 = -1`), CRLF, kesik dosya,
birim türetmeli tolerans ölçek bağımsızlığı.

**Faz 2'ye taşınan iki kısıt:**
- 200k entity → 1.84M segment, 31.6 MB asset (kaynak 13.3 MB). Eğri yoğun
  çizimlerde asset kaynaktan büyük çıkıyor. Gerekirse buffer'da eğriyi eğri
  olarak saklayıp yüklemede düzleştirmek bir seçenek — şimdilik ölçülmüş bir
  sorun değil, izlenecek bir sayı.
- `SPLINE` ve `HATCH` desteklenmiyor; `stats.skippedTypes` ile raporlanıyor.
  İlk gerçek çizimlerde ne sıklıkta çıktıklarına göre önceliklendirilecek.

### Faz 2 — `cad-underlay` node kind ✅ tamamlandı

| Dosya | İş |
|---|---|
| `packages/core/src/schema/nodes/cad-underlay.ts` | Şema; `AnyNode` birliğine ve olay veri yoluna bağlandı |
| `packages/editor/src/lib/cad-underlay-cache.ts` | Asset → `LoadedCadUnderlay`; katman başına SVG path + 3D pozisyon buffer'ı |
| `packages/editor/src/hooks/use-cad-underlay-revision.ts` | Asset geç geldiğinde 2D planı yeniden çizdiren abonelik |
| `packages/nodes/src/cad-underlay/layers.ts` | Katman görünürlük/renk çözümü — **2D ve 3D'nin ortak kaynağı** |
| `packages/nodes/src/cad-underlay/floorplan.ts` | 2D: katman başına tek `path`, `pointerEvents:'none'` |
| `packages/nodes/src/cad-underlay/renderer.tsx` | 3D: katman başına `LineSegments`, `raycast` boş |
| `packages/nodes/src/cad-underlay/definition.ts` | `bake:'strip'`, `dirtyTracking:false`, `selectable` yok |

16 test. Kapsanan: dosyanın kendi off/frozen durumu vs kullanıcı override'ı (iki
yönde de), boş katman atlama, birim→metre dönüşümü, sabit hairline, opaklık,
pointer geçirgenliği.

**Kilitlilik iki yerde birden zorlanıyor** — tek yerde olsa diğer görünümde
sızardı: 2D'de her primitive `pointerEvents:'none'`, 3D'de `raycast = () => {}`,
ve `capabilities.selectable` hiç tanımlı değil.

**Yol boyunca kapatılan iki boşluk:**
- `FloorplanGeometry` group transform'u `translate` + `rotate` destekliyordu ama
  `scale` desteklemiyordu. Altlığın path verisi çizim biriminde; metreye
  çevirmenin tek alternatifi her kalibrasyon değişiminde yüz binlerce komutluk
  string'i yeniden üretmekti. `scale` eklendi (core + SVG renderer, tek satır).
- Cache `primeCadUnderlay(url, underlay)` sunuyor: Faz 3'te worker'da parse
  edilen çizim, asset'i IndexedDB'den geri okumadan anında ekrana gelir.

**Faz 3'e taşınan:** `def.floorplan` ve `def.geometry` senkron; asset asenkron.
Sıcak yol (yeni import) `primeCadUnderlay` ile çözülü. Soğuk yol (kayıtlı sahne
açılışı) `useCadUnderlayRevision` aboneliğiyle çözülü — ama gerçek bir sahne
açılışıyla henüz doğrulanmadı.

### Faz 2.5 — gerçek dosya doğrulaması ✅ kısmen tamamlandı

**Test dosyası:** MENART-Yaka Etüd, 6.78 MB, AutoCAD 2018/2019/2020 (AC1032).

**DWG→DXF:** LibreDWG 0.13.3 `dwg2dxf` AC1032'yi sorunsuz çevirdi (6.78 MB →
29.9 MB DXF). Faz 5'in varsayımı doğrulandı; ODA/APS'ye gerek yok.

**Parse:** 174 ms, 146.474 segment, **2.52 MB asset**. `$INSUNITS=4` (mm) doğru
okundu. Türkçe katman adları (`ARK_Duvar_Dış`, `ARK_Tefriş`) sorunsuz.
Geometri SVG'ye render edilip gözle doğrulandı: bloklar doğru yerleşiyor,
yaylar yuvarlak, kapı taramaları ve merdivenler okunaklı, lejant ve sembol
kütüphanesi dahil çizimin tamamı doğru.

Sentetik fixture'ın 31.6 MB'lık asset tahmini **gerçek dosyada 2.52 MB** çıktı —
gerçek çizimler entity başına çok daha az eğri içeriyor. Asset boyutu endişesi
büyük ölçüde düştü.

#### Bulgu 1 — sahne merkezi aykırı değerden bozuluyordu (düzeltildi)

Çizimin gövdesi ~34 m × 19 m, ama `ARK_İnsan` katmanında 130 m soldaki tek bir
kaçak sembol bbox'ı 166 m'ye çekiyordu. `toUnderlayBuffer` merkezi bbox
ortasına kuruyordu → **63 m sapma**; import edilen çizim sahnede alakasız bir
yerde belirirdi.

Çözüm: `contentBounds()` — yüzdelik-kırpılmış extent (her eksenin uçlarından
%0,5). Merkez artık buna göre; aykırı geometri hâlâ çiziliyor, sadece çerçeveyi
belirlemiyor. `CadUnderlay` hem `bounds` (gerçek) hem `contentBounds` (kırpılmış)
taşıyor. 3 test eklendi.

#### Bulgu 2 — atlanan entity'lerin hiçbiri mimari değil

6.615 atlanan entity'nin katman dağılımı:

| Tip | Adet | Nerede |
|---|---|---|
| SPLINE | 3.464 | %98'i `ARK_Araç` (araba sembolleri) |
| MTEXT/TEXT | 1.630 | tamamı `*_Text` katmanları |
| ELLIPSE | 1.123 | %90'ı `ARK_Tefriş` (mobilya) |
| HATCH | 165 | çoğu `ARK_Bitki` |
| WIPEOUT | 63 | maske, geometri değil |

**Tek bir atlanan entity bile duvar/kolon/merdiven katmanında değil.** Mimari
katmanlar tamamen LINE / LWPOLYLINE / ARC / CIRCLE — desteklediğimiz küme.
SPLINE desteği sayıca en büyük eksik görünüyordu; pratikte dekorasyon
meselesi. Faz 6'da önceliği düşürüldü.

#### Bulgu 3 — katman filtresi ana performans kaldıracı

En büyük 4 katman (Tefriş, Araç, İnsan, Bitki) 146.474 segmentin
**%89'unu** taşıyor. Gerçek mimari (Duvar_Dış 757, Duvar_İç 687, Kapı 1.457,
Pencere 297, Kolon 385) ~%2. Dekorasyon katmanlarını kapatmak snap indeksini ve
render yükünü onda bire indiriyor. Faz 3'ün katman panelini ve Faz 4'ün
"sadece görünür katmanlar havuza girer" kuralını doğruluyor.

#### Bulgu 4 — gerçek DWG tek bir plan değil, bir pafta düzeni

Model space'te yan yana 6+ ayrı çizim var: sembol kütüphanesi, lejant tablosu,
birkaç vaziyet planı, kat planları. Faz 3'ün "import et ve bitti" varsayımı
yanlış — kullanıcının ilgilendiği paftayı orijine getirebilmesi gerekiyor.
`locked` varsayılan true olduğu için kalibrasyon modunun (unlock + taşı) bu iş
için de gerekli olduğu netleşti. Bölge/pafta seçimi Faz 3 kapsamına eklenmeli.

**Hâlâ doğrulanmadı:** editörün içinde canlı import — 2D planda ve 3D'de
görünürlük, kilitlilik, soğuk sahne açılışı. Bunun için Faz 3'ün UI'ı gerekiyor.

### Faz 3 — Import UI ✅ tamamlandı

| Dosya | İş |
|---|---|
| `packages/editor/src/lib/cad-import.ts` | `analyzeCadFile` / `commitCadImport` — sahneye dokunmayan analiz, ayrı commit |
| `packages/editor/src/hooks/use-cad-import.ts` | Akış durumu (analiz → onay → node) |
| `packages/editor/src/components/ui/dialogs/import-cad-dialog.tsx` | Özet, uyarılar, birim seçici, ağırlık çubuklu katman listesi |
| `packages/editor/src/components/ui/panels/cad-underlay-panel.tsx` | Opaklık, kilit, katman görünürlüğü, sil |
| `site-panel/index.tsx` | Seviye başına "Import CAD drawing (.dxf)" satırı |
| `reference-panel.tsx` | `cad-underlay` seçilince kendi paneline devrediyor |

17 test. Gerçek dosyada uçtan uca doğrulandı: 29,9 MB → **197 ms** analiz,
146.474 çizgi, 2,52 MB asset, `$INSUNITS` okundu, iki uyarı da doğru tetiklendi.

**Birim seçici, faktör yerine sonucu gösteriyor.** Birimsiz bir çizimde
"Millimetres / 0.001" değil, "Millimetres — 30,0 m × 20,0 m" ve yanlış seçenek
"Metres — 30.000 m × 20.000 m" olarak listeleniyor. CAD bilmeyen biri bile doğru
olanı seçebilir; en makul olan `likely` rozetiyle önceden seçili geliyor.

**Katman listesi ağırlığa göre sıralı, yüzde çubuklu.** Gerçek dosyada ilk 4
katman çizginin %89'unu taşıyor; dördünü kapatmak 146.474'ü 15.705'e (%11)
indiriyor. Bunu görmeden doğru kararı vermek mümkün değil.

#### Kapsamdan çıkarılan: worker

Plan worker öngörüyordu. Gerçek dosyada ölçüm: 29,9 MB / 200k entity için
**197 ms**. `@pascal-app/editor` hem kütüphane hem Next uygulaması olarak
paketleniyor ve worker URL çözümü bundler'a göre değişiyor — üçte bir saniye
için gerçek karmaşıklık. Ana thread'de bırakıldı; ölçüm ve gerekçe
`cad-import.ts` başında yazılı. Bir mertebe büyük dosyalar çıkarsa dikilecek
yer `analyzeCadFile`.

#### Yapılmadı: iki nokta kalibrasyonu

Birimsiz çizimler için makullük sezgisiyle çalışan birim seçici var, ama
`GuideScaleReference` tarzı "bilinen bir mesafeyi ölç" akışı yok. Test
dosyası birimini bildiriyordu (`$INSUNITS=4`), o yüzden bu yol gerçek veriyle
hiç sınanmadı. Şema (`CadUnderlayNode.calibration`) hazır bekliyor.

#### Hâlâ doğrulanmadı

Tarayıcıda canlı akış: diyaloğun gerçek render'ı, `createNode` sonrası 2D/3D
görünürlük, kilitlilik, soğuk sahne açılışı. Kod yolları testli ama editör
açılıp denenmedi.

### Faz 3.5 — kalibrasyon (birimsiz çizimler için)
İki nokta ölç → gerçek uzunluk gir → `scale` ve `calibration` yaz. Kalibrasyon
açıkken `locked` geçici olarak düşer.

### Faz 4 — Snap entegrasyonu ⏳ duvar tamam, diğer araçlar bekliyor

#### `SnapSegment` refactor'ü yapılmadı — gerekmedi

Plan `wall-snap-geometry.ts`'i soyutlamayı öngörüyordu. Gerçekte gerekmiyor:
parser her eğriyi düzleştirdiği için **CAD geometrisi daima düz segment**, oysa
duvar fonksiyonları kavis matematiği ve node kimliği taşıyor. Ortak noktaları
sanıldığından az. Üstelik CAD tarafı uzamsal indeks istiyor, duvar tarafı
istemiyor (onlarca duvara karşı yüz binlerce segment).

Ortak olan şey soyut bir segment tipi değil, **her aracın çağırabileceği tek
fonksiyon**: `findCadSnapOnLevel(levelId, point, radii?)`. İyi test edilmiş
duvar snap kodu hiç ellenmedi — sıfır regresyon riski.

| Dosya | İş | Test |
|---|---|---|
| `lib/cad-snap-index.ts` | Uniform grid spatial hash; yerleşim dönüşümü; köşe/orta/kesişim/gövde sorguları | 18 |
| `lib/cad-snap-source.ts` | Seviye başına indeks, imza tabanlı önbellek | 10 |
| `lib/cad-underlay-layers.ts` | 2D + 3D + snap için **tek** katman kaynağı | 7 |
| `wall-drafting.ts` | Duvar boru hattına CAD katmanı | 9 |

#### Öncelik sırası

1. Mevcut duvar köşe/orta/kesişim noktaları
2. **CAD snap** — grid'den *önce*; imleçle çizgi arasına grid quantise girerse
   çizim üzerinden çizmek zaten mümkün olmaz
3. Grid / açı
4. Duvar gövdesi

Beraberlikte duvar kazanır: kullanıcının kurduğu model, referans aldığı çizimden
üstündür. CAD snap `targetWallIds` taşımaz — traced bir çizgi bölünecek ya da
birleşilecek bir duvar değil.

**Grid modunda da yapışıyor.** Sadece `'lines'` moduna bağlasaydık, varsayılan
modda çizim import eden biri onu dekoratif bulurdu. Duvar bağlantısıyla aynı
terimlerle: mod yerleşimi çizgiye kadar yönetir, son birkaç santim yapışır.

**Beacon amber.** Aynı glif, farklı renk — kullanıcı modele mi çizime mi
kilitlendiğini görür. 2D ve 3D'de birden.

#### Gerçek dosyada ölçüm (146.474 segment)

| | segment | indeks kurulumu | sorgu |
|---|---|---|---|
| tüm katmanlar | 146.474 | 12 ms | **160 µs** |
| dekorasyon kapalı | 15.705 | 1 ms | **15 µs** |

60 fps'de bir kare 16.666 µs; sorgu en kötü halde karenin %1'i. Katman
filtresinin 10× kazancı Bulgu 3'ü doğruluyor.

#### Bağlanan araçlar

- ✅ Duvar çizimi 3D (`wall/tool.tsx`, 3 çağrı noktası)
- ✅ Duvar çizimi 2D (`wall/floorplan-affordances.ts`) — parite
- ✅ Duvar uç noktası taşıma (`wall/move-endpoint-tool.tsx`)

#### Bağlanmayan araçlar

Çit, döşeme/zone poligonu, kolon/item yerleştirme, merdiven, asansör, ölçüm —
ve alignment anchor tarafı.

Kalanların çoğu bugün **hiç manyetik snap içermiyor**, sadece `snapPointToGrid`
çağırıyor. Onlara CAD eklemek, CAD'den bağımsız yeni bir davranış eklemek
demek; her biri kendi 2D/3D parite kontrolünü ve testini istiyor. Artık desen
kurulu ve tek fonksiyon çağrısına indi, ama araç başına ayrı iş.

### Faz 5 — DWG desteği
- `apps/editor/app/api/cad/convert/route.ts` → sunucuda `dwg2dxf` → aynı client
  boru hattı
- Dockerfile'a `libredwg-tools`
- **Lisans:** LibreDWG GPL-3.0. Ayrı bir binary olarak çalıştırılır, npm
  paketlerine linklenmez — repo MIT kalır
- Boyut limiti, timeout, temp dosya temizliği, upload doğrulaması
  (`packages/mcp/src/lib/safe-fetch.ts` deseni)

### Faz 6 — Cila
- Ölçüm aracının CAD'e snap etmesi
- Altlık opaklık/renk kontrolleri, birden fazla altlık, seviye başına altlık
- MCP tool (`import_cad`)

---

## Riskler

| Risk | Azaltma |
|---|---|
| 100k+ segmentte snap performansı | Uzamsal indeks + görünür katman filtresi + imleç çevresi sınırı; Faz 4 başında bench |
| `SnapSegment` refactor'ün regresyonu | Mevcut `wall-snap-geometry.test.ts` + `wall-drafting.test.ts` davranış kanıtı; refactor'da test **değiştirilmez** |
| Grid snap'i olan ama magnetic'i olmayan araçlara yeni davranış eklemek | Her araç için 2D/3D parite testi; CAD snap'i `'lines'` moduna bağlı kalsın |
| DWG lisans zinciri | Ayrı process, dinamik/statik linkleme yok |
| 2D↔3D parite kuralının ihlali | Her davranış değişikliği kardeş dosyayla aynı PR'da (`wiki/architecture/tools.md`) |
