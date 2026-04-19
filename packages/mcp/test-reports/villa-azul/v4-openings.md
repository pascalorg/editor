# Phase 9 Verifier V4 — Openings

Scene: `/tmp/pascal-villa/scenes/a6e7919eacbe.json`

## Summary

- Doors: 10 (expected 10)
- Windows: 12 (expected 12)
- Total openings: 22 (expected 22)
- Failing openings: 2

## Perimeter wall opening counts

| Side | Doors (actual / expected) | Windows (actual / expected) | OK |
|------|--------------------------|-----------------------------|----|
| south | 2 / 3 | 4 / 4 | FAIL |
| north | 1 / 1 | 3 / 3 | OK |
| east | 1 / 1 | 2 / 2 | OK |
| west | 0 / 0 | 2 / 2 | OK |

## Every opening

| id | type | wallId | wallT | pos(m) | width | height | wallLen | fits? | overlaps? |
|----|------|--------|-------|--------|-------|--------|---------|-------|-----------|
| door_333ygsrz65ijnrqv | door | wall_qgrnmxmo0go9yy3q | 0.900 | 13.500 | 1.000 | 2.100 | 15.000 | yes | no |
| door_slgjz3fagpyg3sh7 | door | wall_2s65apfvekdglbod | 0.750 | 11.250 | 0.900 | 2.100 | 15.000 | yes | no |
| door_d0nqos4zumc0zezd | door | wall_qgrnmxmo0go9yy3q | 0.400 | 6.000 | 2.400 | 2.200 | 15.000 | yes | no |
| door_ytu570mchm7asqeo | door | wall_vnzffl9uhhp7u7ng | 0.750 | 7.500 | 1.800 | 2.200 | 10.000 | yes | no |
| door_6h6nz21yyfivvnsc | door | wall_sl9ngyohpt1ckxrz | 0.250 | 2.500 | 0.800 | 2.050 | 10.000 | yes | no |
| door_2hx5ztbku9sv2a75 | door | wall_k253bcp3cbmvmksf | 0.500 | 1.500 | 0.700 | 2.000 | 3.000 | yes | no |
| door_ybtwqsbolbr0n0gc | door | wall_m7rg6bf7mucmlh4m | 0.120 | 1.200 | 0.800 | 2.050 | 10.000 | yes | no |
| door_ffn9hxnd7564rkvr | door | wall_m7rg6bf7mucmlh4m | 0.880 | 8.800 | 0.800 | 2.050 | 10.000 | yes | no |
| door_omm6j9olsen5odz2 | door | wall_3gthhmi6v5sli2ac | 0.500 | 1.500 | 0.700 | 2.000 | 3.000 | yes | no |
| door_2dd3s6btlze9qog6 | door | wall_icyfprzyd4034us0 | 0.900 | 9.000 | 0.900 | 2.050 | 10.000 | yes | no |
| window_8nqg3fvdnb13c0sx | window | wall_qgrnmxmo0go9yy3q | 0.150 | 2.250 | 1.400 | 1.500 | 15.000 | yes | no |
| window_rjhwcnymvck1ikhp | window | wall_qgrnmxmo0go9yy3q | 0.650 | 9.750 | 2.000 | 1.500 | 15.000 | yes | YES (window_dv570t2x3vbqmqfm) |
| window_q2h2kv4eu0p45vf7 | window | wall_2s65apfvekdglbod | 0.150 | 2.250 | 1.000 | 1.400 | 15.000 | yes | no |
| window_cpw86mxlf92v2im8 | window | wall_2s65apfvekdglbod | 0.550 | 8.250 | 1.400 | 1.400 | 15.000 | yes | no |
| window_2ticoiwkjwa9jpih | window | wall_ohb57u9y7pegelg9 | 0.200 | 2.000 | 1.000 | 1.400 | 10.000 | yes | no |
| window_v3dz9tgb8bydj5aw | window | wall_ohb57u9y7pegelg9 | 0.750 | 7.500 | 0.800 | 0.900 | 10.000 | yes | no |
| window_02mzjx24oqnwh6o9 | window | wall_vnzffl9uhhp7u7ng | 0.150 | 1.500 | 1.000 | 1.400 | 10.000 | yes | no |
| window_2sf6c99wbb2aq23j | window | wall_vnzffl9uhhp7u7ng | 0.400 | 4.000 | 0.900 | 1.400 | 10.000 | yes | no |
| window_hit0ta8v41a678m3 | window | wall_k253bcp3cbmvmksf | 0.200 | 0.600 | 0.600 | 0.600 | 3.000 | yes | no |
| window_749lw7mkz3cus5mp | window | wall_2s65apfvekdglbod | 0.350 | 5.250 | 0.800 | 0.700 | 15.000 | yes | no |
| window_alqegags8luirc9g | window | wall_qgrnmxmo0go9yy3q | 0.220 | 3.300 | 1.200 | 1.500 | 15.000 | yes | YES (window_8nqg3fvdnb13c0sx) |
| window_dv570t2x3vbqmqfm | window | wall_qgrnmxmo0go9yy3q | 0.550 | 8.250 | 1.400 | 1.500 | 15.000 | yes | no |

## Failing openings

- window_rjhwcnymvck1ikhp on wall_qgrnmxmo0go9yy3q: width=2.000 height=1.500 wallT=0.650 pos=9.750 wallLen=15.000 wallH=2.800 thk=0.220 minPos=1.000 maxPos=14.000 fitsW=true fitsH=true fitsPos=true overlap=true
- window_alqegags8luirc9g on wall_qgrnmxmo0go9yy3q: width=1.200 height=1.500 wallT=0.220 pos=3.300 wallLen=15.000 wallH=2.800 thk=0.220 minPos=0.600 maxPos=14.400 fitsW=true fitsH=true fitsPos=true overlap=true

## Findings

- All 22 openings have width and height that fit within their wall dimensions (no width/height/position-range failures).
- 2 opening(s) violate the 0.2 m minimum gap with a neighbour on the same wall.
  - south wall (wall_qgrnmxmo0go9yy3q, 15 m) is crowded with 6 openings (2 doors + 4 windows); overlap cluster around bed-corridor-window / living-patio / living-s-window / living-s-2.
- south wall opening count (2 doors + 4 windows) does not match design (3 doors + 4 windows); build.ts only placed front-door and living-patio on south — a third south door is missing.

## Verdict: FAIL
