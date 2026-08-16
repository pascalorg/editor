# Tapu/Kadastro Parsel İçe Aktarımı ve Çekme Mesafesi (Yapılaşma Alanı)

**Durum:** plan / fizibilite tamamlandı
**Tarih:** 15 Ağustos 2026
**Kapsam:** Ada-parsel bilgisiyle gerçek arsa geometrisinin sahneye alınması, üzerine ön/yan/arka çekme mesafesi tanımlanması, ve çizimin kalan yapılaşma alanına göre yönlendirilmesi.

---

## 1. Özet ve karar

İki ayrı özellik var; ikisi de yapılabilir ama **bağımsız olarak değerlidir** ve ayrı ayrı sevk edilmeli:

| # | Özellik | Fizibilite | Katman |
|---|---|---|---|
| A | TKGM'den ada/parsel ile arsa poligonu çekme | **Doğrulandı** — API canlı, CORS açık, GeoJSON dönüyor | Türkiye'ye özel → ayrı paket + app'te bağlanır |
| B | Çekme mesafesi → yapılaşma alanı → çizim kısıtı | Saf geometri işi, dış bağımlılık yok | Genel (her pazarda geçerli) → `core` + `editor` + `nodes` |

**Kritik mimari karar:** B genel bir yapı özelliğidir (setback her ülkede var), A ise Türkiye'ye özgüdür. `packages/editor` npm'e yayınlanıyor ve `pascalorg/private-editor` tarafından submodule olarak tüketiliyor — dolayısıyla TKGM istemcisi **pakete gömülmez**. Editor paketi soyut bir `ParcelProvider` arayüzü tanımlar, TKGM implementasyonu `apps/editor` tarafından slot olarak enjekte edilir. Böylece B özelliği herkese, A özelliği Türkiye ürününe gider.

---

## 2. Fizibilite: TKGM CBS API (canlı test edildi)

`cbsapi.tkgm.gov.tr` üzerindeki uçlar 15 Ağustos 2026 itibarıyla anahtarsız, kimlik doğrulamasız çalışıyor ve **`Access-Control-Allow-Origin: *`** döndürüyor.

### 2.1 Doğrulanan uçlar

**Ada/parsel ile sorgu** — bizim ana ihtiyacımız:

```
GET https://cbsapi.tkgm.gov.tr/megsiswebapi.v3/api/parsel/{mahalleId}/{ada}/{parsel}
```

**Haritadan nokta ile sorgu** — "haritada tıkla, parseli bul":

```
GET https://cbsapi.tkgm.gov.tr/megsiswebapi.v3/api/parsel/{enlem}/{boylam}
```

Her ikisi de aynı şekli döndürüyor — tek bir GeoJSON `Feature`, WGS84 (lon, lat) sırasıyla:

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[32.85587,39.90166],[32.85587,39.90134], ... ]]
  },
  "properties": {
    "ilAd": "Ankara", "ilId": 28,
    "ilceAd": "Çankaya", "ilceId": 165,
    "mahalleAd": "Remzi Oğuz Arık", "mahalleId": 1162,
    "adaNo": "2705", "parselNo": "15",
    "alan": "1.295,00",
    "nitelik": "Apartman-Beton",
    "zeminKmdurum": "Kat Mülkiyet",
    "pafta": "I29b08d4c",
    "mevkii": "", "durum": "1",
    "ozet": "Remzi Oğuz Arık-2705/15",
    "gittigiParselListe": "", "gittigiParselSebep": ""
  }
}
```

**İdari yapı listeleri** — form için:

```
GET https://parselsorgu.tkgm.gov.tr/app/modules/administrativeQuery/data/ilListe.json
GET https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api/idariYapi/ilceListe/{ilId}
GET https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api/idariYapi/mahalleListe/{ilceId}
```

Hepsi `{ "features": [{ "type":"Feature", "geometry": {...}, "properties": { "id": 28, "text": "Ankara" } }] }` biçiminde `FeatureCollection`.

### 2.2 Bir saat yiyecek tuzaklar (hepsi ölçüldü)

- **`ilId` plaka kodu DEĞİL.** Adana=23, Ankara=28, İzmir=57 — alfabetik sıra + 22 gibi görünüyor ama TKGM'nin iç kimliği olarak ele alın, asla plaka koduyla eşlemeyin. `ilceListe/6` (Ankara plakası) 404 döner.
- **İl listesi 497 KB** ve her ilin sınır poligonunu taşıyor; ihtiyacımız olan sadece `{id, text}`. İlçe/mahalle listeleri de geometri taşıyor. → Proxy'de geometriyi **soyup** cache'leyin, yoksa bir dropdown için yarım megabayt indirilir.
- **`alan` alanının locale'i uçlar arasında tutarsız.** Nokta sorgusu `"1,295.00"`, ada/parsel sorgusu `"1.295,00"` döndürdü — aynı parsel, aynı gün. **Bu alanı parse etmeyin**; alanı poligondan kendimiz hesaplayalım ve TKGM değerini yalnızca ekranda "TKGM kaydı" olarak gösterelim (ayrıca bir tutarlılık kontrolü için karşılaştıralım).
- **Türkçe karakterler de uçlar arasında tutarsız** — `"Remzi Oğuz Arik"` (nokta sorgusu) vs `"Remzi Oğuz Arık"` (ada/parsel sorgusu). Metinleri kimlik olarak değil, yalnızca gösterim için kullanın; eşleştirme `mahalleId` üzerinden.
- **404 gövdesi JSON'dur, HTML değil:** `{"Message":"Parsel Bulunamadı: Enlem = ... "}`. Hata mesajını kullanıcıya olduğu gibi göstermeyin, kendi metnimize çevirelim.
- **Her nokta bir parsele düşmez.** Yol, dere, kamu alanı ve henüz kadastrosu sayısallaşmamış bölgeler 404 döner. Test ettiğim 8 noktadan 3'ü boş geldi. Haritadan tıklama akışı bunu normal bir sonuç olarak ele almalı, hata olarak değil.
- **Rate limit belgelenmemiş.** Anahtar yok demek limit yok demek değil. Proxy + cache zorunlu (aşağıda).
- **Endpoint sürümü kayan hedef** — `v3` ve `v3.1` bir arada yaşıyor, resmî dokümantasyon yok. Özelliği bir feature flag arkasına alın ve uç ölünce panelin kendini kapatıp elle çizime düşmesini sağlayın.

### 2.3 Hukuki / doğruluk çerçevesi

TKGM parsel sorgu verisi **bilgi amaçlıdır, resmî belge yerine geçmez**; geometri kadastro paftalarının sayısallaştırılmasından gelir ve arazideki röperli krokiyle metre altı düzeyde ayrışabilir. Ürün bunu üç yerde göstermeli:

1. İçe aktarım önizlemesinde tek satırlık uyarı.
2. Parsel panelinde kalıcı bir "TKGM referans verisi — aplikasyon krokisi değildir" rozeti.
3. Kullanıcının poligonu **elle düzeltebilmesi** (mevcut `PolygonEditor` bunu zaten yapıyor) ve düzeltince rozetin "kullanıcı tarafından düzenlendi"ye dönmesi.

Bu, profesyonel kullanıcı için bir eksiklik değil güven unsuru — mimar zaten TKGM verisinin taslak olduğunu bilir, bunu söyleyen yazılıma güvenir.

---

## 3. Koordinat dönüşümü: WGS84 → sahne metreleri

API enlem/boylam veriyor; sahne metre tabanlı bir yerel XZ düzlemi. Dönüşüm `packages/core/src/lib/geo-projection.ts` (yeni, saf, bağımlılıksız):

```ts
export type GeoAnchor = { latitude: number; longitude: number }
export function lonLatToLocalMeters(point: LonLat, anchor: GeoAnchor): [number, number]
export function localMetersToLonLat(point: [number, number], anchor: GeoAnchor): LonLat
```

**Yaklaşım: parsel ağırlık merkezine oturtulmuş yerel teğet düzlem (ENU).** Tam bir UTM/ITRF (TM30, EPSG:5254–5259) implementasyonu ve `proj4` bağımlılığı gerekmez: parseller tipik olarak 200 m'nin altında, bu ölçekte ENU ile konformal projeksiyon arasındaki fark milimetrenin altında kalır. Ölçek faktörü hatası ikinci mertebedir ve `(d/R)²` ile büyür.

Kurallar:
- Anchor = parselin ağırlık merkezi. Sahnede zaten bir parsel varsa **anchor sabit kalır** — ikinci bir parseli komşu olarak eklerken ilkinin anchor'ı kullanılır, yoksa iki parsel üst üste biner.
- `+X` = doğu, `-Z` = kuzey (sahnenin plan-yukarı ekseni). `SiteNode.northOffset` içe aktarımda **0'a set edilir** — poligon gerçek kuzeye göre geldiği için model kuzey-yukarı çizilmiş olur, ve güneş analizi bedavaya doğru çalışır.
- `SiteNode.latitude` / `longitude` anchor'dan doldurulur. **Bu, güneş etüdünü hiçbir ek iş yapmadan devreye alır** — bugün kullanıcının elle girdiği alan, parsel çekilir çekilmez doğru dolar.
- Poligon saat yönünün tersine (CCW, pozitif alan) normalize edilir; TKGM sarım yönü garantili değil.
- İlk ve son nokta aynıysa (GeoJSON kapalı halka) sonuncusu atılır — `PropertyLineData.points` açık halka bekliyor.

**Doğrulama:** dönüştürülen poligonun alanı ile TKGM'nin `alan` değeri %1'den fazla ayrışırsa içe aktarımda uyarı göster. Bu, sarım/sıralama/anchor hatalarını tek bir testle yakalayan ucuz bir emniyet kemeri.

---

## 4. Veri modeli

### 4.1 `SiteNode` üzerine iki opsiyonel alan

`packages/core/src/schema/nodes/site.ts`:

```ts
/** Parselin nereden geldiği. Elle çizilmiş bir arsada yok. */
const ParcelRecord = z.object({
  source: z.enum(['tkgm', 'manual']),
  il: z.string(), ilce: z.string(), mahalle: z.string(),
  mahalleId: z.number().int(),
  ada: z.string(), parsel: z.string(),
  /** TKGM'nin kayıtlı yüzölçümü, m². Poligondan hesaplanan alan bununla
   *  ayrışabilir — hangisinin gösterileceği kullanıcının kararı. */
  registeredArea: z.number().positive().optional(),
  nitelik: z.string().optional(),
  pafta: z.string().optional(),
  fetchedAt: z.string(),
  /** Kullanıcı poligonu içe aktarımdan sonra elle düzenlediyse true. */
  edited: z.boolean().default(false),
})

/** Kenar bazlı çekme mesafeleri. Kenar i = points[i] → points[i+1]. */
const SetbackRule = z.object({
  role: z.enum(['road', 'side', 'rear']).default('side'),
  distance: z.number().min(0).default(3),
})

const ZoningLimits = z.object({
  taks: z.number().min(0).max(1).optional(),   // taban alanı kat sayısı
  kaks: z.number().min(0).optional(),          // emsal
  maxHeight: z.number().positive().optional(), // Hmax, m
  maxFloors: z.number().int().positive().optional(),
  order: z.enum(['detached', 'adjacent', 'block']).optional(), // ayrık/bitişik/blok
})
```

`SiteNode`'a eklenenler:

```ts
parcel: ParcelRecord.optional(),
/** Kenar indeksi → kural. Seyrek: yazılmamış kenar `defaultSetback` kullanır. */
setbacks: z.record(z.string(), SetbackRule).default({}),
defaultSetback: z.number().min(0).default(0),
zoning: ZoningLimits.optional(),
```

### 4.2 Türetilmiş yapılaşma alanı **persist edilmez**

Yapılaşma sınırı (`buildableArea`) girdilerden (poligon + setbacks) saf bir fonksiyonla türetilir ve memoize edilir. Sahneye yazılmaz. Gerekçe: poligon bir vertex sürüklemesiyle değişebiliyor; türetilmiş poligonu persist etmek onu bayatlatır ve iki kaynaklı gerçek yaratır.

### 4.3 Kalıcılık sınırları — kontrol edildi

`AGENTS.md`'nin "beş sınır + `GraphSchema`" kuralı burada **rahatlatıcı** çıkıyor: `packages/mcp/src/storage/sqlite-scene-store.ts:95` içinde `nodes: z.record(z.string(), z.unknown())` — düğüm alanları olduğu gibi geçiyor, `savedViews`'ı ısıran strip davranışı düğüm içi alanlara uygulanmıyor. Yine de kontrol listesi:

- [x] `GraphSchema` — düğümler `z.unknown()`, ek alan gerekmiyor
- [ ] `clone-scene-graph.ts` — düğüm kopyalama derin mi, `setbacks` record'u paylaşılan referans olarak sızıyor mu
- [ ] fork / share-link yolu
- [ ] canlı senkron (`scene_events` üzerinden gelen düğüm yaması)
- [ ] `use-auto-save.ts` referans takibi — `setbacks` değişimi kaydı tetikliyor mu

**Migration gerekmiyor:** tüm alanlar opsiyonel veya `default`'lu, eski sahneler `parcel: undefined`, `setbacks: {}` ile yüklenir.

**Dev tuzağı:** `core` şeması `dist`'ten tüketiliyor. Şemayı değiştirdikten sonra `bunx turbo run build --filter=@pascal-app/core` çalıştırmadan `:3002`'de hiçbir şey değişmez.

---

## 5. Geometri: çekme mesafesi → yapılaşma alanı

`packages/core/src/lib/setback-offset.ts` (yeni, saf, test edilebilir):

```ts
export function buildableArea(
  polygon: readonly [number, number][],
  distances: readonly number[],   // kenar başına, polygon.length uzunluğunda
  options?: { miterLimit?: number },
): [number, number][][]           // 0, 1 veya birden fazla halka
```

### 5.1 Algoritma

Türk imar pratiği kenar bazında farklı mesafeler ister (ön 5 m, yan 3 m, arka 3 m) — bu yüzden **tekdüze offset kütüphaneleri (Clipper `ClipperOffset`) doğrudan işe yaramaz**; onlar tek bir `delta` alır.

Uygulanacak yöntem:

1. **Kenar bazlı mitre yürüyüşü.** Her kenarı kendi `d_i` mesafesi kadar içeri kaydır; ardışık kaydırılmış doğruların kesişimi yeni köşeyi verir. Farklı `d` değerlerinde bile doğru mitre köşe çıkar — imar çiziminin beklediği keskin köşe budur (yay değil).
2. **Mitre limiti.** Çok dar açılarda kesişim noktası sonsuza gider; `miterLimit` (varsayılan 4×) aşılırsa köşeyi pahla (bevel) ile kapat.
3. **Kendini kesme temizliği.** Büyük çekme mesafelerinde veya içbükey parsellerde yürüyüş sonucu kendini kesen bir halka üretir. Bu halkanın negatif yönlü (yanlış sarımlı) parçaları atılır, kalan pozitif halkalar döndürülür. L şeklindeki parseller bu adım olmadan yanlış çıkar.
4. **Boş sonuç geçerli bir sonuçtur.** Küçük parsel + büyük çekme = yapılaşma alanı yok. UI bunu hata değil, kırmızı bir okuma olarak göstermeli ("Çekme mesafeleri sonrası yapılaşma alanı kalmıyor").

**Bağımlılık kararı:** önce saf TS ile yaz (adım 1–3 yaklaşık 150 satır). Testler içbükey/dar açı vakalarında yetersiz kalırsa `polyclip-ts` (MIT, saf JS, WASM yok, TypeScript) ekle — `core`'un "Three.js yok, DOM yok" kuralına uyar. `clipper-lib`/`js-angusj-clipper` (WASM) gereksiz ağır.

### 5.2 Testler (`setback-offset.test.ts`)

- kare parsel, tekdüze 3 m → alan `(a-6)²`
- dikdörtgen, ön 5 / yan 3 / arka 3 → beklenen dört köşe, analitik
- içbükey (L şekli), tekdüze offset → tek halka, doğru köşe sayısı
- dar açılı üçgen köşe → mitre limiti pahlaya düşüyor
- aşırı offset → boş dizi
- offset bir halkayı ikiye bölüyor (kum saati parsel) → iki halka
- saat yönü verilen poligon → CCW normalize ediliyor, sonuç aynı

### 5.3 Kenar rollerinin varsayılanları

Planlı Alanlar İmar Yönetmeliği ve yerel imar planları farklı sayılar dayatır. Uygulama bunları **düzenlenebilir ön ayar** olarak sunar, asla otorite olarak değil:

- Ön bahçe (yola cepheli kenar): varsayılan 5 m
- Yan bahçe: varsayılan 3 m
- Arka bahçe: varsayılan 3 m

Panelde tek satırlık uyarı: *"Ön ayarlar yaygın değerlerdir; bağlayıcı mesafeler belediyenizin imar durumu belgesindedir."* Kat sayısına göre otomatik artırma (yan bahçede kat başına +0,50 m gibi) **v1'de yapılmaz** — yerel plan bunu ezebilir ve yanlış otomatik hesap, elle girilen yanlış sayıdan daha tehlikelidir.

### 5.4 Yol cephesi tespiti

v1: kullanıcı kenara tıklar, rolünü seçer. Poligon çizilirken her kenar tıklanabilir bir hedef olarak SVG'de ve 3B'de zaten var.

v2 (opsiyonel): OSM yol geometrisiyle kesişim testi ile "bu kenar yola bakıyor olabilir" önerisi. Öneri olarak sunulur, otomatik uygulanmaz.

---

## 6. Paket yerleşimi (katman sınırları)

| Ne | Nerede | Gerekçe |
|---|---|---|
| TKGM istemcisi, GeoJSON → poligon | **`packages/cadastre`** (yeni) | `cad-import` emsali: saf mantık, DOM yok, React yok. Türkiye'ye özel olduğu için ayrı, opsiyonel paket |
| Geo projeksiyon, offset matematiği, şema | `packages/core` | Saf alan mantığı; Three.js/UI bilmiyor |
| Proxy + cache + liste sadeleştirme | `apps/editor/app/api/cadastre/*` | Upstream'i gizler, geometriyi soyar, rate limit'i emer |
| `ParcelProvider` arayüzü, parsel paneli, kenar editörü, uyum okuması | `packages/editor` | Düzenleme deneyimi; embedder'lar da alsın. **Arayüz genel, TKGM implementasyonu değil** |
| TKGM provider'ının bağlanması | `apps/editor` | Ürüne özel entegrasyon; npm paketi Türkiye'ye özel uç taşımaz |
| 3B parsel + çekme overlay'i | `packages/nodes/src/site/renderer.tsx` | Kalıcı düğüm verisinden türeyen geometri |
| 2B floorplan katmanı | `packages/editor/src/components/editor-2d/` | **2B↔3B parite kuralı — aynı PR'da** |
| Parsel/imar paneli | `packages/nodes/src/site/parcel-panel.tsx`, `siteParametrics.trailingSection` ile | `zone/quantities-panel.tsx` ile birebir aynı desen |
| MCP araçları | `packages/mcp/src/tools/` | Ajanın "şu ada parseli getir" diyebilmesi |

**`ParcelProvider` arayüzü** (`packages/editor`):

```ts
export type ParcelQuery =
  | { kind: 'administrative'; mahalleId: number; ada: string; parsel: string }
  | { kind: 'point'; latitude: number; longitude: number }

export type ParcelResult = {
  ring: LonLat[]
  label: string           // "Ankara / Çankaya / 2705 ada 15 parsel"
  registeredArea?: number
  attributes: Record<string, string>
}

export type ParcelProvider = {
  id: string
  search(query: ParcelQuery, signal: AbortSignal): Promise<ParcelResult | null>
  regions?: RegionSource   // il/ilçe/mahalle dropdown'ları
}
```

Editor paketi `parcelProvider` prop'u almazsa parsel paneli hiç mount olmaz. Embedder kendi kadastro kaynağını (başka ülke) aynı arayüzle takabilir.

**Proxy uçları** (`apps/editor`):

```
GET /api/cadastre/regions/il
GET /api/cadastre/regions/ilce?ilId=28
GET /api/cadastre/regions/mahalle?ilceId=165
GET /api/cadastre/parcel?mahalleId=1162&ada=2705&parsel=15
GET /api/cadastre/parcel?lat=39.9012&lon=32.8560
```

- Bölge listeleri: geometri soyulur, `{id, text}` döner, `revalidate: 86400` ile cache (idari yapı günde bir değişmez).
- Parsel: `revalidate: 3600`, ada/parsel anahtarıyla.
- 404 normalize edilir: `{ found: false }`, HTTP 200. Kullanıcıya "bulunamadı" bir hata değil bir cevaptır.
- Upstream zaten `Access-Control-Allow-Origin: *` veriyor, yani tarayıcıdan doğrudan çağrı da mümkün — proxy erişim için değil, **cache, sadeleştirme ve upstream değişimine karşı tek bir kırılma noktası** için var. Proxy düşerse doğrudan çağrıya düşme (fallback) opsiyonu bırakılabilir.

---

## 7. Kullanıcı akışı

### 7.1 Parseli getirme

Site fazında (`phase === 'site'`) sağ panelde **Arsa** bölümü. İki giriş:

1. **Ada/parsel formu** — il → ilçe → mahalle bağlı dropdown'ları, ada ve parsel metin alanları, "Getir".
2. **Haritadan seç** — mevcut `LocationMap` (`sun-study/location-map.tsx`) yeniden kullanılır. Zaten OSM raster tile + Nominatim arama + `slippy-map.ts` aritmetiği var; eklenecek olan sadece (a) tıklanan noktayı nokta-sorgusuna göndermek ve (b) dönen poligonu tile'ların üstüne SVG olarak çizmek. **Yeni harita kütüphanesi gerekmiyor.**

Sonuç bir **önizleme** olarak gösterilir: poligon, hesaplanan alan, TKGM kayıtlı alan, nitelik, pafta. Kullanıcı "Araziyi uygula" derse:

- Site poligonu değiştirilir (üzerine yazma uyarısıyla — mevcut poligon 30×30 varsayılan değilse "mevcut arsa sınırı değiştirilecek" onayı)
- `parcel` kaydı yazılır
- `latitude`/`longitude` anchor'dan, `northOffset = 0` yazılır
- Kamera parsele çerçevelenir (`camera-controls:zoom-extents` — **2B ve 3B'de ayrı ayrı ele alınmalı**, floorplan kendi zoom'unu yapıyor)

Tümü tek bir `runAsSingleSceneHistoryStep` içinde — kullanıcı bir Ctrl+Z ile içe aktarımı geri alır, altı ayrı adımla değil.

### 7.2 Çekme mesafesi tanımlama

Aynı panelde **Çekme Mesafeleri** bölümü:

- Her kenar için bir satır: kenar uzunluğu, rol seçici (Yol / Komşu / Arka), mesafe girişi
- Satıra hover → o kenar hem 2B hem 3B görünümde vurgulanır
- 2B/3B'de kenara tıklamak da satırı seçer (çift yönlü)
- "Tümüne uygula" hızlı eylemi ve rol ön ayarları (5/3/3)
- Altında canlı okuma: **Yapılaşma alanı: 412 m²** (parsel alanının %38'i)

### 7.3 İmar okuması (TAKS / KAKS)

`zoning` doldurulduğunda panel şunu gösterir:

```
Parsel alanı            1.295 m²
Çekme sonrası alan        412 m²
İzin verilen taban (TAKS 0,40)   518 m²  → sınırlayıcı: çekme mesafesi (412 m²)
İzin verilen toplam (KAKS 2,00)  2.590 m²
Mevcut çizim tabanı        286 m²   ✓
Mevcut çizim toplamı     1.144 m²   ✓
```

"Sınırlayıcı" satırı önemli: kullanıcıya gerçek kısıtın hangisi olduğunu söyler. Mevcut çizim değerleri sahnedeki bina taban alanlarından hesaplanır — `zone/quantities.ts` benzeri bir toplayıcı.

Bu bölüm **hesaplama yardımcısıdır, ruhsat hesabı değildir**; panel altında bunu söyleyen bir satır olmalı.

---

## 8. Çizimin yapılaşma alanına göre kısıtlanması

Kullanıcının asıl istediği bu. Üç seviye var; **varsayılan yumuşak, kilit opsiyonel** öneriyorum.

### Seviye 1 — Görsel (v1, zorunlu)

- 2B: yapılaşma sınırı kesikli çizgi, dışarıda kalan şerit taralı/soluk dolgu
- 3B: zeminde şeffaf bir bant + sınır çizgisi
- Her ikisi de `SiteNode`'dan türetilir, ek durum yok

### Seviye 2 — Snap + uyarı (v1, önerilen varsayılan)

- Yapılaşma sınırının kenarları **snap hedefi** olarak yayınlanır; duvar/döşeme çizerken imleç sınıra yapışır. `packages/core/src/services/snap.ts` içindeki `snapPointToAngle` / `snapPointAlongAngleRay` ile aynı ailede yeni bir `snapPointToPolygonEdges` eklenir.
- Sınırı aşan düğümler için ihlal rozeti: uyum panelinde "3 duvar yapılaşma sınırını aşıyor" + tıklayınca seçim.
- İhlal tespiti `pointInPolygon` (core'da zaten var) + kenar kesişim testiyle; duvar ayak izi için `wall-footprint` yeniden kullanılır.

### Seviye 3 — Sert kilit (opsiyonel toggle, v2)

"Yapılaşma sınırına kilitle" açıkken çizim noktaları poligona **clamp** edilir. Riskli: kullanıcı neden hareket edemediğini anlamazsa bug sanır. Bu yüzden:
- Varsayılan kapalı
- Clamp anında imleç rozetinde "sınıra kilitli" ibaresi
- Shift ile geçici bypass

### Entegrasyon tuzakları (AGENTS.md'den, bu iş için doğrudan geçerli)

- **Çizim araçları `InteractionScope` açmıyor.** `wall`, `slab`, `fence`, `zone`, `roof` araçları `begin` çağırmıyor — `isActive(scope)` duvar çizilirken **false**. Overlay'i buna dayandırmak, tam da hedeflediğimiz araçlarda özelliği sessizce kapatır. Doğru sinyal `useFloorplanDraftPreview` (`wallDraftStart`, `polygonDraftPoints`) ve bunu her iki görünüm de yazıyor.
- **2B↔3B parite.** Yerleştirme/çizim davranışı her iki görünümde de olmalı, kardeş dosyaya port aynı PR'da. Yapılaşma overlay'i tek görünümde çıkarsa yarım sevk edilmiş sayılır.
- **3B canvas hiç mount olmamış olabilir.** Sadece 2B'de açılan bir oturumda `sceneRegistry` boş ve kamera yok. Çerçeveleme/zoom gibi her şeyin kendi 2B cevabı olmalı.
- **Araç keydown dinleyicileri global olanı yener.** Kısayol eklenecekse `window` üzerinde capture + `stopImmediatePropagation`; ayrıca çıplak Shift zaten snap modunu döndürüyor, Shift-bypass tasarımı buna çarpmamalı.
- **`DimensionPill` çizim sırasında ekranda değil.** Yapılaşma alanı canlı okuması çizim sırasında görünecekse `QuickMeasurementHud`'un yanına, editör geneli bir HUD olarak mount edilmeli.

---

## 9. MCP araçları

Ajanın "Konya Selçuklu 1234 ada 5 parsel arazisini getir, 5 metre çekme mesafesiyle yapılaşma alanını çıkar" diyebilmesi için:

| Araç | İş |
|---|---|
| `search_parcel` | il/ilçe/mahalle/ada/parsel veya lat/lon → parsel özeti + poligon (sahneye yazmaz) |
| `apply_parcel_to_site` | Bulunan parseli site poligonuna uygular, lat/lon/north yazar |
| `set_setbacks` | Kenar rolleri ve mesafeleri |
| `get_buildable_area` | Yapılaşma poligonu + alan + sınırlayıcı kısıt |

Notlar:
- `SceneOperations` (`packages/mcp/src/operations/scene-operations.ts`) site düğümünün `polygon`/`setbacks`/`zoning` alanlarına erişim vermeli; düğüm erişimcileri düğüm-dışı alanları sessizce atlıyor — burada hepsi düğüm içi olduğu için risk düşük ama erişim yolu yine de eklenmeli.
- Ağ çağrısı MCP sürecinden çıkacak: `packages/mcp/src/lib/safe-fetch.ts` kullanılmalı.
- **Düğüm kayıt defteri MCP sürecinde boş** — bu araçlar kayıt defterinden hiçbir şey okumamalı. Offset matematiği `core`'da olduğu için sorun yok; bu, matematiği `nodes/site/` altına koymamak için ek bir gerekçe.
- Kayıt ve taşıma katmanı in-process testlerle kanıtlanmıyor: `check-collisions.test.ts` desenini kopyala, sonra `dist/bin/pascal-mcp.js`'e karşı gerçek bir duman testi (önce build).

---

## 10. Yerelleştirme

Varsayılan locale **`tr`**. Kopya İngilizce yazılır, `packages/editor/src/lib/i18n-core.ts` içindeki `tr` sözlüğüne **birebir İngilizce kaynak metin anahtarıyla** eklenir. Bu özellikte kopya yoğun (panel etiketleri, roller, uyarılar, imar terimleri) — sözlük girişleri işin bir parçası, sonraya bırakılan bir iş değil.

Dikkat: çalışma zamanında birleştirilen metinler (template literal) hiçbir zaman sözlükle eşleşmez. `"Çekme mesafeleri sonrası yapılaşma alanı kalmıyor"` gibi cümleler literal yazılmalı, sayı ayrı bir düğüm olmalı.

---

## 11. Aşamalar

**Aşama 1 — Geometri çekirdeği (dış bağımlılık yok)**
`geo-projection.ts`, `setback-offset.ts`, `SiteNode` şeması + testler. Tek başına sevk edilebilir; elle çizilen arsada bile çekme mesafesi çalışır.

**Aşama 2 — Çekme mesafesi UI + overlay**
Parsel/çekme paneli (`trailingSection`), 2B ve 3B overlay, alan okuması. Aşama 1'i kullanıcıya görünür kılar.

**Aşama 3 — TKGM entegrasyonu**
`packages/cadastre`, proxy uçları, `ParcelProvider`, ada/parsel formu, haritadan seçme, önizleme + uygula.

**Aşama 4 — Kısıt ve uyum**
Sınıra snap, ihlal rozetleri, TAKS/KAKS okuması, opsiyonel sert kilit.

**Aşama 5 — MCP araçları**

Aşama 1–2 birlikte anlamlı bir sevkiyat; Aşama 3 tek başına en yüksek pazar etkisine sahip olan ama 1–2 olmadan yarım kalan parça.

---

## 12. Doğrulama planı

Test paketi bu işin yarısını göremiyor — offset matematiği ve projeksiyon `bun test` ile kanıtlanır, ama panelin mount olup olmadığını, overlay'in her iki görünümde çıkıp çıkmadığını, snap'in çizim sırasında gerçekten çalışıp çalışmadığını göremez.

- `cd packages/core && bun test src/lib/setback-offset.test.ts` — geometri
- `bunx turbo run build --filter=@pascal-app/core` — şema değişince zorunlu, yoksa `:3002` eski kodu görür
- `bun restart` → `:3002` → gerçek bir parsel getir, çekme gir, **hem 2B hem 3B'de** duvar çiz
- Açık/koyu temanın ikisinde de overlay kontrastı (koyu-first yazılmış chrome'da açık temada kaybolan `bg-white/10` tuzağı)
- Kaydet → yeniden yükle → `parcel` ve `setbacks` geri geliyor mu (altı kalıcılık sınırı)
- Bir MCP duman testi `dist/bin/pascal-mcp.js`'e karşı

---

## 13. Açık sorular

1. **TKGM uçlarının kullanım şartları.** Anahtarsız ve CORS açık olması kullanım hakkı vermiyor. Ticari bir üründe kullanmadan önce TKGM'den yazılı teyit veya resmî bir servis anlaşması (MEGSİS kurumsal erişim) araştırılmalı. Teknik engel yok, hukuki teyit gerekiyor — **bu, sevkiyat öncesi kapatılması gereken tek gerçek blokaj.**
2. **İmar durumu verisi nereden?** TKGM sadece kadastro geometrisi veriyor; TAKS/KAKS/çekme mesafeleri belediyelerde. Bazı belediyelerin e-imar/KEOS portalları var ama standart yok. v1'de elle giriş; ileride belediye bazlı entegrasyon araştırılabilir.
3. **Çok parselli projeler.** Tevhit (birleştirme) senaryosunda birden fazla parsel tek arsa olur. Şema tek poligon taşıyor. v1 kapsam dışı; birden fazla parsel çekilip birleştirilmesi gerekirse `PropertyLineData` çok halkalı hale gelmeli — bu şemayı ve terrain drape'i etkiler, ayrı bir tasarım işi.
4. **Yola terk.** Yol genişletmesi nedeniyle terk edilecek kısım kadastro parselinden düşer; yapılaşma hesabı terk sonrası alan üzerinden yapılır. v1'de kullanıcı poligonu elle düzeltir; "terk alanı" ayrı bir kavram olarak modellenmeli mi, kullanıcı geri bildirimiyle karar verilecek.
