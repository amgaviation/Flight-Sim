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
} as const;
