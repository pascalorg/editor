# Pascal Editor — Ürün Araştırması ve Özellik Yol Haritası (2026)

> Amaç: Pascal Editor'ün bir sonraki 12 ayında hangi özelliklerin en yüksek
> getiriyi sağlayacağını, SketchUp'ın kullanımı hızlandıran mekaniklerini ve
> 2026 web-BIM pazarını referans alarak belirlemek.
>
> Bu doküman kod tabanının mevcut durumu (Ağustos 2026, `v1.0.0-beta.1` sonrası)
> üzerine kurulu. Her öneri, bu repodaki gerçek dosya/katman yerleşimiyle
> eşleştirilmiştir.

---

## 1. Yönetici Özeti

Pascal bugün **modelleme kapsamı** açısından güçlü (39 yapı aracı, MEP, çatı,
teras, arazi heykeltıraşlığı, CAD underlay, GLB/STL/OBJ + kat planı PDF çıktısı,
MCP üzerinden AI entegrasyonu). Zayıf olduğu yer **kapsam değil, akıcılık**:

| Eksen | Durum |
|---|---|
| Ne kadar şey modelleyebiliyorum? | **Güçlü** — rakiplerin çoğundan geniş |
| Ne kadar *hassas* ve *hızlı* modelliyorum? | **Zayıf** — sayısal giriş yok, eksen kilidi yok |
| Modelimi nasıl organize ederim? | **Orta** — collections var ama görünürlük kontrolü yok |
| Başkalarıyla nasıl çalışırım? | **Yok** — çok kullanıcılı düzenleme, yorum yok |
| Modelden nasıl bilgi çıkarırım? | **Orta** — schedule altyapısı var, alan/maliyet analizi yok |

**Ana tez:** SketchUp'ın 20 yıldır kazandığı savaş modelleme *kapsamı* değil,
**girdi hassasiyeti ve geri bildirim döngüsü**. Bir SketchUp kullanıcısı duvar
çizerken fareyi bırakmadan `4200` yazıp Enter'a basar. Pascal'da bu mümkün değil.
Bu tek eksik, aracı "hızlı taslak" kategorisinden "gerçek iş" kategorisine
geçirmeyi engelliyor.

**En yüksek öncelikli 3 iş:**
1. **Measurements Box (sayısal giriş)** — SketchUp'ın VCB'si. Altyapının %70'i
   zaten var (`parseMeasurement`).
2. **Inference / eksen kilidi** — ok tuşlarıyla eksen kilitleme, dik/paralel
   çıkarımı, snap ipuçları.
3. **Definition/Instance (Component) sistemi** — tekrar kullanılabilir birleşen;
   bir yerde düzenle, her yerde güncellensin.

---

## 2. Mevcut Durum Envanteri (kod tabanından doğrulanmış)

### Var olanlar

**Modelleme**
- 39 built-in yapı aracı: `wall`, `slab`, `ceiling`, `roof` (+ `roof-segment`,
  `dormer`, `skylight`, `chimney`, 5 çeşit vent, `cupola`), `stair`,
  `elevator`, `column`, `structural-grid`, `fence`, `gutter`/`downspout`,
  `solar-panel`
- Tam MEP hattı: `duct-segment`/`fitting`/`terminal`, `pipe-segment`/`fitting`/
  `trap`, `hvac-equipment`, `lineset`, `liquid-line` — `port-connectivity.ts` ve
  `system-graph.ts` ile bağlantı grafiği, `riser-diagram-panel.tsx` ile şema
- Arazi heykeltıraşlığı (`terrain-sculpt`) + arazi-farkındalıklı yerleştirme
- Dikey model: kat yükseklikleri, destek zinciri, kot kılavuzları
  (`vertical-model.md`)

**Etkileşim**
- 2D / 3D / split görünüm, floorplan modu, first-person walkthrough
- Snap servisi: grid snap (`0.5/0.25/0.1/0.05`), açı snap (`DEFAULT_ANGLE_STEP =
  15°`), hizalama çapaları (`alignment-anchors.ts`), açıklık kılavuzları
- Grup seçimi (Cmd+G), marquee, box-select, çoklu seçim paneli
- Malzeme boyama modu, malzeme kütüphanesi, 13+ preset, sahne temaları
- Undo/redo (Zundo), sürüm önizleme modu, otomatik kayıt (IndexedDB)
- Komut paleti, klavye kısayolları, bağlamsal yardımcı paneller

**Veri giriş / çıkış**
- DXF → CAD underlay (`packages/cad-import`), IFC → sahne
  (`packages/ifc-converter`)
- GLB (dokulu), STL, OBJ dışa aktarım
- Kat planı PDF çıktısı (`floorplan-pdfkit-renderer.ts`) + **schedule altyapısı**
  (`collectFloorplanSchedules` — node tanımları schedule katkısı verebiliyor)
- MCP sunucusu: 30+ araç (sahne sorgusu, çakışma kontrolü, kapı/yerleşim
  açıklığı, ölçüm, foto→sahne, vision, şablonlar, canlı senkron)

**Organizasyon**
- `Collection` (id/name/color/nodeIds) — etiket benzeri gruplama
- Site paneli ağacı (outliner) — hiyerarşi, seçim, odaklama
- Plugin mimarisi — dış node kind'ları merkezi union düzenlemesi olmadan araç
  olabiliyor

### Olmayanlar (doğrulanmış boşluklar)

| Eksik | Kanıt |
|---|---|
| Sayısal boyut girişi (VCB) | `measurement-pill.tsx` salt-okunur; hiçbir tool'da typed input yok |
| Eksen kilidi (ok tuşları) | `axisLock`/`lockAxis` grep sonucu boş |
| Kesit düzlemi (section plane) | `clippingPlane`/`localClipping` grep sonucu boş |
| Component/Instance (definition paylaşımı) | `blockInstance`/`component instance` yok; `Collection` sadece id listesi |
| Collection görünürlük kontrolü | `Collection` tipinde `visible` alanı yok |
| Güneş/gölge etüdü | `scene-themes.ts` sabit ışık pozisyonları; `sunPosition`/`timeOfDay` yok |
| Dizi/array araçları | `linearArray`/`duplicateAlong` grep sonucu boş |
| Çok kullanıcılı düzenleme / yorum | `collab`/`yjs`/`presence` grep sonucu boş |
| Alan/hacim/maliyet analizi | `zone` node var, metrik toplama yok |
| IFC **dışa** aktarım | `ifc-converter` yalnızca içe aktarım yönlü |

---

## 3. SketchUp'tan Alınacak Dersler

SketchUp'ın hız avantajı üç mekanizmadan geliyor. Hiçbiri geometri motoruyla
ilgili değil — hepsi **girdi ergonomisi**.

### 3.1 Inference Engine (çıkarım motoru)

SketchUp üç sınıf çıkarım sunuyor:

- **Nokta çıkarımı** — endpoint, midpoint, kesişim, merkez, yüzey üstü, kenar
  üstü, guide point. Her biri renkli bir işaret + ScreenTip ("Midpoint")
- **Doğrusal çıkarım** — kırmızı/yeşil/mavi eksene hizalama, mevcut bir kenara
  paralel/dik, teğet, kenarın hayali uzantısı. Kesikli çizgi ekseninin rengiyle
  gösterilir
- **Şekil çıkarımı** — kare, altın oran dikdörtgen, çeyrek/yarım daire

**Kilitleme:** `↑` mavi eksen, `←` yeşil, `→` kırmızı, `↓` paralel/dik (magenta),
`Shift` aktif çıkarım yönünü kilitler, `Alt/Cmd` çıkarımları tamamen kapatır.

> **Pascal karşılığı:** `snap.ts`'te `snapPointToAngle`, `snapAngleToList`,
> `snapPointAlongAngleRay` zaten var. `alignment-anchors.ts` çapa üretiyor,
> `wall-snap-beacon-layer.tsx` görsel geri bildirim veriyor. Eksik olan
> **kilitleme katmanı** ve **çıkarım tipinin adının ekranda gösterilmesi**.

### 3.2 Measurements Box (VCB)

Herhangi bir çizim/değiştirme aracı aktifken kullanıcı klavyeden değer yazar:
- Uzunluk: `4200`
- Mutlak koordinat: `[3', 5', 7']`
- Göreli koordinat: `<1.5m, 4m, 2.75m>`
- Açı, yarıçap, ölçek faktörü, kopya sayısı (`*12` → 12 kopya)

Kritik nokta: **hiçbir diyalog açılmaz, odak değişmez.** Kullanıcı fareyi
bırakmaz, yazar, Enter'a basar. İşlem tamamlandıktan *sonra* bile değer
yazılabilir ve son işlem yeniden hesaplanır.

> **Pascal karşılığı:** `lib/measurement-parser.ts` içindeki `parseMeasurement`
> ve `lingoUnitSpec` bu işin parse tarafını **zaten çözüyor** (metrik/emperyal,
> birim eki). Eksik olan: global klavye yakalama + aktif tool draft state'ine
> commit yolu.

### 3.3 Definition / Instance (Components)

SketchUp bir component'in geometrisini **bir kez** saklar; her kopya sadece
"isim + transform matrisi". 40 özdeş sandalye = 1 geometri + 40 matris.
Bir instance'ı düzenlemek tüm instance'ları günceller.

Bu iki fayda veriyor:
1. **Bellek/performans** — büyük modeller çökmüyor
2. **Tasarım niyeti** — "tüm pencereleri 10cm büyüt" tek işlem

> **Pascal karşılığı:** Yok. `Collection` sadece bir id listesi; paylaşılan
> tanım yok. Bu, mimari olarak en büyük ama en değerli ekleme.

### 3.4 Diğer aktarılabilir mekanikler

| SketchUp | Pascal'a çevirisi | Değer |
|---|---|---|
| Section Plane | Three.js clipping plane + `section-plane` node kind | Yüksek — iç mekan incelemesi, sunum |
| Scenes (kayıtlı görünüm) | Kamera + görünürlük + kesit durumu snapshot'ı | Yüksek — sunum, PDF sayfaları |
| Tags (görünürlük) | `Collection.visible` + göz ikonu | Düşük efor, yüksek getiri |
| Move + `*n` (dizi) | Linear/radial array aracı | Orta — kolon ızgarası, panel dizisi |
| Tape Measure → guide | `guide` node kind **zaten var** — UI'ya bağla | Düşük efor |
| Outliner | `site-panel/tree-node.tsx` **zaten var** — görünürlük/kilit ekle | Düşük efor |
| Push/Pull | Parametrik karşılığı: duvar yüzü sürükleyerek kalınlık/yükseklik | Orta |

### 3.5 SketchUp 2026'nın kendi yönü

Trimble'ın 2026.0 sürümü (Ekim 2025, normalden 7 ay erken) nereye gittiklerini
gösteriyor:
- **Trimble Connect ile paylaşımlı görüntüleme** — davetli kullanıcı modeli
  gezebiliyor, ölçüm alabiliyor, **yorum bırakabiliyor**
- **Diffusion** — AI ile hızlı 3D modelden konsept görsel üretimi (dışa aktarım
  gerekmeden)
- **Ambient Occlusion** — şiddet/mesafe/renk kontrolü
- LayOut'a trim/extend/fillet/chamfer; viewport'larda foto-gerçekçi malzeme
- Move/Scale/Rotate'in 2D ve 3D'de **tutarlı** davranması

Yani sektör lideri bile: **işbirliği + AI görselleştirme + 2D/3D davranış
paritesi** üçlüsüne yatırım yapıyor. Pascal'ın `tools.md`'deki "2D↔3D behavioral
parity" kuralı bu açıdan doğru bir yatırım.

---

## 4. Pazar Analizi (2026)

### Rakip konumlandırma

| Ürün | Konum | Pascal için ders |
|---|---|---|
| **Arcol** | Tarayıcı-öncelikli "BIM 2.0", konsept tasarım. Kütle/mekan modelleme + analiz/raporlama + gerçek zamanlı beyaz tahta işbirliği ve sunum tek tuvalde | Tek tuvalde **tasarım + veri + sunum** birleşimi; doğal dil arayüzünde öncü |
| **Snaptrude** | AI-öncelikli, bulut-doğal BIM. Metin promptundan program üretimi, imar/setback/yükseklik analizi, kat istifleme, Revit'e parametreli aktarım | Gerçek çok kullanıcılı düzenleme; "tasarım niyeti ↔ BIM modeli" boşluğunu kapatma |
| **Rayon** | "2D CAD'in Figma'sı". 4000+ CAD blok, DWG/DXF/PDF içe aktarım, eşzamanlı çizim + yorum + anotasyon | Blok kütüphanesinin ölçeği; 2D dokümantasyonun ciddiye alınması |
| **Autodesk Forma** | Spacemaker satın alımı sonrası; erken aşama analiz (güneş, rüzgar, gürültü) | Konsolidasyon dalgası — bağımsız üretken tasarım araçları satın alınıyor |
| **SketchUp 2026** | Masaüstü lider, buluta doğru geç hamle | İşbirliğine geç kaldı — bu bir açık kapı |

### 2026'nın belirleyici trendleri

1. **Doğal dil arayüzleri** — metin promptundan tasarım üretimi. Arcol öncü,
   yerleşik platformlar parametrik kontrollerin yanına prompt ekliyor.
2. **Üretken program/yerleşim** — RFP/prompt → site analizi (imar, setback,
   yükseklik, iklim) → yapısal mimari program → kat istifleme → sunum diyagramı
   ve AI render, hepsi 3D tuvalde.
3. **Benimseme gerçek** — Chaos/Architizer'ın 800+ AEC profesyoneliyle
   anketinde **%46'sı günlük işinde AI aracı kullanıyor**, **%44'ü konsept
   görselini AI ile üretiyor**.
4. **Düzenlenebilir BIM çıktısı** — AI araçları artık düzenlenebilir BIM modeli
   üretiyor: yerleşimi rafine et, programı ayarla, kütleyi duvar/döşemeye
   çevir, parametrelerle Revit'e aktar.
5. **Sürekli maliyet/miktar** — quantity takeoff tek seferlik değil, tasarım
   değiştikçe otomatik güncellenen sürekli bir süreç haline geliyor.
6. **Dosya-tabanlıdan bulut-doğala** — worksharing kurulumu, VPN, dosya
   çakışması olmadan gerçek zamanlı çoklu kullanıcı.

### Pascal'ın konumlandırma avantajı

Pascal'da **MCP sunucusu zaten var** — 30+ araçla bir AI ajanı sahneyi
sorgulayabiliyor, düzenleyebiliyor, çakışma kontrolü ve açıklık analizi
yapabiliyor, fotoğraftan sahne üretebiliyor. Rakiplerin çoğu AI'ı ürün içine
gömülü bir düğme olarak sunuyor; Pascal **ajan-yerel bir editör** olarak
konumlanabilir. Bu, savunulabilir bir farklılık — ve `packages/mcp` bunun
altyapısını hâlihazırda taşıyor.

---

## 5. Boşluk Analizi

| Yetenek | SketchUp | Arcol/Snaptrude | Pascal | Boşluk |
|---|---|---|---|---|
| Sayısal boyut girişi | ✅ VCB | ✅ | ❌ | **Kritik** |
| Eksen/çıkarım kilidi | ✅ | ✅ | Kısmi (açı snap) | **Kritik** |
| Component/instance | ✅ | ✅ | ❌ | **Kritik** |
| Kesit düzlemi | ✅ | ✅ | ❌ | Yüksek |
| Kayıtlı görünüm (Scenes) | ✅ | ✅ | ❌ | Yüksek |
| Etiket görünürlüğü | ✅ Tags | ✅ | Kısmi (Collections) | Orta-düşük efor |
| Çok kullanıcılı düzenleme | ❌ (sadece görüntüleme) | ✅ | ❌ | Yüksek |
| Yorum/markup | ✅ (2026) | ✅ | ❌ | Orta |
| Güneş/gölge etüdü | ✅ | ✅ | ❌ | Orta |
| Alan/miktar tablosu | Eklenti | ✅ | Altyapı var | Orta-düşük efor |
| IFC dışa aktarım | Eklenti | ✅ | ❌ (sadece içe) | Yüksek (kurumsal) |
| 2D dokümantasyon | ✅ LayOut | Kısmi | ✅ PDF plan | **Pascal önde** |
| MEP modelleme | Eklenti | Kısmi | ✅ Tam hat | **Pascal önde** |
| Arazi | Eklenti | Kısmi | ✅ Sculpt | **Pascal önde** |
| AI/ajan entegrasyonu | Diffusion (görsel) | ✅ Prompt→tasarım | ✅ MCP (30+ araç) | **Pascal önde** |
| Plugin ekosistemi | ✅ Devasa | ❌ | ✅ Mimari hazır | Ekosistem eksik |

---

## 6. Önerilen Özellikler

### P0 — Temel akıcılık (0-3 ay)

Bu üçü olmadan Pascal "ciddi araç" algısına ulaşamaz. Toplam efor görece düşük,
etki en yüksek.

---

#### P0.1 — Measurements Box (sayısal giriş)

**Ne:** Aktif bir çizim/taşıma/döndürme aracı varken kullanıcı klavyeden değer
yazar; ekranın alt-sağında bir alan dolar; Enter kesinleştirir. Diyalog açılmaz,
odak kaybolmaz. İşlem *bittikten sonra* da yazılabilir → son işlem yeniden
hesaplanır.

**Desteklenecek girdiler (aşamalı):**
1. Uzunluk — `4.2`, `4200mm`, `13'9"` (parser zaten hazır)
2. İki değerli — `4.2;2.8` (dikdörtgen oda, döşeme)
3. Açı — `45°`, `<30`
4. Çoğaltma — `*12` (dizi ile birlikte, P1.4)

**Neden:** SketchUp'ın hız avantajının tek en büyük kaynağı. Şu an Pascal'da
tam 4.20 m duvar çizmenin yolu yok — kullanıcı grid snap'e mahkûm.

**Nerede:**
- `packages/editor/src/store/use-measurement-input.ts` — yeni store: `buffer`,
  `commit()`, `cancel()`, aktif tool'un beklediği alan tipi
- `packages/editor/src/hooks/use-keyboard.ts` — rakam/nokta/virgül/tırnak
  tuşlarını yakala, mevcut kısayolların **önüne** geç (Escape/Enter hariç)
- `packages/editor/src/lib/measurement-parser.ts` — `parseMeasurement` yeniden
  kullanılır; açı ve çift-değer için genişletilir
- `packages/editor/src/components/editor/measurement-pill.tsx` — salt-okunur
  pill'i düzenlenebilir hale getir (imleç, buffer gösterimi)
- Draft tarafı: `components/tools/wall/wall-drafting.ts` (`angleSnap`'in yanına
  `fixedLength?: number`), `fence-drafting.ts`, ve `use-segment-draft-chain.ts`

**Efor:** ~2-3 hafta. Parser ve draft pipeline mevcut olduğu için risk düşük.

**Risk:** `use-keyboard.ts` şu an tek-harf kısayollarla dolu (`v`, `b`, `m`,
`x`, `p`, `g`, `f`, `z`, `r`, `t`, `e`, `c`, `j`). Sayısal buffer aktifken bu
kısayolların bastırılması gerekir — `use-interaction-scope.ts` (mevcut durum
makinesi) bunun doğru yeri.

---

#### P0.2 — Inference & eksen kilidi

**Ne:**
- `→` kırmızı (X), `↑` mavi (Y/dikey), `←` yeşil (Z) eksenine kilit;
  `↓` paralel/dik çıkarım kilidi
- `Shift` basılıyken **aktif çıkarım yönü** kilitlenir (şu an Shift snap
  bypass/cycle için kullanılıyor — `tools.md`'deki Shift sözleşmesiyle
  uyumlandırılmalı)
- Çıkarım tipinin **adı ve rengi** imleçte gösterilir: "Endpoint", "Midpoint",
  "Perpendicular to Wall", "On Guide"
- Mevcut bir kenarın hayali uzantısına snap

**Neden:** Snap zaten var ama **kullanıcı neye snap ettiğini göremiyor**. SketchUp'ın
ScreenTip'i bir öğrenme aracı kadar bir güven aracı. Kilit olmadan da uzun
mesafede istenmeyen snap'e kayma sorunu yaşanır.

**Nerede:**
- `packages/core/src/services/snap.ts` — `SnapServices`'e `axisLock` parametresi
  ve dönüş değerine `snapKind: 'endpoint' | 'midpoint' | 'perpendicular' | ...`
  eklenir
- `packages/core/src/services/alignment-anchors.ts` — çapa üretimi zaten var,
  tip etiketi eklenir
- `packages/editor/src/components/ui/snap-target-badge.tsx` — **zaten var**,
  çıkarım adını gösterecek şekilde genişletilir
- `packages/editor/src/store/use-alignment-guides.ts` — eksen kilidi state'i
- 2D tarafında paritesi: `use-floorplan-background-placement.ts`
  (`tools.md`'deki 2D↔3D parite kuralı gereği aynı PR'da)

**Efor:** ~2 hafta.

**Not:** `guide` node kind zaten kayıtlı. SketchUp'ın Tape Measure → kılavuz
çizgisi akışı neredeyse bedava bir kazanç.

---

#### P0.3 — Definition / Instance (Components)

**Ne:** Bir node alt-ağacını "tanım" (definition) olarak kaydet; sahneye
yerleştirilen her kopya sadece `definitionId + transform`. Bir instance
düzenlendiğinde tanım güncellenir → tüm instance'lar değişir. "Make unique"
ile bir instance bağdan koparılabilir.

**Neden:**
- **Tasarım niyeti:** "tüm tip-A pencereleri değiştir" tek işlem
- **Performans:** 200 özdeş balkon korkuluğu = 1 geometri
- **Kütüphane:** kullanıcı kendi component'ini yaratıp yeniden kullanabilir —
  Rayon'un 4000 bloğuna karşı verilecek cevabın temeli

**Nerede (mimari olarak en ağır iş):**
- `packages/core/src/schema/definitions.ts` — yeni `Definition` tipi
  (`id`, `name`, `rootNodeId`, `thumbnail?`)
- `packages/core/src/schema/nodes/instance.ts` — yeni node kind. **`AGENTS.md`
  dört-yer kuralı geçerli:** zod şeması → `schema/types.ts` `AnyNode` union →
  `events/bus.ts` `NodeEvents<'instance', …>` → `packages/nodes/src/instance/`
- `packages/viewer` — instanced rendering (`THREE.InstancedMesh`) ile gerçek
  bellek kazancı
- `packages/editor` — "Make Component", "Edit Component", "Make Unique",
  component paneli

**Efor:** ~6-8 hafta. En riskli iş; undo/redo, seçim yöneticileri
(`selection-managers.md`), scene registry (`scene-registry.md`) ve serileştirme
ile etkileşiyor.

**Öneri:** İki aşamada yap. Aşama 1: **salt-yerleştirme** instance'lar (tanım
düzenlenebilir ama instance içine girilemez) — riskin %70'ini eler, faydanın
%60'ını verir. Aşama 2: in-place düzenleme.

---

### P1 — Sunum ve organizasyon (3-6 ay)

---

#### P1.1 — Kesit düzlemleri (Section Planes)

**Ne:** Sahneye yerleştirilen, sürüklenebilir/döndürülebilir bir düzlem modeli
keser. Yatay kesit = kat planı görünümü; dikey kesit = birden fazla katın iç
mekanı. Aktif/pasif durumu; birden fazla düzlem tanımlanıp biri aktif olur.

**Neden:** SketchUp'ta iç mekan incelemesinin ve sunumun standart yolu. Pascal'ın
"exploded/solo level" modu benzer bir ihtiyacı karşılıyor ama keyfi düzlemde
kesme yok.

**Nerede:** Yeni `section-plane` node kind (dört-yer kuralı). Render tarafında
`THREE.Plane` + `renderer.localClippingEnabled` — `packages/viewer`. Kesit
yüzeyinin dolu görünmesi (cap) için stencil pass gerekir; ilk sürümde
atlanabilir.

**Efor:** ~3 hafta (cap olmadan), +2 hafta (cap ile).

---

#### P1.2 — Scenes / Kayıtlı görünümler

**Ne:** Kamera pozu + görünürlük durumu + aktif kesit + stil/tema'yı bir isimle
kaydet. Aralarında geçiş yap. Sıralanabilir liste.

**Neden:** Sunumun temel birimi. Ayrıca **PDF çıktısıyla doğrudan bağlanır** —
her scene bir sayfa. `floorplan-export.tsx` zaten sayfa düzeni çözüyor.

**Nerede:** `camera-pose-store.ts` zaten kamera pozunu tutuyor. `BaseNode`'da
`camera?: Camera` alanı var. Yeni `Scene` (isim çakışması: `SavedView` demek
daha iyi) kayıt tipi core'a; UI `packages/editor`'e.

**Efor:** ~2 hafta. Kesit düzlemleriyle birlikte planlanmalı.

---

#### P1.3 — Collection'lara görünürlük + kilit (Tags paritesi)

**Ne:** `Collection` tipine `visible: boolean` ve `locked: boolean` ekle.
Outliner'da ve collections popover'ında göz/kilit ikonu. Bir node birden fazla
collection'da olabilir — bu SketchUp'ın kendi kullanıcılarının şikâyet ettiği
bir eksik ("hâlâ bir nesneyi birden fazla tag'e atamanın yolu yok"), Pascal'ın
`nodeIds: AnyNodeId[]` yapısı bunu **zaten** destekliyor.

**Neden:** En düşük efor / en yüksek getiri oranı. Model karmaşıklaştıkça
kaçınılmaz bir ihtiyaç, ve rakip liderin bilinen bir zayıflığı.

**Nerede:** `packages/core/src/schema/collections.ts` (+2 alan),
`collections-popover.tsx`, `site-panel/tree-node.tsx`. Görünürlük çözümü
`node.visible` ile birleşir — efektif görünürlük = node.visible AND tüm
collection'ların visible.

**Efor:** ~1 hafta.

---

#### P1.4 — Dizi / Array araçları

**Ne:** Taşı+kopyala sonrası `*n` ile lineer dizi; `/n` ile aralara bölme;
polar (radyal) dizi; bir eğri/duvar boyunca dağıtma.

**Neden:** Kolon ızgarası, korkuluk dikmesi, güneş paneli tarlası, park yeri
— hepsi tek tek yerleştiriliyor şu an. `structural-grid` node'u var ama genel
bir dizi mekaniği yok.

**Nerede:** `packages/editor/src/components/tools/` altında yeni bir tool +
`use-drag-action.ts` ile entegrasyon. Measurements Box'ın `*n` sözdizimiyle
birlikte tasarlanmalı (P0.1 bağımlılığı).

**Efor:** ~2-3 hafta.

---

#### P1.5 — Güneş / gölge etüdü

**Ne:** Konum (enlem/boylam), tarih, saat → gerçek güneş açısı. Zaman kaydırıcısı.
Gün/yıl boyu gölge animasyonu. Opsiyonel: yüzey başına yıllık güneşlenme
haritası.

**Neden:** Erken tasarım analizinin en yaygın tek kalemi (Forma'nın çekirdek
satış argümanı). Pascal'da `solar-panel` node'u var ama **güneş konumu yok** —
bu ironik bir boşluk; panel verimliliği hesaplanamıyor.

**Nerede:** `packages/viewer/src/lib/scene-themes.ts` şu an sabit ışık
pozisyonları taşıyor (`{ position: [16, 22, 12], castShadow: true }`). Güneş
pozisyonu hesabı saf bir fonksiyon → `packages/core` (astronomik formül,
bağımlılıksız). Işık pozisyonu türetmesi → `viewer`. Zaman kontrolü →
`editor` (viewer'a prop ile enjekte, `viewer-isolation.md` gereği).

**Efor:** ~3 hafta. Gölge kalitesi (cascaded shadow maps) ayrı bir iş.

---

### P2 — Platform ve işbirliği (6-12 ay)

---

#### P2.1 — Çok kullanıcılı düzenleme

**Ne:** Aynı sahnede eşzamanlı düzenleme, imleç varlığı (presence), seçim
paylaşımı.

**Neden:** Pazarın tanımlayıcı özelliği. Arcol, Snaptrude, Rayon'un hepsi
bunun üzerine kurulu; SketchUp 2026 bile ancak *görüntüleme* paylaşımına
ulaşabildi. Pascal'ın tarayıcı-doğal olması bu kapıyı açık bırakıyor.

**Nasıl:** Figma'nın yaklaşımı doğru referans — tam CRDT değil, **basitleştirilmiş
CRDT**: her istemci kendi doküman kopyasını tutar, sadece değişiklik logu
gönderilir, yakınsama garanti edilir. Sahne grafiği "taşınabilir ağaç" (movable
tree) problemidir — ekleme, silme ve **taşıma** çakışmaları ayrı ayrı ele
alınmalı (taşıma en zoru: döngü oluşturabilir).

**Nerede:** `packages/core/src/store` — `useScene` zaten Zustand + Zundo.
Zundo'nun undo geçmişi ile CRDT'nin uzlaşması **ana mimari risk**: çok
kullanıcılı ortamda undo "benim son işlemim" olmalı, "sahnedeki son işlem"
değil. Yjs pratik varsayılan, ancak Zundo entegrasyonu özel iş gerektirir.

**Efor:** ~3-4 ay. Sunucu tarafı (`packages/mcp`'deki `live-sync.ts` bir
başlangıç noktası olabilir) + istemci + çakışma testleri.

**Öneri:** Öncesinde **asenkron işbirliği** ile değeri erken kilitle → P2.2.

---

#### P2.2 — Yorum & markup (önce bu)

**Ne:** Modelde bir noktaya/node'a çivilenmiş yorum. Yanıt zinciri, çözüldü
işareti, bildirim. Salt-görüntüleme paylaşım linki.

**Neden:** Gerçek zamanlı düzenlemenin **değerinin çoğunu**, maliyetinin
**onda birine** verir. SketchUp 2026'nın attığı adım tam olarak bu (Trimble
Connect üzerinden gezme + ölçüm + yorum). Müşteri onayı döngüsü, uzaktan ekip
geri bildirimi bununla çözülür.

**Nerede:** Yeni `comment` node kind (ya da sahne-yanı ayrı bir koleksiyon —
undo geçmişine karışmaması için **node olmaması** muhtemelen daha doğru).
Görüntüleme paylaşımı: `apps/editor` + `lib/scene-store-server.ts`,
`scene-signature.ts` (imzalı paylaşım altyapısı zaten var).

**Efor:** ~4-6 hafta.

---

#### P2.3 — IFC dışa aktarım

**Ne:** `packages/ifc-converter` şu an tek yönlü (IFC → sahne). Ters yönü ekle:
sahne → IFC4.

**Neden:** Kurumsal/kamu işlerinde openBIM teslimatı zorunlu. Pascal'ın node
modeli (wall, slab, ceiling, roof, door, window, column, stair, zone) IFC'nin
`IfcWall`, `IfcSlab`, `IfcCovering`, `IfcRoof`, `IfcDoor`, `IfcWindow`,
`IfcColumn`, `IfcStair`, `IfcSpace` ile **neredeyse birebir** eşleşiyor — bu
alışılmadık derecede iyi bir başlangıç noktası.

**Nerede:** `packages/ifc-converter` — saf mantık, DOM/React yok (mevcut kural).

**Efor:** ~6-8 hafta. Kapsam MVP'de sınırlanmalı: geometri + tip + temel
property set'ler; IFC'nin tamamı bir kuyu.

---

#### P2.4 — Miktar / alan / maliyet paneli

**Ne:** Canlı güncellenen tablo: kat/zone başına alan, duvar uzunluğu ve alanı,
döşeme hacmi, kapı/pencere sayımı, malzeme başına miktar. CSV/XLSX çıktısı.
Opsiyonel birim fiyat → tahmini maliyet.

**Neden:** 2026 trendi net: quantity takeoff tek seferlik bir egzersizden
**tasarım değiştikçe otomatik güncellenen sürekli bir sürece** dönüşüyor.

**Nerede:** **Altyapının yarısı zaten var** —
`collectFloorplanSchedules(nodes, levelId, unit)` node registry'den
`getFloorplanNodeExtension(definition)?.schedule` katkılarını topluyor. Bu
mekanizma PDF çıktısı için yazılmış; canlı bir panele bağlanması ve node
tanımlarına schedule katkısı eklenmesi yeter.

**Efor:** ~3 hafta (mevcut altyapı sayesinde).

---

#### P2.5 — Ajan-yerel tasarım (AI)

**Ne:**
- **Prompt → yerleşim:** "3 yatak odalı, 120 m², güney cepheli" → oda programı,
  duvar yerleşimi, kapı/pencere yerleştirme
- **Tasarım kontrolü:** kod/yönetmelik kontrolü (kaçış mesafesi, kapı genişliği,
  merdiven yükseklik/basamak oranı) — `door-clearance.ts` ve
  `layout-clearance.ts` MCP araçları bunun çekirdeği
- **Doğal dil düzenleme:** "tüm iç duvarları 10 cm inceltt"

**Neden:** Pazarın en hızlı hareket eden ekseni ve **Pascal'ın hâlihazırda en
önde olduğu yer**. Rakipler AI'ı ürüne gömülü bir düğme olarak sunuyor; Pascal'ın
MCP sunucusu editörü tüm ajanlara açık bir API haline getiriyor.

**Nerede:** `packages/mcp` — mevcut 30+ araç üzerine. `templates/` ve
`variants/` klasörleri zaten var; `photo-to-scene` ve `vision` da öyle. Eksik
olan **editör içi ajan arayüzü** — bugün MCP'yi kullanmak için harici bir
istemci gerekiyor.

**Efor:** Ajan paneli ~4 hafta; üretken yerleşim ~2-3 ay.

**Not:** Bu, Pascal'ın hikâyesi olabilir. "Kod editörlerinde Copilot ne ise,
bina editöründe Pascal o" — ve altyapı zaten yerinde.

---

## 7. Yol Haritası Özeti

```
Çeyrek 1 (0-3 ay) — "Hassasiyet"
├── P0.1 Measurements Box            [3 hf]  ★ en yüksek getiri
├── P0.2 Inference & eksen kilidi    [2 hf]
├── P1.3 Collection görünürlük/kilit [1 hf]  ★ en düşük efor
└── P0.3 Component — Aşama 1         [5 hf]

Çeyrek 2 (3-6 ay) — "Sunum"
├── P1.1 Kesit düzlemleri            [3 hf]
├── P1.2 Kayıtlı görünümler          [2 hf]
├── P1.4 Dizi araçları               [3 hf]
├── P1.5 Güneş/gölge etüdü           [3 hf]
└── P2.4 Miktar/alan paneli          [3 hf]

Çeyrek 3-4 (6-12 ay) — "Platform"
├── P2.2 Yorum & paylaşım            [6 hf]  ← P2.1'den önce
├── P2.5 Ajan paneli                 [4 hf]
├── P2.3 IFC dışa aktarım            [8 hf]
├── P0.3 Component — Aşama 2         [4 hf]
└── P2.1 Çok kullanıcılı düzenleme   [16 hf]
```

**Sıralama gerekçesi:**
- Hassasiyet önce gelir — akıcı olmayan bir araca kimse özellik istemez
- Component erken başlar çünkü en uzun kuyruğa sahip (şema, render, undo,
  serileştirme)
- Yorum, gerçek zamanlı işbirliğinden **önce** gelir: değerin çoğu, maliyetin
  onda biri
- IFC dışa aktarım kurumsal kapıyı açar ama acil değil; node↔IFC eşlemesi
  zaten iyi olduğu için ertelenebilir

---

## 8. Başarı Ölçütleri

| Özellik | Ölçüt |
|---|---|
| Measurements Box | Çizim işlemlerinin >%40'ı sayısal girişle tamamlanıyor |
| Inference | Snap sonrası "undo" oranında düşüş; ortalama duvar çizim süresi |
| Component | Sahne başına ortalama instance/definition oranı >3; 500+ node'lu sahnede FPS |
| Kesit + Scenes | PDF çıktısı alan oturum oranı |
| Yorum | Paylaşım linki oluşturma / oturum; yorum başına yanıt sayısı |
| Miktar paneli | Panel açık geçen oturum süresi |
| Ajan | MCP araç çağrısı / oturum |

---

## 9. Yapılmaması Gerekenler (kapsam dışı)

- **Genel amaçlı serbest-form modelleme (push/pull, follow-me, boolean).**
  Pascal parametrik bir *bina* editörü. SketchUp'ın mesh modelleme yolunu
  taklit etmek mimari kimliği bozar ve `packages/core`'un saf domain mantığı
  ayrımını çürütür. Bunun yerine **parametrik doğrudan manipülasyon**: duvar
  yüzü sürüklenince `thickness` değişsin, mesh değil.
- **Kendi render motoru / path tracing.** GLB dışa aktarım + harici render
  zinciri yeterli. AI görselleştirme (SketchUp Diffusion tarzı) daha iyi bir
  yatırım.
- **Dosya formatı savaşı (RVT, DWG yazma).** IFC yeterli ve açık.
- **Mobil-öncelikli düzenleme.** `editor-layout-mobile.tsx` ve
  `mobile-tab-bar.tsx` var; görüntüleme/inceleme için yeterli. Mobilde tam
  düzenleme, hassasiyet hedefiyle çelişir.

---

## 10. Kaynaklar

**SketchUp mekanikleri**
- [Introducing Drawing Basics and Concepts — SketchUp Help](https://help.sketchup.com/en/sketchup/introducing-drawing-basics-and-concepts) — inference tipleri, eksen kilidi, Measurements Box formatları
- [Drawing Accurately in SketchUp — MasterSketchUp](https://mastersketchup.com/drawing-accurately-sketchup/)
- [Usage of VCB (Value Control Box)](https://www.sketchup4architect.com/usage-of-value-control-box-within-sketchup.htm)
- [Components — SketchUp Help](https://help.sketchup.com/en/sketchup/components)
- [Definitions and Instances in SketchUp — thomthom.net](https://www.thomthom.net/thoughts/2012/02/definitions-and-instances-in-sketchup/) — bellek modeli
- [Creating and Using Section Planes — SketchUp Help](https://help.sketchup.com/en/sketchup/slicing-model-peer-inside)
- [Hierarchies in the Outliner — SketchUp Help](https://help.sketchup.com/en/sketchup/working-hierarchies-outliner)
- [Organizing a Model (Tags) — SketchUp Help](https://help.sketchup.com/en/sketchup/organizing-model)

**SketchUp 2026 yönü**
- [SketchUp Desktop 2026.0 release notes](https://help.sketchup.com/en/release-notes/sketchup-desktop-20260)
- [Trimble releases SketchUp 2026.0 — CG Channel](https://www.cgchannel.com/2025/10/trimble-releases-sketchup-2026-0/)
- [What's New in SketchUp 2026: Collaboration & Visualization](https://www.sketchupafrica.com/whats-new-in-sketchup-2026/)
- [SketchUp 2026: What's New — FOCUSED SketchUp](https://focusedsketchup.com/blog/sketchup-2026-whats-new-and-what-it-means-for-designers-like-us/)

**Pazar / rakipler**
- [Arcol Launches Browser-Based BIM 2.0 for Conceptual Design](https://www.industrialbriefs.com/arcol-launches-browser-based-bim-2-0-for-conceptual-design/)
- [We Test Arcol, a Modern AEC Design Platform — ENGtechnica](https://engtechnica.com/modern-aec-design-platform-from-feasibility-to-boards/)
- [Best BIM Software for Architects 2026 — Snaptrude](https://www.snaptrude.com/blog/best-bim-software-for-architects-2026)
- [Best BIM Collaboration Tools 2026 — Snaptrude](https://www.snaptrude.com/blog/best-bim-collaboration-tools-2026)
- [Rayon — The All-in-One Design Tool for Precision & Collaboration](https://www.rayon.design/roles/architect)
- [Rayon, 2D vs. 3D, and the Future of BIM — Foundamental](https://www.foundamental.com/perspectives/rayon-2d-vs-3d-the-future-design-software-stack)
- [Best SketchUp Alternatives in 2026 — Snaptrude](https://www.snaptrude.com/blog/best-sketchup-alternatives-in-2025-free-bim-ready-plugin-free-tools-compared)

**AI / trendler**
- [Top 18 AI Tools for Architects in 2026 — Snaptrude](https://www.snaptrude.com/blog/top-18-ai-tools-for-architects-in-2026)
- [Top 20 AI Tools for Architects in 2026 — Chaos](https://blog.chaos.com/ai-tools-for-architects) — %46 günlük AI kullanımı, %44 AI konsept görseli
- [Best Generative Design Software 2026 — AI Building Tools](https://aibuildingtools.com/blog/best-generative-design-tools)
- [Finch — AI for how the world builds](https://www.finch3d.com/)

**İşbirliği teknolojisi**
- [How Figma's multiplayer technology works — Figma Blog](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/)
- [How Figma Built Multiplayer Editing on Simplified CRDTs — Hello Interview](https://www.hellointerview.com/learn/system-design/in-the-wild/figma-multiplayer)
- [Yjs and CRDTs Complete Guide](https://calmops.com/backend/yjs-crdts-realtime-collaboration/)
- [Lesson 20: Collaboration — An infinite canvas tutorial](https://infinitecanvas.cc/guide/lesson-020)

**Miktar / maliyet**
- [Construction Takeoffs: The Complete Guide 2026 — Bluebeam](https://www.bluebeam.com/resources/construction-takeoffs-guide-2026/)
- [Cost Estimating in BIM — ConWize](https://conwize.io/articles/cost-estimating-in-bim-building-information-modeling/)
