# Outline GPU regression

`outline-depth.browser.ts` exports `runOutlineDepthChecks()`. It needs a browser
with WebGPU and returns 216 result rows; every row's `pass` must be true.

From the editor checkout, bundle it without installing dependencies:

```sh
bun build packages/viewer/tests/outline-depth.browser.ts --target browser --outfile /tmp/outline-depth.js
python3 -m http.server 3019 --directory /tmp
```

Open `http://localhost:3019/` and run in the browser console:

```js
const { runOutlineDepthChecks } = await import('/outline-depth.js')
const rows = await runOutlineDepthChecks()
console.table(rows.filter((row) => !row.pass))
console.assert(rows.length === 216 && rows.every((row) => row.pass), 'Outline depth regression')
```

Coverage: perspective and orthographic cameras; conventional depth24plus,
depth32float, and reversed depth32float; distances 10/30/100; positive, negative,
and zero depth slopes; visible and occluded surfaces. The renderer has MSAA on,
including when the producer explicitly overrides its sample count to zero.
Flat occluders retain the 1 cm separation regression. Sloped occluders cover the
whole pixel footprint at the lowest test resolution and greatest distance.

This is a GPU fixture, separate from the DOM-free `bun test packages/viewer/src`
suite. It reads the real mask attachment, rather than interpreting the TSL graph
or duplicating its comparison in JavaScript.
