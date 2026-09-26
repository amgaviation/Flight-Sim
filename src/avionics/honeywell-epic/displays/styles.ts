/**
 * Derived drawing styles of the Epic PFD / map (common avionics primitives
 * with the PlaneView palette and typeface). Geometry values are EST from
 * the G650ER / G600 cockpit photographs.
 */
import { ADI_HONEYWELL, type AttitudeStyle } from '../../common/draw/AttitudeIndicator';
import { ALT_TAPE_HONEYWELL, type AltitudeTapeStyle } from '../../common/draw/AltitudeTape';
import { SPEED_TAPE_HONEYWELL, type SpeedTapeStyle } from '../../common/draw/SpeedTape';
import { VSI_HONEYWELL, type VerticalSpeedStyle } from '../../common/draw/VerticalSpeed';
import { HSI_HONEYWELL, type HsiStyle } from '../../common/draw/Hsi';
import { GS_SCALE_BOEING, LOC_SCALE_BOEING, type DeviationScaleStyle } from '../../common/draw/DeviationScale';
import { MAP_HONEYWELL, type MapStyle } from '../../common/draw/MovingMap';
import { EPIC_FONT, EPIC_PALETTE } from '../style';

/** Gulfstream PFD attitude: white delta aircraft symbol with black outline, magenta single-cue FD (EST from photographs). */
export const ADI_EPIC: AttitudeStyle = {
  ...ADI_HONEYWELL,
  palette: EPIC_PALETTE,
  typeface: EPIC_FONT,
  symbol: { style: 'delta', size: 64, thickness: 6 },
  fd: { ...ADI_HONEYWELL.fd, size: 64 },
  radioAlt: null,
  minimums: null,
};
/** Same attitude with a transparent sky / ground so the SmartView picture shows through. */
export const ADI_EPIC_SVS: AttitudeStyle = {
  ...ADI_EPIC,
  gradient: false,
  palette: { ...EPIC_PALETTE, sky: 'rgba(0,0,0,0)', skyHorizon: 'rgba(0,0,0,0)', groundHorizon: 'rgba(0,0,0,0)', ground: 'rgba(0,0,0,0)' },
};
export const SPEED_TAPE_EPIC: SpeedTapeStyle = { ...SPEED_TAPE_HONEYWELL, palette: EPIC_PALETTE, typeface: EPIC_FONT, pxPerKt: 4.2 };
export const ALT_TAPE_EPIC: AltitudeTapeStyle = { ...ALT_TAPE_HONEYWELL, palette: EPIC_PALETTE, typeface: EPIC_FONT, pxPerFt: 0.42 };
export const VSI_EPIC: VerticalSpeedStyle = { ...VSI_HONEYWELL, palette: EPIC_PALETTE, typeface: EPIC_FONT };
export const HSI_EPIC: HsiStyle = { ...HSI_HONEYWELL, palette: EPIC_PALETTE, typeface: EPIC_FONT, labelSize: 20 };
export const GS_EPIC: DeviationScaleStyle = { ...GS_SCALE_BOEING, palette: EPIC_PALETTE, typeface: EPIC_FONT, dotSpacing: 30 };
export const LOC_EPIC: DeviationScaleStyle = { ...LOC_SCALE_BOEING, palette: EPIC_PALETTE, typeface: EPIC_FONT, dotSpacing: 34 };

/** INAV map style: Honeywell symbols, small airports only at short ranges (EST declutter). */
export const MAP_EPIC: MapStyle = { ...MAP_HONEYWELL, smallAirportsBelowNm: 5, fixesBelowNm: 25 };
