import IfcConverter from '@/components/IfcConverter'

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-100 py-12">
      <div className="max-w-3xl mx-auto px-6 pb-12 space-y-4">
        <h1 className="text-3xl font-bold text-gray-900">IFC → Pascal Converter</h1>
        <p className="text-gray-600 leading-relaxed">
          Upload an IFC building model or pick one of the bundled examples. The converter reads the
          IFC geometry, maps it onto Pascal's parametric node types, and returns a scene-graph JSON
          you can load into the editor's <em>Load Build</em> dialog.
        </p>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">Early alpha.</span> IFC is a sprawling, loosely-followed
          standard and real-world exports vary a lot, so expect rough edges — misplaced or missing
          elements, default-height walls, skipped items.{' '}
          <a
            className="font-medium underline decoration-amber-400 underline-offset-2 hover:text-amber-700"
            href="https://github.com/pascalorg/editor/tree/main/apps/ifc-converter"
            rel="noopener noreferrer"
            target="_blank"
          >
            Contributions welcome
          </a>{' '}
          — a sample IFC that converts badly, or a PR improving the conversion, both help a lot.
        </div>
      </div>
      <IfcConverter />
    </main>
  )
}
