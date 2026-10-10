// The look of Point and ask: one stylesheet for the whole overlay, its tokens and moments taken
// from the chat prototype the owner approved (chat-prototype/pascal-builds.html). Every class is
// prefixed `pa-`; motion that follows the camera is set from script, the rest is declared here.
export const POINT_ASK_CSS = `
.pa-layer{--pa-accent:#a99bff;--pa-ok:#79e2b0;--pa-warm:#f6b866;--pa-bad:#ff8a80;--pa-tx:#edece9;--pa-tx2:#a7a7ae;--pa-tx3:#73747c;--pa-ink:#16171b;--pa-ease:cubic-bezier(.23,1,.32,1);
  position:fixed;inset:0;pointer-events:none;z-index:45;color:var(--pa-tx);font-size:13px;line-height:1.35;-webkit-font-smoothing:antialiased}
.pa-layer *{box-sizing:border-box}
:where(.pa-layer) button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
.pa-vignette{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity 150ms var(--pa-ease);box-shadow:inset 0 0 90px 6px rgba(169,155,255,.16),inset 0 0 0 1.5px rgba(169,155,255,.26)}
.pa-vignette.on{opacity:1;transition-duration:180ms}
.pa-pill{position:absolute;left:50%;top:64px;transform:translateX(-50%);padding:6px 14px;border-radius:999px;background:rgba(19,20,24,.82);backdrop-filter:blur(14px) saturate(160%);-webkit-backdrop-filter:blur(14px) saturate(160%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.09),0 10px 28px -12px rgba(0,0,0,.7);white-space:nowrap;font-weight:500;color:var(--pa-tx2)}
.pa-pill b{color:var(--pa-tx);font-weight:600}
.pa-fc{position:absolute;left:0;top:0;width:12px;height:12px;border:0 solid var(--pa-accent);opacity:0;transition:opacity 120ms ease;filter:drop-shadow(0 0 3px rgba(169,155,255,.6));will-change:transform}
.pa-fc.tl{border-width:2px 0 0 2px;border-top-left-radius:4px;margin:-3px 0 0 -3px}
.pa-fc.tr{border-width:2px 2px 0 0;border-top-right-radius:4px;margin:-3px 0 0 -9px}
.pa-fc.bl{border-width:0 0 2px 2px;border-bottom-left-radius:4px;margin:-9px 0 0 -3px}
.pa-fc.br{border-width:0 2px 2px 0;border-bottom-right-radius:4px;margin:-9px 0 0 -9px}
.pa-chipwrap{position:absolute;left:0;top:0;will-change:transform}
.pa-hlabel{padding:4px 10px;border-radius:12px;background:rgba(18,19,23,.9);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);font-weight:600;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap;opacity:0;transform:translateY(4px);transition:opacity 120ms ease,transform 180ms var(--pa-ease)}
.pa-hlabel.show{opacity:1;transform:none}
.pa-hlabel.press{transform:scale(.97);transition-duration:120ms}
.pa-hlabel .sub{display:block;font-weight:500;font-size:11px;color:var(--pa-tx3)}
.pa-hlabel .sz{color:var(--pa-tx2);font-weight:500;margin-left:6px}
.pa-bwrap{position:absolute;left:0;top:0;pointer-events:auto;will-change:transform}
.pa-bub{position:relative;width:320px;padding:12px;border-radius:14px;background:rgba(32,33,39,.95);backdrop-filter:blur(18px) saturate(150%);-webkit-backdrop-filter:blur(18px) saturate(150%);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 0 0 1px rgba(255,255,255,.06),0 18px 40px -16px rgba(0,0,0,.75)}
.pa-tail{position:absolute;left:0;top:0;width:12px;height:12px;border-radius:2px;background:rgba(32,33,39,.95)}
.pa-ctx{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:10px;cursor:grab;position:relative}
.pa-ctx:active{cursor:grabbing}
.pa-thumb{width:40px;height:40px;border-radius:8px;object-fit:cover;margin-left:auto;background:#0f1013}
.pa-nopic{margin-left:auto;font-size:11px;color:var(--pa-tx3);font-weight:500}
.pa-tchip{display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 6px 0 8px;border-radius:999px;background:rgba(169,155,255,.16);color:#d9d2ff;font-weight:600;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap;max-width:210px}
.pa-tchip i{width:6px;height:6px;border-radius:50%;background:var(--pa-accent);flex:none}
.pa-tchip span{overflow:hidden;text-overflow:ellipsis}
.pa-tchip .tx{width:16px;height:16px;display:grid;place-items:center;border-radius:50%;color:#cfc7ff;flex:none}
.pa-tchip .tx:hover{background:rgba(255,255,255,.12)}
.pa-tchip .tx svg{width:10px;height:10px}
.pa-field{display:flex;align-items:center;gap:6px;padding:4px 4px 4px 12px;border-radius:999px;background:rgba(255,255,255,.06)}
.pa-field input{flex:1;min-width:0;height:30px;font:inherit;font-size:14px;color:var(--pa-tx);background:none;border:0;outline:0}
.pa-field input::placeholder{color:var(--pa-tx3)}
.pa-send{height:30px;min-width:30px;border-radius:999px;background:#edece9;color:var(--pa-ink);display:grid;place-items:center;transition:transform 120ms var(--pa-ease),opacity 160ms ease}
.pa-send:active{transform:scale(.97)}
.pa-send:disabled{opacity:.4;cursor:default}
.pa-send svg{width:15px;height:15px}
.pa-send.queue{padding:0 12px;font-weight:600;font-size:13px}
.pa-dict{width:30px;height:30px;border-radius:50%;color:var(--pa-tx2);display:grid;place-items:center;transition:transform 120ms var(--pa-ease),color 160ms ease,background 160ms ease}
.pa-dict:hover{color:var(--pa-tx);background:rgba(255,255,255,.08)}
.pa-dict:active{transform:scale(.97)}
.pa-dict.on{color:var(--pa-ink);background:var(--pa-accent)}
.pa-dict svg{width:16px;height:16px}
.pa-sugs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.pa-btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 12px;border-radius:999px;background:rgba(255,255,255,.08);color:var(--pa-tx);font-weight:500;font-size:12.5px;white-space:nowrap;transition:transform 120ms var(--pa-ease),background 160ms ease}
.pa-btn:hover{background:rgba(255,255,255,.13)}
.pa-btn:active{transform:scale(.97)}
.pa-btn.primary{background:#edece9;color:var(--pa-ink)}
.pa-btn.primary:hover{background:#fff}
.pa-btn.ghost{background:transparent;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}
.pa-err{margin:8px 2px 0;font-size:12px;color:var(--pa-warm);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pa-pin{position:absolute;left:0;top:0;width:32px;height:32px;margin:-38px 0 0 -16px;pointer-events:auto;cursor:pointer;display:grid;place-items:center;will-change:transform}
.pa-pin::after{content:"";position:absolute;left:50%;top:28px;width:2px;height:8px;margin-left:-1px;border-radius:1px;background:var(--pa-accent);opacity:.85}
.pa-pdisc{width:24px;height:24px;border-radius:50%;background:rgba(24,25,30,.92);box-shadow:inset 0 0 0 1.5px rgba(169,155,255,.9),0 6px 16px -6px rgba(0,0,0,.7);display:grid;place-items:center;transition:box-shadow 240ms ease}
.pa-pdisc svg{width:20px;height:20px;overflow:visible}
.pa-pq,.pa-pa{fill:none;stroke:#a99bff;stroke-width:1.8;opacity:0;transition:opacity 160ms ease}
.pa-pq{stroke-dasharray:2.4 2.4}
.pa-pa{stroke-width:2;stroke-linecap:round}
.pa-pk{fill:none;stroke:var(--pa-ok);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:14;stroke-dashoffset:14;transition:stroke-dashoffset 240ms var(--pa-ease) 80ms}
.pa-sg{fill:none;stroke:var(--pa-accent);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;opacity:0;transition:opacity 160ms ease}
.pa-pin.queued .pa-pq,.pa-pin.working .pa-pa{opacity:1}
.pa-pin.needs-input .pa-pdisc{box-shadow:inset 0 0 0 1.5px rgba(246,184,102,.95),0 0 14px 1px rgba(246,184,102,.45),0 6px 16px -6px rgba(0,0,0,.7)}
.pa-pin.needs-input .pa-pa{opacity:1;stroke:var(--pa-warm)}
.pa-pin.done .pa-pk{stroke-dashoffset:0}
.pa-pin.done .pa-pdisc{box-shadow:inset 0 0 0 1.5px rgba(121,226,176,.9),0 6px 16px -6px rgba(0,0,0,.7)}
.pa-pin.done::after{background:var(--pa-ok)}
.pa-pin.answered .pa-sg{opacity:1}
.pa-pin.no-change .pa-pdisc{box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.35),0 6px 16px -6px rgba(0,0,0,.7)}
.pa-pin.no-change .pa-pk{stroke:var(--pa-tx3);stroke-dashoffset:0;opacity:.8}
.pa-pin.no-change::after{background:var(--pa-tx3)}
.pa-pin.error .pa-pdisc{box-shadow:inset 0 0 0 1.5px rgba(255,138,128,.95),0 6px 16px -6px rgba(0,0,0,.7)}
.pa-pin.error::after{background:var(--pa-bad)}
.pa-pin.undone .pa-pq{opacity:.7;stroke:var(--pa-tx3)}
.pa-pin.undone .pa-pdisc{box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.25),0 6px 16px -6px rgba(0,0,0,.7)}
.pa-pin.undone::after{background:var(--pa-tx3)}
.pa-pin.edge{pointer-events:auto}
.pa-ring{position:absolute;left:4px;top:4px;width:24px;height:24px;border-radius:50%;box-shadow:0 0 0 1.5px var(--pa-accent);opacity:0;pointer-events:none}
.pa-edgemark{position:absolute;left:0;top:0;display:flex;align-items:center;gap:6px;height:28px;padding:0 12px 0 8px;border-radius:999px;background:rgba(19,20,24,.88);backdrop-filter:blur(14px) saturate(160%);-webkit-backdrop-filter:blur(14px) saturate(160%);box-shadow:inset 0 0 0 1px rgba(169,155,255,.45),0 8px 22px -10px rgba(0,0,0,.7);color:var(--pa-tx);font-weight:600;font-size:12px;white-space:nowrap;pointer-events:auto;cursor:pointer;will-change:transform;transition:transform 120ms var(--pa-ease)}
.pa-edgemark svg{width:14px;height:14px;color:var(--pa-accent);flex:none}
.pa-cardwrap{position:absolute;left:0;top:0;pointer-events:auto;will-change:transform}
.pa-card{width:250px;padding:10px;border-radius:14px;background:rgba(30,31,37,.95);backdrop-filter:blur(18px) saturate(150%);-webkit-backdrop-filter:blur(18px) saturate(150%);box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 18px 40px -16px rgba(0,0,0,.75);transform-origin:50% 100%}
.pa-card-t{font-weight:600;font-size:13.5px;line-height:1.3}
.pa-card-s{margin-top:2px;font-size:12px;color:var(--pa-tx2)}
.pa-card-a{margin-top:6px;font-size:12px;color:var(--pa-tx2);text-decoration:underline;text-decoration-color:rgba(255,255,255,.2);text-underline-offset:2px;cursor:default}
.pa-card-img{position:relative;margin:8px 0;height:120px;border-radius:10px;overflow:hidden;background:#0f1013}
.pa-card-img img{width:100%;height:100%;object-fit:cover;display:block}
.pa-card-img span{position:absolute;left:8px;bottom:6px;font-weight:600;font-size:11px;color:#fff;text-shadow:0 1px 4px rgba(0,0,0,.7)}
.pa-card-row{display:flex;gap:6px;margin-top:8px}
.pa-edge{position:absolute;pointer-events:auto}
@media (prefers-reduced-transparency:reduce){.pa-bub,.pa-card,.pa-pill{background:#1c1d22;backdrop-filter:none;-webkit-backdrop-filter:none}.pa-tail{background:#1c1d22}}
@media (prefers-contrast:more){.pa-bub,.pa-card{box-shadow:inset 0 0 0 1px rgba(255,255,255,.5)}}
`
