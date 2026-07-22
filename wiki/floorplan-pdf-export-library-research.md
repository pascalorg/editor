# Floor-plan PDF export library research

Date: 2026-07-21

## Decision summary

The missing dimension values are a conversion-boundary problem, not a limitation of PDF text.
The current export builds an SVG in the DOM and asks `svg2pdf.js` to reinterpret that SVG as PDF.
That makes the result depend on how the converter handles nested transforms, inherited SVG styles,
font discovery, text baselines, paint order, and non-scaling strokes. Replacing `svg2pdf.js` with a
second automatic SVG converter leaves those same risks in place.

The reliable design is to render the existing semantic `FloorplanGeometry` directly into PDF
primitives. Dimension values must be emitted with the PDF library's native text API, and dimension
lines/ticks must be emitted with explicit point widths. That preserves selectable vector text and
removes SVG/CSS interpretation from the critical path.

Recommended choices:

1. **Smallest and lowest-risk:** keep jsPDF but stop sending dimension annotations through
   `svg2pdf.js`. Draw dimensions as a native jsPDF overlay with `doc.text`, `doc.line`, and
   `doc.rect`. This is the best implementation choice even though it is not a library replacement.
2. **If a different library is required:** use **PDFKit directly**, rendering from
   `FloorplanGeometry`. It has the strongest current combination of browser support, native vector
   drawing, transformation support, font embedding, and active maintenance.
3. **Do not choose another automatic SVG converter** as the primary fix. In particular,
   `SVG-to-PDFKit` has been inactive since 2022 and documents unsupported features and browser font
   loading caveats.

No production code was changed as part of this research.

## Current architecture and why it matters

The current code already has the right source model for a direct PDF backend:

- Node builders return semantic `FloorplanGeometry`, including `dimension`, `dimension-string`,
  `dimension-label`, lines, paths, polygons, circles, and groups.
- [`floorplan-dimension-renderer.tsx`](../packages/editor/src/components/editor-2d/renderers/floorplan-dimension-renderer.tsx)
  resolves each dimension's line endpoints, ticks, label point, label angle, font size, and label
  placement.
- [`floorplan-export.tsx`](../packages/editor/src/lib/floorplan/floorplan-export.tsx) currently mounts
  a React SVG off-screen and converts it with jsPDF + `svg2pdf.js`.

That means a new export backend does not need to infer measurements from DOM nodes. It can traverse
the same geometry tree and emit native PDF operations deterministically.

The current converter itself says that custom fonts must be registered before conversion, calls
itself "by no means perfect," and notes that its visual tests can vary because of text measurement.
Those are material warnings for small, rotated architectural labels.
[Official `svg2pdf.js` repository](https://github.com/yWorks/svg2pdf.js)

## Requirements

The selected approach should provide:

- visible dimension values at every rotation;
- selectable/searchable PDF text;
- embedded or otherwise deterministic fonts;
- explicit thin vector strokes in PDF points;
- lines, curves, polygons, circles, fills, clips, and nested transforms;
- browser-side generation and Blob/download support;
- compatibility with React and TypeScript in this monorepo;
- an API that can be tested without visual browser automation.

## Comparison

| Rank | Approach | Native/selectable text | Fonts | Transforms and thin vectors | Browser/TypeScript fit | Maintenance | Integration cost |
|---:|---|---|---|---|---|---|---|
| 1 | Direct jsPDF drawing, optionally as a hybrid overlay | Yes; `text()` emits PDF text and supports an angle or matrix | Custom TTF through VFS + `addFont` | Explicit `setLineWidth`; advanced mode exposes transformation matrices | Already installed and browser-first; official typings | Active; current 4.x docs and releases | Low for annotation overlay, medium for full renderer |
| 2 | Direct PDFKit renderer | Yes; native PDF text | TTF, OTF, WOFF, WOFF2, TTC, dfont; subsetting | Canvas-like vectors, SVG path data, save/restore, translate/rotate/scale/transform, explicit line width | Browser supported, but Blob stream/bundling and separate TS types add work | Active; current 0.19.x releases | Medium-high |
| 3 | Chromium print-to-PDF | Browser's own text/SVG renderer; generally preserves vector text | Uses loaded web fonts; Puppeteer waits for fonts by default | Browser-native SVG/CSS transforms and strokes | Not a pure browser-side library: needs print UI or a headless-browser service | Very active | Low rendering rewrite, high operational cost |
| 4 | `@react-pdf/renderer` | Native `<Text>` and SVG `<Text>` | `Font.register`; TTF and WOFF | SVG primitives, group transforms, explicit strokes; `Canvas` wraps PDFKit operations | Browser + server React APIs, Blob provider, bundled typings | Active releases and commits | High because DOM SVG is not reusable as-is |
| 5 | `pdf-lib` direct renderer | Native `drawText` with rotation | Standard fonts; custom fonts through `@pdf-lib/fontkit` | Lines, shapes, individual SVG path data, explicit thickness; lower-level transform work | Browser-compatible and TypeScript-native | Stable but inactive upstream since November 2021 | High |
| 6 | `SVG-to-PDFKit` automatic conversion | Supports SVG text/tspan/textPath | Requires pre-registration or a callback; does not wait for async browser font loading | Supports common transforms, but documents unsupported `vector-effect` | Browser possible through PDFKit; has a declaration file | Last commit August 2022; no published GitHub releases | Medium |
| 7 | Canvg raster fallback | No; text becomes pixels | Whatever the canvas resolved at rasterization time | Visually faithful at sufficient resolution, but all output is raster | Browser-friendly and TypeScript-based | Maintained; 4.0.3 released in 2025 | Low-medium |

## Approach details

### 1. Direct jsPDF primitives — recommended incremental implementation

jsPDF already exposes all operations needed for dimension annotations:

- `text(text, x, y, { angle, align, baseline })` for actual PDF text;
- transformation matrices in advanced mode;
- `setLineWidth(width)` in the document's declared units;
- custom font registration with `addFileToVFS`, `addFont`, and `setFont`.

The official source documentation shows that `text()` writes a PDF text object (`BT`, font
selection, text position, `Tj`, `ET`) rather than rasterizing the label. It also documents angle and
matrix transforms. [jsPDF text and line-width documentation](https://parallax.github.io/jsPDF/docs/jspdf.js.html),
[font and advanced-mode guide](https://parallax.github.io/jsPDF/docs/index.html)

Practical design:

1. Keep the current `svg2pdf.js` pass temporarily for non-annotation geometry.
2. Exclude all `dimension`, `dimension-string`, and `dimension-label` geometry from that SVG pass.
3. Resolve them into a small `PdfDimensionAnnotation` display list containing witness lines,
   dimension line, tick segments, label text, label anchor, angle, font size, and background box.
4. Transform model coordinates into page points once.
5. Draw the background plate, lines, ticks, then `doc.text()` with explicit fill color and embedded
   font.
6. Later, move walls and other geometry to the same native backend if desired.

Why this is ranked first: it eliminates the observed failure path while retaining the installed PDF
engine, page setup, headers, schedules, and save flow. It also provides a narrow regression-test
surface: generated PDF content can be inspected for each expected label string.

### 2. Direct PDFKit — recommended full replacement library

PDFKit runs in both Node and the browser. Its official documentation includes:

- selectable text and embedded font support for TTF, OTF, WOFF, WOFF2, TTC, and dfont;
- vector `moveTo`, `lineTo`, Bézier and quadratic curves;
- parsing of SVG **path data** (not an entire SVG DOM);
- save/restore, translate, rotate, scale, and arbitrary transform operations;
- explicit stroke widths and Blob output in the browser.

[PDFKit browser setup](https://pdfkit.org/docs/getting_started.html),
[vector and transform APIs](https://pdfkit.org/docs/vector.html),
[text and font APIs](https://pdfkit.org/docs/text.html)

PDFKit 0.19 raised its documented browser floor to Firefox 115 and Safari/iOS 16, and its current
release line continues to include text, font, SVG-path, and browser fixes.
[Official PDFKit releases](https://github.com/foliojs/pdfkit/releases)

Practical design:

1. Add an exhaustive `renderFloorplanGeometryToPdfKit` visitor.
2. Give the visitor a coordinate transform from model metres to PDF points, including the page's
   Y-axis inversion and plan rotation.
3. Draw every dimension label using `doc.text()` after `save/translate/rotate`.
4. Register an exact project font before rendering and use explicit point sizes.
5. Pipe to a browser Blob stream and keep the existing download UX.

Tradeoffs: this is a cleaner long-term backend but a larger initial migration. PDFKit's npm package
does not currently advertise bundled declarations in its package manifest, so the TypeScript package
would normally also use `@types/pdfkit`. Browser output uses a Node-style stream, commonly adapted
with `blob-stream`. Both add integration weight compared with the existing jsPDF save flow.

### 3. Chromium/browser printing

Printing a dedicated page lets the browser render the same SVG, CSS, transforms, and fonts that it
renders on screen. `window.print()` is widely available, and print-specific CSS can control the
page. [MDN `window.print`](https://developer.mozilla.org/en-US/docs/Web/API/Window/print),
[MDN printing guide](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Printing)

For automatic downloads, Puppeteer's `Page.pdf()` uses Chromium print output. Its documented
options include CSS page-size preference, background graphics, and waiting for
`document.fonts.ready` (enabled by default).
[Puppeteer PDF guide](https://pptr.dev/guides/pdf-generation),
[Puppeteer PDF options](https://pptr.dev/api/puppeteer.pdfoptions)

This is the best path when exact browser-rendering parity outweighs infrastructure cost. It is not
a pure client library: either the user must use the print dialog, or the application needs a trusted
server/desktop process running Chromium. That is a substantial architectural change for the current
browser-side download.

### 4. `@react-pdf/renderer`

React-pdf produces PDFs in the browser and server and offers browser Blob/download components. It
has its own PDF primitives, including SVG `Line`, `Path`, `Text`, `Tspan`, and `G`. Its documented
presentation attributes include `strokeWidth`, `transform`, `textAnchor`, and
`dominantBaseline`. Group transforms apply to children. Its `Canvas` painter wraps PDFKit methods,
including `text`, `path`, `rotate`, `lineWidth`, `translate`, and `scale`.
[React-pdf SVG APIs](https://react-pdf.org/svg),
[components and Canvas API](https://react-pdf.org/components),
[font registration](https://react-pdf.org/fonts)

This is viable and actively maintained. It is not a drop-in renderer for the existing React DOM SVG:
the floor plan must be rebuilt with React-pdf's component types or drawn through its Canvas painter.
For a CAD-like plan, that gives no decisive rendering advantage over direct PDFKit while adding a
second React renderer and layout engine. It is more attractive if the broader drawing-sheet document
will be rebuilt declaratively.

### 5. `pdf-lib`

`pdf-lib` runs in browsers and is written in TypeScript. It provides native `drawText` with rotation,
explicit line thickness, rectangles/circles/ellipses, and individual SVG path drawing. Custom fonts
are embedded through `@pdf-lib/fontkit`.
[Official examples](https://pdf-lib.js.org/),
[`PDFPage` drawing API](https://pdf-lib.js.org/docs/api/classes/pdfpage),
[`DrawTextOptions`](https://pdf-lib.js.org/docs/api/interfaces/drawtextoptions)

It does not parse a complete SVG document; its SVG support is for one path-data string at a time.
Consequently, it requires the same complete `FloorplanGeometry` visitor as PDFKit, with a less
convenient graphics-state/transform API for this use case. The upstream repository's latest commit
and release are from November 2021, so it is not the preferred new dependency for a renderer being
introduced in 2026. [Official commit history](https://github.com/Hopding/pdf-lib/commits/master/),
[official releases](https://github.com/Hopding/pdf-lib/releases)

### 6. `SVG-to-PDFKit`

`SVG-to-PDFKit` is the only credible alternate JavaScript full-SVG converter found. Its documented
coverage includes SVG text/tspan/textPath, transforms, paths, clips, masks, fonts, gradients, and
patterns. However, it explicitly does not support `vector-effect`, warns that browser fonts must be
registered before conversion because it does not wait for asynchronous loading, warns that bugs
remain, and has not received a commit since August 2022.
[Official repository and support table](https://github.com/alafr/SVG-to-PDFKit),
[official commit history](https://github.com/alafr/SVG-to-PDFKit/commits/master/)

It is therefore not a sensible replacement for `svg2pdf.js`. It changes the converter without
removing the converter boundary.

### 7. Canvg raster fallback

Canvg parses SVG and renders it to Canvas; its stated purpose includes SVG rasterization.
[Official repository](https://github.com/canvg/canvg),
[official API](https://canvg.js.org/api)

Rendering the plan at high device-pixel density and embedding the canvas as PNG would make missing
text unlikely after `document.fonts.ready`, because the browser/canvas has already converted the
glyphs to pixels. It is an acceptable emergency fallback or diagnostic control. It does not meet the
core deliverable: dimension text is not selectable, all geometry becomes raster, thin lines depend
on export resolution, and large plans produce larger PDFs.

## Proposed implementation sequence

If implementation is approved, use this order:

1. Add a library-independent PDF display list or visitor over `FloorplanGeometry`.
2. Implement dimensions first: lines, ticks, background plates, and native text.
3. Embed one exact non-variable TTF font and wait for/load it explicitly.
4. Preserve all document sizes in PDF points; do not use CSS pixels for line weights.
5. Keep the existing SVG conversion only for unported geometry during the transition.
6. Add structural tests that inspect the generated PDF for expected text strings and page count.
7. Add fixture coverage for horizontal, vertical, diagonal, rotated-plan, short/outside-label,
   metric, and imperial dimensions.
8. Only after the annotation path is proven, decide whether to port the remaining geometry and
   remove `svg2pdf.js`.

For a mandated new library, substitute a direct PDFKit backend at steps 2–5 and port geometry kinds
incrementally. Do not introduce `SVG-to-PDFKit` as an intermediate layer.

## Acceptance criteria for the eventual implementation

- Every dimension value in the source geometry is present as extractable text in the generated PDF.
- Horizontal, vertical, and diagonal values remain readable at plan rotations of 0°, 45°, 90°, and
  arbitrary building rotations.
- Dimension lines render at an explicit target such as 0.5 pt and ticks at 0.75 pt regardless of
  plan scale.
- The chosen font is embedded or a deliberate standard PDF font is used.
- Label backing plates are drawn before text and do not obscure glyphs.
- Text extraction verifies representative metric and imperial labels.
- Geometry remains vector except for explicitly documented raster-only assets.

## Primary sources

- [jsPDF repository](https://github.com/parallax/jsPDF)
- [jsPDF documentation](https://parallax.github.io/jsPDF/docs/index.html)
- [jsPDF source/API documentation](https://parallax.github.io/jsPDF/docs/jspdf.js.html)
- [`svg2pdf.js` repository](https://github.com/yWorks/svg2pdf.js)
- [`svg2pdf.js` releases](https://github.com/yWorks/svg2pdf.js/releases)
- [PDFKit repository](https://github.com/foliojs/pdfkit)
- [PDFKit browser setup](https://pdfkit.org/docs/getting_started.html)
- [PDFKit vector graphics](https://pdfkit.org/docs/vector.html)
- [PDFKit text and fonts](https://pdfkit.org/docs/text.html)
- [PDFKit releases](https://github.com/foliojs/pdfkit/releases)
- [React-pdf components](https://react-pdf.org/components)
- [React-pdf SVG primitives](https://react-pdf.org/svg)
- [React-pdf fonts](https://react-pdf.org/fonts)
- [React-pdf releases](https://github.com/diegomura/react-pdf/releases)
- [`pdf-lib` documentation](https://pdf-lib.js.org/)
- [`pdf-lib` `PDFPage` API](https://pdf-lib.js.org/docs/api/classes/pdfpage)
- [`pdf-lib` repository](https://github.com/Hopding/pdf-lib)
- [`SVG-to-PDFKit` repository](https://github.com/alafr/SVG-to-PDFKit)
- [Canvg repository](https://github.com/canvg/canvg)
- [Puppeteer PDF generation](https://pptr.dev/guides/pdf-generation)
- [Puppeteer PDF options](https://pptr.dev/api/puppeteer.pdfoptions)
- [MDN printing guide](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Printing)
