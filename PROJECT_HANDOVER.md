# DigitalTwin — Proje Devir ve Mimari Dokümanı
### (Project Handover & Architecture)

> **Amaç:** Bu doküman, projeyi devralacak yeni AI kodlama asistanının (ör. Google
> Antigravity) sistemi eksiksiz kavraması, dört depo arasındaki ilişkiyi anlaması
> ve geliştirmeyi kesintisiz sürdürebilmesi için hazırlanmıştır.
>
> **Ürün:** DigitalTwin — depo/lojistik tesisleri için 3B dijital ikiz (warehouse
> digital-twin) tasarım ve yönetim platformu. Canlı adres: **https://opex.help**
>
> **Kapsanan depolar:** `ovurrsl/editor`, `ovurrsl/panel`,
> `ovurrsl/plugin-warehouse`, `ovurrsl/Digitaltwin`
>
> **Sürüm:** v2 · **Doküman tarihi:** 2026-08-19
>
> **Dil notu:** Kod tabanındaki yorumların ve commit mesajlarının büyük kısmı
> **Türkçe**'dir; geçmişi okurken bunu bilin.
>
> **v2'de eklenenler:** §1.4 depolar arası otomatik haberleşme + dal kuralları
> (cron'lar, secret'lar, kaynak→hedef dallar, güvenlik kapısı) · §3.1.1 MCP
> sunucusu ve 30+ aracı · §3.1.2 `apps/ifc-converter` · §5.2 bilinen hataların
> dosya:satır kanıtlı, önceliklendirilmiş tam dökümü (üç kod incelemesinden) ·
> Ek A mimari wiki sayfaları + skills · panelin kendi CI'ı olmadığı notu.

---

## 1. Projenin Büyük Resmi ve Amacı (Project Overview)

### 1.1 Ürün ne yapar?

DigitalTwin, bir depo/fabrika tesisinin (bina → kat → duvar/döşeme/çatı/bölge →
mobilya ve **depo ekipmanları**) 3 boyutlu, düzenlenebilir bir dijital ikizini
tarayıcıda oluşturmayı sağlar. Kullanıcı:

- Tesisin katlarını, duvarlarını, döşemelerini ve bölgelerini çizer,
- Palet rafları, konveyörler, asma katlar, forkliftler, dock levellerleri gibi
  **gerçek depo ekipmanlarını** bir katalogdan yerleştirir,
- Kapasite / alan istatistiklerini okur,
- Sahneleri kaydeder, sürümler, yedekler, başkalarıyla paylaşır ve
  (tek-aktif-editör kirası ile) birlikte üzerinde çalışır.

Ürünün önü bir **kimlik doğrulama + yönetim konsolu**dur (kullanıcılar, roller,
tesisler, 2FA); arkasında 3B editör yer alır. Sahneler konsol hesaplarına aittir.

### 1.2 Neden dört depo? (kuş bakışı mimari)

Sistem, açık kaynak bir editörün **fork**'u üzerine kurulu olduğu için sorumluluk
dört depoya bölünmüştür. Kritik nokta: **çalışan ürün tek bir Next.js işlemidir**
(editör + konsol + API + scene store hepsi aynı süreçte); dört depo bu tek
süreci besleyen *kaynak ve otomasyon* katmanlarıdır.

```
                       ┌──────────────────────────────┐
   pascalorg/editor    │  UPSTREAM (açık kaynak)       │
   (genel 3B editör)   │  günlük mirror → PR açar      │
                       └───────────────┬──────────────┘
                                       │ mirror-upstream (günlük, PR)
                                       ▼
   ovurrsl/plugin-warehouse ───►  ovurrsl/editor  ◄─── ovurrsl/panel
   (warehouse:* eklentisi)   pin  (FORK · monorepo)  vendor  (DigitalTwin Console)
       bump-plugin (saatlik)  │   default branch:      │   pull-panel (saatlik)
                              │   integration          │   → apps/editor/panel/**
                              │                        │
                              ▼   deploy-bundle (build) ▼
                       ┌──────────────────────────────┐
                       │   ovurrsl/Digitaltwin         │
                       │   derlenmiş standalone Next    │
                       │   → Hostinger → opex.help      │
                       └──────────────────────────────┘
```

| Depo | Rol | Nasıl beslenir / besler |
|---|---|---|
| **`ovurrsl/editor`** | Ana monorepo. Editör + viewer + core + mcp (scene store) + Next.js uygulaması. **Tüm geliştirmenin merkezi.** Default branch: `integration`. | Upstream buraya mirror'lanır; panel & plugin buraya akar; buradan Digitaltwin derlenir. |
| **`ovurrsl/panel`** | DigitalTwin Console — bağımsız Next.js: giriş, 2FA, kullanıcı/rol/tesis yönetimi, denetim. | Saatlik `pull-panel` ile editöre `apps/editor/panel/**` olarak **vendor** edilir. |
| **`ovurrsl/plugin-warehouse`** | Depo ekipmanı eklentisi (`warehouse:*` node kind'leri), plugin API v1. | Editörün `apps/editor/package.json`'ında SHA ile pinlenir; saatlik `bump-plugin` ile güncellenir. |
| **`ovurrsl/Digitaltwin`** | **Üretim artefaktı** — editörün derlenmiş `standalone` Next çıktısı git'e commit'li. Kaynak değil, deploy paketidir. | `deploy-bundle` workflow'u editörden derleyip buraya force-push eder; Hostinger buradan çalıştırır. |

> **En kritik ilişki:** `editor` = beyin, `panel` = ön kapı (editöre vendor
> edilir), `plugin-warehouse` = katalog/ekipman (editöre pinlenir), `Digitaltwin`
> = editörün paketlenmiş halinin canlıda koştuğu yer. Panel ve plugin **editörün
> içinde birleşir**; ayrı servis değildir.

### 1.3 Beş depo topolojisi (kuş bakışı)

Ayrıntılı, düz-dille anlatım: **`editor/OTOMASYON.md`** (tek doğruluk kaynağı;
her workflow dosyasından okunup ikinci turda doğrulanarak yazılmış). Aşağıda o
belgenin özü + dokümanın 1.4'ünde tam otomasyon tablosu var.

```
   pascalorg/editor            Pascal'ın orijinali (bizim değil)
            │  ① her gün 05:00 UTC (08:00 TR) — otomatik
            ▼
   ovurrsl/editor → main       Pascal'ın SAF aynası. Tek commitimiz bile yok.
            │  ② merge PR açılır — BİRLEŞTİRME KARARI İNSANDA (tek elle iş)
            ▼
   ovurrsl/editor → integration  ◄── ovurrsl/panel            (③ saat başı :17)
   VARSAYILAN dal; her şey burada ◄── ovurrsl/plugin-warehouse (④ saat başı :42)
            │  ⑤ derle → 2 duman testi → geçerse — otomatik
            ▼
   ovurrsl/Digitaltwin         Sadece derlenmiş çıktı; kaynak kod girmez.
            │
            ▼   Hostinger → opex.help
```

**② dışındaki her ok otomatiktir.** ② bilinçli olarak insandadır (upstream aynı
dosyalara dokunduğunda çakışma çıkar; makine bu kararı veremez — kurallar
`UPSTREAM.md`'de).

---

### 1.4 Depolar arası otomatik haberleşme ve dal kullanımı

> Bu bölüm sorunun tam yanıtıdır: 4 (aslında 5) depo birbiriyle **GitHub Actions
> workflow'ları** üzerinden konuşur; hangi iş ne zaman, hangi **secret** ile,
> hangi **kaynak → hedef dal**da çalışır ve manuel geliştirmede hangi dal
> kurallarını izleriz.

#### 1.4.1 Neden iki kalıcı dal var (`main` vs `integration`)

| Dal | İşlevi | Kural |
|---|---|---|
| **`main`** | `pascalorg/editor`'ın **bire bir aynası**. Bizim hiçbir değişikliğimiz yazılmaz. | **Asla commit'leme.** Ayna sadece ileri sarabildiği için hiç çakışmaz; buraya atılan bir commit `mirror-upstream`'i kilitler (silinmez, elle çözülene kadar aynayı jamlar). |
| **`integration`** | **Varsayılan dal.** Bizim eklediğimiz ~130+ commit burada; canlıya giden derleme bundan yapılır. | Tüm geliştirme buraya akar. |

> **Kritik:** GitHub zamanlanmış işleri **yalnız varsayılan daldan** çalışır.
> `integration` varsayılan olmasaydı saat başı işlerin hepsi **sessizce dururdu**.
> Dal adı değişecekse depo değişkeni `INTEGRATION_BRANCH` kurulur; tüm workflow'lar
> önce onu okur, yoksa `integration`'a düşer.

#### 1.4.2 Otomatik workflow'lar (hepsi `ovurrsl/editor/.github/workflows/`)

Saatler **UTC** (TR = UTC+3).

| Workflow | Ne zaman | Kaynak → Hedef | Ne yapar | Secret |
|---|---|---|---|---|
| **`bump-plugin`** | Her saat **`:42`** | `plugin-warehouse@main` → `editor@integration` | Eklentinin `main`'i ile editördeki pin'i karşılaştırır; farklıysa günceller, `bun.lock` tazeler, **`check-types`**'tan geçirir, `integration`'a yazar ve `deploy-bundle`'ı tetikler. | Yok (plugin herkese açık) |
| **`pull-panel`** | Her saat **`:17`** | `panel@main` → `editor@integration` (`apps/editor/panel/**`) | Paneli çeker, vendor eder, **`check-types`**'tan geçirir, `integration`'a yazar ve derlemeyi tetikler. | **`PANEL_TOKEN`** |
| **`mirror-upstream`** | Her gün **`05:00`** (08:00 TR) | `pascalorg/editor` → `editor@main`, sonra `integration`'a **PR** | `main`'i upstream'e ileri sarar; `integration` geride kaldıysa **merge PR açar** (otomatik merge etmez). | **`MIRROR_TOKEN`** |
| **`deploy-bundle`** | `integration`'a **her yazımda** | `editor@integration` → `Digitaltwin` (force-push) | Derler → **2 duman testi** → geçerse `Digitaltwin`'e yazar (Hostinger deploy). Güvenlik kapısı (§1.4.5). | **`DEPLOY_TOKEN`** |
| **`upstream-check`** | Pazartesi **`06:00`** (09:00 TR) | — (rapor) | Deneme birleştirmesi yapar, hangi dosyaların çakışacağını raporlar. **Hiçbir yere yazmaz.** | Yok |
| **`ci`** | `integration`'a her yazım + her PR | — | Biome + tip kontrolü. | Yok |
| **`mcp-ci`** | Belirli dosyalar değişince | — | MCP + sahne API testleri. | Yok |

#### 1.4.3 Elle (manuel) çalıştırılan workflow'lar

| Workflow | Ne zaman kullanılır |
|---|---|
| **`sync-panel`** | Editördeki panel dosyalarını `ovurrsl/panel`'e **geri** göndermek (`sync/from-editor` PR'ı). Yalnız panel deposunu ilk tohumlama/istisnai düzeltme için; günlük yön tersidir (`pull-panel` otomatik). |
| **`relock`** | Bir bağımlılık elle değişince `bun.lock`'u gerçek sunucuda yeniden üretmek. |
| **`release`** | Pascal'ın npm paket yayınlama akışı — bizim rutin işimiz değil. |

#### 1.4.4 Secret'lar (`ovurrsl/editor` → Settings → Secrets and variables → Actions)

| Secret | Kim kullanır | Ne için | Süresi dolarsa |
|---|---|---|---|
| **`PANEL_TOKEN`** | `pull-panel`, `sync-panel` | `ovurrsl/panel`'i okumak | Panel güncellemeleri durur; `pull-panel` **kırmızı olmaz**, sessizce hiçbir şey yapmaz (ilk adımda "PANEL_TOKEN is not set" yazar). |
| **`DEPLOY_TOKEN`** | `deploy-bundle` | `Digitaltwin`'e yazmak | Derleme geçer, **son adım (Publish) kırmızı**, canlı eski sürümde kalır. |
| **`MIRROR_TOKEN`** | `mirror-upstream` | `main`'i ileri sarmak + entegrasyon PR'ı açmak | Ayna durur, **kırmızı olur**; upstream birikir ama canlıya etkisi yok, fark edilmesi günler alabilir. |

> **`MIRROR_TOKEN` neden fine-grained PAT olmak zorunda:** Ayna, upstream'in
> `.github/workflows/*.yml` dosyalarını da `main`'e iter. GitHub, yerleşik
> `GITHUB_TOKEN`'ın workflow dosyası yazmasını **reddeder** ("refusing to allow a
> GitHub App to create or update workflow … without `workflows` permission"). Bu
> izin `permissions:` bloğunda **yok**; yalnız PAT'ta var. Gereken üç izin:
> **Contents (yazma)**, **Workflows (yazma)**, **Pull requests (yazma)**; kapsam
> tek depo `ovurrsl/editor`. `bump-plugin` ve `upstream-check` **hiçbir secret
> kullanmaz** (kaynak depolar herkese açık).

> ⚠️ **Görünmez tuzak:** `GITHUB_TOKEN` ile yapılan push **hiçbir workflow
> tetiklemez**. Push edip build bekleyen her workflow, bir sonrakini açıkça
> (`workflow_dispatch`) tetiklemek zorundadır — `bump-plugin`/`pull-panel`'in
> `integration`'a yazdıktan sonra `deploy-bundle`'ı ayrıca çağırmasının sebebi budur.

#### 1.4.5 Güvenlik kapısı — her otomatik yol buradan geçer (`deploy-bundle`)

1. `bun run build` — derleme.
2. **Duman testi 1:** veritabanı yokken sunucu açılmayı reddediyor mu?
3. **Duman testi 2:** gerçek MySQL'e karşı `/api/health` yanıt veriyor mu?
4. Üçü de geçerse → `Digitaltwin`'e yazılır; biri geçmezse **yayın durur, canlıdaki
   çalışan sürüm yerinde kalır.**

Ayrıca `bump-plugin` ve `pull-panel` kendi içlerinde `bun run check-types` koşar —
derlenmeyen bir değişiklik `integration`'a **yazılmaz bile**.

#### 1.4.6 Manuel geliştirme dal kuralları (bizim iş akışımız)

Bu depolarda yaptığımız günlük geliştirme deseni:

- **Nerede geliştirilir:** Editör değişikliği → `ovurrsl/editor`; konsol → `ovurrsl/panel`;
  raf/ekipman → `ovurrsl/plugin-warehouse`. `Digitaltwin`'e ve `apps/editor/panel/**`'e
  **elle dokunulmaz** (üzerine yazılır).
- **Özellik dalı → PR → `integration`:** Değişiklikler bir özellik dalında yapılır
  (bu oturumdaki ad: `claude/…`), taslak PR açılır, `ci` yeşilinde `integration`'a
  **squash-merge** edilir → `deploy-bundle` tetiklenir → canlı.
- **Merge sonrası dal tazeleme:** PR merge edilince özellik dalı
  `origin/integration`'dan yeniden kurulur (eski commit'ler squash'landığı için
  `git checkout -B <dal> origin/integration`, gerekirse `--force-with-lease` push).
- **Merged PR'a yeni commit yığma yok:** Merge edilmiş bir PR bitmiştir; yeni iş
  taze dal + yeni PR olur.
- **Commit dili/biçimi:** Conventional Commits (`feat/fix/perf/refactor/docs/test/
  chore`); konu changelog'a girer, gövde (genelde Türkçe) gerekçedir.
- **CI'nin bilinen sallantısı:** `bun install --frozen-lockfile` git-bağımlılıklarını
  (plugin-warehouse, plugin-trees) GitHub tarball'larından çeker; ara sıra 504/429
  verir — kod hatası değildir, rate-limit sonrası `rerun_failed_jobs`.

#### 1.4.7 Bir şey ters giderse — nereye bakılır

| Belirti | Muhtemel sebep | Bakılacak yer |
|---|---|---|
| Canlı güncellenmiyor, derleme yeşil | `DEPLOY_TOKEN` süresi dolmuş | `deploy-bundle` → son adım `Publish` |
| Eklenti değişikliği gelmiyor | `bump-plugin` pini bulamıyor | O çalışmanın `Compare the pin` adımı |
| Panel değişikliği gelmiyor | `PANEL_TOKEN` yok/dolmuş | `pull-panel` ilk adımı |
| Hiçbir zamanlanmış iş çalışmıyor | Varsayılan dal değişmiş | Settings → Branches → default `integration` mı? |
| Pascal güncellemesi görünmüyor | Merge PR açılmamış | Actions → `Mirror upstream` → elle çalıştır |

Tüm çalışmalar: **https://github.com/ovurrsl/editor/actions**

---

## 2. Teknoloji Yığını (Tech Stack)

### 2.1 Ortak çekirdek

| Katman | Teknoloji | Not |
|---|---|---|
| Dil | **TypeScript** | editor/plugin: `6.0.3`; panel & apps/editor: **`7.0.2`** (native `tsc`/`tsgo`) |
| UI | **React 19** (`^19.2.x`) | Server + Client Components |
| Framework | **Next.js 16** (App Router) | `editor`: `16.3.0` (pinli), `panel`: `^16.2.12`, `Digitaltwin`: `16.2.9` |
| 3B | **three.js `0.185.x`** + **@react-three/fiber `^9`** + **@react-three/drei `^10`** | WebGPU renderer |
| State | **Zustand `^5`** (+ **zundo `^2.3`** undo/redo) | üç mağaza, katman başına bir tane |
| Şema/doğrulama | **Zod `^4`** | node şemaları + API kontratları |
| Veritabanı | **MySQL 8 / MariaDB 10.11** (`mysql2 ^3.x`) | üretimde tek backend; dev'de SQLite (bun yerleşik) |
| Lint/format | **Biome `^2.4`** (+ `ultracite` editörde) | ESLint/Prettier yok |
| Auth/kripto | `@node-rs/argon2` (argon2id), `otpauth` (TOTP), `qrcode`, `ulid`, `nodemailer` | |

### 2.2 Paket yöneticileri (önemli fark!)

- **`ovurrsl/editor`** ve **`ovurrsl/plugin-warehouse`** → **Bun** (`bun@1.3.14`;
  `bun.lock`). Testler `bun test` ile koşar (vitest **değil**).
- **`ovurrsl/panel`** ve **`ovurrsl/Digitaltwin`** → **npm** (`package-lock.json`).
  Panel testleri **Vitest** ile koşar.

> Yeni asistan uyarısı: editör monorepo'sunda `npm install` yapmayın — `bun`
> kullanın. Panel'de tersine, `bun` değil `npm` kullanın.

### 2.3 Monorepo altyapısı (`editor`)

- **Turborepo `^2.9`** — `turbo.json` görevleri: `build`, `lint`, `check-types`,
  `test`, `dev`. Workspaces: `apps/*`, `packages/*`, `tooling/*`.
- Kök `overrides` tüm ağacı sabitler: `next 16.3.0`, `three 0.185.1`,
  `@types/react 19.2.17` vb.
- `engines.node`: `>=20.9` (üretimde **Node 22.x**, Hostinger).

### 2.4 Sürüm hızlı-referans (kritik pinler)

```
editor paketleri:        @pascal-app/{core,viewer,editor,nodes} 1.0.0-beta.4
                         @pascal-app/mcp 1.0.0-beta.5
plugin-warehouse:        0.1.4  (peer: @pascal-app/* ">=1.0.0-beta.1 <2")
panel (console):         0.9.1  (Next ^16.2.12, React ^19.2.8, TS ^7.0.2)
Digitaltwin (artifact):  2.15.0 (Next 16.2.9, React 19.2.7, mysql2 3.23.2)
```

---

## 3. Modüllerin Detaylı Mimari Analizi (Architecture per Repository)

### 3.1 `ovurrsl/editor` — ana monorepo

**Görev:** React Three Fiber + WebGPU tabanlı 3B mimari/depo editörü. Upstream
genel bir mimari editör; bu fork onu **warehouse DigitalTwin** ürününe
özelleştirir (MySQL backend, konsol, warehouse eklentisi).

**Monorepo yapısı** (`packages/` ve `apps/`):

| Paket | Sorumluluk | `src/` alt-klasörleri |
|---|---|---|
| **`packages/core`** (`@pascal-app/core`) | Alan verisi + saf mantık: node Zod şemaları, `useScene` mağazası, event bus, uzamsal ızgara, registry kontratları, geometri üretim sistemleri. **Three.js/UI/editör kavramı import edemez.** | `events/ hooks/ lib/ registry/ schema/ services/ store/ systems/ utils/ validation/` |
| **`packages/viewer`** (`@pascal-app/viewer`) | Bağımsız 3B tuval: node renderer'ları, viewer sistemleri (kat/tarama/rehber görünürlüğü), kamera/kontroller, post-processing, gerçek sunum durumu (`useViewer`). `three-bvh-csg`, `three-mesh-bvh`. **`useEditor`/araç/mod bilmez.** | `components/ hooks/ lib/ store/ systems/` |
| **`packages/editor`** (`@pascal-app/editor`) | Yeniden kullanılabilir düzenleme UI + mantığı: araçlar, paneller, seçim afordansları, doğrudan-manipülasyon tutamakları ve **`useEditor` dahil çoğu editör mağazası**. Kaynağı doğrudan export eder (`./src/index.tsx`). | `components/ hooks/ lib/ store/` |
| **`packages/mcp`** (`@pascal-app/mcp`) | Model Context Protocol sunucusu + **scene storage adaptörleri** (forkun veri katmanı). `mysql2` + `@modelcontextprotocol/sdk`. Subpath export'lar: `./storage`, `./operations`, `./bridge`, `./server`, `./env`. | `bridge/ lib/ operations/ storage/ tools/ transports/ types/ …` |
| **`packages/nodes`** (`@pascal-app/nodes`) | Yerleşik node paketleri (wall, slab, roof, stair, door, window, hvac, duct/pipe, shelf…), `builtinPlugin` olarak. Framework paketleri buradan import **edemez** (Biome yasağı). | kind başına bir klasör |
| **`apps/editor`** | Next.js 16 uygulaması: viewer + editor + nodes + eklentileri besteler; forkun REST API'si, MySQL bağlantısı, auth köprüsü ve **vendor'lanmış konsol**. | `app/ components/ lib/ panel/(vendor) public/ scripts/` |

**Kritik dosyalar:**
- `apps/editor/lib/bootstrap.ts` — eklenti keşfi (`extendPluginDiscovery` ile
  `mintPlugin` + `warehousePlugin` besteler).
- `apps/editor/lib/scene-store-server.ts` — süreç-başı scene store singleton'ı
  (`getSceneStore` / `getSceneOperations`).
- `apps/editor/lib/auth/{session,guard,admin}.ts` — konsol oturumu köprüsü + yetki.
- `apps/editor/next.config.ts`, `hostinger-server.js`, `instrumentation.ts`.
- `packages/mcp/src/storage/{types,mysql-scene-store,sqlite-scene-store,scene-store-shared,index}.ts`.

**Kod okuma haritası:** `editor/README.md` (mimari), `editor/AGENTS.md`
(=`CLAUDE.md`, katman sınırları + fork bloğu), `editor/wiki/architecture/`
(20 sayfa; değişiklikten **önce** ilgili sayfayı okuyun), `editor/UPSTREAM.md`
(upstream merge çakışma tablosu), `editor/OTOMASYON.md` (otomasyon).

---

#### 3.1.1 MCP sunucusu — yeni asistanın doğrudan kullanabileceği yetenek

`packages/mcp` yalnız bir depolama katmanı değil; aynı zamanda **çalışan bir
Model Context Protocol sunucusu**dur. Yani devralan AI asistanı sahneyi UI'dan
bağımsız, programatik olarak okuyup değiştirebilir.

- **Binary:** `pascal-mcp` (`packages/mcp/src/bin/pascal-mcp.ts` → `dist/bin/`).
  Çalıştırma: `bun run start` (paket içinde) veya `bunx pascal-mcp`.
- **Transport:** `stdio` ve `http` (`src/transports/{stdio,http}.ts`) — stdio,
  editör istemcilerine bağlanmanın olağan yolu.
- **Depolama:** aynı `createSceneStore(env)` fabrikası; yani MCP sunucusu
  **canlı MySQL sahnelerine** aynı env değişkenleriyle bağlanır.
- **Duman testi:** `bun run smoke` (`scripts/smoke.ts`).

**Araçlar (`src/tools/`, 30+):**

| Kategori | Araçlar |
|---|---|
| Okuma / sorgu | `get-scene`, `get-node`, `describe-node`, `find-nodes`, `scene-query`, `schemas`, `asset-catalog` |
| Oluşturma | `create-level`, `create-wall`, `place-item`, `set-zone`, `cut-opening`, `construction-tools`, `room-tools` |
| Düzenleme | `apply-patch`, `delete-node`, `duplicate-level`, `undo`, `redo` |
| Analiz | `check-collisions`, `layout-clearance`, `door-clearance`, `measure`, `measurement`, `geometry`, `validate-scene` |
| Dışa aktarma | `export-glb`, `export-json` |
| Senkron | `live-sync` |

> ⚠️ **Bilinmesi gereken sınır:** `check_collisions`
> (`src/tools/check-collisions.ts`) yalnız `type: 'item'` düğümlerini tarar ve
> `findItemItemCollisions` kullanır. **`warehouse:*` eklenti kind'leri çakışma
> tespitinin tamamen dışındadır** — mükerrer/çakışık depo ekipmanı bu araçla
> görünmez. Mükerrer tespiti eklenecekse bu, doğal genişletme noktasıdır
> (bkz. §5.2, madde D).

#### 3.1.2 `apps/ifc-converter` — ayrı IFC uygulaması

Editör monorepo'sunda ikinci bir Next.js uygulaması (`ifc-converter-app`).
IFC (BIM) dosyalarını içe aktarmak için `web-ifc ^0.0.77` kullanır.

- `bun dev` → **port 3003** (editör 3002'de).
- `predev`/`prebuild`/`postinstall` adımları `scripts/copy-web-ifc-wasm.mjs`
  çalıştırır — **wasm dosyaları elle kopyalanır**; bu adım atlanırsa IFC
  yükleme sessizce çalışmaz.
- Editördeki tetikleyici: `apps/editor/components/ifc-import-button.tsx`.
- IFC tamamen **editöre** aittir; panel deposunda IFC kodu yoktur.

---

### 3.2 `ovurrsl/plugin-warehouse` — depo ekipmanı eklentisi

**Görev:** Pascal editörüne **plugin API v1** üzerinden depo/lojistik ekipmanı
ekler. Tüm node kind'leri `warehouse:` ön ekli. Sürüm `0.1.4`. Toolchain: **Bun**.

**Eklentiler nasıl çalışıyor?** `src/index.ts` **manifest barrel**'dır — tüm
kamusal yüzey:
- `warehousePlugin: Plugin = { id: PLUGIN_ID, apiVersion: 1, nodes: [...21 tanım] }`.
  `apiVersion` literal `1`'dir; host farklı bir sürüme geçerse `loadPlugin` **gürültülü
  hata** verir (kasıtlı).
- `warehouseCatalogPanel: EditorHostPanel` — sağ ray katalog paneli, `component`
  tembel import ile (`() => import('./panels/catalog-panel')`).

**Host nasıl besleniyor?** Host uygulamada üç düzenleme (bkz. `README.md`):
1. Bağımlılık — SHA pini (`github:ovurrsl/plugin-warehouse#<sha>`), monorepo içinde `"*"`.
2. `transpilePackages: ['@ovurrsl/plugin-warehouse']` (paket TS kaynağı gönderir).
3. `extendPluginDiscovery(async () => [warehousePlugin])` + `registerEditorHostPanel(...)`.
   **Asla `setPluginDiscovery` kullanma** (diğer tüm eklentileri düşürür).

**Yapı** — her node-kind ailesi kendi klasöründe (aynı dosya deseni:
`definition.ts`, `schema.ts`, `parts.ts`, `geometry*.ts`, `renderer.tsx`,
`tool.tsx`, `preview.tsx`, `floorplan.ts`, `metrics.ts`, `*.test.ts`). Kritik ortak
dosyalar: `catalog.ts` (katalog verisi), `placement.ts` (yerleştirme altyapısı +
çift-tık koruması), `store.ts` (eklenti-sahibi zustand), `host-adapter.ts` (tüm
host-şeması okumaları burada), `compat.ts` (boot-zamanı uyumluluk probu),
`geometry-builder.ts` (birleşik-geometri + cache motoru).

**Uygulanmış 21 `warehouse:` node kind'i:** `pallet`, `pallet-rack`,
`conveyor-{roller,curve,launcher,booster,transfer,oblique,telescopic,spiral}`,
`route`, `truck`, `mezzanine`, `live-rack`, `drive-in-rack`, `longspan-rack`,
`m3-rack`, `bench`, `dock-leveller`, `tote-cart`, `pallet-lift`. (Katalog, kind
sayısından daha fazla *tile* gösterir — kind başına birden çok hazır ayar.)

**Geometri modeli (performansın tüm hikâyesi):** Şekil başına **tek birleşik
`THREE.BufferGeometry`**, o şekli paylaşan her node arasında cache'lenir; parça
renkleri vertex-color attribute'unda → tüm sahne **tek materyalden** çizilir.
15.000 m²'lik depo ~95 blok / ~95 draw-call (parça-başı mesh olsaydı ~çeyrek
milyon). İki kural:
- **Cache anahtarı, builder'ın ürettiğini tanımlar — şemayı değil.** Mesh'i
  değiştiren ama anahtarda olmayan alan iki farklı rafı aynı geometride birleştirir;
  anahtarda olup hiçbir vertex'i oynatmayan alan cache'i boşuna böler. Coverage
  testi iki yönü de doğrular (beş gerçek hata yakalamış).
- **Disposal, node ömrünü değil retain-count'u izler.** Paylaşılan bir şekle
  **asla kendiniz `dispose()` çağırmayın**; sweep, hiçbir tutucu kalmayınca
  (grace period sonrası) serbest bırakır.

**Dört sessiz kural (`CLAUDE.md` — hata vermeden bozar):**
1. **Her ölçü metredir.** Yayınlanmış specler mm'dir → 1000'e böl. 100'ün üstünde
   çıplak ölçü literali yazma (`1200` = 1.2 km'lik palet, kimse itiraz etmez).
2. **`@pascal-app/*` peer bağımlılıktır — asla pinleme.** İkinci kopya = ikinci
   `nodeRegistry` singleton'ı; kind'ler yanlış registry'ye kaydolur, görünmez.
3. **Host node şekilleri yalnız `src/host-adapter.ts`'de, runtime guard'larla
   okunur.** Kontrat versiyon-korumalıdır (gürültülü kırılır), host şemaları değil.
4. **Panel markup'ında Tailwind class'ı yok.** Tailwind v4 symlink'li dizini
   taramaz; git-bağımlılığı bun store'una symlink'tir → class asla derlenmez, panel
   stilsiz çıkar. Inline stil (`src/panels/styles.ts`) veya host bileşeni kullan.

> **Sayıların kaynağı olmalı:** Bu gerçek ekipmanı modeller. Uydurma ama makul bir
> değer, eksik değerden kötüdür (incelemeden geçer). Katalog belirt ya da "seçilmiş
> varsayılan" olduğunu açıkça söyle.

---

### 3.3 `ovurrsl/panel` — DigitalTwin Console

**Görev:** Ürünün **ön kapısı** — bağımsız Next.js 16 uygulaması: giriş, 2FA,
kullanıcı/rol yönetimi, tesis (site) yönetimi, oturumlar, denetim (audit), işler
(jobs), entegrasyonlar, ayarlar. `package.json` adı `digitaltwin-console`,
sürüm `0.9.1`. Şirket bağlamı: Türk lojistik firması **Netlog**. Toolchain: **npm**.

> **Vendoring:** Konsol **burada** geliştirilir, editöre `apps/editor/panel/**`
> olarak saatlik akar. Editördeki kopyayı düzenleme — bir sonraki `pull-panel`
> ile üzerine yazılır. Değişikliği **bu depoda** yap.

**Yapı** (`src/`):
- `app/` — auth ekranları (`signin`, `mfa`, `reset`, `welcome`, `request`) +
  `console/[tab]/page.tsx` (tek dinamik rota tüm sekmeleri sunar) + `app/api/**`
  (~45 REST handler).
- `components/` — `auth/` (7 kimlik ekranı), `console/` (sekme başına bir bileşen +
  `command-palette.tsx` ⌘K, `user-drawer.tsx`, `assign-dialog.tsx`), `ui/`.
- `lib/` — `db.ts` (MySQL pool), `types.ts`, `api-contract.ts` (zod), `auth/`
  (`password, session, totp, invitations, reset, lockout, guard, roles, audit,
  crypto`), özellik lib'leri (`users, jobs, integrations, logs, settings, mail`),
  `i18n/{en,tr}`.

**11 konsol sekmesi** (`src/lib/console-tabs.ts`, üç ray bölümünde):
- **Monitor:** `overview`, `logs` · **Access:** `users`, `roles`, `audit`,
  `sessions` · **Platform:** `sites`, `jobs`, `integrations`, `updates`, `settings`.

> **Önemli:** Panel'in kendisinde **scenes sekmesi ve IFC kodu YOKTUR.**
> `scenes-tab.tsx` ve `guides-tab.tsx` yalnız editör tarafında (`EDITOR_OWNED`)
> yaşar; IFC içe aktarma tamamen editördedir (`apps/ifc-converter/`).

**Veri + DB:** `src/lib/db.ts` tembel `mysql2/promise` havuzu (limit 10, utf8mb4,
UTC). Env öncelik zinciri: `DIGITALTWIN_MYSQL_*` → `PASCAL_MYSQL_*` → `DATABASE_*`
(+ tekil URL). Bu, vendor'lanmış konsolun editörün sahne veritabanını **paylaşması**
için köprüdür. Migration'lar `db/migrations/*.sql` (§4.4'te şema). Panel'in sahip
olduğu tablolar: `users, sites, assignments, invitations, sessions, two_factor,
recovery_codes, api_keys, webhooks, jobs, audit_log, settings, roles,
access_requests, password_resets`. **`scenes` tablosu panele ait DEĞİLDİR** —
panel yalnız `sites.scene_id` yumuşak işaretçisini taşır.

**Auth:** argon2id parola (19 MiB, t=2, p=1); `sessions` tablosu (128-bit ID,
HttpOnly cookie, kayan pencere, `mfa_pending`); TOTP 2FA (secret AES-256-GCM
şifreli, `SECRET_ENCRYPTION_KEY`); kilitleme (3→30s, 10→15dk); davet/reset
akışları. Roller: 9 izin; sistem rolleri kod-tanımlı (`Admin, Supervisor,
Editor, Viewer`), özel roller `roles` tablosunda; dış org → Viewer'a sıkıştırılır.

**Vendoring sınırı — `EDITOR_OWNED`** (`editor/scripts/sync-panel.mjs`): editöre
özel olup panele **asla** geri gitmeyen dosyalar: `app/layout.tsx`, `app/page.tsx`,
`api/health/route.ts`, `console-tabs.ts`, `console/tab-content.tsx`, `console/
scenes-tab.tsx`, `console/guides-tab.tsx`. Kısaca: **panel-owned** = tüm konsol
kütüphanesi; **EDITOR_OWNED** = shell + scenes/guides sekmeleri + health.

---

### 3.4 `ovurrsl/Digitaltwin` — üretim artefaktı

**Görev:** `pascalorg/editor`'ın (commit `08e2279`) + `ovurrsl/editor`'ın MySQL
scene store'unun **derlenmiş, çalışmaya hazır `standalone` Next çıktısıdır**.
Kaynak kod değil, ters-proxy değil — deploy zamanı hiçbir şey derlenmesin diye
git'e commit'li Next build'idir. Sürüm `2.15.0`. Node 22.x, npm. Canlı: **opex.help**.

**Kritik dosyalar:**
- `server.js` (44 satır) — standalone Next bootstrap (Express değil). `PORT`
  (vars. 3000), `HOSTNAME`, derlenmiş `nextConfig`'i JSON olarak inline'lar,
  `startServer()` çağırır. **Editör UI, 3B viewer, konsol, tüm `/api/*` ve statik
  varlıklar tek süreçten** sunulur.
- `setup-native.mjs` (`npm run build`) — hiçbir şey derlemez; Turbopack'in
  `@node-rs/argon2-<hash>` alias'ını gerçek `argon2` kurulumuna symlink'ler
  (native modül tuhaflığı düzeltmesi).
- `panel-migrations/001..007.sql` — panelin **yetkili DB şeması** (§4.4).
- `public/` (~80 MB) — editörün varlık kütüphanesi (145 `items/` modeli, 7 PBR
  `material/` ailesi, 55 `icons/*.webp`, HDRI, fontlar, sesler, `demos/demo_1.json`).
- `.next/` (~55 MB) — derlenmiş uygulama (committed). `MysqlSceneStore` DDL'i
  `.next/server/chunks/packages_mcp_dist_storage_*.js` içinde.

**Nasıl birleşir:** Kullanıcı panelden kimlik doğrular (`users`/`sessions`/
`two_factor`, argon2id + TOTP) → bir tesise atanır (`assignments`) → o tesisin
sahnesini editörde açar → düzenler → MySQL'de `scenes` + `scene_revisions` +
`scene_events` olarak saklanır. İki şemanın birleşme noktası **`sites.scene_id`**
(migration 004).

> ⚠️⚠️ **GÜVENLİK — ACİL:** `/workspace/digitaltwin/.env` dosyası **canlı üretim
> kimlik bilgileriyle git'e commit edilmiş** durumda (gerçek MySQL kullanıcı+parola,
> aynı parolanın SMTP olarak tekrar kullanımı, gerçek `SECRET_ENCRYPTION_KEY`, admin
> e-postası). README de bu riski işaretliyor. **Yapılması gereken:** tüm sırları
> döndür (rotate), `~/.digitaltwin.env`'e taşı ve git geçmişinden temizle.
> `SECRET_ENCRYPTION_KEY` değişirse mevcut tüm 2FA gizli anahtarları okunamaz hale
> gelir — kullanıcıların 2FA'yı yeniden kurması gerekir.

---

## 4. Veri Akışı, Durum Yönetimi ve İletişim

### 4.1 Frontend ↔ Backend iletişimi

- **REST** — İstemci bileşenleri kendi `app/api/**/route.ts` handler'larını
  `fetch` eder (Next App Router, `nodejs` runtime, `force-dynamic`). Handler'lar
  `src/lib/*` üzerinden doğrudan MySQL okur/yazar. Kontratlar zod ile
  (`api-contract.ts`).
- **SSE (Server-Sent Events)** — Canlı sahne senkronizasyonu:
  `apps/editor/app/api/scenes/[id]/events/route.ts` `text/event-stream` döner,
  `listSceneEvents`'i **250 ms**'de bir yoklar, poll başına 50 olaya kadar gönderir,
  15s keepalive, `?after=` / `Last-Event-ID` ile devam eder. Konsol `jobs/stream`
  da SSE'dir.
- **GraphQL / WebSocket YOK.** (Gerçek-zamanlı çoklu-oyuncu CRDT katmanı da yok;
  ayrıntı §5.3.)

**Sahne ile ilgili başlıca rotalar** (`apps/editor/app/api/`): `scenes/`
(liste/oluştur), `scenes/[id]/` (getir/kaydet/adlandır/sil), `scenes/[id]/shares`
(paylaşım: `viewer|editor`), `scenes/[id]/revisions` + `revisions/restore`
(yedek/geri-yükle), `scenes/[id]/thumbnail`, `scenes/[id]/presence` (nabız + kira),
`scenes/[id]/events` (SSE), `admin/scenes/**` (konsol yönetimi).

### 4.2 Frontend state yönetimi — üç Zustand mağazası

Katman başına bir mağaza (kesin sınırlarla):

| Mağaza | Dosya | Sahip olduğu |
|---|---|---|
| **`useScene`** | `packages/core/src/store/use-scene.ts` | Sahne verisi: `nodes: Record<id, AnyNode>`, `rootNodeIds`, `dirtyNodes: Set`, CRUD. Middleware: **persist** (IndexedDB) + **zundo `temporal`** (50-adım undo/redo). |
| **`useViewer`** | `packages/viewer/src/store/use-viewer.ts` | Sunum durumu: `selection`, hover, `cameraMode`, tema, gölgeleme, ve forka özel **`sceneLocked` + `lockedCategories: Set`** (düzenleme kilidi). |
| **`useEditor`** | `packages/editor/src/store/use-editor.tsx` | Aktif araç, yapışma modları, boya modu, ölçüm taslakları, floorplan modu, fırça ayarları. `useScene` ve `useViewer`'ı import eder. |

**Sahne grafiği modeli:** Node'lar `BaseNode { id, type, parentId, visible, … }`'dan
türer, **düz sözlükte** saklanır (ağaç değil); hiyerarşi `parentId` ile. ID'ler
tip-önekli (`wall_abc123`). Şemalar Zod (`packages/core/src/schema/nodes/*`).
Ayrı bir **scene registry** (`useRegistry`) node id → Three.js `Object3D` eşler;
**sistemler** (`useFrame` içinde) yalnız **dirty** node'ların geometrisini günceller.
Kind'ler registry-güdümlü (`nodeRegistry`, `def.geometry`/`def.renderer`/`def.system`
üçlü kompozisyonu).

### 4.3 Paylaşılan yapı + kimlik doğrulama

- **Tek veritabanı, tek oturum çerezi.** Editör ve konsol aynı MySQL'i ve aynı
  `dt_session` çerezini paylaşır.
- **Kimlik konsola aittir.** `apps/editor/lib/auth/session.ts`, konsolun
  `@panel/lib/auth/session`'ından `getSession()` çağırır; konsolun izin setini üç
  editör rolüne indirger: `admin_access`→**admin**; `edit_projects|create_projects`
  →**editor**; aksi halde **viewer** (`canEdit = role ≠ viewer`).
- **`guard.ts`** — `authorizeSceneRead` / `authorizeSceneMutation`: imzasız→401;
  viewer yazamaz→403; owner/admin serbest; aksi halde `getSceneShareRole`'a
  danışır (`viewer` paylaşımı okuma, `editor` paylaşımı yazma verir). Yayınlanmış
  sahneler her imzalı hesaba okunur.
- **Presence / tek-aktif-editör kirası:** POST nabız; `{claim:true}` kira ister.
  `touchPresence` atomiktir — arayan yalnız düzenleme-uygunsa **ve** başka taze
  hesap kirayı tutmuyorsa kirayı alır; aksi halde canlı izleyicidir. TTL 30s.
  Düzenlenebilir sahneyi ilk açan düzenler; sonrakiler kira boşalana kadar izler.

### 4.4 Veritabanı şeması (iki ayrı alan, tek DB)

**A) Konsol/panel şeması** — `Digitaltwin/panel-migrations/001..007.sql` (yetkili
kaynak) ve `panel/db/migrations/`. Kimlik: içeride `BIGINT UNSIGNED` PK süreçten
çıkmaz; dışarıda **`CHAR(26)` ULID `public_id`** URL/API/log'ların tek ID'si.
InnoDB, utf8mb4, UTC.

- `users` (email/username unique, `org enum('internal','external')`, `global_role`,
  `status`, argon2id `password_hash`, kilitleme alanları, `locale`)
- `sites` (warehouse/tesis; `name` unique, `status`, kapasite alanları, `scene_id`
  — editör sahnesine köprü)
- **`assignments`** (kullanıcı × tesis × rol; `UNIQUE(user_id, site_id)`) — dış
  hesaplar yalnız buradan gerçek erişim kazanır
- `invitations`, `sessions`, `two_factor`, `recovery_codes`, `api_keys`,
  `webhooks`, `jobs` (kuyruk: `ifc_import`/`report_export`/`backup`), `audit_log`
  (mesaj İngilizce saklanır, `meta` JSON ile yerelleştirilir), `settings` (tek satır
  org config), `roles`, `access_requests`, `password_resets`.

**B) Scene store şeması** — `packages/mcp/src/storage/mysql-scene-store.ts`
(`migrate()`), runtime'da `CREATE TABLE IF NOT EXISTS` ile kurulur:

- `scenes` (`id VARCHAR(64) PK`, `name`, `project_id`, `owner_id`, `thumbnail_url`,
  `version`, timestamps, `size_bytes`, `node_count`, `graph_json LONGTEXT`,
  `graph_hash`)
- `scene_revisions` (`(scene_id, version)` PK, `graph_json`, `author_*`, FK CASCADE) —
  son **`SCENE_REVISION_HISTORY = 5`** sürüm tutulur
- `scene_events` (auto-inc `event_id`, SSE beslemesi, FK CASCADE)
- `scene_shares` (`ENUM('viewer','editor')`, PK `(scene_id, user_id)`)
- `scene_presence` (PK `(scene_id, user_id)`, `last_seen` ISO, `is_editor`) —
  TTL **`SCENE_PRESENCE_TTL_SECONDS = 30`**
- `project_placeholders`

> **Eşzamanlılık:** İyimser kilitleme — `expectedVersion` ile
> `SceneVersionConflictError`. Her kayıt scene satırını + bir revision yazar.
> `scene-store-shared.ts`'deki alan listesi **kalıcılık whitelist'idir** — orada
> olmayan alan kayıtta sessizce silinir. `apps/editor/lib/graph-schema.ts` de aynı
> şekilde yük taşır.

---

## 5. Mevcut Durum (Current State & Progress)

### 5.1 Tamamlanmış ve canlıda çalışan özellikler

**Editör tarafı (fork):**
- ✅ **MySQL scene store** — üretimde tek backend (SQLite yalnız dev; Docker
  kasıtlı kaldırıldı).
- ✅ **Scene sharing** — kullanıcı bazında `viewer`/`editor` paylaşımı
  (`scene_shares`, `shares` rotası, paylaşım-farkında `guard.ts`).
- ✅ **Yedekler + otomatik önizleme** — son 5 sürüm + geri-yükleme; kaydettikçe
  otomatik thumbnail.
- ✅ **Presence + tek-aktif-editör kirası** — canlı katılımcı çubuğu, "devral"
  (takeover), izleyici moduna sabitleme.
- ✅ **Canlı senkron (SSE)** — `scene_events` + 250 ms poll, last-writer-wins,
  çakışma bandı.
- ✅ **Kategori kilitleri** — `useViewer.sceneLocked` + `lockedCategories`,
  `packages/editor/src/lib/edit-lock.ts` (`isNodeEditLocked`).
- ✅ **Silme modu (X) toggle** — takılı kalma düzeltildi (PR #27, canlıda).
- 🟡 **Kilit kapıları: silme modu + çoğaltma** — editor **PR #28** (taslak,
  merge onayı bekliyor). Ayrıntı §5.2-C.
- 🟡 **Çift yerleştirme düzeltmesi** — plugin-warehouse **PR #29** (taslak).
  Ayrıntı §5.2-B.
- ✅ **Warehouse eklenti entegrasyonu** — `bootstrap.ts`'te kayıtlı, saatlik pin.
- ✅ **Fork performans düzeltmeleri (2026-08)** — wall-cutout thunk, warehouse
  ölçekli oda (12k–30k m²) için space-detection üst-sınır kaldırma, level-index
  WeakMap memo, bütçeli scene-BVH bakımı, statik-transform dondurma (testlerle
  korunmakta).

**Plugin-warehouse:** 21 node kind (raflar, konveyör ailesi, asma kat, forklift
filosu, dock leveller, tote-cart, pallet-lift…), toplu instancing (5.300 node'da
~10.300→~11 draw-call), LOD-kalite kolu, gölge-haritası kısma, `bake:'replace'`.

**Konsol (panel `0.9.1`):** giriş/2FA/kilitleme/davet/reset, kullanıcı+toplu
işlemler, roller, tesisler, oturumlar, işler (SSE), entegrasyonlar (API key +
webhook), denetim (iki-dilli), ⌘K komut paleti, gerçek SMTP, ayarlar. README
"bilinçli olarak yarım bırakılan bir şey yok" der.

### 5.2 Bilinen hatalar ve açık işler (öncelik sırasıyla)

> Bu bölüm 2026-08-19'da üç ayrı kod incelemesiyle üretildi. Her madde
> **dosya:satır** taşır; "muhtemelen" yazan yerler doğrulanmamış demektir.

#### A. ⚠️ ACİL — Üretim sırları git'e commit'li

`Digitaltwin/.env` canlı MySQL kullanıcı+parolası, aynı parolanın SMTP kopyası,
gerçek `SECRET_ENCRYPTION_KEY` ve admin e-postasını taşıyor; README de riski
işaretliyor. **Yapılacak:** sırları döndür, `~/.digitaltwin.env`'e taşı, git
geçmişinden temizle. `SECRET_ENCRYPTION_KEY` döndürülürse mevcut tüm TOTP
gizli anahtarları okunamaz hâle gelir — kullanıcılar 2FA'yı yeniden kurar.

#### B. ✅ ÇÖZÜLDÜ (2026-08-19) — Tek tıkta çift yerleşim

*plugin-warehouse PR #29 · iki bağımsız sebep.*

1. **Guard konuma bakıyordu ve konum asla eşleşmiyordu.** Bir fiziksel tıklama
   emitter'a iki kez ulaşır: nesne yüzeyinden `pointerup` ile sentezlenen
   `<kind>:click` ve tarayıcı `click`'inden gelen `grid:click` (`'grid'`,
   `CLICK_TRIGGER_KINDS`'in ilk elemanı). `isFollowUpOfSameClick`
   (`src/placement.ts`) ikisini **konum** ile eşleştirmeye çalışıyordu; oysa biri
   ışının **mesh'e çarptığı**, diğeri **zemini kestiği** noktayı bildirir. Fark,
   çarpma yüksekliğiyle orantılı (palet üstünde ~14 cm) ve eşik 1 mm. → ikinci
   olay geçiyor, **aynı koordinata ikinci düğüm**. Boş zeminde iki nokta
   çakıştığı için hata yalnız nesne üstüne tıklarken görünüyordu.
   **Düzeltme:** guard artık pres-başına (`pointerdown` ile kurulur, ilk commit
   ile harcanır) ve abonelik başına; ayrıca host'un `swallowFollowUpBrowserClick`
   deseni kopyalandı, böylece `grid:click` hiç yayınlanmıyor.
2. **Beş kind host paletinden gizli değildi** (`bench`, `dock-leveller`,
   `pallet-lift`, `tote-cart`, `route`) → hem host paleti hem eklenti kataloğu
   aynı tıkta yerleştiriyordu. Aynı hata `492f23b`'de sarmalda düzeltilmişti.
   **Düzeltme:** beşine `presentation.hidden: true` + aile-üstü bekçi test.

Bekçi testler eski kodda düşüyor (doğrulandı). Suite: 2681 geçti / 0 düştü.

#### C. ✅ ÇÖZÜLDÜ (2026-08-19) — Kilit kapılarında atlanan iki yer

*editor PR #28.*

1. **Silme modu kilidi yok sayıyordu** — balyoz modunda (X) kilitli sahnede/
   kategoride nesne siliniyordu. Merkezî handler
   `selection-manager.tsx`'e `isNodeEditLocked` kapısı eklendi (tek yer hem 3B
   hem 2D'yi kapsıyor).
2. **Kilitliyken Duplicate serbestti** — `floating-action-menu.tsx` ve
   `floorplan-registry-action-menu.tsx`'te Move/Delete/AddHole/Curve `!editLocked`
   ile kapalıyken **Duplicate atlanmıştı**. Kopya kaynağın *tam* koordinatına
   yazılıyor (çoğaltma yollarının çoğu offset vermiyor) → görünmez; kilitli
   olduğu için seçilemez (#25); seçilemediği için silinemez. **Kullanıcının
   "fark edilemiyor" şikâyetinin en güçlü açıklaması buydu.**

#### D. 🔴 AÇIK — Yerleştirme önizlemesi (hayalet)

Kullanıcı raporu (2026-08-19): *"3B'de imleci takip ediyor ama imlecin olduğu
koordinatta göstermiyor; tıklayınca doğru yere koyuyor. 2B'de nesneyi seçince
hiç göstermiyor; yerleştirdiğimi görmek için 3B'ye geçip geri dönmem gerekiyor."*

Üç ayrı kusur; hiçbiri henüz düzeltilmedi:

- **D1 — 2B'de hayalet hiç çizilmiyor.** 2B önizleme katmanı
  (`editor-2d/renderers/floorplan-placement-preview-layer.tsx`) yalnız
  `usePlacementPreview` store'undaki node'u çizer. Host'un yerleşik araçları
  oraya yazar (`nodes/src/column/tool.tsx`, `spawn`, `cabinet` …); **eklentinin
  18 aracı hiç yazmaz** — konumu kendi `cursorRef`'ine imperatif olarak
  yazıyorlar ve o mesh 2B'de `display:none` altında kalıyor.
  *Düzeltme yeri:* `plugin-warehouse/src/placement.ts`'e ortak
  `publishPreview()`/`clearPreview()` yardımcısı + 18 araçtan çağrı.
- **D2 — 3B'de hayalet bir kare geride.** `placement.ts`'teki `subscribeGridMove`
  hareketi rAF'a erteler (perf commit `fe641cf`), ama tıklama
  `flushPendingGridMoves()` ile **senkron** boşaltır — commit doğru, önizleme
  geride. Host'un araçları senkron abone.
  *Düzeltme yeri:* görsel yazımı (position/rotation) senkron yap, pahalı işi
  (`resolveAlignedPlacement`, çakışma taraması, `setState`) rAF'ta bırak.
- **D3 — 2B'de yeni konan nesne görünmüyor, görünüm değiştirince geliyor.**
  Henüz kök nedeni doğrulanmadı. En güçlü aday
  `floorplan-registry-layer.tsx`'teki `floorplanVisible` kapısı ve geometri/
  level-data cache'leri (`geometryCacheRef`, `levelDataCacheRef`, `siblingEpochs`)
  — 3B↔2B geçişi cache'i geçersiz kılıyor olabilir. **Araştırılacak.**

> Elenen hipotezler (kanıtlı): instancing / `static-transform` / `frozen-matrix`
> **değil** (bunlar yalnız renderer'larda, preview'de kullanılmıyor);
> `getFloorStackPreviewPosition` **değil** (yalnız Y'yi değiştirir);
> koordinat çerçevesi uyuşmazlığı **değil** (üç yol da bina-yerel ve tutarlı).

#### E. 🔴 AÇIK — Mükerrer node üreten diğer yollar

- **E1 — Terk edilen `isNew` taslağı hiç geri alınmıyor.**
  `tools/registry/move-registry-node-tool.tsx:1054-1062` temizlik koşulundan
  `isNew` **bilerek** dışlanmış; taslağı silen tek yol `tool:cancel`
  (`:1020-1034`). `tool:cancel` gelmeden unmount (mod/kat/faz değişimi, split-view
  geçişi, seçim değişimi) → **taslak sahnede kalır, kaynağın tam üstünde**. 2B
  karşılığı `floorplan-registry-move-overlay.tsx`: commit yalnız pointer plan
  görünümü içindeyse yapılıyor (`:669`), panel üstünde bırakılan tıklama ne
  commit ne iptal ediyor.
  *Ek sorun:* birkaç duplicate girişi `temporal.pause()` yapıp başarı yolunda
  `resume()` etmiyor (`floating-action-menu.tsx:534`, `nodes/src/door/panel.tsx:255`,
  `lib/stair-duplication.ts:48`) → sızan kopya **undo yığınına bile girmiyor**.
- **E2 — `use-placement-coordinator.tsx`'te çift-commit kapısı yok.** Hem
  `grid:click` hem `item:click` hem `wall:click` (+ `ceiling`, `shelf`) abone
  (`:2238-2248`); handler'ların hiçbirinde ortak "commit edildi" bayrağı yok.
  Kardeş yolların hepsinde var: `move-registry-node-tool.tsx:800` (`if (committed) return`),
  `stair-click-guard.ts` (`createStairCommitGate`), `nodes/shared/floor-placement.ts:119`
  (`stopPlacementCommitPropagation`). Repeat modunda commit sonrası aynı
  koordinatta yeni taslak kurulduğu için (`:495-501`) ikinci geçiş **tam üst üste**
  ikinci düğüm koyabiliyor.
- **E3 — Kat çoğaltmada çift-tık koruması yok.** Üç düğme de korumasız
  (`site-panel/index.tsx:851`, `level-duplicate-dialog.tsx:105`,
  `floating-level-selector.tsx:281`) ve handler bayat prop `levels` ile taze
  `useScene.getState().nodes`'u karıştırıyor (`site-panel/index.tsx:677-696`) →
  aynı karede iki tık = **aynı kat numarasında üst üste iki kat**.
  *Not:* veri katmanı temiz — `clone-scene-graph.ts:207-220` `Set` guard'lı,
  çift ziyaret yok. Sorun yalnız UI tarafında.
- **E4 — 2B çizim katmanında dedup eksik.** `floorplan-registry-layer.tsx:945`
  `visit()` fonksiyonunda `seen` seti yok; `:984-999` building-scoped taraması
  `collectedIds` ile karşılaştırılmıyor (oysa hemen üstteki linked-node bloğu
  `:959` bunu yapıyor). `parentId === building` ama hâlâ bir level torununun
  `children`'ında görünen bir node (yarı göçmüş elevator sınıfı — çekirdek bunu
  `use-scene.ts:633-639` ve `:902-910`'da belgeliyor) **2B'de iki kez çizilir**.
  Aynısı `collectLevelDataKind:911`'de.
- **E5 — "Grubun grubu" veri olarak mümkün değil** — session grupları sahne
  düğümü değil (`lib/session-groups.ts:1-10`), gruplama üyeyi eski grubundan
  çıkarıyor (`:114`). Grup duplicate'te üye+ebeveyn çift kopyası da korunmuş
  (`lib/scene-clipboard.ts:328,334,342`). **Buradaki gerçek risk çift değil,
  sessiz düşürme:** ebeveyni `shelf`/`cabinet`/`rack` olan ve ebeveyni seçili
  olmayan üye root sayılmıyor (`:139-156`) → sessizce kopyalanmıyor.

#### F. 🟡 Mükerrer tespiti yok (istenen "fark edilebilirlik")

- `check_collisions` (MCP) yalnız `type:'item'` tarıyor → `warehouse:*` kapsam
  dışı. `plugin-warehouse/src/clash.ts` gerçek 3B hacim testi yapıyor ama yalnız
  yerleştirme kapısı olarak, sahne denetimi olarak değil.
  `core/src/validation/validate-build-json.ts` yalnız `orphan_parent`,
  `orphan_root`, `key_id_mismatch`, `unknown_types`, `schema_failure` üretiyor.
- **Öneri:** `packages/core/src/validation/` altına saf yardımcılar —
  `findCoincidentNodes` (anahtar: parent + type + yuvarlanmış position/rotation),
  `findMultiParentNodes` (`use-scene.ts:1151-1179` zaten `childIdsByParentId`
  indeksini kuruyor, neredeyse bedava), `findChildParentMismatch`. Bağlanacağı
  yerler: `validateBuildJson`, dev-only `createNodesAction` sonrası denetim,
  site-panel'de kat satırına rozet (**kilitli node'ları da göstermeli**).
- **Önlem tespitten değerli:** her duplicate yolunda kopyayı görünür bir offset
  ile üret (`lib/stair-duplication.ts:54-58` deseni — bugün offset veren yalnız
  o ve `nodes/src/roof-segment/panel.tsx:127-131`).

#### G. 🟢 Doküman kaymaları (düzeltilmeli, davranış etkisi yok)

- `plugin-warehouse/README.md:145-168`: "eklenti node'ları duplicate edilemiyor,
  `pascalorg/editor#547` bekleniyor" — **artık geçersiz.** Host'ta fallback var
  (`scene-clipboard.ts:28-35` `parseClipboardNode`, registry şemasına düşüyor) ve
  id-prefix hatası `83517b3c` ile düzelmiş.
- `plugin-warehouse/CLAUDE.md` + README "Layout" bölümü yalnız `pallet/`+`rack/`
  anlatıyor ve var olmayan `src/overlay.tsx`'e atıf yapıyor; gerçekte **21 kind**.
- `editor/CHANGELOG.md` upstream'e ait; **fork özellikleri orada izlenmiyor**.

#### H. 🟢 Diğer açık maddeler

- **Seçilmiş varsayılanlar** (kaynak yerine, kodda işaretli): tote-cart 15° eğim,
  `DEFAULT_LEVEL_HEIGHT = 3.0` (host varsayılanı 2.5), LOD ölçek faktörleri
  ("ölçüm değil"), turret aisle EN 15620 bandı.
- **Panel:** diyaloglar arka planı `inert` işaretlemiyor (erişilebilirlik);
  iş kuyruğu süreç-içi (`src/lib/jobs.ts` `startJobWorker` — çok-instance'ta ayrı
  sürece taşınmalı); `audit_log.message` kalıcı İngilizce; `roles.ts` `Supervisor`
  tanımlıyor ama `seed.ts` seed'lemiyor.
- **Tasarım sorusu (karar bekliyor):** Cut, kilitli nesnede kopyalıyor ama
  silmiyor (`group-actions.ts:555-573`) — yorumda **bilinçli** olarak belgeli.
  Yapıştırma kullanıcı tetiklediği için gizli mükerrer üretmiyor, ama sürpriz.
- **Editör plan pending'leri:** asma kat çizimi zone/slab mantığına geçiş,
  mezzanine outline yanlış çerçeve kuantalama, route `lines` yapışma modu no-op,
  boya (duvar/slab doku) bir makinede gelmeme.

### 5.3 Kasıtlı ertelenenler

- **Organizations** (takım workspace + Owner/Admin/Member + davetler) — bizim
  yığında yapılabilir (CRDT gerektirmez); `assignments`/`scene_shares` desenini
  org modeline genişletmek. Orta iş.
- **Gerçek-zamanlı çoklu-oyuncu (CRDT)** — upstream açık kaynağında **yok**
  (Pascal'ın kapalı SaaS'ı). Bir CRDT taşıma katmanı ister (Liveblocks/PartyKit
  veya öz-barındırılan Yjs). Büyük iş; ara çözüm olarak presence + tek-aktif-editör
  zaten canlıda.

---

## 6. Kritik Tasarım ve Kodlama Kararları

### 6.1 Mimari kararlar (yeni asistanın BİLMESİ GEREKENLER)

1. **Katman sınırları kutsaldır** (`editor/AGENTS.md`, `wiki/architecture/`):
   `core` = saf veri/mantık (Three.js/UI yok); `viewer` = bağımsız 3B tuval
   (`useEditor`/araç/mod bilmez); `apps/editor` = düzenleme deneyimi, `<Viewer>`'a
   prop/children ile enjekte edilir. **Biome bunu zorlar:** framework paketleri
   `@pascal-app/nodes`'u import edemez — `nodeRegistry.get(kind)` kullan.
2. **Registry-güdümlü kompozisyon** — yeni node kind'i = `def.geometry` +
   `def.renderer` + `def.system` üçlüsü; kind adı dosyalara gömülmez.
3. **2D ↔ 3D davranış paritesi** — bir yerleştirme/taşıma etkileşimi eklerken
   hem 2D floorplan hem 3D için geçerli olmalı; kardeş dosyaya aynı PR'da taşı.
   (Silme "balyoz" modu bunun istisnası: tek merkezî handler
   `selection-manager.tsx` her iki görünümü de karşılar.)
4. **Kalıcılık whitelist'leri yük taşır** — `scene-store-shared.ts` ve
   `graph-schema.ts`'de olmayan alan kayıtta **sessizce silinir**.
5. **MySQL-only üretim** — SQLite üretim fallback'i yok; `createSceneStore`
   üretimde URL yoksa **fırlatır**. Docker kasıtlı silindi.
6. **Fork ≠ upstream** — `integration`'da çalış, **`main`'e asla commit'leme**
   (bire bir ayna; commit `mirror-upstream`'i kilitler). Upstream merge'leri
   `UPSTREAM.md` dosya-bazlı tabloya uyar. `apps/editor/panel/**` vendor'dur —
   `ovurrsl/panel`'de düzenle.
7. **`GITHUB_TOKEN` push'u workflow tetiklemez** — build bekleyen push'lar bir
   sonrakini açıkça dispatch etmeli.
8. **Plugin izolasyonu** — host şema okumaları yalnız `host-adapter.ts`; peer
   dep'ler pinlenmez; `src/index.ts` SSR-güvenli (module-scope'ta document/window/
   Three.js yok, renderer/tool tembel thunk arkasında).

### 6.2 Kod standartları

- **Biome** (ESLint/Prettier yok): 2-boşluk girinti, satır 100, tek tırnak, JSX
  çift tırnak, `semicolons: asNeeded`, sondaki virgül, import düzenleme açık.
  Editörde bazı kurallar gevşek (`noExplicitAny`, `noConsole`, `noMagicNumbers`
  kapalı). Panel alt-ağacında `useExhaustiveDependencies` kapalı.
- **CSS:** Tailwind CSS v4 `@theme` + `--dt-*` design token'ları (panel/editör).
  **Plugin panellerinde Tailwind YOK** (§3.2, kural 4) — inline stil.
- **UI kütüphaneleri:** editör Radix UI + dnd-kit; panel `lucide-react` + `clsx` +
  `tailwind-merge`. İkon seti `public/icons/*.webp`.
- **Commit'ler:** Conventional Commits (`feat:`, `fix:`, `perf:`, `refactor:`,
  `docs:`, `test:`, `chore:`). Konu changelog'a girer; gövde (Türkçe) gerekçedir.
- **Testler:** editör/plugin `bun test`; panel `vitest`. Her değişiklikten sonra
  tip-kontrolü + lint + test koş (plugin'de suite <1 sn).
- **Operasyon kuralları** (`AGENTS.md`): dosyanın tamamını oku, tek seferde eksiksiz
  düzenle; iki ardışık araç hatasından sonra dur; back-compat shim / ölü kod /
  spekülatif soyutlama yok; yorum yalnız gizli bir *neden*'i açıklar.

---

## 7. Kurulum ve Çalıştırma Yönergeleri (Local Development)

### 7.1 `ovurrsl/editor` (ana geliştirme)

```bash
cd editor
bun install
bun dev            # turbo dev; Next → http://localhost:3002
# yardımcılar:
bun kill           # 3002 portunu boşalt
bun restart        # kill + cache temizle + dev
bun check-types    # turbo check-types (next typegen && tsc --noEmit)
bun check          # biome check   ·  bun check:fix
bun run test       # turbo test (paket başına bun test)
bun build          # üretim: node_modules temizle+kur, standalone çıktı + hostinger-server.js
bun sync-panel     # panel senkron (manuel tohumlama)
```

- **Dev için env gerekmez** (yalnız `PORT`, vars. 3002). Opsiyonel:
  `MINT_PASCAL_HOST_ORIGIN`, `NEXT_PUBLIC_ASSETS_CDN_URL` (env.mjs doğrular;
  `SKIP_ENV_VALIDATION` bypass).
- **Üretim MySQL (zorunlu):** `DIGITALTWIN_MYSQL_URL` **veya**
  `DIGITALTWIN_MYSQL_{HOST,USER,PASSWORD,DATABASE,PORT}`. Yerel SQLite override:
  `DIGITALTWIN_DB_PATH` / `DIGITALTWIN_DATA_DIR`.
- **Next 16 uyarısı:** `apps/editor/AGENTS.md` — "This is NOT the Next.js you know";
  kod yazmadan önce `node_modules/next/dist/docs/` oku.

### 7.2 `ovurrsl/panel` (konsol)

```bash
cd panel
npm install
cp .env.example .env.local
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # SECRET_ENCRYPTION_KEY
npm run db:migrate       # DB'yi kurar (yoksa oluşturur), idempotent
npm run db:seed          # 1 admin + 3 tesis + settings + sistem rolleri
npm run db:seed -- --dev # + r.ovur, c.tuna geliştirici hesapları
npm run dev              # next dev
npm run test | typecheck | build
```

İlk giriş (seed): `Admin` / `Admin` (`admin@netlog.com.tr`, ilk girişte parola
değişimi zorunlu). **Zorunlu env:** `SECRET_ENCRYPTION_KEY`, `DATABASE_*`.
Opsiyonel: `SESSION_COOKIE_SECURE`, `NEXT_PUBLIC_EDITOR_URL`, `MAIL_*`/`SMTP_*`,
`GITHUB_TOKEN` (changelog). Testler: 59 test / 7 dosya (`tests/`).

> ⚠️ **Panelin kendi CI'ı yoktur** (`.github/workflows/` boş). Tip güvenliği
> tamamen editördeki `pull-panel`'in `bun run check-types` kapısına bağlıdır —
> yani panelde bozuk kod yazılırsa hata **editör tarafında** patlar ve vendor
> akışı sessizce durur. Panelde çalışırken `npm run typecheck`'i elle koşun.

### 7.3 `ovurrsl/plugin-warehouse` (eklenti)

```bash
cd plugin-warehouse
bun install
bun run check-types      # tsc --noEmit
bunx biome check .       # lint + format (--write düzeltir)
bun test
bun run verify           # üçü birden (CI eşdeğeri)
```
Env: yalnız `NODE_ENV` (prod'da yinelenen kind fırlatır; dev'de uyarır).

### 7.4 `ovurrsl/Digitaltwin` (üretim paketi)

```bash
cd digitaltwin
npm install
npm run build            # setup-native.mjs (argon2 alias fix) — derleme YOK
npm start                # node server.js → http://localhost:3000  (MySQL env gerekir)
```
Env yükleme: gerçek env vars > `.env` (her sürümde değişir) > `~/.digitaltwin.env`
(sürümler arası kalır — **tercih edilen**). Her `DIGITALTWIN_*` bir `PASCAL_*`
takma adıyla da okunur. Hostinger: repo `ovurrsl/digitaltwin`, branch `main`,
Node 22.x, build `npm run build`, entry `server.js`. `/api/health` deploy'u
doğrular (`"backend":"mysql","db":"ok"`).

> **Dört depoyu birlikte çalıştırma:** Yerelde en pratik yol tek MySQL örneği
> paylaşmaktır. `panel` ve `editor` aynı `DATABASE_*`/`DIGITALTWIN_MYSQL_*`
> değerlerini kullanmalı; böylece konsol oturumu + sahne verisi aynı DB'de buluşur.
> `NEXT_PUBLIC_EDITOR_URL`'i panele verin ki "Open" bağlantıları editöre gitsin.

---

## 8. Gelecek Yol Haritası (Next Steps & Roadmap)

### 8.1 Yeni asistanın İLK görevleri (sırayla)

1. **Güvenlik önce:** `Digitaltwin/.env` sırlarını döndür, `~/.digitaltwin.env`'e
   taşı, git geçmişinden temizle. (`SECRET_ENCRYPTION_KEY` döndürülürse 2FA
   yeniden kurulacağını unutma.) — **en yüksek öncelik** (§5.2-A).
2. **Açık PR'ları kapat:** editor **#28** (kilit kapıları) ve plugin-warehouse
   **#29** (çift yerleştirme). İkisi de taslak; CI yeşilinde merge → deploy.
3. **Önizleme hatasını bitir (§5.2-D):** D1 (2B'de hayalet hiç yok) en yüksek
   etkili ve en küçük iş — `placement.ts`'e ortak `publishPreview()` yardımcısı
   koyup 18 araçtan çağır. Sonra D2 (3B bir-kare gecikmesi: görsel yazımı
   senkron yap, pahalı işi rAF'ta bırak) ve D3 (2B'de yeni nesne görünmüyor —
   **kök neden henüz doğrulanmadı**, `floorplanVisible` kapısı ve cache'lerden
   başla).
4. **Mükerrer üreten kalan yolları kapat (§5.2-E):** öncelik sırası E1 (sızan
   `isNew` taslağı) → E2 (`use-placement-coordinator` commit kapısı) → E3 (kat
   çoğaltma çift-tık) → E4 (2B çizim dedup).
5. **Tespit ekle (§5.2-F):** `findCoincidentNodes` + `findMultiParentNodes` ve
   duplicate yollarına görünür offset. Bu, "fark edilemiyor" sınıfını kökten
   bitirir.

### 8.2 Yakın vadeli özellikler

- **Organizations (takım workspace'i)** — `assignments`/`scene_shares` desenini
  Owner/Admin/Member + e-posta davetleri + org'a ait projeler + paylaşılan Files'a
  genişlet. CRDT gerektirmez; panel + editör auth'ta yapılabilir (orta iş).
- **Açık hata/iş düzeltmeleri:** asma kat çizimini zone/slab mantığına geçir;
  mezzanine outline çerçeve kuantalama; route `lines` yapışma; boya doku gelmeme.
- **Plugin dokümantasyonunu güncelle** (21 kind'i yansıt; hayali `overlay.tsx`'i
  kaldır) ve "seçilmiş varsayılan" değerleri gerçek sahnede ölçüp ayarla.
- **Upstream katkıları:** `#547` (duplicate) takibi; ölçüm sonrası perf/autosave
  yamalarını upstream'e sun.

### 8.3 Orta/uzun vade

- **Gerçek-zamanlı çoklu-oyuncu (CRDT)** — Yjs (öz-barındırılan y-websocket/
  Hocuspocus) veya yönetilen (Liveblocks/PartyKit). Asıl zorluk: editörün scene
  graph'ını CRDT doc'una bağlamak. Büyük iş; presence+kira ara çözüm olarak yerinde.
- İş kuyruğunu ayrı sürece taşı (çok-instance); erişilebilirlik (`inert`) açığını
  kapat.

### 8.4 Yeni asistan için altın kurallar (özet)

- 🟢 Geliştirmeyi **`editor@integration`**'da yap; **`main`'e dokunma** (§1.4.1).
  Özellik dalı → PR → squash-merge → `deploy-bundle` → canlı (§1.4.6).
- 🟢 Konsolu **`ovurrsl/panel`**'de düzenle, `apps/editor/panel/**`'de değil;
  `Digitaltwin`'e elle hiç dokunma (her yayında üzerine yazılır).
- 🟢 Otomatik akışların (`bump-plugin`, `pull-panel`, `mirror-upstream`) işini
  elle yapma; `GITHUB_TOKEN` push'u workflow tetiklemez (§1.4.4).
- 🟢 Editör/plugin → **bun**; panel → **npm**. Testler: bun test / vitest.
- 🟢 Ölçüler **metre**; plugin peer dep'lerini **pinleme**; host şeması yalnız
  `host-adapter.ts`.
- 🟢 Kalıcılık whitelist'lerini (scene-store-shared / graph-schema) unutma —
  sessiz veri kaybı.
- 🟢 Değişiklikten önce ilgili `wiki/architecture/` sayfasını oku; PR incelemede
  `review-architecture` skill'ini çağır.

---

### Ek A: mimari wiki sayfaları ve hazır iş akışları (skills)

Mimariye dokunan bir değişiklikten **önce** ilgili sayfayı oku
(`editor/wiki/architecture/`, indeks `README.md`'de). 20 sayfa:

`layers` · `viewer-isolation` · `systems` · `renderers` · `node-schemas` ·
`node-definitions` · `scene-registry` · `selection-managers` · `selection-groups` ·
`tools` · `interaction-scope` · `spatial-queries` · `events` · `measurements` ·
`materials-and-themes` · `item-authoring` · `plugin-authoring` · `vertical-model` ·
`creating-rules` · `README` (indeks)

Asgari eşleme: yeni node kind → `node-schemas` + `node-definitions` + `renderers`
+ `systems`; yeni araç → `tools` + `interaction-scope` + `spatial-queries` +
`events`; `packages/viewer` içi → `viewer-isolation` + `layers`; seçime dokunan
→ `selection-managers` + `scene-registry` + `events`; **eklenti işi →
`plugin-authoring`**.

**Skills** (`editor/.agents/skills/`, `.claude/skills/` vb. sembolik bağlar):
- `review-architecture` — PR'ı mimari kurallara karşı denetler (gerekli wiki
  sayfalarını yükler, diff'i çeker, yeni dosyaları katmana göre sınıflar).
- `open-pr` — deponun PR şablonuyla PR açar.

### Ek B: hızlı dosya-yolu dizini

| Ne | Nerede |
|---|---|
| Katman sınırları + fork kuralları | `editor/AGENTS.md` (=`CLAUDE.md`) |
| **Otomasyon topolojisi (tek doğruluk kaynağı)** | `editor/OTOMASYON.md` → bu dokümanda §1.4 |
| Workflow tanımları | `editor/.github/workflows/{bump-plugin,pull-panel,mirror-upstream,deploy-bundle,upstream-check,ci,mcp-ci,sync-panel,relock}.yml` |
| Upstream merge kuralları (dosya-bazlı) | `editor/UPSTREAM.md` |
| Yayınlama notları | `editor/YAYINLAMA.md` |
| Scene store (MySQL) | `editor/packages/mcp/src/storage/mysql-scene-store.ts` |
| Scene store sabitleri/whitelist | `editor/packages/mcp/src/storage/scene-store-shared.ts` |
| Auth köprüsü + yetki | `editor/apps/editor/lib/auth/{session,guard}.ts` |
| Eklenti keşfi | `editor/apps/editor/lib/bootstrap.ts` |
| Düzenleme kilidi | `editor/packages/editor/src/lib/edit-lock.ts` |
| Silme "balyoz" handler | `editor/packages/editor/src/components/editor/selection-manager.tsx` |
| Plugin manifest | `plugin-warehouse/src/index.ts` |
| Plugin host okumaları | `plugin-warehouse/src/host-adapter.ts` |
| Plugin geometri/cache | `plugin-warehouse/src/*/geometry-builder.ts` |
| Konsol sekmeleri | `panel/src/lib/console-tabs.ts` |
| Konsol DB pool | `panel/src/lib/db.ts` |
| Yetkili panel DB şeması | `Digitaltwin/panel-migrations/001..007.sql` |
| Üretim sunucusu | `Digitaltwin/server.js` |
| Vendoring motoru + `EDITOR_OWNED` | `editor/scripts/sync-panel.mjs` |
