/**
 * SimVars written by the world module (aircraft-independent, `world.` prefix).
 * Read-only for everyone else.
 */
export const WORLD_VARS = {
  /** Cloud layer base / top (ft MSL) derived from env.cloud_base_ft (AGL of the reference field). */
  cloudBaseMslFt: 'world.cloud_base_msl_ft',
  cloudTopMslFt: 'world.cloud_top_msl_ft',
  /** Cloud density at the camera, 0..1 (whiteout amount). */
  inCloud: 'world.in_cloud',
  moonElevDeg: 'world.moon_elev_deg',
  /** Sun azimuth (deg true). */
  sunAzimuthDeg: 'world.sun_az_deg',
  /** Camera height above terrain/runway (ft). */
  camAglFt: 'world.cam_agl_ft',
  /** Terrain tiles queued or in flight. */
  tilesPending: 'world.tiles_pending',
  /**
   * Photometric scale of the renderer: scene light units per lux, including
   * the current eye adaptation (~3e-5 in daylight, up to ~2.4e-3 at night).
   * An aircraft light of I candela is a three.js light of intensity
   * I x this value with physical inverse-square decay (decay = 2), so it is
   * as bright relative to the sun and sky as the real lamp would be.
   */
  renderUnitsPerLux: 'world.render_units_per_lux',
} as const;
