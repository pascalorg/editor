// The region marquee's look (spec 2.3, Region): the capture overlay's corner accents on a thin
// accent border with a faint fill, the live size pinned inside its bottom-right, drawn back to 60%
// once the person has let go. Uses the layer's `--pa-*` tokens; append it to POINT_ASK_CSS.
export const REGION_MARQUEE_CSS = `
.pa-rgn{position:fixed;left:0;top:0;pointer-events:none;border:1.5px solid var(--pa-accent);border-radius:3px;background:rgba(169,155,255,.07);transition:opacity 160ms ease;will-change:transform,width,height}
.pa-rgn.settled{opacity:.6}
.pa-rgn-c{position:absolute;width:14px;height:14px;border:0 solid var(--pa-accent);filter:drop-shadow(0 0 3px rgba(169,155,255,.5))}
.pa-rgn-c.tl{left:-3px;top:-3px;border-width:2.5px 0 0 2.5px;border-top-left-radius:5px}
.pa-rgn-c.tr{right:-3px;top:-3px;border-width:2.5px 2.5px 0 0;border-top-right-radius:5px}
.pa-rgn-c.bl{left:-3px;bottom:-3px;border-width:0 0 2.5px 2.5px;border-bottom-left-radius:5px}
.pa-rgn-c.br{right:-3px;bottom:-3px;border-width:0 2.5px 2.5px 0;border-bottom-right-radius:5px}
.pa-rgn-size{position:absolute;right:6px;bottom:6px;padding:2px 8px;border-radius:999px;background:rgba(18,19,23,.85);font-weight:600;font-size:11.5px;font-variant-numeric:tabular-nums;color:var(--pa-tx);white-space:nowrap}
.pa-rgn-size:empty{display:none}
.pa-rgn-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;border-radius:inherit}
`
