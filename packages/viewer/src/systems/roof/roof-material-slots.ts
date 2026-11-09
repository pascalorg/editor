/**
 * A roof mesh's material slots. Slots 0–3 come out of the CSG (0 wall / trim,
 * 1 deck, 2 interior and fascia, 3 shingle top); the wall bands are split off
 * slot 0 after it (`splitRoofWallBandFaces`): the heel band (the wall between
 * the top plate and the eaves) and each gable end, so each paints apart from
 * the edge role. The merged shell splits only the heel band; a segment's own
 * mesh splits its gables too.
 */
export const ROOF_HEEL_MATERIAL_INDEX = 4
export const ROOF_GABLE_LEFT_MATERIAL_INDEX = 5
export const ROOF_GABLE_RIGHT_MATERIAL_INDEX = 6
/** Every slot a roof mesh can carry: the four CSG slots plus the wall bands. */
export const ROOF_RENDER_MATERIAL_COUNT = 7
