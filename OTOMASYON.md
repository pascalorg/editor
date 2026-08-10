# Otomasyon — sistem nasıl çalışıyor

Bu belge, beş deponun birbirine nasıl bağlandığını anlatır. Kod bilgisi
gerektirmez. Teknik ayrıntı ve birleştirme kuralları için: `UPSTREAM.md`.

Buradaki her bilgi, iş akışı dosyalarının kendisinden okunarak ve ikinci bir
kontrol turuyla doğrulanarak yazıldı. Bir iş akışını değiştirirsen bu belgeyi de
güncelle — yanlış belge, hiç belge olmamasından kötüdür.

---

## Büyük resim

```
   pascalorg/editor            Pascal'ın orijinal projesi (bizim değil)
            │
            │  ① her gün 08:00 — otomatik
            ▼
   ovurrsl/editor → main       Pascal'ın saf aynası. Bizim tek commitimiz bile yok.
            │
            │  ② öneri (pull request) açılır — BİRLEŞTİRME KARARI İNSANDA
            ▼
   ovurrsl/editor → integration  ◄── ovurrsl/panel            (③ saat başı, otomatik)
   varsayılan dal; her şey burada ◄── ovurrsl/plugin-warehouse (④ saat başı, otomatik)
            │
            │  ⑤ derle → 2 duman testi → geçerse — otomatik
            ▼
   ovurrsl/Digitaltwin         Sadece derlenmiş çıktı. Buraya kaynak kod girmez.
            │
            ▼
        canlı sunucu
```

**② dışındaki her ok otomatik.** ② bilerek insanda — sebebi aşağıda.

---

## Neden iki dal var

| Dal | Ne işe yarar |
|---|---|
| `main` | Pascal'ın **birebir aynası**. Buraya bizim hiçbir değişikliğimiz yazılmaz. Tam da bu yüzden hiç çakışmaz: ayna sadece ileri sarabilir. |
| `integration` | **Varsayılan dal.** Bizim eklediğimiz her şey burada, ve canlıya giden derleme bundan yapılır. |

GitHub zamanlanmış işleri **yalnızca varsayılan daldan** çalıştırır. `integration`'ın
varsayılan dal olmasının sebebi budur — başka bir dala taşınırsa saat başı çalışan
işlerin hepsi sessizce durur.

Dal adını değiştirmek istersen: depo ayarlarından `INTEGRATION_BRANCH` değişkenini
kur. Bütün iş akışları önce onu okur, yoksa `integration`'a düşer.

---

## Beş depo

| Depo | Ne var içinde | Sen ne yaparsın |
|---|---|---|
| `pascalorg/editor` | Pascal'ın orijinal projesi | Hiçbir şey — bizim değil |
| `ovurrsl/editor` | Fork'umuz. `main` = ayna, `integration` = bizim sürümümüz | Editörün kendisine dokunacaksan `integration`'a commit'lersin |
| `ovurrsl/panel` | Giriş/yönetim panelinin **asıl evi** | Panel değişikliklerini burada yaparsın |
| `ovurrsl/plugin-warehouse` | Depo/raf eklentisi (`warehouse:` düğümleri) | Raf değişikliklerini burada yaparsın |
| `ovurrsl/Digitaltwin` | **Sadece derlenmiş çıktı** | Hiçbir şey. Elle dokunma — her yayında üzerine yazılır |

---

## İş akışları — hangisi ne zaman çalışır

Saatler **UTC**. Türkiye UTC+3, yani parantez içindeki yerel saat.

### Otomatik olanlar

| İş akışı | Ne zaman | Ne yapar |
|---|---|---|
| **`bump-plugin`** | Her saat `:42` | Eklentinin `main`'i ile bizdeki sürüm numarasını karşılaştırır. Farklıysa günceller, kilit dosyasını tazeler, tip kontrolünden geçirir, `integration`'a yazar ve derlemeyi başlatır. |
| **`pull-panel`** | Her saat `:17` | `ovurrsl/panel`'i çeker, `apps/editor/panel` altına yerleştirir, tip kontrolünden geçirir, `integration`'a yazar ve derlemeyi başlatır. |
| **`mirror-upstream`** | Her gün `05:00` (08:00) | `main`'i Pascal'ın son hâline ileri sarar. `integration` geride kaldıysa **öneri açar**. |
| **`deploy-bundle`** | `integration`'a her yazımda | Derler, iki duman testi koşar, geçerse `Digitaltwin`'e yazar. |
| **`upstream-check`** | Pazartesi `06:00` (09:00) | Deneme birleştirmesi yapar, hangi dosyaların çakışacağını rapor eder. Hiçbir şeye yazmaz. |
| **`ci`** | `integration`'a her yazımda ve her öneride | Biome + tip kontrolü. |
| **`mcp-ci`** | Belirli dosyalar değişince | MCP ve sahne API testleri. |

### Elle çalıştırılanlar

| İş akışı | Ne zaman kullanılır |
|---|---|
| **`sync-panel`** | Editördeki panel dosyalarını `ovurrsl/panel`'e **geri** göndermek için. Panel deposunu ilk kez doldurmak içindir; günlük iş bu değil, ters yön (`pull-panel`) otomatiktir. |
| **`relock`** | Bir bağımlılık elle değiştirildiğinde `bun.lock`'u gerçek bir sunucuda yeniden üretmek için. |
| **`release`** | Pascal'ın npm paket yayınlama akışı. Bizim işimiz değil, **çalıştırma.** |

---

## İki anahtar

Bunlar `ovurrsl/editor` → Settings → Secrets and variables → Actions altında durur.

| Anahtar | Kim kullanır | Ne için | Süresi dolarsa |
|---|---|---|---|
| `PANEL_TOKEN` | `pull-panel`, `sync-panel` | `ovurrsl/panel`'i okumak | Panel güncellemeleri durur. `pull-panel` **kırmızı olmaz**, sessizce hiçbir şey yapmaz. |
| `DEPLOY_TOKEN` | `deploy-bundle` | `Digitaltwin`'e yazmak | Derleme geçer, **son adım kırmızı olur**, canlı eski sürümde kalır. |
| `MIRROR_TOKEN` | `mirror-upstream` | `main`'i ileri sarmak ve entegrasyon PR'ını açmak | Ayna durur, **kırmızı olur**. Upstream biriktikçe birikir ama canlıya hiçbir etkisi olmaz — o yüzden fark edilmesi günler alabilir. |

`bump-plugin` ve `upstream-check` **hiçbir anahtar kullanmaz** — eklenti deposu
herkese açık, Pascal'ın deposu herkese açık.

> **`MIRROR_TOKEN` neden yerleşik anahtarla olmuyor.** Ayna, upstream'in
> commit'lerini `main`'e iter. Upstream ara sıra kendi `.github/workflows/ci.yml`
> dosyasını değiştiriyor, ve GitHub yerleşik `GITHUB_TOKEN`'ın workflow dosyası
> yazmasını reddediyor:
>
> ```
> ! [remote rejected] upstream/main -> main (refusing to allow a GitHub App to
>   create or update workflow `.github/workflows/ci.yml` without `workflows`
>   permission)
> ```
>
> `permissions:` bloğunda verilebilecek bir `workflows` kapsamı YOK; bu izin
> yalnız PAT'ta ya da App kurulumunda var. Bu yüzden anahtar fine-grained bir
> PAT ve üç izne ihtiyacı var: **Contents** (yazma), **Workflows** (yazma),
> **Pull requests** (yazma). Kapsamı tek depo: `ovurrsl/editor`.
>
> Bu bir kez ısırdı: ayna aylarca yeşil koştu, 7 Ağustos'ta upstream'in ilk
> `ci.yml` değişikliğine çarptı ve ondan sonraki her gece kırmızı yandı. Dört
> gün fark edilmedi çünkü başka hiçbir şey bozulmadı — editör, hareket etmeyi
> sessizce bırakmış bir aynadan derlenmeye devam etti.

> Süresi dolan bir anahtarı yenilerken: GitHub anahtarın değerini yalnız
> oluşturulduğu an bir kez gösterir. `Regenerate token` → çıkan `github_pat_…`
> yazısını kopyala → yukarıdaki gizli anahtar kutusuna yapıştır. Anahtarın
> ayarlar sayfasını düzeltmek yetmez; kutudaki **değerin** de yenilenmesi gerekir.

---

## Güvenlik kapısı

Her otomatik yol aynı kapıdan geçer: **`deploy-bundle`.**

1. `bun run build` — derleme
2. **Duman testi 1:** veritabanı yokken sunucu açılmayı reddediyor mu?
3. **Duman testi 2:** gerçek MySQL'e karşı sağlık kontrolü yanıt veriyor mu?
4. Üçü de geçtiyse → `Digitaltwin`'e yazılır

Biri geçmezse yayın durur ve **canlıdaki çalışan sürüm yerinde kalır.** Bozuk bir
şeyin canlıya ulaşmamasının sebebi budur.

Ayrıca `bump-plugin` ve `pull-panel` kendi içlerinde `bun run check-types`
koşar — derlemeyi hiç başlatmadan önce. Derlenmeyen bir değişiklik `integration`
dalına yazılmaz bile.

---

## Tek elle yapılan iş: Pascal güncellemesi

`main` hiç çakışmaz, çünkü orada bizim hiçbir şeyimiz yok. Ama `integration`'da
bizim 130'dan fazla commitimiz var ve Pascal aynı dosyalara dokunduğunda çakışma
çıkar — beta.4 denemesinde 185 dosya sorunsuz birleşti, **12 dosya çakıştı.**

İkisi kritik:

- **`apps/editor/next.config.ts`** — bizim `output: 'standalone'` ayarımız.
  Silinirse `deploy-bundle` hiç derleyemez.
- **`apps/editor/package.json`** — eklenti sürüm pinimiz. Pascal'da böyle bir
  bağımlılık yok; toptan "onlarınkini al" denirse **raflar sessizce kaybolur.**

Bir makine bu kararı veremez. Dosya dosya kurallar `UPSTREAM.md` içinde.

---

## Bir şey ters giderse — nereye bakılır

| Belirti | Muhtemel sebep | Bakılacak yer |
|---|---|---|
| Canlı güncellenmiyor, derleme yeşil | `DEPLOY_TOKEN` süresi dolmuş | `deploy-bundle` çalışmasının son adımı (`Publish`) |
| Eklenti değişikliği canlıya gelmiyor | `bump-plugin` pini bulamıyor | O çalışmanın `Compare the pin` adımı |
| Panel değişikliği gelmiyor | `PANEL_TOKEN` yok veya süresi dolmuş | `pull-panel` çalışmasının ilk adımı — "PANEL_TOKEN is not set" yazar |
| Hiçbir zamanlanmış iş çalışmıyor | Varsayılan dal değişmiş | Settings → Branches → default branch `integration` mı? |
| Pascal güncellemesi görünmüyor | Öneri açılmamış | Actions → `Mirror upstream` → elle çalıştır |

Bütün çalışmalar burada: **https://github.com/ovurrsl/editor/actions**
