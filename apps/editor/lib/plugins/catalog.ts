import type { LazyPluginDescriptor } from '@pascal-app/core'

export const PLUGIN_CATALOG: LazyPluginDescriptor[] = [
  {
    id: 'pascal:boots',
    name: 'PascalOrg Boots',
    description: 'Birinci şahıs (FPS) inşa ve AI robot tehditlerine karşı saha koruma simülasyonu.',
    detailedDescription:
      'PascalOrg Boots, projenizi anında birinci şahıs modunda deneyimlemenizi sağlar. Saha denetimi, yapay zeka robot tehditlerine karşı savunma ve interaktif FPS inşa mekanikleri sunar.',
    version: '0.1.0',
    category: 'simulation',
    tags: ['game', 'fps', 'simulation', 'voxel', 'punch-list'],
    author: {
      name: 'PascalOrg',
      url: 'https://github.com/pascalorg',
      isVerified: true,
    },
    pluginUrl: 'https://github.com/pascalorg/plugin-boots',
    icon: '/icons/boots.webp',
    defaultInstalled: false,
    features: ['Birinci Şahıs Kamera Kontrolleri', 'boots:job Punch-List Düğümü', 'AI Zombi Simülasyonu'],
    nodeKinds: ['boots:job'],
    loadPlugin: async () => {
      const { bootsPlugin, bootsHostPanel } = await import('@pascal-app/plugin-boots')
      return {
        plugin: bootsPlugin,
        panel: { ...bootsHostPanel, defaultInstalled: false },
      }
    },
  },
  {
    id: 'pascal:trees',
    name: 'Nature & Trees',
    description: 'Dış mekan sahneleri için prosedürel ağaçlar, çiçekler ve çim örtüleri.',
    detailedDescription:
      'Gelişmiş ez-tree algoritması ile parametrik ağaçlar, çalılar, çiçekler ve zemin peyzajı oluşturmanızı sağlar. Rüzgar animasyonları ve mevsimsel varyasyonları destekler.',
    version: '1.0.0',
    category: 'environment',
    tags: ['nature', 'vegetation', 'trees', 'landscape', '3d'],
    author: {
      name: 'PascalOrg',
      url: 'https://github.com/pascalorg',
      isVerified: true,
    },
    pluginUrl: 'https://github.com/pascalorg/plugin-trees',
    icon: '/icons/nature.webp',
    defaultInstalled: false,
    features: ['Prosedürel Ağaç Üreteci', 'Çiçek & Çim Fırçası', 'trees:tree, trees:flower, trees:grass Düğümleri'],
    nodeKinds: ['trees:tree', 'trees:flower', 'trees:grass'],
    loadPlugin: async () => {
      const { treesPlugin, treesHostPanel } = await import('@pascal-app/plugin-trees')
      return {
        plugin: treesPlugin,
        panel: { ...treesHostPanel, defaultInstalled: false },
      }
    },
  },
  {
    id: 'pascal:bones',
    name: 'Bones (Mühendislik Röntgeni)',
    description: 'Duvar karkasları, döşeme, çatı ve elektrik altyapısını gösteren mühendislik röntgeni.',
    detailedDescription:
      'Mimari modelin arkasındaki strüktürel ahşap ve çelik karkas yapıyı (framing), kablo kanallarını ve MEP servislerini otomatik hesaplar ve görselleştirir.',
    version: '0.2.0',
    category: 'engineering',
    tags: ['engineering', 'bim', 'structure', 'framing', 'x-ray', 'mep'],
    author: {
      name: 'Julien Brissonneau',
      url: 'https://github.com/Snoopy147',
      isVerified: true,
    },
    pluginUrl: 'https://github.com/pascalorg/plugin-bones',
    icon: '/icons/bones.webp',
    defaultInstalled: false,
    features: [
      'Duvar Karkas Analizi',
      'Ahşap & Çelik Boyutlandırma',
      'bones:lumber, bones:framing Düğümleri',
      'Inspector Mühendislik Kartı',
    ],
    nodeKinds: ['bones:lumber', 'bones:service', 'bones:device'],
    loadPlugin: async () => {
      const { bonesPlugin, bonesHostPanel } = await import('@pascal-app/plugin-bones')
      return {
        plugin: bonesPlugin,
        panel: { ...bonesHostPanel, defaultInstalled: false },
      }
    },
  },
  {
    id: 'pascal:articraft',
    name: 'Articraft 3D & AI',
    description: 'Articraft-10K varlık kütüphanesi ve prompt tabanlı 3D eklemli varlık üretimi.',
    detailedDescription:
      'Geniş 3D model kataloğuna erişim sağlar ve yapay zeka ile metin veya referans görselden eklemli (poseable) 3D varlıklar türetir.',
    version: '1.0.0',
    category: 'assets',
    tags: ['assets', 'ai-generation', 'articulated', 'models', '3d'],
    author: {
      name: 'PascalOrg',
      url: 'https://github.com/pascalorg',
      isVerified: true,
    },
    pluginUrl: 'https://github.com/pascalorg/plugin-articraft',
    icon: '/icons/articraft.webp',
    defaultInstalled: false,
    features: ['Articraft-10K Kataloğu', 'AI Prompt Varlık Üretimi', 'articraft:asset Düğümü'],
    nodeKinds: ['articraft:asset'],
    loadPlugin: async () => {
      const { articraftPlugin, articraftHostPanel } = await import('@pascal-app/plugin-articraft')
      return {
        plugin: articraftPlugin,
        panel: { ...articraftHostPanel, defaultInstalled: false },
      }
    },
  },
  {
    id: 'pascal:streetscape',
    name: 'Streetscape & Kentsel Altyapı',
    description: 'Yollar, sokak lambaları, trafik işaretleri ve kentsel altyapı araçları.',
    detailedDescription:
      'Eksiksiz dış mekan sokak ve şehir planlaması için yol ağları, aydınlatma direkleri, drenaj hatları, trafik işaretleri ve kentsel donatı elemanları sunar.',
    version: '1.0.0',
    category: 'infrastructure',
    tags: ['outdoor', 'roads', 'lighting', 'infrastructure', 'street', 'urban'],
    author: {
      name: 'Sudhir Yadav',
      url: 'https://github.com/sudhir9297',
      isVerified: true,
    },
    pluginUrl: 'https://github.com/sudhir9297/streetscape-pascal-plugin',
    icon: '/icons/streetscape.webp',
    defaultInstalled: false,
    features: ['Parametrik Yol Ağı', '30+ Aydınlatma & Donatı Düğümü', 'Altyapı Kablolama Sistemi'],
    nodeKinds: [
      'streetscape:road-network',
      'streetscape:street-light',
      'streetscape:utility-pole',
      'streetscape:road-sign',
    ],
    loadPlugin: async () => {
      const { streetscapePlugin, streetscapeHostPanel } = await import(
        '@pascal-app/plugin-streetscape'
      )
      return {
        plugin: streetscapePlugin,
        panel: {
          ...streetscapeHostPanel,
          creator: { name: 'Sudhir Yadav', url: 'https://github.com/sudhir9297' },
          defaultInstalled: false,
        },
      }
    },
  },
  {
    id: 'ovurrsl:warehouse',
    name: 'Warehouse & Lojistik Donatıları',
    description: 'Endüstriyel depolama, palet rafları, konveyör sistemleri ve lojistik planlama.',
    detailedDescription:
      'Fabrika ve lojistik depoları için palet rafları (drive-in, live racking, mezzanine), makaralı ve bantlı konveyör hatları ve yükleme rampaları sağlar.',
    version: '1.1.0',
    category: 'logistics',
    tags: ['logistics', 'warehouse', 'conveyor', 'racking', 'pallet', 'industrial'],
    author: {
      name: 'ovurrsl',
      url: 'https://github.com/ovurrsl',
      isVerified: true,
    },
    pluginUrl: 'https://github.com/ovurrsl/plugin-warehouse',
    icon: '/icons/warehouse.webp',
    defaultInstalled: true,
    features: [
      '20+ Depo Ekipmanı Düğümü',
      'Konveyör Yönlendirme & Akış Hattı',
      'Warehouse Zone Takeoff Metrajı',
    ],
    nodeKinds: [
      'warehouse:pallet',
      'warehouse:pallet-rack',
      'warehouse:conveyor-spiral',
      'warehouse:pallet-lift',
      'warehouse:truck',
    ],
    loadPlugin: async () => {
      const { warehousePlugin, warehouseCatalogPanel } = await import('@ovurrsl/plugin-warehouse')
      return {
        plugin: warehousePlugin,
        panel: warehouseCatalogPanel,
      }
    },
  },
  {
    id: 'mint:assets',
    name: 'Mint 3D Asset Studio',
    description: 'Mint 3D varlık tarama, üretim ve sahneye doğrudan yerleştirme paneli.',
    detailedDescription:
      'Mint ekosistemindeki yüksek kaliteli 3D modelleri arayın, sahnenize ölçekli olarak ekleyin ve özelleştirin.',
    version: '0.9.0',
    category: 'assets',
    tags: ['assets', '3d-models', 'catalog', 'ai', 'mint'],
    author: {
      name: 'Mint',
      url: 'https://mint.gg',
      isVerified: true,
    },
    pluginUrl: 'https://github.com/mintdotgg/mint-pascal-plugin',
    icon: '/icons/mint.webp',
    defaultInstalled: false,
    features: ['Mint Varlık Kataloğu', 'Tek Tıkla Yerleştirme', 'Hızlı Varlık Arama'],
    nodeKinds: [],
    loadPlugin: async () => {
      const { mintPlugin, mintHostPanel } = await import('@mint/pascal-plugin')
      return {
        plugin: mintPlugin,
        panel: { ...mintHostPanel, defaultInstalled: false },
      }
    },
  },
]

export function getPluginDescriptor(id: string): LazyPluginDescriptor | undefined {
  return PLUGIN_CATALOG.find((p) => p.id === id)
}
