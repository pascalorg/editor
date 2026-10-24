const INCH = 0.0254

/**
 * The standard numbers of a residential foundation, in metres, stated once: the generic foundation
 * the viewer draws under every building (`genericFoundation`), Bones' pour and the sections
 * plugin's drawings all read them. They are the common US residential values (IRC chapters 4 and
 * 5), not a jurisdiction's: core holds no frost data, so what depends on one (the frost line, the
 * wall convention) stays with the jurisdiction profile in Bones.
 */
export const FOUNDATION_STANDARD = {
  /** Continuous footing under an exterior wall: 16 in wide, the usual pour for light framing (IRC R403.1). */
  footingWidth: 16 * INCH,
  /** 6 in is the minimum (IRC Table R403.1(1)); 8 in is the near-universal pour. */
  footingThickness: 8 * INCH,
  /**
   * How far the footing's bottom sits under the lowest grade where nothing says better: 12 in, the
   * shallowest Bones allows (IRC R403.1.4.1 asks for the frost line, which core does not know). A
   * generic depth, drawn as one.
   */
  footingBelowGrade: 12 * INCH,
  /** The foundation wall (the stem) from the footing up to the floor: 8 in (IRC R404.1). */
  stemThickness: 8 * INCH,
  /** A crawl space vent, 8 × 16 in screened for 50 sq in net (IRC R408.1), within 3 ft of each corner, set 2 ft in (R408.2). */
  ventWidth: 16 * INCH,
  ventHeight: 8 * INCH,
  ventNetAreaSqIn: 50,
  ventCornerInset: 24 * INCH,
  /** The crawl space access through the stem: 16 × 24 in (IRC R408.4). */
  crawlAccessWidth: 24 * INCH,
  crawlAccessHeight: 16 * INCH,
} as const
