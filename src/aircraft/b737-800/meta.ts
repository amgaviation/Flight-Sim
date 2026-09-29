/** Boeing 737-800 catalog metadata (numbers: TCDS / ACAPS / data.ts). */
import type { AircraftMeta } from '../types';

export const B738_META: AircraftMeta = {
  id: 'b737-800',
  name: 'Boeing 737-800 (winglets)',
  manufacturer: 'Boeing Commercial Airplanes',
  icaoType: 'B738', // ICAO Doc 8643
  engines: 2,
  engineType: 'turbofan',
  avionics: 'Boeing 737NG CDS / Smiths FMC / Collins AFDS',
  description:
    'Next-Generation 737-800 with blended winglets: 2 x CFM56-7B26 (26,300 lbf), MTOW 79,016 kg, FL410, Vmo 340 KIAS / Mmo 0.82; ' +
    'six-DU Common Display System, FMC with two CDUs, MCP with CMD A/B and dual-channel autoland, full forward and aft overhead.',
  typical: {
    cruiseAltFt: 35000, // typical FL350 cruise (optimum ~FL350-370 at 60-65 t, avionics perf.ts EST)
    cruiseKtas: 450, // M0.78 at FL350 ISA (data.ts PERF_REF)
    approachKias: 145, // VREF30 ~140-145 kt at typical landing weights + 5 kt additive (perf.ts EST)
    rotateKias: 145, // VR at ~70 t flaps 5 (perf.ts QRH-like table: 146 kt)
    maxAltFt: 41000, // TCDS
  },
  chaseDistance_m: 60,
};
