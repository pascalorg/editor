# Yayınlama — plugin güncellemesinden canlıya

Bu belge `opex.help`'e sürüm çıkarmanın tam yolunu anlatır. Depo topolojisi
`UPSTREAM.md`'de; burada anlatılan onun çalıştırma tarafı.

## Zincir

```
opex.help  (Hostinger Node.js hosting)
   ↑  hPanel ovurrsl/digitaltwin main dalını izler, push görünce yeniden dağıtır
ovurrsl/digitaltwin        ← DERLENMİŞ bundle. Kaynak kod yok, deploy anında hiçbir şey derlenmez
   ↑  deploy-bundle iş akışı force-push eder
ovurrsl/editor             ← bu depo. Bundle burada üretilir
   ↑  bun install çeker, SHA ile çivili
ovurrsl/plugin-warehouse   ← eklenti
```

Anlaşılması gereken tek şey: **eklenti uygulamanın içine derleniyor.** Plugin
deposuna commit atmak canlıda hiçbir şeyi değiştirmez. Değişikliğin siteye
ulaşması için SHA yenilenir, bundle yeniden üretilir ve digitaltwin'e konur.

## Tek seferlik ön koşullar

Bunlar bir kez kurulur; sonraki yayınlarda dokunulmaz.

| Ne | Nerede | Neden |
|---|---|---|
| `DEPLOY_TOKEN` sırrı | `ovurrsl/editor` → Settings → Secrets and variables → Actions | İş akışı digitaltwin'e push edebilsin diye |
| `deploy-bundle.yml` varsayılan dalda | `main` | GitHub `workflow_dispatch`'i yalnız varsayılan daldaki iş akışları için açar. Dosya sadece feature dalındayken tetikleme 404 döner |

`DEPLOY_TOKEN` bir fine-grained PAT'tir ve şu üç ayarın üçü de doğru olmalıdır:

- **Resource owner:** `ovurrsl`
- **Repository access:** Only select repositories → **`ovurrsl/digitaltwin`**
  (`ovurrsl/editor` değil — token'ın yazacağı yer deploy deposudur)
- **Repository permissions → Contents:** **Read and write**
  (`Metadata: Read-only` kendiliğinden gelir)

İzin sonradan düzenlenebilir ve token dizisi değişmez — yani izni düzeltmek
için sırrı yeniden girmek gerekmez.

## Eklentiyi güncelle

1. Yeni SHA'yı al: `ovurrsl/plugin-warehouse` deposunun `main` ucundaki commit.
2. `apps/editor/package.json` içinde satırı güncelle:

   ```
   "@ovurrsl/plugin-warehouse": "git+https://github.com/ovurrsl/plugin-warehouse.git#<YENİ_SHA>"
   ```

3. `bun.lock`'u tazele. **Sandbox'ta `bun install` çalışmaz** — lock her GitHub
   tarball'ının sha512'sini saklar ve bunu ancak gerçek `api.github.com`'a
   ulaşabilen bir makine hesaplayabilir. Bunun için `Relock` iş akışı var:
   `.github/workflows/relock.yml` dosyasının sonundaki yorum satırını değiştirip
   push edin; iş akışı lock'u üretip dalınıza geri iter.

4. Bundle sürümünü yükselt: `.github/deploy/package.json` → `version`.
   Bu dosya digitaltwin'in `package.json`'ı olarak kopyalanır; atlanırsa canlı
   sürüm numarası olduğu yerde kalır ya da geriye düşer.

5. Commit + push.

## Yayınla

`deploy-bundle` iş akışını çalıştır. Üç yolu var:

- **Elle:** Actions sekmesi → *Deploy bundle* → *Run workflow* → dalı seç
- **Kendiliğinden:** `main`'e `apps/editor/**`, `packages/**` veya `bun.lock`
  değiştiren bir push
- **Plugin deposundan:** `repository_dispatch` (tip: `plugin-updated`)

İş akışı sırayla: `bun install --linker=hoisted` → build → standalone bundle
montajı → iki smoke test → digitaltwin main'e force-push.

Smoke testler kasten şunu ölçer:

1. Veritabanı yokken sunucu **açılmamalı** (aksi hâlde host'un sildiği yerel bir
   dosyaya sessizce yazmaya başlar)
2. MySQL varken `/api/health` → `backend:mysql`, `db:ok` dönmeli ve ana sayfa
   yanıt vermeli

Push force'tur, yani digitaltwin'in ağacı tamamen değişir. Orada commit'li duran
`.env` bilerek taşınır (iş akışının *Publish* adımı önce onu okur, sonra yazar) —
panel değişkenleri unutsa bile sunucu ayağa kalksın diye.

## Doğrula

```bash
# iş akışı
curl -s https://api.github.com/repos/ovurrsl/editor/actions/runs/<RUN_ID> \
  | grep -o '"conclusion":"[a-z]*"' | head -1

# deploy deposuna commit düştü mü
curl -s https://api.github.com/repos/ovurrsl/digitaltwin/commits?per_page=1

# canlı
curl -s https://opex.help/api/health
```

Beklenen: `"conclusion":"success"`, `Build from <sha7>` başlıklı yeni commit ve

```json
{"status":"ok","app":"digitaltwin","backend":"mysql","db":"ok","auth":"ok"}
```

Hostinger dağıtımı birkaç dakika sürer. Tarayıcıda sert yenileme yapın.

## Sorun giderme

| Log'da gördüğünüz | Anlamı | Çözüm |
|---|---|---|
| `dispatches: 404 Not Found` | İş akışı varsayılan dalda kayıtlı değil | `deploy-bundle.yml`'ı `main`'e koyun. Tetikleme yine feature dalına yapılabilir; dispatch iş akışının gövdesini ve kopyaladığı dosyaları çalıştırıldığı ref'ten alır |
| `DEPLOY_TOKEN:` boş + `Invalid username or token` | Sır tanımsız | Sırrı ekleyin. GitHub 2021'den beri git yazma için parolayı kabul etmiyor; depo public olsa da token şart |
| `DEPLOY_TOKEN: ***` + `Write access to repository not granted` (403) | Token depoyu görüyor ama yazamıyor | Token'ın `Contents` izni `Read and write` mi, seçili depo `digitaltwin` mi — ikisini de kontrol edin |
| `failed to resolve … api.github.com/repos/pascalorg/… 403` | Sandbox'ın GitHub kapsamı dışında bir bağımlılık | Yerelde çözülemez; `Relock` iş akışını kullanın |

## Dikkat

- **Eklenti kind adı değişirse veri kaybı olur.** Kayıtlı sahneler düğüm tipini
  metin olarak saklar ve registry'de alias desteği yok. Eklentide bir kind
  yeniden adlandırıldıysa yayından önce veritabanına bakın:

  ```sql
  SELECT COUNT(*) FROM scenes WHERE graph_json LIKE '%<eski:kind>%';
  ```

  0 değilse önce `scripts/migrate-legacy-scene.mjs` içindeki dönüşüm
  mekanizmasıyla sahneleri geçirin.

- **`ovurrsl/digitaltwin` private kalmalı.** Kökünde `.env` commit'li: MySQL
  parolası, SMTP parolası, oturum anahtarları. Public yapmak bunları açar ve
  geri almak yetmez — git geçmişinde ve cache'lerde kalır, tek çözüm her sırrı
  değiştirmek olur.

- **Deploy deposuna elle commit atmayın.** Her yayın onu force-push'la baştan
  yazar; oraya yazılan her şey ilk yayında kaybolur.
