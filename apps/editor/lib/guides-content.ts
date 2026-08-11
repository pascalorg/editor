import type { Lang } from '@panel/lib/types'

/**
 * The documentation, as data.
 *
 * Written for this deployment rather than adapted from an upstream manual:
 * every page describes something that exists here — the console's accounts
 * and roles, the warehouse plugin, publishing to Sites & Projects — and
 * nothing that does not. Text only, no screenshots: images would have to be
 * recaptured on every release, and a stale screenshot teaches the wrong
 * interface.
 */

export interface GuideBlock {
  /** Section heading inside a page. */
  heading: string
  /** Prose paragraphs. */
  body?: string[]
  /** Bulleted points. */
  points?: string[]
  /** Two-column reference table, e.g. shortcuts. */
  table?: { columns: [string, string]; rows: [string, string][] }
}

export interface GuidePage {
  slug: string
  title: string
  description: string
  blocks: GuideBlock[]
}

export interface GuideGroup {
  title: string
  pages: GuidePage[]
}

export interface GuidesContent {
  /** Index page. */
  title: string
  lead: string[]
  startHere: string
  explore: string
  groups: GuideGroup[]
}

const EN: GuidesContent = {
  title: 'Welcome to DigitalTwin',
  lead: [
    'DigitalTwin is a 3D building editor that runs in your browser — draw warehouses and buildings, furnish them from a catalogue, walk through them, and share the result with your colleagues.',
    'Everything you draw is saved to your own account on your own server. An administrator decides who may edit, who may only look, and which projects are published to the whole organisation.',
    'This guide is readable without an account. If you do not have one yet, use “Request access” on the sign-in screen.',
  ],
  startHere: 'Start here',
  explore: 'Explore the features',
  groups: [
    {
      title: 'Getting started',
      pages: [
        {
          slug: 'your-first-scene',
          title: 'Your first scene',
          description: 'Draw a room, add a door and a window, and place your first items.',
          blocks: [
            {
              heading: 'Create the scene',
              body: [
                'Open the Scenes tab in the left sidebar and choose “New scene”. You land in an empty editor with a ground floor already prepared.',
              ],
            },
            {
              heading: 'Draw the walls',
              points: [
                'Open the Build tab in the left sidebar and pick the wall tool.',
                'Click once where the wall starts and once where it ends — the length is shown live as you move.',
                'Press C while drawing to close the room automatically back to your first point.',
                'Press Esc to cancel a wall you have started but not finished.',
              ],
            },
            {
              heading: 'Add a door and a window',
              body: [
                'Still in the Build tab, choose the door or window and click on a wall. The opening is cut into the wall for real, and you can slide it along the wall afterwards or type an exact size in the properties panel.',
              ],
            },
            {
              heading: 'Place items',
              body: [
                'The Items tab holds the catalogue. Pick a category, then click in the scene to place. Items snap to walls and stack on top of each other where that makes sense.',
              ],
            },
            {
              heading: 'Saving',
              body: [
                'There is no save button: your work is written to the server as you go, and the Scenes tab in the left sidebar shows when each scene was last touched.',
              ],
            },
          ],
        },
        {
          slug: 'interface-tour',
          title: 'Interface tour',
          description: 'What each region of the editor does.',
          blocks: [
            {
              heading: 'Left sidebar',
              points: [
                'Scene — the structure of what you have built, level by level.',
                'Build — walls, floors, doors, windows, roofs and stairs.',
                'Items — the catalogue of furniture and equipment.',
                'Scenes — every scene you have saved: open one, start a new one, or import an IFC model.',
                'Settings — per-scene preferences.',
              ],
            },
            {
              heading: 'Top-left toolbar',
              points: [
                '3D / 2D / Split — how the scene is shown. Split puts the plan and the model side by side.',
                'The « button collapses the sidebar when you need the full width.',
              ],
            },
            {
              heading: 'Top-right toolbar',
              points: [
                'Stack — how levels are shown: stacked, exploded, or one at a time.',
                'Full height — how walls are drawn: full, cut away, low, or translucent.',
                'Display — grid, measurements, units, camera mode, shading, scene theme and shadows.',
                'Walkthrough — first-person movement inside the model.',
                'Preview — hides every editing control. Use it when showing the model to someone.',
              ],
            },
            {
              heading: 'Bottom toolbar',
              body: [
                'The active tools for what you are doing: select, move, measure, delete, and the placement helpers. The letter under each icon is its keyboard shortcut.',
              ],
            },
          ],
        },
        {
          slug: 'keyboard-shortcuts',
          title: 'Keyboard shortcuts',
          description: 'The keys worth learning first.',
          blocks: [
            {
              heading: 'Tools',
              table: {
                columns: ['Shortcut', 'Action'],
                rows: [
                  ['V', 'Select tool'],
                  ['M', 'Measure'],
                  ['Z', 'Orbit / zoom the camera'],
                  ['X', 'Delete the selection'],
                ],
              },
            },
            {
              heading: 'Drawing',
              table: {
                columns: ['Shortcut', 'Action'],
                rows: [
                  ['C', 'Close the room automatically'],
                  ['Ctrl', 'Hold to change the snapping grid'],
                  ['Esc', 'Cancel what you are drawing'],
                ],
              },
            },
            {
              heading: 'Editing',
              table: {
                columns: ['Shortcut', 'Action'],
                rows: [
                  ['Cmd/Ctrl + Z', 'Undo'],
                  ['Cmd/Ctrl + Shift + Z', 'Redo'],
                  ['Cmd/Ctrl + C / V', 'Copy and paste the selection'],
                ],
              },
            },
          ],
        },
      ],
    },
    {
      title: 'Building',
      pages: [
        {
          slug: 'walls-and-rooms',
          title: 'Walls and rooms',
          description: 'Draw straight and curved walls with live measurements and snapping.',
          blocks: [
            {
              heading: 'Drawing',
              points: [
                'Two clicks make a wall: start and end. The length and angle follow the cursor as you move.',
                'Walls snap to the grid and to the ends of other walls, so corners meet cleanly.',
                'Hold Ctrl to change the snap step while drawing.',
                'C closes the outline back to your starting point and makes a room of it.',
              ],
            },
            {
              heading: 'Changing a wall',
              body: [
                'Select a wall to edit its thickness, height and material. Drag its ends to move them; the walls attached to it follow.',
              ],
            },
            {
              heading: 'How walls are shown',
              body: [
                'The “Full height” control in the top-right toolbar decides how walls appear while you work: full height, cut away at eye level, low, or translucent. It changes only the view, never the model.',
              ],
            },
          ],
        },
        {
          slug: 'doors-and-windows',
          title: 'Doors and windows',
          description: 'Openings that are cut into the wall, and can be sized exactly.',
          blocks: [
            {
              heading: 'Placing',
              body: [
                'Choose a door or window in the Build tab and click on a wall. The opening is cut through the wall, so it is visible from both sides and in the plan view.',
              ],
            },
            {
              heading: 'Adjusting',
              points: [
                'Drag along the wall to reposition.',
                'Type exact width, height and sill height in the properties panel.',
                'Flip the opening direction where a door’s swing matters.',
              ],
            },
          ],
        },
        {
          slug: 'floors-and-levels',
          title: 'Floors and levels',
          description: 'Stack storeys, switch between them, and shape floor slabs.',
          blocks: [
            {
              heading: 'Levels',
              body: [
                'A scene starts with a ground floor. Add levels above or below it from the level selector at the top-left of the viewport, and switch which one you are editing there too.',
              ],
            },
            {
              heading: 'Seeing several levels at once',
              body: [
                'The “Stack” control decides how levels are drawn together: stacked as a real building, exploded apart to see each one, or solo — only the level you are working on.',
              ],
            },
          ],
        },
        {
          slug: 'roofs-and-stairs',
          title: 'Roofs and stairs',
          description: 'Cover the building and connect its levels.',
          blocks: [
            {
              heading: 'Roofs',
              body: [
                'Draw a roof footprint, then choose the roof type and adjust pitch and overhang. The roof follows the outline, so changing the walls under it updates its shape.',
              ],
            },
            {
              heading: 'Stairs',
              body: [
                'Stairs are placed like any other item and connect the level you are on to the one above. Their run and step height can be set exactly in the properties panel.',
              ],
            },
          ],
        },
      ],
    },
    {
      title: 'Items and materials',
      pages: [
        {
          slug: 'finding-and-placing-items',
          title: 'Finding and placing items',
          description: 'Browse the catalogue, place, arrange and duplicate.',
          blocks: [
            {
              heading: 'Finding',
              body: [
                'The Items tab groups the catalogue by category. Pick a category to see what is in it; the same catalogue is available in every scene.',
              ],
            },
            {
              heading: 'Placing and arranging',
              points: [
                'Click in the scene to place. Items snap to walls and to the surfaces of other items.',
                'Select an item to move, rotate or scale it with the handles in the scene, or to type exact numbers.',
                'Copy and paste repeats an item with the same configuration.',
              ],
            },
          ],
        },
        {
          slug: 'materials-and-paint',
          title: 'Materials and paint',
          description: 'Give walls, floors and furniture their finish.',
          blocks: [
            {
              heading: 'Painting a surface',
              body: [
                'Select a wall, floor or item and choose a material from its properties. The change is per surface, so one wall can differ from the rest of the room.',
              ],
            },
            {
              heading: 'How it is drawn',
              body: [
                'The Display menu switches between solid shading, which is fast and flat, and rendered shading, which adds ambient occlusion and reads much better in presentations.',
              ],
            },
          ],
        },
        {
          slug: 'warehouse-equipment',
          title: 'Warehouse equipment',
          description: 'Pallets, racking, conveyors and the capacity panel.',
          blocks: [
            {
              heading: 'What the plugin adds',
              points: [
                'Pallets in EPAL, GMA and plastic sizes.',
                'Pallet racking with per-bay tunnels, skips and picking levels, following EN 15620 tables.',
                'Roller conveyor modules with 45°, 90° and 180° curves.',
              ],
            },
            {
              heading: 'Capacity and clashes',
              body: [
                'The equipment carries a capacity and clash panel: it counts what fits and flags where two pieces of equipment occupy the same space, which is the check worth doing before a layout leaves the screen.',
              ],
            },
          ],
        },
      ],
    },
    {
      title: 'Projects and access',
      pages: [
        {
          slug: 'scenes-and-publishing',
          title: 'Scenes and publishing',
          description: 'Private drafts, and the projects an administrator approves.',
          blocks: [
            {
              heading: 'Your scenes are drafts',
              body: [
                'Everything you draw belongs to you. Your scene list shows only your own work; other people cannot see it, and administrators can see it only from the console.',
              ],
            },
            {
              heading: 'Publishing',
              body: [
                'When a project is finished, an administrator publishes it. A published project appears on Sites & Projects as an approved site, which is the catalogue the whole organisation reads.',
              ],
            },
            {
              heading: 'Withdrawing',
              body: [
                'Withdrawing a published project removes its card from Sites & Projects and nothing else — the scene, its contents and its history stay exactly where they were.',
              ],
            },
          ],
        },
        {
          slug: 'importing-ifc',
          title: 'Importing an IFC model',
          description: 'Bring in a model exported from Revit, ArchiCAD or similar.',
          blocks: [
            {
              heading: 'How to import',
              body: [
                'Open the Scenes tab in the left sidebar and choose “Import IFC”, then pick the .ifc file. A new scene is created from it and opens when the conversion finishes.',
              ],
            },
            {
              heading: 'What to expect',
              points: [
                'Conversion runs inside your browser — the file is not uploaded anywhere until the resulting scene is saved.',
                'Large models take a while; leave the tab open until it completes.',
                'Geometry and structure come across. Vendor-specific parametric behaviour does not, so expect to tidy up.',
              ],
            },
          ],
        },
        {
          slug: 'accounts-and-roles',
          title: 'Accounts and roles',
          description: 'Signing in, what each role may do, and two-factor authentication.',
          blocks: [
            {
              heading: 'Getting an account',
              points: [
                'Accounts are issued by an administrator. Use “Request access” on the sign-in screen and you will be emailed when it is approved.',
                'The invitation carries a temporary password; your first sign-in makes you choose your own, and the temporary one dies at that moment.',
                'If two-factor authentication is required, you enrol it right after setting your password, with any authenticator app.',
                '“Forgot password” mails a single-use link that is valid for 30 minutes.',
              ],
            },
            {
              heading: 'What each role may do',
              table: {
                columns: ['Role', 'What it allows'],
                rows: [
                  ['Viewer', 'Open scenes in preview: look around and measure, but never save'],
                  ['Editor', 'Create and edit their own scenes'],
                  [
                    'Administrator',
                    'Everything, plus the console: accounts, roles, sites, publishing, audit',
                  ],
                ],
              },
            },
            {
              heading: 'Sessions',
              body: [
                'A session ends by itself after a period of inactivity set by your administrator. You can see and revoke your own devices from the console’s Sessions screen.',
              ],
            },
          ],
        },
      ],
    },
  ],
}

const TR: GuidesContent = {
  title: 'DigitalTwin’e hoş geldiniz',
  lead: [
    'DigitalTwin, tarayıcıda çalışan bir 3B yapı editörüdür — depo ve bina çizer, katalogdan donatır, içinde gezer ve sonucu iş arkadaşlarınızla paylaşırsınız.',
    'Çizdiğiniz her şey kendi sunucunuzdaki kendi hesabınıza kaydedilir. Kimin düzenleyebileceğine, kimin yalnız izleyeceğine ve hangi projelerin tüm kuruma yayınlanacağına yönetici karar verir.',
    'Bu kılavuz hesapsız da okunabilir. Henüz hesabınız yoksa giriş ekranındaki “Hesap talebi oluştur” bağlantısını kullanın.',
  ],
  startHere: 'Buradan başlayın',
  explore: 'Özellikleri keşfedin',
  groups: [
    {
      title: 'Başlarken',
      pages: [
        {
          slug: 'your-first-scene',
          title: 'İlk sahneniz',
          description: 'Bir oda çizin, kapı ve pencere ekleyin, ilk nesnelerinizi yerleştirin.',
          blocks: [
            {
              heading: 'Sahneyi oluşturun',
              body: [
                'Sol kenar çubuğundaki Sahneler sekmesini açıp “Yeni sahne” deyin. Zemin katı hazır, boş bir editöre düşersiniz.',
              ],
            },
            {
              heading: 'Duvarları çizin',
              points: [
                'Sol kenar çubuğundaki Yapı sekmesini açıp duvar aracını seçin.',
                'Duvarın başlayacağı yere bir, biteceği yere bir kez tıklayın — uzunluk imleçle birlikte canlı görünür.',
                'Çizerken C tuşuna basarsanız oda ilk noktaya kadar kendiliğinden kapanır.',
                'Başlayıp bitirmediğiniz bir duvarı Esc ile iptal edersiniz.',
              ],
            },
            {
              heading: 'Kapı ve pencere ekleyin',
              body: [
                'Yine Yapı sekmesinde kapıyı veya pencereyi seçip bir duvara tıklayın. Boşluk duvara gerçekten açılır; sonrasında duvar boyunca kaydırabilir ya da özellikler panelinden tam ölçü yazabilirsiniz.',
              ],
            },
            {
              heading: 'Nesne yerleştirin',
              body: [
                'Katalog Nesneler sekmesindedir. Bir kategori seçip sahneye tıklayarak yerleştirirsiniz. Nesneler duvarlara yapışır, uygun olan yerlerde üst üste istiflenir.',
              ],
            },
            {
              heading: 'Kaydetme',
              body: [
                'Kaydet düğmesi yoktur: çalışmanız siz çizdikçe sunucuya yazılır ve sol kenar çubuğundaki Sahneler sekmesi her sahnenin en son ne zaman değiştiğini gösterir.',
              ],
            },
          ],
        },
        {
          slug: 'interface-tour',
          title: 'Arayüz turu',
          description: 'Editörün her bölgesi ne işe yarar.',
          blocks: [
            {
              heading: 'Sol kenar çubuğu',
              points: [
                'Sahne — kat kat, ne inşa ettiğinizin yapısı.',
                'Yapı — duvar, döşeme, kapı, pencere, çatı ve merdiven.',
                'Nesneler — mobilya ve ekipman kataloğu.',
                'Sahneler — kaydettiğiniz bütün sahneler: birini açın, yenisini başlatın ya da IFC modeli içe aktarın.',
                'Ayarlar — sahneye özel tercihler.',
              ],
            },
            {
              heading: 'Sol üst araç çubuğu',
              points: [
                '3B / 2B / Bölünmüş — sahnenin nasıl gösterileceği. Bölünmüş, planla modeli yan yana koyar.',
                '« düğmesi tam genişlik gerektiğinde kenar çubuğunu toplar.',
              ],
            },
            {
              heading: 'Sağ üst araç çubuğu',
              points: [
                'İstif — katların gösterimi: üst üste, patlatılmış ya da tek kat.',
                'Tam yükseklik — duvarların çizimi: tam, kesitli, alçak veya yarı saydam.',
                'Görünüm — ızgara, ölçüler, birimler, kamera kipi, gölgelendirme, sahne teması ve gölgeler.',
                'Gezinti — modelin içinde birinci şahıs hareket.',
                'Önizleme — bütün düzenleme araçlarını gizler. Modeli birine gösterirken bunu kullanın.',
              ],
            },
            {
              heading: 'Alt araç çubuğu',
              body: [
                'Yaptığınız işe göre etkin araçlar: seçme, taşıma, ölçme, silme ve yerleştirme yardımcıları. Her simgenin altındaki harf, klavye kısayoludur.',
              ],
            },
          ],
        },
        {
          slug: 'keyboard-shortcuts',
          title: 'Klavye kısayolları',
          description: 'Önce öğrenmeye değer tuşlar.',
          blocks: [
            {
              heading: 'Araçlar',
              table: {
                columns: ['Kısayol', 'İşlev'],
                rows: [
                  ['V', 'Seçme aracı'],
                  ['M', 'Ölçüm'],
                  ['Z', 'Kamerayı döndür / yakınlaştır'],
                  ['X', 'Seçimi sil'],
                ],
              },
            },
            {
              heading: 'Çizim',
              table: {
                columns: ['Kısayol', 'İşlev'],
                rows: [
                  ['C', 'Odayı otomatik kapat'],
                  ['Ctrl', 'Basılı tutunca yapışma adımı değişir'],
                  ['Esc', 'Çizdiğinizi iptal edin'],
                ],
              },
            },
            {
              heading: 'Düzenleme',
              table: {
                columns: ['Kısayol', 'İşlev'],
                rows: [
                  ['Cmd/Ctrl + Z', 'Geri al'],
                  ['Cmd/Ctrl + Shift + Z', 'İleri al'],
                  ['Cmd/Ctrl + C / V', 'Seçimi kopyala ve yapıştır'],
                ],
              },
            },
          ],
        },
      ],
    },
    {
      title: 'İnşa',
      pages: [
        {
          slug: 'walls-and-rooms',
          title: 'Duvarlar ve odalar',
          description: 'Canlı ölçü ve yapışmayla düz veya eğri duvar çizin.',
          blocks: [
            {
              heading: 'Çizim',
              points: [
                'Bir duvar iki tıklamadır: başlangıç ve bitiş. Uzunluk ve açı imleci izler.',
                'Duvarlar ızgaraya ve diğer duvarların uçlarına yapışır; köşeler temiz birleşir.',
                'Çizerken Ctrl basılı tutmak yapışma adımını değiştirir.',
                'C, ana hattı başlangıç noktasına kapatıp odaya dönüştürür.',
              ],
            },
            {
              heading: 'Duvarı değiştirmek',
              body: [
                'Bir duvarı seçince kalınlığını, yüksekliğini ve malzemesini düzenlersiniz. Uçlarını sürüklerseniz ona bağlı duvarlar da takip eder.',
              ],
            },
            {
              heading: 'Duvarların gösterimi',
              body: [
                'Sağ üstteki “Tam yükseklik” denetimi, çalışırken duvarların nasıl görüneceğini belirler: tam, göz hizasından kesitli, alçak veya yarı saydam. Yalnız görünümü değiştirir, modele dokunmaz.',
              ],
            },
          ],
        },
        {
          slug: 'doors-and-windows',
          title: 'Kapılar ve pencereler',
          description: 'Duvara gerçekten açılan, tam ölçülendirilebilen boşluklar.',
          blocks: [
            {
              heading: 'Yerleştirme',
              body: [
                'Yapı sekmesinden kapı ya da pencere seçip bir duvara tıklayın. Boşluk duvarı baştan başa keser; iki yüzden de ve plan görünümünde görünür.',
              ],
            },
            {
              heading: 'Ayarlama',
              points: [
                'Duvar boyunca sürükleyerek konumlandırın.',
                'Özellikler panelinden tam genişlik, yükseklik ve denizlik yüksekliği yazın.',
                'Kapı açılış yönünün önemli olduğu yerlerde yönü çevirin.',
              ],
            },
          ],
        },
        {
          slug: 'floors-and-levels',
          title: 'Döşemeler ve katlar',
          description: 'Katları istifleyin, aralarında geçin, döşemeyi biçimlendirin.',
          blocks: [
            {
              heading: 'Katlar',
              body: [
                'Sahne zemin katla başlar. Görünümün sol üstündeki kat seçicisinden üstüne ya da altına kat eklersiniz; hangi katı düzenlediğinizi de oradan değiştirirsiniz.',
              ],
            },
            {
              heading: 'Birden çok katı birlikte görmek',
              body: [
                '“İstif” denetimi katların birlikte nasıl çizileceğine karar verir: gerçek bina gibi üst üste, her birini görmek için patlatılmış ya da tek — yalnız üzerinde çalıştığınız kat.',
              ],
            },
          ],
        },
        {
          slug: 'roofs-and-stairs',
          title: 'Çatılar ve merdivenler',
          description: 'Binayı örtün ve katlarını birbirine bağlayın.',
          blocks: [
            {
              heading: 'Çatılar',
              body: [
                'Çatı ana hattını çizin, sonra çatı tipini seçip eğim ve saçak taşmasını ayarlayın. Çatı ana hattı izler; altındaki duvarları değiştirince biçimi güncellenir.',
              ],
            },
            {
              heading: 'Merdivenler',
              body: [
                'Merdiven de diğer nesneler gibi yerleştirilir ve bulunduğunuz katı üsttekine bağlar. Basamak sayısı ve yüksekliği özellikler panelinden tam olarak verilebilir.',
              ],
            },
          ],
        },
      ],
    },
    {
      title: 'Nesneler ve malzemeler',
      pages: [
        {
          slug: 'finding-and-placing-items',
          title: 'Nesne bulmak ve yerleştirmek',
          description: 'Katalogda gezinin, yerleştirin, düzenleyin, çoğaltın.',
          blocks: [
            {
              heading: 'Bulmak',
              body: [
                'Nesneler sekmesi kataloğu kategorilere ayırır. Kategoriye tıklayınca içindekiler görünür; aynı katalog her sahnede vardır.',
              ],
            },
            {
              heading: 'Yerleştirmek ve düzenlemek',
              points: [
                'Yerleştirmek için sahneye tıklayın. Nesneler duvarlara ve diğer nesnelerin yüzeylerine yapışır.',
                'Seçtiğiniz nesneyi sahnedeki tutamaklarla taşıyın, döndürün, ölçeklendirin ya da tam sayı yazın.',
                'Kopyala-yapıştır, nesneyi aynı ayarlarla tekrarlar.',
              ],
            },
          ],
        },
        {
          slug: 'materials-and-paint',
          title: 'Malzemeler ve boya',
          description: 'Duvara, döşemeye ve mobilyaya kaplamasını verin.',
          blocks: [
            {
              heading: 'Bir yüzeyi boyamak',
              body: [
                'Duvarı, döşemeyi veya nesneyi seçip özelliklerinden malzeme seçin. Değişiklik yüzey bazındadır; bir duvar odanın geri kalanından farklı olabilir.',
              ],
            },
            {
              heading: 'Nasıl çizildiği',
              body: [
                'Görünüm menüsü, hızlı ve düz olan katı gölgelendirme ile ortam gölgelemesi ekleyen ve sunumlarda çok daha iyi duran kaliteli gölgelendirme arasında geçiş yapar.',
              ],
            },
          ],
        },
        {
          slug: 'warehouse-equipment',
          title: 'Depo ekipmanları',
          description: 'Paletler, raflar, konveyörler ve kapasite paneli.',
          blocks: [
            {
              heading: 'Eklentinin getirdikleri',
              points: [
                'EPAL, GMA ve plastik ölçülerde paletler.',
                'Göz bazında tünel, atlama ve toplama seviyeleri olan palet rafları; EN 15620 tablolarına uygun.',
                '45°, 90° ve 180° virajlı rulolu konveyör modülleri.',
              ],
            },
            {
              heading: 'Kapasite ve çakışma',
              body: [
                'Ekipman bir kapasite ve çakışma paneliyle gelir: neyin sığdığını sayar, iki ekipmanın aynı hacmi paylaştığı yerleri işaretler — bir yerleşim planı ekrandan çıkmadan önce yapılması gereken kontrol budur.',
              ],
            },
          ],
        },
      ],
    },
    {
      title: 'Projeler ve erişim',
      pages: [
        {
          slug: 'scenes-and-publishing',
          title: 'Sahneler ve yayınlama',
          description: 'Özel taslaklar ve yöneticinin onayladığı projeler.',
          blocks: [
            {
              heading: 'Sahneleriniz taslaktır',
              body: [
                'Çizdiğiniz her şey size aittir. Sahne listeniz yalnız sizin çalışmanızı gösterir; başkaları göremez, yöneticiler ise ancak konsoldan görebilir.',
              ],
            },
            {
              heading: 'Yayınlamak',
              body: [
                'Proje bitince yöneticiniz onu yayınlar. Yayınlanan proje, tüm kurumun okuduğu katalog olan Siteler ve Projeler ekranında onaylı saha olarak görünür.',
              ],
            },
            {
              heading: 'Geri çekmek',
              body: [
                'Yayından geri çekmek yalnız kartı kaldırır — sahne, içeriği ve geçmişi olduğu yerde kalır.',
              ],
            },
          ],
        },
        {
          slug: 'importing-ifc',
          title: 'IFC modeli içe aktarmak',
          description: 'Revit, ArchiCAD gibi araçlardan dışa aktarılmış modeli getirin.',
          blocks: [
            {
              heading: 'Nasıl aktarılır',
              body: [
                'Sol kenar çubuğundaki Sahneler sekmesini açıp “IFC içe aktar” deyin ve .ifc dosyasını seçin. Dosyadan yeni bir sahne oluşturulur ve dönüşüm bitince açılır.',
              ],
            },
            {
              heading: 'Ne beklemeli',
              points: [
                'Dönüşüm tarayıcınızda çalışır — oluşan sahne kaydedilene kadar dosya hiçbir yere yüklenmez.',
                'Büyük modeller zaman alır; bitene kadar sekmeyi açık bırakın.',
                'Geometri ve yapı aktarılır. Üreticiye özgü parametrik davranışlar aktarılmaz; bir miktar düzeltme beklemelisiniz.',
              ],
            },
          ],
        },
        {
          slug: 'accounts-and-roles',
          title: 'Hesaplar ve roller',
          description: 'Giriş, hangi rolün ne yapabildiği ve iki adımlı doğrulama.',
          blocks: [
            {
              heading: 'Hesap edinmek',
              points: [
                'Hesapları yönetici açar. Giriş ekranındaki “Hesap talebi oluştur” ile başvurun; onaylanınca e-posta alırsınız.',
                'Davette geçici bir şifre gelir; ilk girişte kendi şifrenizi belirlersiniz ve geçici şifre o anda geçersiz olur.',
                'İki adımlı doğrulama zorunluysa, şifrenizi belirledikten hemen sonra herhangi bir doğrulayıcı uygulamayla kaydolursunuz.',
                '“Şifremi unuttum”, 30 dakika geçerli tek kullanımlık bir bağlantı gönderir.',
              ],
            },
            {
              heading: 'Hangi rol ne yapabilir',
              table: {
                columns: ['Rol', 'Neye izin verir'],
                rows: [
                  ['İzleyici', 'Sahneleri önizlemede açar: gezer ve ölçer, ama kaydedemez'],
                  ['Editör', 'Kendi sahnelerini oluşturur ve düzenler'],
                  [
                    'Yönetici',
                    'Her şey, ayrıca konsol: hesaplar, roller, sahalar, yayınlama, denetim',
                  ],
                ],
              },
            },
            {
              heading: 'Oturumlar',
              body: [
                'Oturum, yöneticinizin belirlediği hareketsizlik süresinden sonra kendiliğinden kapanır. Kendi cihazlarınızı konsolun Oturumlar ekranından görüp sonlandırabilirsiniz.',
              ],
            },
          ],
        },
      ],
    },
  ],
}

export function guidesFor(lang: Lang): GuidesContent {
  return lang === 'tr' ? TR : EN
}

export function guidePageFor(lang: Lang, slug: string): GuidePage | null {
  for (const group of guidesFor(lang).groups) {
    const page = group.pages.find((p) => p.slug === slug)
    if (page) return page
  }
  return null
}

export function allGuideSlugs(): string[] {
  return EN.groups.flatMap((group) => group.pages.map((page) => page.slug))
}
