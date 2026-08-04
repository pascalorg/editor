<!--
Domain research reference for the formwork feature. Captured 2026-08-01 from
web research (primary standards, vendor catalogs, published papers).

PROVENANCE MATTERS HERE. Numbers in this file carry different confidence
levels, and the code must not treat them uniformly:

  - Items marked ⚠️ come from a secondary source.
  - Items marked ❌ are unverified.
  - The DIN 18218 tE-correction slopes were reverse-engineered by probing
    PASCHAL's public calculator (the standard is paywalled). They are
    internally consistent and exactly reproducible, but DERIVED, not
    transcribed.
  - Vendor capacity figures conflict because some are permissible/allowable
    and some are design resistances. Every catalog capacity needs an
    explicit capacityBasis flag; conflating them is a factor-of-2 error.

See wiki/formwork/reference/README.md for the buy/verify list before any of
this is presented to a user as a certified design.
-->

# Formwork Products & Materials — Implementation Reference

**Verification legend:** ✅ = extracted from manufacturer catalog/standard PDF I parsed directly. ⚠️ = secondary source (dealer/blog/search snippet). ❌ = could not verify — do not hardcode.

---

## 1. Modular Wall Panel Systems

### 1.1 PERI TRIO ✅ (all item numbers + weights parsed from PERI TRIO Product Brochure 12/2017, doc ref `DE en 07|2019 3eb 790102`)

Source: `https://www.peri.com.mx/dam/jcr:d409cbe2-82e6-4183-96b6-60b02b4658ba/catalogo-de-componentes-trio.pdf` (also mirrored at peri.be, peri.lv, peri.it)

TRIO is a **6-width system**: 30, 60, 72, 90, 120, 240 cm. Heights: 60, 90, 120, 270, 330 cm. Frame depth is **120 mm** on every panel (important invariant for your geometry model).

**Steel panels — height 270 (`TR`) and 330 (`TR/4`):**

| Panel | Item no. | Weight kg | Area m² | kg/m² |
|---|---|---|---|---|
| TR 270 x 240 | 022570 | 330.0 | 6.48 | 50.9 |
| TR 270 x 120 | 022510 | 162.0 | 3.24 | 50.0 |
| TR 270 x 90 | 022520 | 114.0 | 2.43 | 46.9 |
| TR 270 x 72 | 022530 | 97.2 | 1.944 | 50.0 |
| TR 270 x 60 | 022550 | 87.4 | 1.62 | 54.0 |
| TR 270 x 30 | 022560 | 59.5 | 0.81 | 73.5 |
| TR/4 330 x 240 | 054304 | 399.0 | 7.92 | 50.4 |
| TR/4 330 x 120 | 054314 | 196.0 | 3.96 | 49.5 |
| TR/4 330 x 90 | 054324 | 138.0 | 2.97 | 46.5 |
| TR/4 330 x 72 | 054334 | 118.0 | 2.376 | 49.7 |
| TR/4 330 x 60 | 054354 | 106.0 | 1.98 | 53.5 |
| TR/4 330 x 30 | 054364 | 73.4 | 0.99 | 74.1 |

**Heights 120 and 60:**

| Panel | Item no. | Weight kg |
|---|---|---|
| TR 120 x 240 | 022514 | 162.0 |
| TR 120 x 120 | 022600 | 76.1 |
| TR 120 x 90 | 022610 | 58.3 |
| TR 120 x 72 | 022620 | 48.6 |
| TR 120 x 60 | 022640 | 43.5 |
| TR 120 x 30 | 022650 | 28.4 |
| TR 60 x 90 | 022790 | 34.5 |
| TR 60 x 72 | 022800 | 28.6 |
| TR 60 x 60 | 022810 | 25.7 |
| TR 60 x 30 | 022820 | 15.6 |

**Aluminium TRIO (`TRA`/`TAE`/`TAM`) — yellow powder-coated, crane-independent:**
TRA 270x30 `023880` 31.4 kg · TRA 270x60 `023870` 49.3 kg · TRA 270x90 `023850` 70.2 kg · TRA 90x30 `023960` 10.7 kg · TRA 90x60 `023950` 18.0 kg · TRA 90x120 `023900` 33.6 kg · Corner Alu TAE 270/2 `023891` 42.2 kg · TAE 90/2 `023971` 15.2 kg · Multi Panel Alu TAM 270x72 `023860` 60.7 kg · TAM 90x72 `023980` 23.5 kg. Alu ≈ **26 kg/m²** vs steel ≈ 50 kg/m² — roughly half.

**TRIO Structure (21 mm base plate, for special formlining):** TS/4 330x240 `054305` 374 kg · x120 `054315` 183 · x90 `054325` 131 · x72 `054335` 112 · x60 `054355` 101 · x30 `054365` 71.1 · TSM/4 330x72 `054345` 128 · Corner TSE/4 330 `054375` 80.2.

**Tie-hole grid (vertical positions, mm from bottom — this is the load-bearing geometry for your layout engine):** ✅
- **TRIO 270** dimension chain `575 / 1550 / 575` → 2 tie levels at **575** and **2125** mm.
- **TRIO 330** chain `475 / 600 / 575 / 1075 / 575` → 4 tie levels at **475, 1075, 1650, 2725** mm.
- **TRIO 120** chain `25 / 850 / 325` → 1 tie level at **875** mm.
- Multi Panel TRM has a continuous drilled grid: `19 x 30 = 570` mm i.e. **holes every 30 mm** over 570 mm, plus 75 mm end margins, supplied with 44 pc (270-high) or 88 pc (330-high) of Plug Ø20/24 `030300`.

Note the marketing claim "large panels need only 2 tie positions" refers to the 240-wide panel: horizontal chain `540 / 1320 / 540` = 2400, so **2 tie columns** at 540 and 1860 mm.

**Corners:** ✅

| Component | Item no. | Weight kg | Geometry / note |
|---|---|---|---|
| Inside Corner TE 270-2 | 022580 | 70.0 | 90° internal, legs 180 x 300 |
| Inside Corner TE 120-2 | 022660 | 32.9 | 90° internal |
| Inside Corner TE 60-2 | 022840 | 18.0 | 90° internal |
| Inside Corner TE/4 330 | 054374 | 85.8 | 90° internal, 18 mm ply |
| Articulated Corner TGE 270 | 023200 | 94.9 | **steel formlining**, oblique from 75° up, in/out, 300x300 |
| Articulated Corner TGE 120 | 023300 | 43.6 | as above |
| Articulated Corner TGE/4 330 | 054414 | 119.0 | as above |
| Outside Corner TEA 270/135° | 103337 | 76.5 | 290 x 290 |
| Outside Corner TEA 120/135° | 103330 | 35.9 | 290 x 290 |
| Internal Corner TEI 270/135° | 103317 | 56.9 | 189 x 189 |
| Internal Corner TEI 120/135° | 103284 | 26.4 | 189 x 189 |
| **Striking Corner TRIO 330/270** | 129945 | 293.0 | shaft striking corner |
| Multi Panel TRM 270x72 | 022540 | 103.0 | oblique angles, wall connections |
| Multi Panel TRM 120x72 | 022630 | 56.3 | " |
| Multi Panel TRM/4 330x72 | 054344 | 134.0 | " |
| Projection Waler TVR 45/45-2 | 128387 | 8.9 | internal corners *without* TE corner, for wall offsets |

**Compensation / filler (your "make-up" strategy in a panel layout algorithm):** ✅
- **Wall Thickness Compensation WDA** — discrete: `023182` WDA-2 270x5 (16.2 kg), `023192` WDA-2 270x6 (17.2 kg), `023995` WDA 270x10 Alu (10.1 kg); 120-high: `023282` x5 (7.61), `023292` x6 (8.09), `023990` x10 Alu (4.68); 330-high: `054391` x5 (20.1), `054401` x6 (21.4), `054435` x10 Alu (12.4). **Planning dimension 10 cm** for WDA 10.
- **Filler Plate LA 270x36** `023170` 48.9 kg — **continuous compensation 6 to 36 cm** (the key "any width" element). LA 120x36 `023270` 24.5 kg; LA/4 330x36 `054384` 62.2 kg.
- **Filler Profile TPP 270 Alu** `101813` 8.04 kg + **Filler Support TPA 270** `023460` 4.71 kg — for site-cut **21 mm filler plates** (i.e. timber infill). TPP 120 `101823` 3.59; TPA 120 `023450` 2.06; TPP 330 `101829` 9.82; TPA 330 `054430` 6.40.

So the TRIO compensation cascade your optimizer should model: **panel widths (30/60/72/90/120/240) → WDA 5/6/10 cm → LA filler plate 6–36 cm continuous → TPP/TPA + site-cut 21 mm ply.**

**Stop-end / bulkhead:** ✅
- Closed stopend panels for standard walls: **Stopend Panel TR 270x24** `023040` 50.5 kg; TR 120x24 `023030` 23.6 kg; TR/4 330x24 `023050` 62.3 kg. (Brochure: "For walls with 24 cm and 30 cm thicknesses, Stopend Panels TR 24 and TR 30 are available.")
- **MT** centre pieces (no waterstop) — widths B = 118/158/218/268 mm for wall 20 / 24-25 / 30 / 35-36 cm: 270-high `023061/023062/023064/023065` = 26.5/30.4/36.3/41.3 kg; 120-high `023068/023069/023071/023072`; 330-high `131152/131155/131158/131161`.
- **MTF** = same with **waterstop bar installation**: 270-high `023074/023075/023077/023076` = 29.2/33.4/38.6/42.5 kg.
- **AT** external pieces: AT 270x3 `023060` 17.2 kg, AT 270x5 `105953` 19.0 kg — *concrete cover approx. 30 or 50 mm* (that's what the "x3/x5" means).
- **Stopend Waler MX 15-40** `127732` 11.0 kg. Design rule ✅: *2.70 m panel, wall ≤ 40 cm → **3 walers** for permissible fresh concrete pressure 60 kN/m²; 3.30 m panel, wall ≤ 40 cm → **4 walers***.
- **Bulkhead Tie TS** `023640` 1.14 kg, DW 15 thread, **permissible tension 20.0 kN**.

**Panel connector — the single most important accessory:** ✅
**Alignment Coupler BFD** `023500`, **4.58 kg**, *"For all panel connections for MAXIMO, TRIO and RUNDFLEX. Fillers up to 10 cm. Permissible tension force 20.0 kN."* Clamping range 55–220 mm. One component performs align + clamp + tension; this is the "only one connecting part" claim.

**Walers:** Compensation Waler TAR 85 `023550` 12.3 kg, **permissible bending moment 4.4 kNm** · Waler 85 `023551` 8.52 kg, 4.4 kNm · Waler MAR 85-3 `124941` 14.1 kg, **3.9 kNm** (MAXIMO) · **Universal Waler 245** `023920` 78.4 kg (2466 mm long; for oblique angles/thick walls) + Waler Stop `023930` 4.10 kg.

**Tension/Compression Brace MX** `115350` (15–40 cm, 6.31 kg) and `123842` (15–100 cm, 9.07 kg) — **adjustable in 0.5 cm increments**, permissible tension & compression **9 kN**.

**Push-pull props (PERI RS series):** ✅

| Prop | Item no. | Weight kg | Extension range |
|---|---|---|---|
| RS 210 | 117466 | 10.6 | 1.30 – 2.10 m |
| RS 260 | 118238 | 12.1 | 2.30 – 2.60 m |
| RS 300 | 117467 | 15.5 | 1.90 – 3.00 m |
| RS 450 | 117468 | 23.0 | 2.80 – 4.50 m |
| RS 650 | 117469 | 39.9 | 4.30 – 6.50 m |
| RS 1000 | 028990 | 115.0 | 6.40 – 10.00 m |
| RS 1400 | 103800 | 271.0 | 6.40 – 14.00 m |
| RSS I | 028010 | 17.9 | 2.05 – 2.94 m |
| RSS II | 028020 | 22.0 | 2.91 – 3.80 m |
| RSS III | 028030 | 38.4 | 4.60 – 6.00 m |

Kickers (the short lower brace, paired with the prop): AV 82 `057087` 3.51 kg (0.50–0.82) · AV 111 `057088` 4.20 (0.79–1.11) · AV 140 `028110` 4.85 (1.08–1.40) · AV 210 `108135` 12.9 (1.28–2.10) · AV RSS III `028120` 17.0 (2.03–2.92). Tube OD is **Ø48.3 mm** on RS 210–1400; pin holes Ø21/Ø17. Base Plate-3 for RS 210-1400 `126666` 3.07 kg; Base Plate-2 `117343` 3.25 kg; Anchor Bolt PERI 14/20 x 130 `124777` 0.21 kg (drill Ø14). **Brace Connector TRIO** `023660` 3.30 kg mounts props onto vertical *and* horizontal struts. Note: brochure says *"Permissible load see PERI Design Tables"* — prop capacities are **not** in the component list, so your catalog needs a separate capacity-vs-extension table per prop (same shape as the Doka table in §1.6).

**Working platforms / safety (wall forms):** ✅
- **Scaffold Bracket TRG 80** `023670` 12.6 kg · **TRG 120** `023680` 16.7 kg · **TRG 100/112** `023590` 13.0 kg. All: **permissible load 150 kg/m², max width of influence 1.35 m**.
- **Concreting Platform TRIO 120 x 270** `022950` 129 kg, pre-assembled, self-securing from above, **150 kg/m²**.
- Concreting Platform MX 100x240 `127273` 192 kg; MX 100x100 hatch `127885` 71.6 kg.
- Guardrail Post Holder TRIO `101592` 2.81 kg + Guardrail Post HSGP-2 `116292` 4.72 kg; Guardrail Post MXK `126360` 4.92 kg; Side Mesh Barriers PMB 90 `126381` 7.14 / PMB 120 `126376` 9.26 / PMB 240 `126371` 17.7 kg. Scaffold Bracket MXK `126356` 10.2 kg, MXK-RS `126540` 14.6 kg.

**Shaft elements:** TSE 270 `105523` 127 kg · TSE 330 `105525` 142 kg · TSE 120 `105524` 72.6 kg. **Permissible load-bearing point capacity 2.0 t each**; **all-round striking clearance 30 mm**; constructive **minimum shaft edge length 1.30 m**; max **2000 kg per Shaft Panel**. ✅

**Handling:** Lifting Hook MAXIMO 1.5 t `115168` 7.47 kg — *steel elements 1.5 t, alu elements 750 kg* ✅. Stacking Device MAXIMO `115058` 7.45 kg — **650 kg per post, 2.6 t per stack**. Lifting Gear MX `117322` 25 kg; Combi MX `117321` 31 kg. Lifting Pin TRIO `023440` 0.312 kg. Stacking Aid TRIO DW 20 `750303` 0.014 kg.

**Single-sided (brace frames):** SB Brace Frame — up to **8.75 m high, max 60 kN/m²** ✅. Connector SB-1,2 - MX/TR/D `027680` 49.6 kg (perm. point capacity **1.0 t at sling angle ≤15°**); Connector SB-A,B,C `025740` 9.14 kg (1 pc per anchor point); Bolt SB-TRIO/DOMINO `027690` 0.368 kg — *"for panel formwork with 12 cm overall thickness"*.

**Permissible fresh concrete pressure:** ⚠️ TRIO wall panels rated **up to 80 kN/m²**; TRIO **column** panels (TRS) **100 kN/m²** — from perionline.com and easy-formwork dealer listings. The brochure quotes 60 kN/m² in the stop-end and brace-frame design rules. Treat 80 kN/m² as the panel-body rating and **60 kN/m² as the practical system-with-accessories rating**; both belong in your data model as separate fields.

⚠️ **Data conflict worth noting for your catalog design:** the dealer shop.easy-formwork.de lists Panel TR 270x60 (item `022550`) at **80.30 kg**, PERI's own brochure says **87.400 kg**. Reconditioned/used stock and different formlining thickness produce different weights for the same item number — so `weight_kg` must be versioned per catalog edition, not treated as an immutable property of the part number.

### 1.2 Doka Framax Xlife ✅ (parsed from official Doka item list `https://www.doka.com/_ext/downloads/itemlists/me/91.pdf`)

Framax is a **5-width, 15 cm grid** system. Widths **0.30, 0.45, 0.60, 0.90, 1.35 m** (+ 0.55 m special). Heights **1.35, 2.70, 3.30 m**. Tie spacing **1.35 m**. Panels galvanised + powder-coated.

| Panel | Weight kg | Article n° |
|---|---|---|
| Framax Xlife panel 1.35x2.70m | 210.0 | 588100500 |
| 0.90x2.70m | 126.5 | 588102500 |
| 0.60x2.70m | 91.5 | 588104500 |
| 0.55x2.70m | 87.0 | 588105500 |
| 0.45x2.70m | 77.7 | 588106500 |
| 0.30x2.70m | 61.5 | 588108500 |
| 1.35x1.35m | 106.3 | 588110500 |
| 0.90x1.35m | 68.5 | 588112500 |
| 0.60x1.35m | 50.5 | 588114500 |
| 0.55x1.35m | 46.5 | 588115500 |
| 0.45x1.35m | 41.0 | 588116500 |
| 0.30x1.35m | 31.8 | 588118500 |
| 1.35x3.30m | 259.3 | 588221500 |
| 0.90x3.30m | 154.5 | 588222500 |
| 0.60x3.30m | 114.7 | 588223500 |
| 0.55x3.30m | 107.5 | 588131500 |
| 0.45x3.30m | 97.9 | 588224500 |
| 0.30x3.30m | 78.5 | 588225500 |

**Large-area panels** (corners marked grey): 2.40x2.70 `588103500` 370.0 kg · 2.40x3.30 `588606500` 484.9 · 2.70x2.70 `588109500` 416.0 · 2.70x3.30 `588608500` 514.2 kg. *"Custom sizes on enquiry"*.

**Universal panels** (T-junctions, stop-ends, wall-thickness compensation — corners marked **blue**): 0.90x0.90 `588120500` 63.0 · 0.90x1.35 `588124500` 79.3 · 0.90x2.70 `588122500` 148.0 · 0.90x3.30 `588228500` 182.6 kg; 1.20 wide: `588604500` 91.5 (x0.90), `588603500` 116.7 (x1.35), `588601500` 225.8 (x2.70), `588671500` 276.7 (x3.30). **Universal panel SCC 0.90x2.70** `588119500` 170.3 kg for self-compacting concrete, with hose-to-panel coupler SCC `588121000` 10.0 kg and panel closure tool D125 SCC `588127000` 18.0 kg.

Framax 1.35x2.70 = 210 kg / 3.645 m² = **57.6 kg/m²** (vs TRIO 50 kg/m²).

**Corners:** ✅

| Component | Weight kg | Article n° |
|---|---|---|
| Framax Xlife inside corner 1.35m | 51.2 | 588132500 |
| inside corner 2.70m | 97.0 | 588130500 |
| inside corner 3.30m | 117.9 | 588229500 |
| outside corner 1.35m | 23.5 | 588128000 |
| outside corner 2.70m | 47.0 | 588126000 |
| outside corner 3.30m | 58.0 | 588227000 |
| **hinged inside corner I** 1.35m | 55.4 | 588137000 |
| hinged inside corner I 2.70m | 102.3 | 588136000 |
| hinged inside corner I 3.30m | 125.5 | 588610000 |
| **hinged outside corner A** 1.35m | 27.4 | 588135000 |
| hinged outside corner A 2.70m | 52.8 | 588134000 |
| **stripping corner I** 1.35m | 90.0 | 588614000 |
| stripping corner I 2.70m | 171.0 | 588675000 |
| stripping corner I 3.30m | 209.9 | 588676000 |

Stripping spindle I `588618000` 3.2 kg; with ratchet `588653000` 5.5 kg.

**Compensation:** closure plate **R30** (30 mm) 0.90m `588144000` 14.4 kg / 1.35m `588142000` 21.4 / 2.70m `588140000` 43.0 kg — width 38 cm. **Steel closure plate 5cm**: 1.35m `588272000` 7.9 kg, 2.70m `588273000` 14.0, 3.30m `588274000` 17.2 kg. **Fitting timber** (`Passholz`) in 2x12, 3x12, 5x12, 10x12 cm x 2.70/3.30 m — `176020000`–`176027000`, 3.1–19.0 kg (this is the timber make-up piece). **Moulded timber** (`Profilholz`) 18/21/27 mm x 2.70/3.30 m `176119000/176010000/176012000` etc. **Circular forming plate** 0.20/0.25/0.30 x 1.35 or 2.70 m `588235000`–`588240000` (30.3–67.4 kg).

**Clamps & connectors:** quick-acting clamp RU `588153400` 3.3 kg (L 20 cm) · **multi function clamp** `588169000` 5.8 kg (L 40 cm — used for stacking up to 5.40 m panel height before universal walings are needed) · adjustable clamp `588168000` 5.3 kg (L 48 cm) · universal fixing bolt 10-16cm `588158000` 0.60 kg / 10-25cm `583002000` 0.69 kg · wedge clamp `588152000` 1.5 kg · tensioning wedge R `588155000` 0.20 kg · wedge bolt RA 7.5 `588159000` 0.34 kg · clamping bolt 4-8cm `588107000` 0.39 kg.

**Walings:** universal waling 0.90m `588150000` 10.6 kg / 1.50m `588148000` 16.8 kg; **universal corner waling** `588151000` 12.8 kg (leg length 60 cm); **steel waling RD 0.40m** `588189000` 8.7 kg. Stop-end tie `588143000` 1.5 kg; pressure plate 6/15 `588183000` 0.80 kg; anchoring bracket `588188000` 1.4 kg; foundation clamp 0.90m `588141000` 4.9 kg.

**Monotec / one-sided tying:** ✅ *"Tying from one side only"* — Framax **combination nut 15.0** `588681000` 5.2 kg (width 27 cm), **anchor nut 15.0** `588684000` 2.7 kg (19 cm), **combination nut 20.0** `588683000` 6.1 kg, **anchor nut 20.0** `588687000` 3.6 kg. Doka's Monotec conical tie covers **wall thickness 15–35 cm with two tie types**.

**Panel struts (Doka's push-pull):** ✅ **Panel strut 340** `588246000` 30.2 kg = prop head `588244000` 3.5 kg x2 + prop shoe `588245000` 2.1 kg + **plumbing strut 340** `588247000` 14.2 kg (**190–341 cm**) + **adjusting strut 120** `588248000` 7.2 kg (**80–130 cm**). **Panel strut 540** `588249000` 49.0 kg = plumbing strut 540 `588250000` 29.6 kg (**309–550 cm**) + adjusting strut 220 `588251000` 10.2 kg (**171–224 cm**). Without prop head: 340 `580365000` 24.0 kg, 540 `580366000` 42.2 kg. **Eurex 60 550** (aluminium, single-sided/heavy): plumbing strut `582658000` 42.5 kg (343–553 cm), extension 2.00m `582651000` 21.3 kg, coupler `582652000` 8.6 kg, connector `582657000` 3.9 kg, strut shoe `582660000` 8.5 kg, adjusting strut 540 `582659000` 29.0 kg (302–543 cm).

**Platforms/safety:** Framax bracket 90 `588167000` 12.5 kg (W 103 x H 185 cm, railing included) · **Framax pouring platform O 1.25/2.70m** `588360000` 117.0 kg · **U 1.25/2.70m** `588377000` 127.5 kg · side handrail clamping unit T `580488000` 29.1 kg (115–175 cm, H 112 cm) · Doka express anchor 16x125mm `588631000` 0.31 kg · Doka coil 16mm `588633000` 0.009 kg · scaffold tube 48.3 mm in **1.00 to 6.00 m in 0.50 m steps** `682014000`–`682025000` at **3.6 kg/m** (1.00 m = 3.6 kg, 6.00 m = 21.6 kg — a clean linear rule for your model) · screw-on coupler 48mm `682002000` 0.84 kg (AF 22 mm) · scaffold tube connection `584375000` 0.27 kg.

**Handling:** Framax lifting hook `588149000` 10.6 kg · stacking cone `588234000` 0.02 kg · Doka 4-part chain 3.20m `588620000` 15.0 kg · transport bolt 5kN `588621000` 1.9 kg · transport gear `588232000` 13.3 kg · Dokamatic lifting strap 13.00m `586231000` 10.5 kg · **Fix-De-Fix remote uncoupling system 3150 kg** `586014000` 27.0 kg.

**Tie-hole plugs (consumables — one per unused hole):** Universal plug R20/25 `588180000` **0.003 kg**, blue Ø3 cm · Framax plug R24.5 `588181000` 0.003 kg, yellow Ø2 cm · Plug for closure plate R25 `588187000` 0.003 kg, black Ø3 cm. (PERI equivalent: Plug Ø20/24 `030300` 0.002 kg, **delivery unit 250 pcs**.)

Misc: triangular ledge 2.70m `588170000` 0.38 kg · frontal triangular ledge `588129000` 1.9 kg · connecting timber `176030000` 0.70 kg · Doka perforated tape 50x2.0mm 25m `588206000` 17.0 kg · Framax 3-in-1 pole tool `588678000` 4.2 kg (L 193 cm — lifting, plumbing, nail removal) · double scraper Xlife 100/150mm `588674000` 2.8 kg · formwork stripping timber 10x12cm 2.85m `176008000` 16.4 kg / 3.45m `176014000` 19.9 kg · wheel-around scaffold DF `586157000` 44.0 kg (195x80x290 cm) · Doka stacking pallet 1.55x0.85m `586151000` 42.0 kg / 1.20x0.80m `583016000` 39.5 kg · accessory box `583010000` 106.4 kg · bolt-on castor set B `586168000` 33.6 kg.

⚠️ Framax Xlife permissible fresh concrete pressure is widely quoted as **60 kN/m²** (Framax Xlife *plus* higher); the item list does not state it. Verify against Doka's "Framax Xlife User Information" before hardcoding.

### 1.3 Doka Frami Xlife / Alu-Framax ❌
Could not retrieve verified tables. **Frami Xlife** is the hand-set (crane-independent) light system: widths typically 0.30/0.45/0.60/0.75/0.90 m, heights 0.60/0.90/1.20/1.50/2.70 m, ~**50 kN/m²**, panel weights ~30–60 kg to stay manually handleable — treat all of this as unverified. **Alu-Framax Xlife** mirrors Framax geometry (same 15 cm grid, same accessories) in aluminium at roughly **60–65 % of steel weight**. Get real numbers from the Doka item lists at `https://www.doka.com/_ext/downloads/itemlists/...` (the `/me/91.pdf` pattern works; each system group has its own numbered PDF).

### 1.4 MEVA / ULMA / Faresin
- **MEVA Mammut 350** ⚠️: *"Permissible fresh concrete pressure (to DIN 18218) over entire surface of **100 kN/m²**"*, heights **350, 300, 250, 125 cm**, max panel contact area **8.75 m² (350 x 250 cm)** — the largest single panel in common use. Source: `https://www.meva.net/en-gb/products/mammut-350/`. MEVA's differentiators for your model: **alkus all-plastic formlining** (no plywood; different reuse economics — no ply replacement line item) and the **DW20 tie at only one tie per 2.5 m²**.
- **MEVA StarTec / AluFix** — StarTec = 60 kN/m² class crane-handled; AluFix = hand-set aluminium. ❌ unverified.
- **ULMA ORMA**: `https://www.ulmaconstruction.com/en/formwork/wall-formwork-column-formwork/panel-formwork-orma`. ⚠️ **The "80 kN/m²" figure in my notes was echoed back from my own query and is NOT independently confirmed — do not use it.** ORMA is the crane-handled steel-frame system (nominal panel 2.70 x 1.20 m, 120 mm frame); **NEVI** is the newer system; **ALUMA/ENKOFORM** are beam-and-waler.
- **Faresin** ❌ — no data retrieved. Faresin's range is Nuovo Faresin/Fast/Alusystem, generally 60–80 kN/m² with 2.70 x 1.20 m base module.

### 1.5 Aluminium monolithic systems (MIVAN / Kumkang / L&T) ⚠️

Critically for your software: **these are project-custom, not catalog products.** Panels are cut and welded to the specific building's wall layout, so there is no reusable SKU list — the "catalog" is per-project and generated from the architectural plan.

- Base module: **600 mm wide x floor height** (commonly 600 x 2400 mm quoted as "standard size"); wall panels range **300–1200 mm wide**, heights up to **2400 mm+** (i.e. full floor height in one lift, no horizontal joint).
- Alloy **6061-T6**, sheet ~**4 mm** face on extruded rib frame, ~**65 mm** overall panel depth (⚠️ one source states "6061-T6 (65 mm thick)" — that is the frame depth, not sheet thickness).
- Component vocabulary your data model must include: **wall panel, kicker** (base positioning strip that sets the first lift's line), **rocker** (lateral alignment of wall panels during casting), **deck panel** (slab soffit), **soffit/beam soffit**, **prop head / prop length**, **beam (deck beam)**, **stub pin, pin & wedge** (the universal connector — replaces every bolt), **tie rod**, **external corner, internal corner, dropped/drop panel, cat ladder/working platform bracket**.
- Reuse: **200–250 repetitions** ⚠️ (marketing claims run to 250–300). Cycle time **7–10 days per floor**.
- Indian commercial rate ⚠️ **₹45–65/sq ft (2025)**; code reference **IS 14687:1999** (guidelines for falsework).
- Design implication: because everything is pin-and-wedge on a 600 mm module with no ties on many walls, the layout problem is *tiling a fixed wall polygon with a custom panel set* — closer to a nesting/partition problem than to the "choose from catalog widths" problem of TRIO/Framax.

Sources: `iscodehub.com`, `acoformwork.com`, `gmsscaffolding.com`, `theconstructor.org`.

### 1.6 Column formwork

- **Doka column formwork KS Xlife** ✅: *"adjusting the cross-section anywhere between **20 and 60 cm, in 5 cm increments**"* — square and rectangular **20x20 to 60x60 cm**, **30 cm height grid**, column heights **up to 6.60 m**. Sources: `https://www.doka.com/us/system-groups/doka-wall-systems/column-formwork/ks-xlife/index`, `https://manualzz.com/doc/87300119/doka-column-formwork-ks-xlife-user-information`.
- **Framax/Frami as column formwork** ⚠️: universal panels give **up to 75 cm (Frami) / 105 cm (Framax) in 5 cm increments** using the universal panel's continuous tie slot.
- **PERI QUATTRO** ⚠️: 4-panel self-supporting column form, cross-sections typically **20–60 cm in 5 cm steps**, heights in 25/50 cm increments; **PERI SRS** = **circular** steel column formwork, diameters typically **25–150 cm** in fixed diameters (not adjustable). **PERI TRIO column (TRS)** panels 60x90 etc., rated **100 kN/m²** ⚠️ (dealer listing, item `054220`). ❌ I could not verify SRS/QUATTRO tables — fetch `peri.com` product data sheets.
- **Adjustable column clamps** (the traditional/low-cost option) ⚠️: steel angle clamps in sets of 4, common ranges **150–600 mm**, **300–900 mm**, **450–1200 mm**, adjustment via punched holes typically at **50 mm** pitch. Model as `min_size / max_size / increment / set_quantity=4`.

Note for the data model: column formwork needs a **fundamentally different sizing model** than wall panels — `(min_dim, max_dim, increment)` plus a **height stacking grid**, rather than a discrete width enumeration.

### 1.7 Table / slab formwork

**Doka Dokaflex (1-2-4)** ⚠️: *"floor slabs up to 30 cm thick"*, no structural design required; telescoping **primary (main) beams on props** + **secondary beams** carrying **21 mm ply**; height adjustment to within **1 cm** with extensions; beams carry **printed markings** for beam and prop spacing (the "1-2-4" is the marking rule: prop spacing / main beam spacing / secondary beam spacing). Components: **Dokaflex lowering head H20**, **supporting head H20 DF**, **Doka floor prop Eurex**, **Doka removable folding tripod**, **erecting tongs**. Source: doka.com Dokaflex pages, `direct.doka.com` PDFs.

**Doka Eurex props — real permissible-load table** ✅ (parsed from `https://www.doka.com/web/media/files/solutions/Floor-prop-Eurex_Permissible-load-capacity.pdf`, per approval **Z-8.311-942**). Load depends on **extension length AND on which end the outer tube is at ("bottom"/"top" — flipping the prop upside down increases capacity)**:

*Eurex 30 top* (kN), selected rows — columns are prop size 250/300/350/400/450/550:
| Prop length m | bottom | top |
|---|---|---|
| 1.7–1.5 (250) | — | 41.2 |
| 2.0 (250) | 37.0 | — |
| 2.5 (250) | 30.9 | 37.0 |
| 3.0 (300) | 30.9 | 34.8 |
| 3.5 (350) | 30.9 | 34.2 |
| 4.0 (400) | 31.5 | 34.2 |
| 4.5 (450) | 32.7 | 34.5 |
| 5.0 (550) | 41.2 | 41.2 |
| 5.5 (550) | 31.8 | 33.3 |

*Eurex 20 top* (kN): 3.0 m → 20.7 (bottom, 250) / 24.8 / 28.8 / 36.7 / 35.5 depending on size; 4.0 m → 21.5 bottom / 24.8 top; 4.5 m → 33.2 / 36.7; 5.0 m → 25.8 / 29.4; 5.5 m → 20.6 bottom / 22.7 top. **Capacity is non-monotonic in length** (it dips mid-range then rises where a shorter, stiffer tube configuration is used) — so your model **must** store this as a lookup table, never as a formula.

**EN 1065 prop classes** ⚠️: *"Type-tested according to EN 1065, class B/D. As a free construction support they carry **20 kN (2 t) at each extension length**. When clamped, **minimum 30 kN at any extension length**."* (`jh-itc.de`); Doka Eurex 20: *"min. 20 kN for each extension length, up to 31.8 kN depending on extension length"*. EN 1065 designates props as e.g. **30-250, 20-350** = (class kN)-(max length cm), classes **A–E**; class B and D are the common heavy classes. Class B props reach **up to ~39 kN** at 1.80–4.00 m ⚠️ (`scribd.com/document/898562763`).

**PERI SKYDECK / MULTIFLEX** ❌ — not verified. SKYDECK is the aluminium **panel slab system** (drophead + panel + beam, panel typically **150 x 75 cm**, ~**14–16 kg** to be one-man handled); MULTIFLEX is the **H20 beam + prop** flexible system (direct analogue of Dokaflex). Fetch PERI product data sheets.

**Drop-head props and tripods** — model fields: `drophead_lowering_travel_mm` (typically **6 cm**, which is what allows early stripping of beams while props stay), `tripod_fits_prop_diameter`, `tripod_weight_kg`.

---

## 2. Traditional / Conventional Formwork Materials

### 2.1 Film-faced plywood / shuttering ply ⚠️

**Sheet sizes (real trade sizes):**
| Size mm | Region / use |
|---|---|
| **1220 x 2440** | 4'x8' — global default, UK/US/India/Middle East |
| **1250 x 2500** | metric European standard (Wisa, Finnish/Baltic birch) |
| **1500 x 3000** | large-format, fewer joints on big walls |
| 1200 x 1800, 1220 x 1830 | 4'x6' — handleable half sheets |
| 1000 x 2000, 1220 x 3050 (4'x10') | less common |
| 2500 x 1250 vs 1250 x 2500 | **face-grain direction differs — not interchangeable structurally** |

**Thicknesses:** 9, **12, 15, 18, 21**, 24, 27, 30 mm. **18 mm is the formlining standard on TRIO and Framax** ✅ (PERI: *"Steel panel with 18 mm plywood"*; TRIO Structure uses **21 mm**; Doka Framax moulded timber offered in 18/21/27 mm ✅). Dokaflex/MULTIFLEX slab decking is **21 mm**.

**Species / grade and reuse expectation** ⚠️ (trade guidance, varies hugely — make this a per-product field, never a constant):
| Type | Typical reuses |
|---|---|
| Non-coated/plain shuttering ply (site-grade, hardwood core) | **3–8** |
| Film-faced **poplar** core, 120 g/m² film | **5–10** |
| Film-faced **mixed hardwood / eucalyptus** core, 220 g/m² film | **10–20** |
| Film-faced **birch** (Finnish/Russian/Baltic), WBP phenolic | **20–50** |
| **PERI FinPly / FinPly Maxi, Doka Xlife sheet** (branded, thicker film, edge-sealed) | **50–100+** |
| **alkus** all-plastic sheet (MEVA) | **100+**, repairable/weldable |

Key attributes to store: **film weight g/m² (120/140/167/220 g)** — this is the single best predictor of reuse count; **glue class WBP/phenolic (EN 314-2 Class 3)**; **edge sealing (acrylic/alkyd)**; **core species**; **face grain direction**; **EN 13986 CE marking**.

Sources: `teconform.com/products/tecon-form-film-faced-plywood/`, `buildingsupplieshub.com/film-faced-plywood-1220-2440-18-mm`, `murdockbuildersmerchants.com`, `fushiwoodgroup.com/product-18mm-film-faced-plywood.html`.

**Allowable pressure:** ply is not rated in kN/m² standalone — it is rated by **allowable span vs load**, governed by bending, shear and **deflection (usually limited to span/270 or span/360, or an absolute 1–3 mm for visible concrete)**. For 18 mm film-faced ply with face grain across supports, typical usable spans are **~250–300 mm at 60 kN/m²** and **~400–500 mm at 25–30 kN/m²**. Store as `span_table[(thickness, grain_direction, pressure)] -> max_span_mm`, plus `E_parallel_MPa`, `E_perp_MPa`, `f_m_MPa`, `section_modulus_per_m`.

### 2.2 Timber

**H20 / H16 / H24 engineered I-beams** ⚠️:
| | H16 | H20 | H24 |
|---|---|---|---|
| Depth | 160 mm | **200 mm** | 240 mm |
| Flange width | 80 mm | **80 mm** | 80 mm |
| Flange thickness | ~40 mm | **~40 mm** | ~40 mm |
| Web thickness | 10–12 mm | **10–12 mm** | 10–12 mm |
| Weight | ~4.5 kg/m | **~5.5 kg/m** | ~6.5 kg/m |

**Standard lengths (mm) — a genuinely non-uniform series your cut/BOM logic must respect:** ✅/⚠️
**1450, 1800, 2450, 2650, 2900, 3300, 3600, 3900, 4500, 4900, 5900** (Doka H20 top/eco/N and PERI GT24/VT20 follow this or a close variant; PERI VT 20 also 2.90/3.30/3.90/4.90/5.90). There is **no constant step** — 350, 650, 200, 250, 400, 300, 300, 600, 400, 1000 mm. Also offered "special length, cut to order" with a **cutting charge** (mirroring PERI's `030050 Cutting Cost Tie Rod DW 15` ✅ — your catalog needs a `cut_to_length_supported` + `cutting_charge` field).

**Capacities — the conflict you must model explicitly** ⚠️:
| Source | Bending | Shear | Stiffness EI |
|---|---|---|---|
| serwisbudowy.com (H20, allowable/permissible) | **5.0 kNm** | **11 kN** | **450 kNm²** |
| apacsafety.com H20 datasheet (resistance/characteristic) | **11 kNm** | **24 kN** | **460 kNm²** |

These are not contradictory — **5.0 kNm / 11 kN are permissible (working-stress, ~γ≈2.2) values; 11 kNm / 24 kN are characteristic/ultimate resistances**. Your data model needs **both** `M_allow_kNm` and `M_Rk_kNm` with an explicit `basis` enum (`permissible` | `characteristic` | `design`), or you will silently over-span decks by ~2x. EI ≈ **450–460 kNm²** is consistent across sources. Reuse **200–500 cycles** ⚠️ with covered storage. Sources: `https://www.serwisbudowy.com/en_US/p/Timber-beam-h20-shod/81`, `https://apacsafety.com/wp-content/uploads/2022/12/H20-Beam-Datasheet.pdf`, `https://vinawoodltd.com/blog/h20-timber-beam-formwork`.

**Nominal vs actual sawn timber (US) — the classic estimator trap:**
| Nominal | Actual (dry, S4S) | A mm² | S = bd²/6 mm³ | I = bd³/12 mm⁴ |
|---|---|---|---|---|
| 2x4 | 1.5 x 3.5 in = **38 x 89 mm** | 3,382 | 50,150 | 2.23e6 |
| 2x6 | 1.5 x 5.5 in = **38 x 140 mm** | 5,320 | 124,133 | 8.69e6 |
| 2x8 | 1.5 x 7.25 in = **38 x 184 mm** | 6,992 | 214,421 | 1.973e7 |
| 2x10 | 1.5 x 9.25 in = **38 x 235 mm** | 8,930 | 349,829 | 4.11e7 |
| 4x4 | 3.5 x 3.5 in = **89 x 89 mm** | 7,921 | 117,478 | 5.23e6 |

Note **2x lumber under 2x6 is 1/2 in undersize; 2x8 and up are 3/4 in undersize** (7.25 not 7.5). European site timber is nominal = actual: **50x100, 75x100, 100x100, 50x150, 75x150 mm**. Doka's own fitting timbers are **2x12, 3x12, 5x12, 10x12 cm** ✅. Store `nominal_designation`, `actual_width_mm`, `actual_depth_mm`, `S_mm3`, `I_mm4` separately — never derive actual from nominal.

### 2.3 Steel walers / soldiers

- **PERI walers** ✅ (verified): Compensation Waler **TAR 85** `023550`, 850 mm, 12.3 kg, **perm. moment 4.4 kNm**; **Waler 85** `023551` 8.52 kg, 4.4 kNm; **Waler MAR 85-3** `124941` 14.1 kg, **3.9 kNm**; **Universal Waler 245** `023920`, 2466 mm, 78.4 kg. PERI **SRU** (steel waler, U-profile, lengths ~0.75–3.00 m) and **SRZ** (heavier, twin-channel) ❌ — capacities not verified; fetch PERI's "System-Independent Accessories" brochure.
- **Doka Framax walings** ✅: universal waling 0.90 m (10.6 kg) / 1.50 m (16.8 kg); universal corner waling 12.8 kg; steel waling RD 0.40 m 8.7 kg. Doka **WS10 / WU16** universal walings are the beam-formwork range.
- **RMD Kwikform Superslim Soldier** ⚠️: *"available in **nine lengths**"*, high-yield steel; **allowable bending moment is published as a curve against "effective length of compression flange" (0–7 m)** — i.e. capacity depends on the **lateral restraint spacing**, not just the member. Practical rule from RMD: *"the Superslim soldier length must be between **40 & 60 mm shorter than the wall gap**"*. Sources: `rmdkwikform.com`, `altrad-coffrage.com` technical data sheet, `pdf4pro.com`. Superslim nominal lengths run roughly **0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.6, 4.2, 4.8 m** ⚠️ (verify). Model soldiers with `M_allow_vs_restraint_spacing[]` — a curve, not a scalar.

### 2.4 Tie systems — verified numbers ✅

| Tie | Thread/dia | **Permissible tension** | Note |
|---|---|---|---|
| **DW 15** (B 15) | 15 mm, coarse rolled thread | **90 kN** | PERI item `030030` family |
| **DW 20** (B 20) | 20 mm | **150 kN** | PERI item `030700` family |
| **DW 26** | 26.5 mm | ⚠️ ~**280–300 kN** | not in TRIO catalog |

⚠️ Cross-check from DYWIDAG Form Tie Systems (swaged she-bolts): 5/8" (15 mm) SWL **18.8 kips = 98 kN**, ultimate 37.5 kips; 7/8" (20 mm) SWL **39.2 kips ≈ 174 kN**, ultimate 78.4 kips; 1" (26 mm) SWL **63.7 kips ≈ 284 kN**, ultimate 127.5 kips. Note the reported kip→kN conversions in that table are internally inconsistent (18.8 kips = 83.6 kN, not 98) — **treat the kip values as authoritative and re-derive SI yourself.** The consistent engineering picture: **DW15 ultimate ≈ 165–190 kN, permissible 90 kN (γ≈1.9–2.1)**.

**DW 15 tie rod lengths and weights** ✅ — **1.44 kg/m** exactly:
`030005` 0.50 m 0.720 kg · `030010` 0.85 m 1.230 · `030480` 1.00 m 1.440 · `030490` 1.20 m 1.730 · `030170` 1.50 m 2.160 · `030020` 1.70 m 2.450 · `030180` 2.00 m 2.880 · `030710` 2.50 m 3.600 · `030720` 3.00 m 4.320 · `030730` 3.50 m 5.040 · `030160` 6.00 m 8.640 · `030030` **special length** · `030050` **cutting cost** (zero weight — a *service* line item, not a material: your catalog needs `item_kind = service`).
*"Non-weldable! Take official Approval into consideration!"*

**DW 20**: `030640` 0.50 m 1.280 kg · `030641` 1.00 m 2.560 · `030680` 6.00 m 15.400 · `030700` special · `030800` cutting cost. → **2.56 kg/m**.

**Nuts / plates** ✅:
| Item | No. | kg | Load | Spanner |
|---|---|---|---|---|
| Wingnut DW 15 | 030100 | 0.439 | **90 kN** | SW 27 |
| Wingnut DW 20 | 030990 | 0.786 | **150 kN** | SW 36 |
| Wingnut Pivot Plate DW 15 | 030370 | 1.660 | **90 kN**, max tilt **8°** | SW 27 |
| Cam Nut DW 15 | 030130 | 0.318 | **90 kN** | SW 27 |
| Counterplate DW 20 120x120x20 | 030830 | 2.180 | **150 kN** | Ø26 hole |
| Tie Yoke | 022030 | 2.170 | **90 kN** | Ø20 |
| Tie Rod Wrench 15 | 031070 | 1.260 | — | — |

**Spacer tubes & cones (the consumable per tie hole)** ✅:
- **Spacer Tube rough DR 22** (plastic, for DW15/B15): `065027` 2.00 m 0.359 kg (→ **0.18 kg/m**), `065031` 0.27 m 0.050 kg, `065030` 0.21 m 0.039 kg.
- **Cone DR 22** `065033` 0.010 kg, Ø21/Ø46, 32.5 mm long — **delivery unit 500 pieces**.
- **DK Cone DW 15/55** `031636` 0.063 kg — *"for **waterproof, fire-resistant and soundproof** anchor points"*, used with Spacer Tube rough 22, **delivery unit 50 pcs**. **DK Cone DW 20/55** `031637` 0.055 kg, used with Spacer Tube rough 28.
- **Plug Ø20/24** `030300` 0.002 kg — seals unused tie holes Ø20/22/24, **250 pcs/unit**.

**Water stops:** the **DK cone** system above is the water-tight tie (cone leaves a recess sealed with expanding mortar plug); the **MTF stopend panels** ✅ carry a **waterstop bar installation** groove at construction joints. For your BOM: a watertight wall needs `DK cone x2 + tie rod + spacer tube + 2 sealing plugs + patch mortar` **per tie**, roughly 3–5x the cost of a standard tie point.

**Taper ties & she-bolts (North American / one-side-removable practice)** ⚠️:
- **15 mm Euro taper tie**: taper diameter **0.752" to 0.866" (19.1 to 22 mm)**; *"Load capacity values include a **2:1 factor of safety**"* (`dss.net`). Taper ties are **fully reusable** (pulled out through the taper) — model `reusable: true`, `uses_expected: 50–100`, vs a DW15 through-tie in a spacer tube which is also reusable, vs a **lost/cast-in tie** which is `reusable: false`.
- **She-bolts**: Dayton Superior **D2** she-bolt works with **D1 or D18 inside rods** to span a range of wall thicknesses; **D30A** has *"2-1/2 threads per inch for rapid installation and stripping"*. Structure: `she_bolt (reusable, outside) + inner rod (lost, cast in) + coupling`. Sources: `daytonsuperior.com`, `concrete.dywidag.com`, `chontan.net/blog/formwork-tie-rod-guide`.

**Standard tie-hole grid on modular panels** ✅ — see §1.1. Summary of the invariants: **Framax = 1.35 m horizontal tie spacing** (the headline economy claim); **TRIO 270 = 2 tie levels, TRIO 330 = 4 tie levels**; **TRIO 240-wide panel = 2 tie columns**; **MEVA Mammut = 1 tie per 2.5 m²** ⚠️. Your model: `tie_positions: [{x_mm, y_mm, hole_dia_mm, tie_system}]` per panel type, because ties must **align across adjacent panels** or the tie cannot pass.

**One-sided tying** ✅: PERI **MX 15 / MX 18** ties (MAXIMO — no spacer tube needed, fixed wall-thickness cones); Doka **Monotec** (2 tie types cover 15–35 cm walls) + Framax **combination nut / anchor nut 15.0 & 20.0**.

### 2.5 Consumables

**Release agent coverage (m²/L)** ⚠️ — depends on absorbency, so store per form-face type:
| Form face | Coverage | Source |
|---|---|---|
| Steel / plastic / aluminium | **40–60 m²/L** (Sika Release Oil: 50–60) | spcsupplies.com, dcp-int.com, ind.sika.com |
| Coated / film-faced plywood, HD ply | **25–50 m²/L** (Sika: 40–50; Formcoat F200: 25–35) | as above |
| Untreated timber / sawn boards | **20–30 m²/L** (Sika Separol Plus: 30) | as above |
| Textured/striated ply | **25–35 m²/L** | dcp-int.com |

Products named: **Sika Release Oil**, **Sika Separol Plus**, **DCP Formcoat F200**, **MIXRELEASE S50** (30–40 m²/L). For estimating use **~45 m²/L on steel panel systems, ~30 m²/L on ply** and apply per **contact-area-use**, not per m² of wall once.

**Per-tie-hole consumable set** (build this as a composite/kit in your model):
`2 x cone (or DK cone) + 1 x spacer tube (length = wall thickness) + 2 x wingnut (reusable, not consumed) + 2 x plug/patch` — and for exposed concrete, **patching mortar ~0.05–0.1 kg per Ø22–25 mm hole** ⚠️ plus labour ~**1–2 min/hole**.

**Nails** ⚠️: site rule of thumb **~0.3–0.5 kg of nails per m² of timber formwork** (65–100 mm round wire); for panel systems ≈ 0. **Tie tubes** — see spacer tubes above. **Form-tie plugs** — `030300` @ 250/pack, `588180000/588181000/588187000` @ 0.003 kg.

**Scaffold brackets / platforms / railings** ✅ — see §1.1 and §1.2. The universal numbers: bracket working load **150 kg/m²** with **max 1.35 m width of influence** (PERI TRG); Doka Framax bracket 90 = **103 cm wide platform, 185 cm high railing**; guardrail post heights **1050–1350 mm**; scaffold tube **Ø48.3 mm @ 3.6 kg/m** in 0.5 m steps.

---

## 3. Plywood Cut Optimisation & Panel Layout in Practice

### 3.1 How contractors actually lay out a wall

1. **Start from the corners, work toward the middle.** Corner units (inside/outside/hinged) are placed first because they are fixed-geometry and non-negotiable; the **make-up piece lands in the middle of a wall run or at a T-junction**, where a poor joint is least visible and least structurally awkward. This is the opposite of how a naive left-to-right greedy packer works, and it's the single most important domain rule to encode.
2. **Full sheets/panels first, then descending widths, then compensation.** For TRIO the cascade is 240 → 120 → 90 → 72 → 60 → 30 → WDA 5/6/10 → LA filler 6–36 cm → TPP/TPA + cut 21 mm ply. Encode as an **ordered preference list with a cost/labour penalty per step** — each descent adds a joint, a coupler, and stripping time.
3. **Joints are aligned (stack bond), not staggered (running bond)** — the reverse of masonry. Reasons: (a) **tie holes must line up** across panels or the tie rod physically cannot pass; (b) a continuous vertical joint line reads as a deliberate architectural feature, whereas staggered joints read as a defect; (c) walers and brackets clamp across the joint and need coincident frame profiles; (d) panels are assembled as **gangs** that get craned as a unit and re-used identically on the next lift. Running bond appears only where panel heights are stacked and the supplier explicitly permits offset (and then multi-function clamps / universal walings are added — Doka: stacking to **5.40 m** with multi-function clamps before universal walings become mandatory ✅).
4. **Horizontal joint = the lift/pour line.** Panel height is chosen so `n x panel_height >= lift_height`; the top panel over-sails and the concrete stops below the top edge (typically 50–150 mm freeboard). A **kicker** (75–150 mm) sets the base line.
5. **Minimum offcut worth keeping:** ply strips narrower than about **100 mm (4 in)** are scrap — they split when nailed and cannot span between walers. Practically, keep offcuts **≥150 mm wide x ≥600 mm long** for filler/soffit use; below that, waste. For **length**, pieces under ~**300 mm** aren't worth handling. Encode as `min_keep_width_mm`, `min_keep_length_mm`, `min_keep_area_m2` on the stock/offcut policy — plus a **grain-direction constraint** (offcuts rotated 90° have different span capacity and often cannot substitute).
6. **Cut ply always sits behind a support.** A cut piece's edge must land on a waler/beam; you can't have an unsupported cut edge. So the cut layout is **constrained by the beam/waler grid**, making this a *constrained* nesting problem, not free nesting.

### 3.2 Wastage allowances ⚠️

| Material | Allowance | Source |
|---|---|---|
| Plywood / sheet goods | **5–10 %** | civilnotess.com, civilshape.in |
| Formwork timber (sawn) | **5–10 %** (often 10 % for complex geometry) | civilshape.in, trybuildcalc.com |
| Nails / consumables | 10 % | trade practice |
| Steel/aluminium panels | ~0 % (damage/loss allowance **2–5 %** on hire) | trade practice |

Practical split your model should support: **cutting waste (geometric, computable from the nest)** + **handling/damage waste (a flat %)**. Reporting them together as one 10 % blurs a number your optimiser can actually reduce.

### 3.3 Algorithms — practical recommendations

**Constraint that decides everything: a panel saw / beam saw makes only edge-to-edge cuts, so the layout must be *guillotineable*.** ⚠️ *"Every cut goes edge to edge across the sheet. This mirrors how a panel saw, table saw, or beam saw works"* — `cutoptim.com/docs/2d-panel-cutting`; *"Free nesting places parts anywhere and can pack tighter, but its layouts often cannot be cut on a saw at all"* — `cutoptim.com/guides/how-cutting-optimization-works`.

| Algorithm | Guillotine? | Typical waste | Speed | Fit for formwork |
|---|---|---|---|---|
| **FFD / BFD shelf (next-fit / first-fit decreasing height)** | ✅ 2-stage | 12–25 % | O(n log n), instant | **Best default.** 2-stage guillotine = rip into strips, then cross-cut — exactly how site/yard saws work. Very explainable to a foreman. |
| **Guillotine (recursive split, best-area/best-short-side fit)** | ✅ n-stage | 8–15 % | fast | **Recommended production choice.** Keeps a free-rectangle tree; each placement splits the remainder horizontally or vertically. Directly emits a cut sequence. |
| **MaxRects (BSSF/BAF/BL heuristics)** | ❌ | 5–12 % | fast, more bookkeeping | Tighter, but layouts often **not sawable**. *"The pure 2D bin-packing literature has prettier solutions (the Maximal Rectangles algorithm, skyline heuristics, or full ILP solvers)"* — dev.to/kavelaltd. Use only if you cut with a CNC router/jigsaw. |
| **Skyline (bottom-left with skyline)** | ❌/partial | 8–15 % | fast | Good for strip-like parts; poor cut sequencing. |
| **Column generation / set-covering LP (Gilmore–Gomory)** | ✅ if patterns are | **near-optimal, 3–8 %** | seconds–minutes | Correct choice when **many identical sheets and repeated piece sets** — which is exactly formwork (same wall repeated per floor). Generate guillotine patterns, solve LP relaxation, round. |
| **Simulated annealing / GA over placement order** | depends | 5–10 % | seconds | Cheap upgrade: keep guillotine placement, metaheuristically search the **insertion order** and per-piece **rotation** flags. Best effort/benefit ratio. |

**Recommended architecture:** *piece-order metaheuristic (SA over sort keys + rotation) wrapping a recursive guillotine placer, with the free-rectangle tree emitting an ordered cut list.* Then, for repeated floors, layer a **pattern-based set-covering pass** to exploit repetition. Constraints to bake in: **grain direction (rotation allowed only if `grain_agnostic`)**, **saw kerf (3–4 mm — non-negligible; 12 cuts across 1220 mm loses ~40 mm)**, **trim/edge allowance on damaged reclaimed sheets**, **min offcut retention**, and **piece-to-support-grid alignment**.

### 3.4 Reuse counts → cost per use

| Material | Uses (design basis) | Note |
|---|---|---|
| Plain/site shuttering ply | **3–8** | ⚠️ |
| Film-faced ply (poplar/hardwood) | **5–20** | ⚠️ |
| Branded film-faced (FinPly, Xlife sheet) | **50–100** | ⚠️ |
| alkus plastic sheet | **100+**, repairable | ⚠️ MEVA |
| H20/H16 timber beams | **200–500** | ⚠️ vinawoodltd |
| Steel panel frames (TRIO/Framax) | **100–500+** (frame life ~ indefinite; **formlining is the consumable**) | ⚠️ |
| Aluminium monolithic (MIVAN) | **200–250** | ⚠️ iscodehub |
| Tie rods DW15 (through-tie, in tube) | **20–100** | ⚠️ |
| Taper ties | **50–100** | ⚠️ |
| Cones, spacer tubes, plugs | **1 (lost)** | ✅ consumable |

**Cost-per-use model:**
```
cost_per_m2_per_use = (purchase_price / (expected_uses x usable_area_m2))
                    + refurb_cost_per_use_per_m2      # ply replacement on panels
                    + (consumables_per_use / area)    # cones, tubes, plugs, release agent
                    + labour_per_m2 (erect + strip + clean)
                    + transport_amortised
                    + finance/holding
```
Crucially, for a **steel panel** the frame amortises over ~300 uses while its **18 mm ply formlining amortises over ~30–50** — so a panel is a **composite asset with components on different depreciation clocks**. Your data model must support that (see §4.4).

---

## 4. Costing / Commercial Structures

### 4.1 Pricing bases
- **Purchase**: per panel/item, or per **m² of formwork area**.
- **Rental/hire**: ⚠️ *"Formwork hire rates are structured as weekly charges per item or per square metre of contact area"* (`formwork.expert/services/formwork-hire/`). Common forms: **% of list price per month** (typically **2–4 %/month** of new value for panel systems), or **currency per m² per month**. Rentals carry **minimum hire period**, **loss/damage recharge at list price**, **cleaning charge per m²**, and **repair charge (ply replacement) on return**. Sources: `bfs-industries.com/blog/concrete-formwork-pricing/`, `latestcost.com/concrete-form-rental-cost-pricing/`, `constructionrates.co.uk`.
- **MIVAN aluminium** ⚠️: **₹45–65/sq ft (2025)** all-in (`iscodehub.com`) = roughly ₹485–700/m².
- **Labour**: per m² of contact area, by element type.
- **Crane**: hours; a 240-wide TRIO gang at 50 kg/m² and ~10 m² is ~500 kg + accessories — well inside a tower crane's radius capacity, but **crane cycles, not tonnage, are the constraint**. Budget **~4–8 gang moves/hour** for a well-drilled crew.

### 4.2 Labour norms (m²/carpenter-day) ⚠️

Sources: `civilguidelines.com/articles/carpenter-shuttering-beam.html` (*"a skilled carpenter can achieve **12–15 square metres per day**"* for beam shuttering), `scribd.com/document/638208098/Labour-Productivity-Chart`, `scribd.com/document/701341812`, `scribd.com/document/344832532` (*"24 types of carpentry formwork with expected production rates in m²/hour for different crew sizes"*), `infralens.in/formats/estimation/rate-analysis-shuttering-formwork`.

Indicative norms — **store as data, per element x system x cycle-number**, because they vary 3x:
| Element | Conventional ply/timber | Panel system (2nd+ use) |
|---|---|---|
| Walls | 8–12 m²/cd | **20–35 m²/cd** |
| Columns | 6–10 m²/cd | 15–25 m²/cd |
| Beams | **12–15 m²/cd** | 15–20 m²/cd |
| Slab soffit | 10–15 m²/cd | 25–40 m²/cd |
| Footings/rafts | 10–14 m²/cd | 20–30 m²/cd |
| Stairs | 4–7 m²/cd | — |
| **Stripping** | ~**2–3x the erecting rate** (i.e. 25–45 m²/cd) | 40–70 m²/cd |

Modifiers to include as multipliers: **first use x1.5–2.0 (learning + fabrication)**, repetition curve, height above ground, congestion, night work, and a **strip:erect ratio ~0.35–0.5**.

### 4.3 Standard measurement rules

**IS 1200 Part 5 : 1982 (India)** ✅ verified:
- *"Formwork shall be measured in **square metres as the actual surfaces in contact with the concrete** or any other material requiring formwork."* (Clause 6)
- *"**No deductions shall be made for each opening up to 0.4 m²**."* (Clause 6.4)
- *"No deduction shall be made for any opening/cutouts when **slip form** technique is used."*
- Source: `https://law.resource.org` IS 1200-5 (1982); corroborated at `testbook.com`, `iscodehub.com`.

**RICS NRM2, Section 11 In-situ Concrete Works** ✅ (parsed the actual rules table, *"Effective from 1 January 2013"*, p.155):
| Item | Unit | Levels |
|---|---|---|
| **22 Faces of walls and other vertical work** | **m²** | 1 Vertical / 2 Battered one face / 3 Battered both faces. *Rate of batter to be stated. Work to single sides shall be so described.* |
| **23 Extra over — openings** | **nr** | Openings for doors or the like, **thickness of wall stated**: 1 **≤ 5.00 m²**; 2 **5.00–10.00 m²**; 3 **> 10.00 m²**. *All additional labour and material needed to form the opening is **deemed included**.* |
| **24 Wall ends, soffits and steps in walls** | **m / m²** | 1 **≤ 500 wide, width stated**; 2 **> 500 wide**. *Excludes ends and soffits of walls created by the formation of an opening — these are **deemed included in the item for forming the opening**.* |
| **25 Soffits of sloping work** | m² | 1 sloping one way / 2 sloping two ways. *Includes soffits of slabs, ramps, steps, staircases.* |
| **26 Staircase strings and the like** | m | max width stated |
| **27 Staircase risers** | m | 1 vertical, width stated / 2 undercut, width stated |
| **28 Sloping top surfaces** | m² | 1 **≤ 15°** / 2 **> 15°** |
| **29/30 Steps in top surfaces / in soffits** | m | 1 **≤ 500 high, width stated** / 2 **> 500 high** |
| **31 Complex shapes** | **nr** | dimensioned description or diagram; **1 propping ≤ 3 m; 2 over 3 m ≤ 4.5 m; 3 thereafter in 1.5 m stages** |
| **32 Wall kickers** | **m** | 1 plain / 2 suspended. ***Length measured along centre line and is deemed to include both sides.*** |

Three NRM2 rules with real software consequences: **openings are "extra over" counted in `nr` by area band, not deducted in m²**; the **500 mm threshold flips the unit from m to m²**; and **kickers are measured once along the centre line but priced for both faces**.

**CESMM (Class G, Concrete Ancillaries)** ⚠️ — I could not retrieve the clause text. Structure: formwork classified by **finish (rough/fair/other stated)** x **surface orientation (horizontal / sloping ≤ or > 1:4 / vertical / curved to one or two directions)** x **width band (≤0.1 m, 0.1–0.2 m, 0.2–0.4 m, 0.4–1.22 m, >1.22 m stated)**; measured m² (or m / nr for narrow widths); **voids ≤ 0.5 m² not deducted** ⚠️ — verify before use.

**POMI (Principles of Measurement International)** ⚠️ — not verified; generally measures formwork as contact area with no deduction for voids **≤ 1.00 m²** ⚠️.

**Design your model to hold all four rule sets simultaneously**, since the same wall yields different quantities under IS 1200 (0.4 m² deduction), NRM2 (extra-over nr), and CESMM (width bands). This is a `MeasurementStandard` strategy, not a constant.

**Fresh concrete pressure standard — DIN 18218:2010-01** ✅ (parsed the English translation): *"Pressure of fresh concrete on vertical formwork."* Supersedes DIN 18218:1980-09. Key changes in 2010 that matter for your calculations: **(b) loads determined using partial safety factors** (so you get characteristic *and* design pressures); **(c) influence of fresh concrete temperature**; **(d) influence of compaction/vibration**; **(e) method amended for consistency classes F5, F6 and SCC**. Scope: concrete to DIN EN 206-1 / DIN 1045-2 and SCC to the DAfStb SCC guideline, **max aggregate 63 mm**; applies to vertical formwork **and formwork deviating from vertical by up to ±5°**. So `max_concrete_pressure_kNm2` on a panel is only meaningful alongside **`pressure_standard` (DIN 18218:2010 vs :1980 vs ACI 347)** and the pour parameters **(rise rate m/h, concrete temperature, consistency class, setting time t_E, vibration depth, density)**. Also parsed **ACI 347-04** *Guide to Formwork for Concrete* (US counterpart, with its own P_max formulas for walls/columns and the 150 lb/ft³ basis).

### 4.4 What a formwork BOQ / BOM / delivery ticket / lift schedule contains

**Formwork BOQ line (measured work):**
`item_code · description · measurement_standard_ref (e.g. NRM2 11.22.1) · element_type · finish_class · unit (m²/m/nr) · quantity · wastage_% · net_qty · material_rate · labour_rate · plant_rate · rate_total · amount · cost_code/WBS · location/zone · pour/lift_ref · revision · remarks`

**Bill of materials (system take-off, per lift/gang):**
`line_no · manufacturer · system · item_no (part number) · description · qty_required · qty_per_panel_assembly · unit_weight_kg · total_weight_kg · contact_area_m2 · owned_vs_hired · rate · rental_rate_per_month · duration_months · amount · store_bin_location · condition_grade · parent_assembly_id`

**Delivery ticket / despatch note:**
`ticket_no · date/time · supplier & depot · customer & site · project_no · order/contract_no · vehicle reg & type · driver · gross/tare/net weight · pallet/stillage IDs · line items (item_no, description, qty despatched, qty received, unit weight) · total weight & total items · crane/offload requirement · returnable-packaging flag · signature (despatch/receipt) · discrepancy/damage notes · on-hire start date · GPS/geotag`

**Lift schedule (pour schedule) — the operational spine:**
`lift_id · zone/grid ref · level/floor · element (wall W1, core C2) · lift_number (of n) · base_level & top_level (RL) · lift_height_m · wall_thickness_mm · contact_area_m2 (both faces) · concrete_volume_m3 · concrete_grade & mix · pour_rate_m3/h · rise_rate_m/h · design_concrete_pressure_kNm2 · gang_id & panel_configuration_ref · tie_count & tie_type · props/braces required · reinforcement_release_date · formwork_erect_start/finish · pre-pour_inspection_signoff · pour_date & duration · concrete_temp · strip_date (from maturity/strength criteria) · min_strip_strength_MPa · crane_lifts_required & heaviest_lift_kg · crew_size & planned_manhours · next_use_of_gang (lift_id) · cycle_days · status · actual vs planned`

---

## 5. Proposed Data Model

Designed around the pain points the research exposed: **units and basis ambiguity, item-number-vs-weight drift, composite assets with different depreciation clocks, capacity as tables/curves not scalars, and multiple measurement standards.**

### 5.1 `CatalogEntry` — base for every product

```
id                       uuid
manufacturer             enum(PERI, DOKA, MEVA, ULMA, FARESIN, RMD, MIVAN, KUMKANG, GENERIC, ...)
system_family            str      # "TRIO", "Framax Xlife", "Dokaflex", "H20", "DW15"
item_no                  str      # "022550", "588100500"  -- manufacturer part number
item_no_scheme           enum(peri_6digit, doka_9digit, ean, internal)
catalog_source           str      # doc ref: "PERI TRIO 12/2017 790102"
catalog_edition_date     date     # weights DRIFT between editions -- version this
source_url               url
verification             enum(manufacturer_catalog, manufacturer_web, dealer, third_party, estimated)
description              str
description_native       str      # "Framax-Ausschalecke I" -- German names appear on tickets
item_kind                enum(panel, corner, filler, stopend, tie, nut, cone, tube, plug,
                              clamp, coupler, waler, soldier, beam, prop, brace, kicker,
                              bracket, platform, guardrail, sheet, timber, consumable,
                              handling, service, assembly)
category_path            str[]
uom                      enum(each, m, m2, m3, kg, set, pack, litre, hour)
pack_qty                 int?     # 250 (plugs), 500 (cones), 50 (DK cones)
weight_kg                decimal? # NULL is valid: "Cutting Cost" has zero/no weight
weight_basis             enum(nominal, measured, per_metre)
weight_per_m_kg          decimal? # 1.44 (DW15), 2.56 (DW20), 3.6 (tube 48.3), 5.5 (H20)
dims_mm                  {l, w, h}?
material                 enum(steel_galv, steel_powder, aluminium, timber, plywood,
                              plastic, alkus, composite)
surface_finish           str?     # "Galvanised, powder-coated"; "Corners marked in blue"
colour_code              str?     # blue/yellow/grey/black -- real field, encodes variant
formlining               {type, thickness_mm, brand}?   # 18mm ply / 21mm / steel / alkus
consumable               bool
returnable               bool
expected_uses            int?     # 5..500
expected_uses_source     enum(manufacturer, industry_norm, company_history, estimated)
contact_area_m2          decimal? # panel form face -- drives all m2 costing
requires                 [{item_no, qty}]   # "Complete with 44 pc 030300 Plug"
compatible_systems       str[]
substitutes              [item_no]
supersedes / superseded_by  item_no?
notes                    str[]    # "Non-weldable!", "Follow Instructions for Use!"
status                   enum(active, discontinued, hire_only, custom_fabricated)
custom_fabricated        bool     # TRUE for all MIVAN wall panels
```

### 5.2 `PanelType` (extends CatalogEntry)

```
nominal_width_mm         int      # 300,600,720,900,1200,2400 (TRIO) | 300..1350 (Framax)
nominal_height_mm        int      # 600,900,1200,2700,3300
frame_depth_mm           int      # 120 (TRIO & Framax) -- invariant per system
system_grid_mm           int      # 150 (Framax); 300 (TRIO widths) -- for layout snapping
panel_role               enum(standard, universal, large_area, multi, structure,
                              inside_corner, outside_corner, hinged_inside, hinged_outside,
                              articulated, stripping_corner, shaft, stopend_closed,
                              stopend_centre_MT, stopend_centre_MTF, stopend_external_AT,
                              filler_plate, wall_thickness_comp, closure_plate, column)
corner_geometry          {angle_deg, leg_a_mm, leg_b_mm, hinged: bool,
                          angle_min_deg, angle_max_deg}?   # TGE: 75..(180)
compensation_range_mm    {min, max, increment}?  # LA plate 60..360; WDA discrete [50,60,100]
# --- pressure: NEVER a bare scalar ---
pressure_ratings         [{ value_kNm2,           # 60 / 80 / 100
                            standard,             # DIN 18218:2010 | :1980 | ACI 347
                            basis,                # permissible | characteristic | design
                            condition }]          # "full height" | "with 3 stopend walers"
                                                  #  | "wall <= 400mm" | "panel body only"
max_pour_height_mm       int?
# --- tie geometry: the hard constraint for layout ---
tie_system               enum(DW15, DW20, DW26, MX15, MX18, Monotec, taper, shebolt, none)
tie_positions            [{x_mm, y_mm, hole_dia_mm, role}]  # role: primary|optional|grid
tie_hole_dia_mm          int[]    # [20,22,24] -- Plug 030300 covers all three
tie_grid_continuous      {start_mm, pitch_mm, count, margin_mm}?  # TRM: 19 x 30 = 570, 75 margin
horizontal_tie_pitch_mm  int?     # 1350 (Framax headline)
ties_per_panel           int
connection_method        enum(BFD_coupler, framax_clamp_RU, wedge_clamp, pin_and_wedge, bolt)
connectors_per_joint     {vertical: int, horizontal: int}
max_stack_height_mm      int?     # 5400 with multi-function clamp (Framax)
stack_requires_above_mm  {height_mm, extra_item_no}?   # >5400 -> universal waling
lifting                  {max_load_kg, sling_angle_max_deg, lifting_item_no}
stackable_qty            int?     # 2..5 (Stacking Device MAXIMO)
stack_load_limits        {per_post_kg: 650, per_stack_kg: 2600}?
striking_clearance_mm    int?     # 30 (shaft elements)
min_shaft_edge_mm        int?     # 1300
platform_attachable      bool
bracket_load_kNm2        decimal? # 150 kg/m2 -> 1.47
bracket_influence_w_mm   int?     # 1350
```

### 5.3 `TieType`

```
designation              str      # DW15, DW20, DW26, MX15, Monotec, "5/8in taper"
thread_form              enum(dywidag_coarse_rolled, metric, imperial_coil, taper, none)
nominal_dia_mm           decimal  # 15.0, 20.0, 26.5
imperial_equiv           str?     # 5/8", 7/8", 1"
perm_tension_kN          decimal  # 90 (DW15), 150 (DW20)
char_tension_kN          decimal?
ultimate_tension_kN      decimal?
safety_factor            decimal  # ~2.0 -- state it; sources disagree on derived SI values
load_basis               enum(permissible, SWL_with_FoS, characteristic, ultimate)
load_source_url          url
weldable                 bool     # FALSE for DW15/DW20 -- catalog says "Non-weldable!"
reusable                 bool
expected_uses            int?
one_sided                bool     # MX15/MX18, Monotec, taper, shebolt
requires_spacer_tube     bool     # FALSE for MX -- big consumable-cost difference
spanner_size_mm          int?     # SW27 (DW15), SW36 (DW20)
available_lengths_mm     int[]    # [500,850,1000,1200,1500,1700,2000,2500,3000,3500,6000]
length_item_map          {length_mm -> item_no}
cut_to_length            {supported: bool, service_item_no: "030050", charge_per_cut}
weight_per_m_kg          decimal  # 1.44 | 2.56
wall_thickness_range_mm  {min, max}?   # Monotec 150..350
# accessory bindings
nut_options              [{item_no, type: wingnut|cam|pivot_plate|combination|anchor,
                            perm_load_kN, weight_kg, max_tilt_deg}]
cone_options             [{item_no, type: standard|DK_watertight, dia_mm, length_mm,
                            pack_qty, watertight, fire_rated, sound_rated}]
spacer_tube              {item_no, dia_mm, weight_per_m_kg, cut_to_wall_thickness: true}
plug_item_no             str
# per-tie-point consumable kit -> feeds BOM automatically
consumable_kit           [{item_no, qty_per_tie}]
patch_mortar_kg_per_hole decimal?
labour_min_per_tie       decimal?
```

### 5.4 `Accessory`

```
accessory_role           enum(prop, kicker_brace, brace_frame, waler, soldier, beam,
                              bracket, platform, guardrail, mesh_barrier, clamp, coupler,
                              lifting, stacking, tool, anchor, chamfer, tape, plug)
# --- adjustable length: model as range + increment, not a single length ---
length_min_mm            int?     # 1300 (RS 210)
length_max_mm            int?     # 2100
length_increment_mm      int?     # 5 (MX brace: 0.5 cm steps)
telescopic               bool
# --- capacity is a TABLE or CURVE, not a scalar ---
capacity_model           enum(scalar, table_vs_extension, curve_vs_restraint, external_ref)
capacity_scalar          {value, unit, basis}?      # BFD coupler: 20 kN tension
capacity_table           [{extension_mm, orientation: bottom|top, size_variant,
                            load_kN, standard: "EN 1065", approval_ref: "Z-8.311-942"}]
capacity_curve           [{restraint_spacing_mm, M_allow_kNm}]   # RMD Superslim
capacity_external_ref    str?     # "see PERI Design Tables" -- a REAL catalog state
en1065_class             enum(A,B,C,D,E)?
en1065_designation       str?     # "30-250"
perm_moment_kNm          decimal? # TAR 85: 4.4 | MAR 85-3: 3.9
perm_shear_kN            decimal?
EI_kNm2                  decimal? # H20: 450-460
section                  {depth_mm, flange_w_mm, flange_t_mm, web_t_mm}?
tube_od_mm               decimal? # 48.3
available_lengths_mm     int[]    # H20: [1450,1800,2450,2650,2900,3300,3600,3900,4500,4900,5900]
length_series_regular    bool     # FALSE for H20 -- irregular; TRUE for scaffold tube (500mm step)
platform_udl_kNm2        decimal? # 150 kg/m2
platform_influence_w_mm  int?     # 1350
platform_width_mm        int?     # 1030 (Framax bracket 90)
guardrail_height_mm      int?     # 1050..1350
mounts_to                str[]    # ["vertical_strut","horizontal_strut","top_strut"]
attach_from_above        bool
self_securing            bool
sub_components           [{item_no, qty, label}]  # Panel strut 340 = A+B+C+D
drophead_travel_mm       int?     # ~60
fits_prop_dia_mm         decimal?
anchor_drill_dia_mm      decimal? # 14
```

### 5.5 `CostRecord` / `RentalRecord`

```
id, item_no | panel_type_id | assembly_id
record_type          enum(purchase, rental, labour, transport, crane, consumable,
                          refurbishment, loss_damage, cleaning)
pricing_basis        enum(per_item, per_m2_contact, per_m2_per_month, per_m2_per_week,
                          pct_of_list_per_month, per_kg, per_m3_concrete,
                          per_m2_per_use, per_hour, per_manday)
currency, price, price_date, fx_rate_to_base
region / depot / supplier
price_list_ref, quote_ref, contract_ref
# --- rental specifics ---
rental_rate, rental_period      enum(day, week, month)
pct_of_list_per_month           decimal?   # 2..4 %
min_hire_period_days            int
on_hire_date, off_hire_date, chargeable_days
idle_time_chargeable            bool
cleaning_charge_per_m2, repair_policy, loss_recharge_pct_of_list  # often 100 %
# --- amortisation: composite asset, components on DIFFERENT clocks ---
amortisation         [{component: "frame"|"formlining"|"tie"|"cone",
                        purchase_price, expected_uses,      # 300 vs 40 vs 50 vs 1
                        residual_value_pct, refurb_cost_per_cycle,
                        refurb_interval_uses }]
cost_per_use, cost_per_m2_per_use, uses_to_date, remaining_uses
# --- labour ---
labour_norm          {element_type, operation: erect|strip|clean|move,
                       m2_per_manday, manhours_per_m2,
                       first_use_factor: 1.5..2.0, repetition_curve[],
                       height_factor, crew_size, trade: carpenter|helper}
# --- plant ---
crane                {lifts_required, heaviest_lift_kg, hours, rate_per_hour}
transport            {truck_loads, payload_kg, rate_per_load, km, return_leg}
# --- consumables ---
consumption_rate     {basis: per_tie|per_m2_per_use|per_m2_of_face,
                       qty, uom}                       # release agent 45 m2/L steel, 30 m2/L ply
wastage_pct          {cutting: computed_from_nest, handling_damage: 0.05..0.10}
# --- measurement linkage ---
measurement_standard enum(IS_1200_5, NRM2, CESMM4, POMI, ACI, custom)
measured_qty, measured_unit, deduction_rule_applied
cost_code / WBS / activity_id
```

### 5.6 Supporting types worth defining

```
SheetStock:   { sheet_id, product_id, width_mm, height_mm, thickness_mm,
                grain_direction: enum(length,width,none), grain_rotatable: bool,
                condition: enum(new, used_n, patched, scrap), uses_to_date,
                usable_width_mm, usable_height_mm, trim_allowance_mm,
                film_weight_gsm, glue_class, edge_sealed, species,
                span_table[(pressure_kNm2, grain) -> max_span_mm] }

CutPlan:      { plan_id, stock_sheets[], pieces[{piece_id, w, h, qty, rotatable,
                  grain_required, destination(element, lift_id), must_land_on_support}],
                algorithm: enum(shelf_ffd, guillotine_recursive, maxrects, colgen, sa_guillotine),
                guillotine_required: bool, kerf_mm: 3..4,
                min_keep_width_mm, min_keep_length_mm,
                placements[{sheet_idx, piece_id, x, y, rotated}],
                cut_sequence[{stage, axis, offset_mm}],   # emit real saw instructions
                offcuts[{w,h,keep:bool}],
                yield_pct, waste_area_m2, sheets_used }

PanelLayout:  { wall_id, start_corner_ref, direction, lift_id,
                courses[{y_mm, height_mm, panels[{panel_type_id, x_mm, orientation,
                  is_makeup, connectors[], ties[]}]}],
                joint_mode: enum(stack, running),   # stack is the DEFAULT for formwork
                tie_alignment_verified: bool,
                makeup_position: enum(mid_run, at_tee, at_corner),
                compensation_chain[],  # panels -> WDA -> filler plate -> cut ply
                total_contact_area_m2, total_weight_kg, tie_count, crane_lifts }
```

**Five design rules the research forces on you:**
1. **Every capacity needs a `basis` enum.** H20 is "5 kNm" *and* "11 kNm" depending on permissible vs characteristic — a 2.2x error if conflated. Same for tie loads (90 kN permissible vs ~180 kN ultimate) and pressures (60 vs 80 vs 100 kN/m²).
2. **Prop capacity is non-monotonic in extension** (Eurex 30: 41.2 kN at 5.0 m but 31.8 kN at 5.5 m and 30.9 kN at 2.5 m) and depends on which end the outer tube is at. Store the table; never interpolate a formula.
3. **`item_no` is not a primary key for physical properties.** PERI `022550` is 87.4 kg new and 80.3 kg from a reconditioner. Version weights by `catalog_edition_date` + `verification`.
4. **A panel is a composite asset.** Steel frame ~300 uses, 18 mm ply formlining ~40 uses, cones 1 use. One `expected_uses` field per product will misprice everything.
5. **Length series are irregular.** H20: 1450/1800/2450/2650/2900/3300/3600/3900/4500/4900/5900 — no constant step. Store arrays plus a `cut_to_length` service SKU (PERI literally sells `030050 Cutting Cost` as a zero-weight line item).

---

## Source URLs

**Manufacturer catalogs (parsed directly):**
- PERI TRIO Product Brochure 12/2017 — `https://www.peri.com.mx/dam/jcr:d409cbe2-82e6-4183-96b6-60b02b4658ba/catalogo-de-componentes-trio.pdf` · mirrors: `https://www.peri.be/dam/jcr:21cf5beb-9f88-341c-a018-8196572ead16/trio-formwork.pdf`, `https://www.peri.lv/dam/jcr:6d4adf38-ebee-4835-9ee0-0b8d54362448/trio-posteris-en.pdf`, `https://www.peri.it/dam/jcr:7fa50bd9-43cf-4f7e-90cb-b8539909ac81/trio-cassaforma-per-pareti-brochure-en.pdf`, `https://library.theformworkstore.com/wp-content/uploads/2021/11/Peri_TRIO_English_Manual.pdf`
- Doka Framax Xlife item list — `https://www.doka.com/_ext/downloads/itemlists/me/91.pdf` (the `/_ext/downloads/itemlists/{lang}/{n}.pdf` pattern is the machine-readable goldmine: article no. + weight + dims for every part)
- Doka Eurex prop permissible loads — `https://www.doka.com/web/media/files/solutions/Floor-prop-Eurex_Permissible-load-capacity.pdf`
- Doka Framax Xlife — `https://www.doka.com/en/system-groups/doka-wall-systems/framed-formwork/framax-xlife/index` · `https://direct.doka.com/web/media/files/doka_framedformwork_framaxxlife_en.pdf`
- Doka KS Xlife columns — `https://www.doka.com/us/system-groups/doka-wall-systems/column-formwork/ks-xlife/index` · `https://manualzz.com/doc/87300119/doka-column-formwork-ks-xlife-user-information`
- Doka shop (live part numbers/prices) — `https://shop.doka.com/shop/no/en/wall-formwork/framed-formwork/framax-xlife-plus/framax-xlife-plus-panel/p/035/`
- PERI TRIO — `https://www.peri-usa.com/products/trio-panel-formwork.html` · MAXIMO — `https://www.peri.com/en/maximo-panel-formwork.html` · `https://www.peri.com/en/dam/jcr:128e17a6-7390-4104-be90-ca00d07f4165/brochure-maximo.pdf` · DOMINO — `https://www.peri.be/dam/jcr:5a86fe77-937e-4fef-8ca4-71a03139511e/domino.pdf` · brochures index — `https://www.peri.ae/products/product-brochures.html`
- MEVA Mammut 350 — `https://www.meva.net/en-gb/products/mammut-350/`
- ULMA ORMA — `https://www.ulmaconstruction.com/en/formwork/wall-formwork-column-formwork/panel-formwork-orma`
- Dealer with PERI item numbers + weights + prices — `https://shop.easy-formwork.de/Panel-TR-270-x-60`, `https://shop.easy-formwork.de/Column-Panel-TRS-60-x-90`

**Standards (parsed directly):** DIN 18218:2010-01 *Pressure of fresh concrete on vertical formwork* (English translation, Beuth) · ACI 347-04 *Guide to Formwork for Concrete* · RICS NRM2 Section 11 *In-situ Concrete Works* (eff. 1 Jan 2013, p.155) · IS 1200 Part 5:1982 via `https://law.resource.org`

**Materials / components:** `https://apacsafety.com/wp-content/uploads/2022/12/H20-Beam-Datasheet.pdf` · `https://www.serwisbudowy.com/en_US/p/Timber-beam-h20-shod/81` · `https://vinawoodltd.com/blog/h20-timber-beam-formwork` · `https://www.rmdkwikform.com` · `https://altrad-coffrage.com` · `https://concrete.dywidag.com` · `https://www.daytonsuperior.com` · `https://dss.net` · `https://chontan.net/blog/formwork-tie-rod-guide` · `https://teconform.com/products/tecon-form-film-faced-plywood/`

**Cut optimisation:** `https://cutoptim.com/docs/2d-panel-cutting` · `https://cutoptim.com/guides/how-cutting-optimization-works` · `https://dev.to/kavelaltd`

**Costing / norms:** `https://civilguidelines.com/articles/carpenter-shuttering-beam.html` · `https://infralens.in/formats/estimation/rate-analysis-shuttering-formwork` · `https://formwork.expert/services/formwork-hire/` · `https://bfs-industries.com/blog/concrete-formwork-pricing/` · `https://www.constructionrates.co.uk/Rate_Gen/Formwork@constructionrates.co.uk.html` · `https://civilnotess.com` · `https://iscodehub.com`

---

### Gaps to close next (I could not verify these)
1. **Frami Xlife and Alu-Framax item lists** — enumerate `https://www.doka.com/_ext/downloads/itemlists/en/{n}.pdf`; that PDF family is the single highest-value machine-readable source I found and covers every Doka system with article numbers, weights and dimensions.
2. **PERI SKYDECK, MULTIFLEX, SRS, QUATTRO, SRU/SRZ** — same brochure pattern as TRIO (`/dam/jcr:.../<system>.pdf` on any PERI country site).
3. **Framax Xlife permissible pressure** — the item list omits it; get "Framax Xlife User Information".
4. **CESMM4 Class G and POMI clause text** — my width-band and void-deduction figures for these two are unverified.
5. **ULMA ORMA pressure rating** — the 80 kN/m² figure was an echo of my own query, not a source. Discard it.
6. **RMD Superslim: the nine lengths and the moment-vs-restraint curve** — needs the actual technical data sheet from `altrad-coffrage.com`.