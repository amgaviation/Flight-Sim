/** Cessna 172S Skyhawk SP (steam gauges, Bendix/King NAV II) catalog metadata; shared numbers from c172s-common/meta.ts. */
import type { AircraftMeta } from '../types';
import { C172S_META_BASE } from '../c172s-common/meta';

export const C172_STEAM_META: AircraftMeta = {
  ...C172S_META_BASE,
  id: 'c172-steam',
  name: 'Cessna 172S Skyhawk (steam gauges)',
  avionics: 'Analog six-pack, KX 155A / KAP 140',
  description:
    'Four-seat trainer, Lycoming IO-360-L2A 180 hp, MTOW 2,550 lb, Vne 163 KIAS (POH 172SPHUS). Analog six-pack with vacuum attitude ' +
    'and directional gyros, and the Bendix/King NAV II stack: KMA 28 audio panel, KLN 94 IFR GPS with NAV/GPS switching, dual KX 155A ' +
    'NAV/COM (KI 209A glideslope CDI, KI 208), KR 87 ADF, KT 76C transponder and the KAP 140 two-axis autopilot with altitude preselect.',
};
