import { dictionaryFor } from '@panel/lib/i18n'
import type { Lang } from '@panel/lib/types'
import type { Metadata } from 'next'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'User guide' }

/**
 * The user guide the sign-in screen has always linked to. Written here
 * rather than fetched, so it works before anyone has an account — which is
 * the point: a new colleague reads what the system is before requesting
 * access.
 */

interface Section {
  title: string
  steps: string[]
}

const EN: { lead: string; sections: Section[] } = {
  lead: 'How DigitalTwin fits together, and what to do on your first day.',
  sections: [
    {
      title: 'Getting an account',
      steps: [
        'Accounts are issued by an administrator — use “Request access” on the sign-in screen and you will get an email once it is approved.',
        'The invitation email carries a temporary password. The first sign-in makes you choose your own, and the temporary one dies at that moment.',
        'If two-factor authentication is required, you enrol it right after setting your password, with any authenticator app.',
        'Forgotten passwords are self-service: “Forgot password” on the sign-in screen mails a single-use link valid for 30 minutes.',
      ],
    },
    {
      title: 'What you see after signing in',
      steps: [
        'Editors and administrators land in the 3D editor, at the site’s own address.',
        'View-only accounts land on their scene list, and scenes open in preview — you can look around and measure, but nothing is saved.',
        'Administrators also reach the console, which holds accounts, roles, sites, the audit trail and the job queue.',
      ],
    },
    {
      title: 'Drawing a scene',
      steps: [
        'Build tab: walls, floors, doors and windows. Draw a wall by clicking its start and end; press C to close a room automatically.',
        'Items tab: the catalogue — furniture, equipment and, with the warehouse plugin, pallets, racking and conveyors.',
        'Switch between 3D, 2D and split view from the top-left; Display collects grid, measurements, units and shading.',
        'Preview hides every editing control, which is what to use when showing the model to someone.',
        'Work saves itself as you go. “All scenes” takes you back to your list.',
      ],
    },
    {
      title: 'Importing an existing model',
      steps: [
        'Scenes list → “Import IFC” accepts an IFC file exported from Revit, ArchiCAD or similar.',
        'Conversion happens in your browser, so the file never leaves your machine until the resulting scene is saved.',
        'Large models take a while to convert — leave the tab open until it finishes.',
      ],
    },
    {
      title: 'Projects and publishing',
      steps: [
        'Everything you draw is a private draft: only you (and administrators) can see it.',
        'An administrator publishes a finished project, which puts it on the console’s Sites & Projects screen as an approved site.',
        'Withdrawing a published project removes its card only — the scene and its history stay exactly where they were.',
      ],
    },
    {
      title: 'Getting help',
      steps: [
        'The changelog lists what shipped, and when.',
        'For access problems, a lost second factor or anything account-shaped, contact an administrator — they can reset both from the console.',
      ],
    },
  ],
}

const TR: { lead: string; sections: Section[] } = {
  lead: 'DigitalTwin’in parçaları nasıl birleşiyor ve ilk gün ne yapmalısınız.',
  sections: [
    {
      title: 'Hesap edinme',
      steps: [
        'Hesaplar yönetici tarafından açılır — giriş ekranındaki “Hesap talebi oluştur” ile başvurun, onaylandığında e-posta alırsınız.',
        'Davet e-postasında geçici bir şifre gelir. İlk girişte kendi şifrenizi belirlersiniz; geçici şifre o anda geçersiz olur.',
        'İki adımlı doğrulama zorunluysa, şifrenizi belirledikten hemen sonra herhangi bir doğrulayıcı uygulamayla kaydolursunuz.',
        'Şifrenizi unutursanız giriş ekranındaki “Şifremi unuttum” 30 dakika geçerli, tek kullanımlık bir bağlantı gönderir.',
      ],
    },
    {
      title: 'Giriş sonrası ne görürsünüz',
      steps: [
        'Editör ve yönetici hesapları doğrudan 3B editöre düşer; adres çubuğunda yalnız alan adı görünür.',
        'Yalnız-izleme hesapları sahne listesine düşer ve sahneler önizleme modunda açılır — gezip ölçebilirsiniz ama kayıt yapılmaz.',
        'Yöneticiler ayrıca konsola erişir: hesaplar, roller, sahalar, denetim kaydı ve iş kuyruğu oradadır.',
      ],
    },
    {
      title: 'Sahne çizmek',
      steps: [
        'Yapı sekmesi: duvar, döşeme, kapı ve pencere. Duvarı başlangıç ve bitiş noktasına tıklayarak çizersiniz; C tuşu odayı otomatik kapatır.',
        'Nesneler sekmesi: katalog — mobilya, ekipman ve depo eklentisiyle palet, raf ve konveyörler.',
        'Sol üstten 3B, 2B ve bölünmüş görünüm arasında geçiş yapılır; Görünüm menüsü ızgara, ölçü, birim ve gölgelendirmeyi toplar.',
        'Önizleme tüm düzenleme araçlarını gizler — modeli birine gösterirken bunu kullanın.',
        'Çalışmanız kendiliğinden kaydedilir. “Tüm sahneler” sizi listenize götürür.',
      ],
    },
    {
      title: 'Var olan modeli içe aktarmak',
      steps: [
        'Sahneler listesi → “IFC içe aktar”, Revit veya ArchiCAD gibi araçlardan dışa aktarılmış IFC dosyalarını kabul eder.',
        'Dönüştürme tarayıcınızda yapılır; dosya, oluşan sahne kaydedilene kadar bilgisayarınızdan çıkmaz.',
        'Büyük modellerin dönüşümü zaman alır — bitene kadar sekmeyi açık bırakın.',
      ],
    },
    {
      title: 'Projeler ve yayınlama',
      steps: [
        'Çizdiğiniz her şey özel taslaktır: yalnız siz (ve yöneticiler) görebilir.',
        'Biten projeyi yönetici yayınlar; proje konsoldaki Siteler ve Projeler ekranında onaylı saha olarak görünür.',
        'Yayından geri çekmek yalnız kartı kaldırır — sahne ve geçmişi olduğu yerde kalır.',
      ],
    },
    {
      title: 'Yardım',
      steps: [
        'Sürüm notları neyin ne zaman yayınlandığını listeler.',
        'Erişim sorunları, kaybolan ikinci adım veya hesapla ilgili her şey için yöneticinize başvurun — ikisini de konsoldan sıfırlayabilir.',
      ],
    },
  ],
}

export default async function GuidesPage() {
  const jar = await cookies()
  const lang: Lang = jar.get('digitaltwin_lang')?.value === 'tr' ? 'tr' : 'en'
  const t = dictionaryFor(lang)
  const content = lang === 'tr' ? TR : EN

  return (
    <article className="flex flex-col gap-7">
      <header className="flex flex-col gap-[6px]">
        <h1 className="m-0 font-semibold text-[22px] tracking-[-0.015em]">{t.qlGuides}</h1>
        <p className="m-0 text-[13.5px] text-muted-fg leading-[1.6]">{content.lead}</p>
      </header>

      {content.sections.map((section, index) => (
        <section className="flex flex-col gap-[10px]" key={section.title}>
          <h2 className="m-0 flex items-baseline gap-[9px] font-semibold text-[15px] tracking-[-0.01em]">
            <span className="font-mono text-[11px] text-brand-fg">
              {String(index + 1).padStart(2, '0')}
            </span>
            {section.title}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-[7px] p-0">
            {section.steps.map((step) => (
              <li
                className="rounded-[10px] border border-border bg-surface px-[13px] py-[10px] text-[13px] leading-[1.6]"
                key={step}
              >
                {step}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  )
}
