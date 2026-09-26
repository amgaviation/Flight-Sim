# Avionics common + analog instruments (`src/avionics/common`, `src/avionics/analog`)

Two libraries that every avionics suite in the simulator is built from:

- **`src/avionics/common`**: a canvas display base class (`CanvasDisplay`, implements
  `CockpitDisplay`) plus pure Canvas-2D primitives for glass cockpits: attitude indicator, speed
  and altitude tapes, vertical speed, HSI/compass rose, deviation scales, moving map with terrain
  raster, engine indications, CAS window, soft keys, menus, data fields, FMA and checklists. Each
  primitive has vendor presets (Garmin, Boeing, Honeywell, Collins). The library also holds the
  alerting state machines, needle dynamics, formatting, fonts and palettes these primitives use.
- **`src/avionics/analog`**: 3D electromechanical instruments (Three.js, `CockpitControl`) with
  painted dials, separate needles, cards and drums at their own depths, working knobs and
  buttons, instrument lighting, and physical models: gyros, inclinometer, wet compass,
  altimeter, TAS ring and the Davtron M803.

```ts
import {
  CanvasDisplay, CallbackDisplay, AttitudeIndicator, ADI_GARMIN, SpeedTape, SPEED_TAPE_GARMIN,
  AltitudeTape, ALT_TAPE_GARMIN, VerticalSpeedIndicator, VSI_GARMIN_2000, Hsi, HSI_GARMIN,
  AltitudeAlerter, ALT_ALERT_GARMIN, GARMIN_PALETTE, GARMIN_TYPEFACE, type Ctx2D,
} from '../../avionics/common';
import {
  AirspeedIndicator, AnalogAttitudeIndicator, Altimeter, TurnCoordinator, HeadingIndicator,
  AnalogVerticalSpeedIndicator, CourseIndicator, AdfIndicator, Tachometer, FuelQuantityGauge,
  OilTempPressGauge, VacuumAmmeterGauge, EgtFuelFlowGauge, DavtronClock, MagneticCompass,
  ANALOG_VARS, INSTRUMENT_SIZE,
} from '../../avionics/analog';
```

Barrels: `src/avionics/common/index.ts` (which re-exports `common/draw/index.ts`) and
`src/avionics/analog/index.ts`. The two barrels have no export names in common, so a later
`src/avionics/index.ts` may `export *` from both. The analog classes whose names would clash with
glass primitives are called `AnalogAttitudeIndicator` and `AnalogVerticalSpeedIndicator`.

Tests: `tests/avionics/*.test.ts` (math, dynamics, alerting, instrument models, Davtron logic, and
display logic using a fake canvas context).

## Contents

1. Conventions (units, signs, coordinates, allocation, the state-object pattern)
2. `CanvasDisplay`, `CallbackDisplay`, `createDisplayCanvas`
3. Palettes and line widths
4. Typefaces (`Typeface`, canvas fonts, `StrokeFont`)
5. Formatting (`format.ts`)
6. Display math (`math.ts`)
7. Dynamics: needles, rates, blinking (`dynamics.ts`)
8. Alerting state machines (`alerting.ts`)
9. Canvas helpers (`draw/context.ts`)
10. Glass primitives (one section per primitive, 10.1 to 10.14)
11. Building each avionics family from the primitives (G1000 NXi, G3000/G5000, Primus Epic,
    Pro Line Fusion, 737NG CDS/FMC)
12. Analog instruments: frame, sizes, SimVars (`ANALOG_VARS`, `PHYSICAL_INPUTS`)
13. `AnalogGauge`, `GaugeKnob`, `FaceCanvas`, geometry
14. Generic gauges: `RoundGauge`, `TwinGauge`, 172S engine gauges
15. Flight instruments (one section per class)
16. Pure instrument models (`analog/models`)
17. Building the steam-gauge 172S panel
18. SimVars, events and sounds summary
19. Performance rules and known scope limits

---

## 1. Conventions

- **Units** follow `core/vars.ts`: kt, ft, fpm, deg, inHg, deg C / deg F as named, US gal, kg for
  fuel tank vars. Headings are in degrees, 0..360. On display, north is written 360 and never
  000 (`fmtHeading`).
- **Signs**: bank + = right wing down; pitch + = nose up; slip/ball -1..1 with + = ball right.
  Lateral deviation (`nav{r}.cdi`, `fms.cdi`) -1..1 is full scale, and + means fly right (needle
  right). Vertical deviation (`nav{r}.gs_dev`) -1..1 is full scale, and + means the path is above
  the aircraft (fly up, pointer drawn above centre). Bearings are measured TO the station, in the
  heading's reference (magnetic unless `headingIsTrue`).
- **Glass coordinates**: logical pixels with the origin at top left and y pointing down. A
  display is designed at a fixed logical size, such as 1024 x 768 for a G1000 PFD.
  `CanvasDisplay.pixelRatio` sets only the texture resolution.
- **Screen angles** on roses and dials are measured clockwise from 12 o'clock. `roseAngle`
  returns radians; the dial helpers take degrees.
- **Analog 3D frame**: the dial lies in the XY plane at z = 0, +y points to 12 o'clock and +z
  points toward the pilot. Units are metres.
- **State-object pattern** (all glass primitives): construct once with geometry and a style
  preset. Each frame, write plain fields on `primitive.state`, then call `update(dt)` (timers,
  trend filters, flashing) and `draw(ctx)`. Primitives never read SimVars. The display class
  that owns them reads SimVars and fills their state, so one primitive can serve different
  sensors (ADC1/ADC2, reversionary modes).
- **No allocation in steady state**: the primitives, formatters (cached strings), typefaces
  (cached font strings) and models allocate nothing per frame. Methods marked "allocates" are
  for page or setup changes only.
- **Accuracy**: every number carries a source comment in the code, such as the POH, the Garmin
  pilot's guide 190-00494-04, the 737NG FCOM 10.10, the Honeywell EGPWS pilot guide or
  FAA-H-8083. A value with no public source is marked `EST:` with its reasoning. Honeywell and
  Collins presets are mostly EST (no public pilot-guide extract was available).

---

## 2. `CanvasDisplay` (`common/CanvasDisplay.ts`)

Base class for every glass screen: PFD, MFD, EICAS, CDU, standby, LCD windows. It implements
`CockpitDisplay` from `cockpit/types.ts`, so the cockpit `DisplayManager` maps it onto a mesh.

```ts
interface CanvasDisplayOptions {
  id: string;                 // unique; also names the DISPLAY_VARS
  width: number; height: number;  // logical (design) size
  pixelRatio?: number;        // canvas px per logical px (default 1)
  refreshHz?: number;         // default 30 (CLAUDE.md: glass <= 30 Hz)
  vars?: SimVars;             // without it: always powered, brightness 1, no watches
  powerVar?: string | null;   // default DISPLAY_VARS.power(id) = 'display.<id>.power'; null = no check
  brightnessVar?: string | null; // default DISPLAY_VARS.brightness(id) = 'display.<id>.brt'; null = none
  canvas?: 'dom' | 'offscreen' | HTMLCanvasElement | OffscreenCanvas; // default: DOM if `document` exists
  background?: string;        // fill before every frame, default '#000000'
  bootTimeS?: number;         // boot screen seconds after power-up (default 0)
  applyBrightness?: boolean;  // darken the frame by (1 - brightness) (default true)
  alpha?: boolean;            // alpha channel (HUD overlays), default false
}
```

Public members:

| Member | Meaning |
|---|---|
| `id`, `canvas`, `width`, `height` (canvas px), `refreshHz` | `CockpitDisplay` contract |
| `logicalWidth`, `logicalHeight`, `pixelRatio` | design size |
| `powered` (get) | forced value from `setPowered`, else `vars.get(powerVar, 1) >= 0.5`. **A missing var counts as powered.** |
| `brightness` (get) | `setBrightness()` value if one was ever given, else `vars.get(brightnessVar, 1)` clamped to 0..1 |
| `booting` (get) | boot screen showing |
| `setPowered(on: boolean \| null)` | override power (null = follow the var) |
| `setBrightness(b)` | from the dimming system (the `DisplayManager` calls it) |
| `invalidate()` | force a redraw on the next `render` |
| `render(dt): boolean` | `CockpitDisplay`: returns true when the canvas changed |
| `onPointer(x, y, kind, delta?)` | canvas px, converted to logical px and passed to `onPointerLogical` (ignored when unpowered) |
| `dispose()` | shrinks the canvas and clears the watches |

Subclass hooks, all `protected`:

- `draw(ctx, dt)` (abstract): full-frame draw in logical px. The background is already filled
  and the transform is `pixelRatio`.
- `update(dt)`: runs on every `render` while powered, before the dirty check. Advance timers,
  alerters and filters here.
- `drawBoot(ctx, progress 0..1)`: boot screen. The default leaves the background colour.
- `onPowerChange(on)`, `onPointerLogical(x, y, kind, delta)`.
- `watch(name, quantum = 0)`: redraw when the var changes by at least `quantum` (the value is
  rounded to multiples of `quantum`). Call it in the constructor for every var the display
  shows.
- `watchString(name)`: redraw when a string var changes.
- Fields: `ctx`, `vars`, `background`, `timeS` (powered seconds), `animating` (true = redraw
  every render, for flashing cues).

`render(dt)` logic:

1. Unpowered: paint black once (and call `onPowerChange(false)`), then return false.
2. On power-up, reset `timeS`, start the boot timer and call `onPowerChange(true)`.
3. Run `update(dt)`.
4. While booting, draw the boot screen and return true.
5. Otherwise redraw only if the display was invalidated or is animating, a watched var moved,
   or the brightness changed.
6. With `applyBrightness`, overlay black at `1 - brightness` (64 precomputed steps). The
   cockpit `DisplayManager` dims the material only for displays without `setBrightness`, so a
   `CanvasDisplay` is never dimmed twice. If you create one with `applyBrightness: false`, add it
   with `dimMaterial: true`, and leave the manager's `boot` option off, because `CanvasDisplay`
   has its own `bootTimeS`.

`CallbackDisplay(opts, drawFn(ctx, dt, display), updateFn?(dt, display))` is a concrete
display built from callbacks, for LCD windows, quick screens and tests. It adds
`setAnimating(on)`, `time` (powered seconds) and `watchVar(name, quantum)`.

`createDisplayCanvas(wPx, hPx, kind = 'auto')` returns a DOM canvas or an `OffscreenCanvas`.

Example (a G1000-style PFD skeleton):

```ts
class Pfd extends CanvasDisplay {
  private adi = new AttitudeIndicator({ rect: { x: 0, y: 0, w: 1024, h: 768 }, cx: 512, cy: 290, style: ADI_GARMIN });
  private spd = new SpeedTape({ x: 110, y: 110, w: 100, h: 370, style: SPEED_TAPE_GARMIN });
  private alt = new AltitudeTape({ x: 760, y: 110, w: 110, h: 370, style: ALT_TAPE_GARMIN });
  private alerter = new AltitudeAlerter(ALT_ALERT_GARMIN);
  constructor(vars: SimVars, private readonly audio: AudioApi) {
    super({ id: 'pfd1', width: 1024, height: 768, vars, bootTimeS: 3 });
    this.animating = true;             // attitude moves continuously: redraw at refreshHz
  }
  protected override update(dt: number): void {
    const v = this.vars!;
    const a = this.adi.state;
    a.valid = v.get(ADC.ahrsValid(1), 1) >= 0.5;
    a.pitch = v.get(ADC.pitch(1));
    a.bank = v.get(ADC.bank(1));
    a.slip = v.get(ADC.slip(1));
    this.spd.state.ias = v.get(ADC.ias(1));
    const t = this.alt.state;
    t.altFt = v.get(ADC.baroAlt(1));
    t.vsFpm = v.get(ADC.vs(1));
    t.selectedFt = v.get(AP.selAltitude);
    t.baroInHg = v.get(ADC.baroSetting(1));
    this.alerter.update(t.altFt, t.selectedFt, dt);
    t.alertPhase = this.alerter.phase;
    t.alertVisible = this.alerter.visible;
    if (this.alerter.consumeAural()) this.audio.play('alert.altitude');   // sound id per aircraft
    this.adi.update(dt);
    this.spd.update(dt);
    this.alt.update(dt);
  }
  protected draw(ctx: Ctx2D): void {
    this.adi.draw(ctx);
    this.spd.draw(ctx);
    this.alt.draw(ctx);
  }
}
```

Assign state fields one by one, as above: `Object.assign` with an object literal allocates on
every frame.

---

## 3. Palettes (`common/palette.ts`)

`AvionicsPalette` is a set of semantic colour roles, so primitives never hard-code colours:
`name, background, white, grey, darkGrey, black, cyan, magenta, green, amber, yellow, red, blue,
selected` (pilot-selected targets), `fms` (FMS/GPS data), `navRadio` (VOR/LOC), `bearing`,
`trend`, `flightDirector`, `aircraftSymbol`, `aircraftSymbolOutline`, `sky`, `skyHorizon`,
`groundHorizon`, `ground`, `tapeBackground`, `readoutBackground`, `readoutBorder`, `warning`,
`caution`, `advisory`, `status`, `softKeyText`, `softKeyActive`, `softKeyDisabled`, `mapWater`,
`mapRoute`, `mapMissed` and `mapRangeRing`.

Presets: `GARMIN_PALETTE` (G1000/NXi/G3000/G5000: advisory white, selected cyan), `BOEING_PALETTE`
(737NG: MCP targets magenta, reference speeds green), `HONEYWELL_PALETTE` and `COLLINS_PALETTE`
(cyan selected, magenta FMS). `PALETTES[vendor]` looks a preset up by
`AvionicsVendor = 'garmin' | 'boeing' | 'honeywell' | 'collins'`.
`derivePalette(base, overrides)` returns a new palette, which is useful for a PlaneView or
Symmetry palette variant. `DEFAULT_LINE_WIDTHS: { thin, normal, thick, halo }`.
`TERRAIN_COLORS`: RGB triples for red, yellow, amber, green, black and noData (magenta).

Colour meanings follow 14 CFR 25.1322 and AC 25-11B. The exact shades are EST, because LCD
gamut makes an exact match meaningless.

---

## 4. Typefaces (`common/fonts.ts`, `common/StrokeFont.ts`)

No font files are bundled. Text uses installed-font stacks (`FONT_STACKS.garmin | honeywell |
collins | boeing | mono | gauge | lcd`) or the vector stroke font.

```ts
interface Typeface {
  draw(ctx, text, x, y, size, color, align?: 'left'|'center'|'right', baseline?: 'top'|'middle'|'bottom'|'alphabetic', halo?: string): void;
  width(ctx, text, size): number;
}
```

- `CanvasTypeface(family, weight = 'normal', haloWidth = 0.22)`: canvas font, with the font
  string cached per size. `haloWidth` is the halo line width as a fraction of the font size.
- `StrokeTypeface(font = STROKE_FONT)`: the Boeing look. Strokes have the colour's width, and a
  halo is stroked first.
- Instances: `GARMIN_TYPEFACE`, `HONEYWELL_TYPEFACE`, `COLLINS_TYPEFACE`, `BOEING_TYPEFACE`
  (stroke), `MONO_TYPEFACE` (CDU / data fields), `GAUGE_TYPEFACE`.
- `fontString(sizePx, family, weight)`: cached CSS font string, rounded to 0.5 px.
- `isFontAvailable(family)`, `resolveFontStack(stack)`: the first installed family.
- `ensureFonts(stacks?, timeoutMs = 1500): Promise<string[]>`: never rejects.
- `StrokeFont(weight = 0.13)`: an original 4x6 single-stroke glyph set covering digits, A-Z,
  punctuation, arrows and the degree sign. Lower case maps to upper. Methods:
  `width(text, size)`, `has(ch)`, `path(ctx, text, x, y, size, align?, baseline?, slant?)`
  (appends to the current path so several strings share one stroke) and
  `draw(ctx, text, x, y, size, color, align?, baseline?)`. Cap height = 0.72 x size, so a layout
  can switch between stroke and canvas fonts. `STROKE_FONT` is the shared instance.

---

## 5. Formatting (`common/format.ts`)

All results are cached strings (bounded caches of 4096 entries each), so formatting a changing
value allocates nothing after warm-up.

| Function | Output |
|---|---|
| `fmtInt(v)` | rounded integer: `"-12"` |
| `fmtPad(v, width, padChar = '0')` | `fmtPad(7, 3) = "007"`, with a leading `-` for negatives |
| `fmtFixed(v, 0..3)` | `"29.92"` |
| `fmtMach(m, 2 \| 3 = 3)` | `".782"` |
| `fmtHeading(deg, zeroIs360 = true)` | `"001"` to `"360"` |
| `fmtClock(s, hours = false)` | `"MM:SS"` (or `"H:MM"`) |
| `fmtBaro(inHg, 'inhg' \| 'hpa')` | `"29.92"` / `"1013"` |
| `clearFormatCaches()` | for tests |

---

## 6. Display math (`common/math.ts`)

- Tapes: `tapeY(value, current, centerY, pxPerUnit)` (larger values are higher on screen),
  `tapeValueAtY`, `firstMultipleAtOrAbove(v, step)`, `lastMultipleAtOrBelow`,
  `clampBugY(y, top, bottom)` (off-scale bugs park at the edge, per the G1000 PG),
  `bugOffscale(y, top, bottom) -> -1 | 0 | 1`, `trendValue(v, ratePerS, seconds)`.
- `drumPosition(value, weight, carryWindow)`: rolling-drum position for odometer digits. The
  wheel for `weight` turns only while the lower wheels are within `carryWindow` of rolling over.
  Use `(alt, 20, 20)` for the 20-ft drum and `(alt, 100, 20)` for the hundreds drum. Values must
  be >= 0; draw the minus sign separately.
- Roses and dials: `roseAngle(bearingDeg, upDeg)` returns radians clockwise from up, in
  [-PI, PI). `polarX(cx, r, a)`, `polarY(cy, r, a)`,
  `dialAngle(v, vMin, vMax, aMin, aMax, clamp = true)`.
- Non-linear scales: `piecewise(xs, ys, x)` (clamped), `piecewiseSigned` (|x| table, sign
  re-applied, `xs[0] = 0`), `piecewiseInverse`.
- Deviation: `deviationPx(dev, dots, dotSpacingPx, overshootDots = 0)`,
  `deviationPegged(dev)` (true when |dev| >= 1).
- Attitude: `pitchLineOffsetPx(lineDeg, pitchDeg, pxPerDeg)`.
- `STANDARD_RATE_DPS = 3` and `standardRateBankDeg(tasKt)`, from tan(phi) = V omega / g. At
  100 kt this gives 15.36 deg; at 200 kt, 28.78 deg.
- Maps: `projectLocalNm(lat, lon, refLat, refLon, cosRefLat, out)` (equirectangular: x east nm,
  y north nm), `unprojectLocalNm`,
  `localToScreen(xNm, yNm, upSin, upCos, cx, cy, pxPerNm, out)`, `norm360`. `LocalXY = {x, y}`.

---

## 7. Dynamics (`common/dynamics.ts`)

- `new NeedleDynamics({ omega = 10, zeta = 0.75, maxRate = Infinity, min = -Infinity,
  max = Infinity, restitution = 0.2, circular = false, initial = 0 })`:
  - A second-order needle, x'' = w^2 (target - x) - 2 zeta w x'. It is integrated
    semi-implicitly with substeps (w dt <= 0.25), so it stays stable through frame hitches.
  - `min`/`max` are stop pins, and `restitution` sets the bounce off them.
  - `circular` chases the short way round and keeps the value in [0, 360).
  - `update(target, dt) -> value`, `reset(v)`; fields `value`, `rate`.
- `new RateEstimator(tau = 1)`: a filtered derivative for trend vectors. `update(v, dt)`,
  `updateAngle(deg, dt)` (wrap-aware), `reset()`, field `rate`.
- `blinkOn(timeS, hz = 1.6, duty = 0.5)`: stateless blink phase.
- `new Flasher(duration = 5, hz = 1.6)`: `trigger(duration?)`, `stop()`, `update(dt)`,
  `active`, `visible` (always true when idle).

---

## 8. Alerting (`common/alerting.ts`)

Pure logic, allocation-free and unit tested.

**`AltitudeAlerter(cfg = ALT_ALERT_GARMIN)`**: selected-altitude alerting.

- Call `update(altFt, selectedFt, dt)` every frame. Outputs: `phase: 'idle' | 'approaching' |
  'near' | 'captured' | 'deviation'`, `flashing`, `visible` (blink phase for the selected-altitude
  box) and `consumeAural()` (true once per tone).
- Changing the selected altitude re-initialises it silently, per the G1000 PG. `reset()` clears
  it.
- Config `AltitudeAlertConfig { approachFt, nearFt, captureFt, deviationFt, approachFlashS,
  deviationFlashS, flashNear }`.
- Presets:
  - `ALT_ALERT_GARMIN`: 1000 / 200 ft, deviation 200 ft, flashes 5 s (G1000 PG).
  - `ALT_ALERT_BOEING`: 900 / 300 ft (EST). The box turns white while alerting. A deviation
    flashes amber until the aircraft is back within the band (FCOM 10.10).
  - `ALT_ALERT_HONEYWELL` (EST).

**`MinimumsAlerter(cfg = MINIMUMS_GARMIN)`**: MDA/DH alerting.

- Call `update(heightFt, minimumsFt, onGround, dt)`. `heightFt` is baro altitude for BARO
  minimums or radio altitude for RA minimums.
- Outputs: `phase: 'inhibited' | 'hidden' | 'armed' | 'near' | 'reached'`, `shown`,
  `flashing`, `visible` and `consumeAural()` ("MINIMUMS"). `reset()` is the Boeing EFIS RST.
- Config `MinimumsConfig { showWithinFt, nearFt, armAboveFt, resetAboveFt, flashS }`.
- Presets:
  - `MINIMUMS_GARMIN`: shown within 2500 ft, white within 100 ft, armed after being 150 ft
    above, resets 50 ft above (G1000 PG).
  - `MINIMUMS_BOEING`: flashes 3 s, resets at +75 ft (FCOM).
  - `MINIMUMS_HONEYWELL` (EST).

**`ExceedanceMonitor(limits)`**: gauge colour state.

- `ExceedanceLimits { warnLow?, cautionLow?, cautionHigh?, warnHigh?, hysteresis?, flashS? }`.
- `update(value, dt) -> 0 | 1 | 2` (normal, caution, warning). Also `level`, `peak` (highest
  value seen while in warning), `flashing`, `visible` and `acknowledge()`.

---

## 9. Canvas helpers (`common/draw/context.ts`)

- Types: `Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D`,
  `Rect { x, y, w, h }`.
- Dash constants: `DASH_NONE`, `DASH_SHORT`, `DASH_MEDIUM`, `DASH_LONG`, `DASH_DOT`. These are
  shared arrays, so never mutate them.
- Paths and fills: `roundRectPath`,
  `box(ctx, x, y, w, h, fill, stroke, lineWidth = 1, radius = 0)`,
  `line(ctx, x0, y0, x1, y1, color, width)`,
  `polyPath(ctx, pts, closed, ox = 0, oy = 0, scale = 1)` (flat `[x0, y0, x1, y1, ...]`),
  `rotatedPolyPath(ctx, pts, closed, ox, oy, angle, scale = 1)`,
  `fillStroke(ctx, fill, stroke, lw = 1)` (`''` skips that part), `triangle(...)`,
  `circle(ctx, x, y, r, fill, stroke = '', lw = 1)`.
- Clipping: `clipRect`, `clipCircle`, `clipRoundRect`. These save the context and set the clip;
  call `ctx.restore()` afterwards.
- `barberPole(ctx, x, y, w, h, colorA, colorB, stripe, phase = 0)`.
- `dotGrid(ctx, x, y, w, h, spacing, radius, color)`.

---

## 10. Glass primitives (`common/draw/*`)

Every primitive:

- has a `state` object (`createXState()` returns a fresh default), a mutable `style`, and
  geometry fields (`x`, `y`, `w`, `h` or centre and radius) that you may move at run time;
- has `update(dt)` to advance timers and trend filters, and `draw(ctx)`;
- draws nothing but a flag or dashes when `state.valid` is false.

### 10.1 `AttitudeIndicator`

```ts
new AttitudeIndicator({ rect: Rect, cx, cy, style: AttitudeStyle })
```

`rect` is the area the horizon fills or is clipped to, and `(cx, cy)` is the aircraft
reference point. Presets:

- `ADI_GARMIN`: full-screen horizon with a gradient, 7.2 px/deg, single-cue FD, delta symbol.
  Red chevrons appear from +50 / -30 deg. It declutters beyond +30 / -20 deg pitch or 65 deg
  bank.
- `ADI_BOEING`: rounded-box clip, 8 px/deg, cross-pointer FD, wings symbol, trapezoid slip that
  fills at full scale. The bank pointer turns amber at 35 deg. Radio altitude and minimums
  readouts are drawn inside the ADI.
- `ADI_HONEYWELL`, `ADI_COLLINS` (EST).

`AttitudeState` fields:

| Field | Meaning |
|---|---|
| `valid` | false shows the attitude fail flag |
| `pitch`, `bank`, `slip` (-1..1), `heading` | attitude and slip |
| `fdVisible`, `fdPitch`, `fdBank` | FD commands (from `AP.fdPitch` / `AP.fdBank`) |
| `fpvVisible`, `fpaDeg`, `driftDeg` | flight path vector |
| `pliDeg` | pitch-limit indicator; NaN = hidden |
| `radioAltValid`, `radioAltFt` | use `quantizeRadioAlt` (G1000 table 2-4) |
| `minimumsFt`, `minimumsIsRadio`, `minimumsPhase`, `minimumsVisible` | minimums readout |
| `risingRunway`, `locDev` | Boeing rising runway |
| `decluttered` | output: set by `update` |

Style interfaces: `PitchLadderStyle`, `BankScaleStyle` (`pointerMode: 'sky' | 'ground'`),
`SlipStyle`, `FlightDirectorStyle`, `AircraftSymbolStyle`, `AttitudeStyle`. Extra members:
`elapsed` and `blink(hz)`.

### 10.2 `DeviationScale` and `drawMarkerBeacon`

```ts
new DeviationScale({ x, y, style })   // x, y = scale centre
```

- Presets: `GS_SCALE_GARMIN` (vertical, 2 dots, diamond), `VDI_GARMIN` (chevron),
  `GS_SCALE_BOEING`, `LOC_SCALE_BOEING`.
- State `DeviationScaleState`: `valid`, `dev`, `color`, `hollow` (preview or not captured),
  `label` (`'G'`, `'V'`, ...), `flag` (drawn when invalid, e.g. `'NO GS'`), `alert` (Boeing
  amber scale and flashing pointer), `dev2` and `color2` (second pointer; NaN = none).
- `createDeviationState(color)`, `pointerOffset(dev)`.
- `drawMarkerBeacon(ctx, x, y, kind 0..3, 'garmin' | 'boeing', palette, typeface, size = 20)`:
  1 = outer (cyan), 2 = middle (amber), 3 = inner (white).

### 10.3 `SpeedTape`

```ts
new SpeedTape({ x, y, w, h, style, centerY?, ranges?: SpeedRange[], bugCount = 8 })
```

Presets:

- `SPEED_TAPE_GARMIN`: 6 s magenta trend. Red and white barber pole above Vmo, red low-speed
  awareness band. V-speed flags, Mach shown at and above M 0.40.
- `SPEED_TAPE_BOEING`: 10 s green trend and magenta cursor. Max-speed and stick-shaker barber
  poles, amber minimum-manoeuvre bar. The readout box turns amber and flashes for 10 s.
- `SPEED_TAPE_HONEYWELL`, `SPEED_TAPE_COLLINS`.

`C172S_ASI_RANGES` holds the 172S arcs for the G1000 strip (white 40-85, green 48-129, yellow
129-163, red > 163 KIAS; POH Figure 2-2).

`SpeedTapeState` fields:

| Field | Meaning |
|---|---|
| `valid`, `ias`, `mach` | current speed |
| `accelKtS` | NaN = estimate from `ias` |
| `selectedKt`, `selectedMach`, `selectedIsMach`, `selectedManaged` | managed = magenta |
| `maxKt`, `minKt`, `minManeuverKt`, `lowSpeedAwarenessKt`, `flapLimitKt`, `greenDotKt` | limits; NaN = hidden |
| `bugs: SpeedBug[]` | `{ label, kt, visible, color }`, caller-owned fixed array |
| `overspeed`, `lowSpeed`, `trendKt` | outputs of `update` |

Also: `machVisible` (with hysteresis) and `ranges`. The readout has rolling ones digits and
carry drums. Off-scale bugs are listed as text at the top or bottom.

### 10.4 `AltitudeTape`

```ts
new AltitudeTape({ x, y, w, h, style, centerY? })
```

- Presets:
  - `ALT_TAPE_GARMIN`: 20-ft drum, selected-altitude box above the tape, baro box below it,
    6 s trend, minimums bug.
  - `ALT_TAPE_BOEING`: green crosshatch below 10,000 ft, magenta selected altitude, green baro,
    no trend.
  - `ALT_TAPE_HONEYWELL`, `ALT_TAPE_COLLINS`.
- State `AltitudeTapeState`: `valid`, `altFt`, `vsFpm` (NaN = differentiate internally),
  `selectedFt`, `alertPhase`, `alertVisible` (from `AltitudeAlerter`), `baroInHg`,
  `baroUnit: 'inhg' | 'hpa'`, `baroStd`, `baroPreselectInHg`, `baroFlash`, `minimumsFt`,
  `minimumsPhase`, `metric`, `vnavTargetFt`, `groundAltFt` (hatched below; from the radio
  altimeter or the landing elevation). Output: `trendFt`.
- `flightLevelText(altFt)` returns `"FL350"`.

### 10.5 `VerticalSpeedIndicator` (glass)

```ts
new VerticalSpeedIndicator({ x, y, w, h, style })
```

- Presets:
  - `VSI_GARMIN_2000`: piston, +/-2000 fpm.
  - `VSI_GARMIN_4000`: jets.
  - `VSI_BOEING`: needle from a pivot, non-linear 0-6000 fpm. The digital readout shows when
    |VS| > 400 fpm (FCOM).
  - `VSI_HONEYWELL`, `VSI_COLLINS`.
- State: `valid`, `vsFpm`, `selectedFpm`, `requiredFpm` (RVSI, from `FMS.vsRequiredFpm`), and
  the TCAS RA bands `raGreenFrom/To` and `raRedFrom/To`. All targets are NaN = none.
- `yFor(fpm)`.

### 10.6 `Hsi`

```ts
new Hsi({ cx, cy, radius, style, mode?: 'rose' | 'arc', arcSpanDeg = 90,
  gs?: { style?, dx }, wind?: { dx, dy } | null })
```

Presets: `HSI_GARMIN`, `HSI_BOEING`, `HSI_HONEYWELL`, `HSI_COLLINS`.

`HsiState` fields:

| Field | Meaning |
|---|---|
| `valid`, `heading`, `headingIsTrue` | heading and reference |
| `selectedHeading`, `track`, `turnRateDps` | bug, track mark, turn-rate trend (6 s on Garmin) |
| `courseVisible`, `course`, `courseColor`, `courseDouble` | course pointer |
| `cdiValid`, `cdi`, `toFrom` (1 / -1 / 0), `xtkNm` | deviation; XTK is shown when pegged |
| `sourceLabel` (`'GPS'`, `'VOR1'`, `'LOC2'`), `phaseLabel` (`'TERM'`, `'LPV'`) | annunciations |
| `bearing1`, `bearing2` | `{ visible, bearing, lines: 1 \| 2, color }` |
| `windValid`, `windFrom`, `windKt` | wind box |
| `gsVisible`, `gsValid`, `gsDev`, `gsColor`, `gsFlag` | glideslope scale beside the rose |

The embedded GS scale is available as `gsScale`.

### 10.7 `TerrainRaster`

```ts
new TerrainRaster({ world: Pick<WorldQuery, 'elevationAt'>, size = 128, coverage = 1.45,
  samplesPerUpdate = 900, pixelsPerCell = 2 })
```

A cached north-up grid of elevations. It samples incrementally, nearest cells first, within a
per-update budget, and shifts by whole cells as the aircraft moves. A change of altitude
recolours the grid from a LUT without resampling.

- Fields: `mode: 'off' | 'relative' | 'egpws' | 'topo'`, `alertLevel: 0 | 1 | 2`,
  `alertLookAheadNm = 4`, `gearDown`, `size`, `ppc`, `canvas`.
- Methods: `update(lat, lon, rangeNm, altFt, trackDeg)`,
  `draw(ctx, centerX, centerY, pxPerNm, upDeg)`, `reset(lat, lon, cellNm)`,
  `cachedElevationFt(lat, lon)` (NaN when not yet sampled), `completeness` (0..1), `gridLat`,
  `gridLon`, `gridCellNm`.
- `terrainBand(mode, dFt, gearDown)` exposes the pure classification:
  - relative: red above -100 ft, yellow down to -1000 ft;
  - egpws: Honeywell EGPWS pilot guide density bands.

`MovingMap` uses the raster; build your own only for a stand-alone TAWS page.

### 10.8 Map symbols (`draw/mapSymbols.ts`)

- `drawAirportSymbol(ctx, x, y, runwayAngle, 'towered' | 'untowered' | 'soft' | 'private',
  style: 'garmin' | 'boeing' | 'honeywell', palette, size = 8)`
- `drawRunway(ctx, x0, y0, x1, y1, widthPx, color, outline)`
- `drawNavaidSymbol(ctx, x, y, kind: 'VOR' | 'VORDME' | 'VORTAC' | 'TACAN' | 'DME' | 'NDB' |
  'FIX' | 'WPT', style, palette, size = 8, color = '')`
- `drawTrafficSymbol(ctx, x, y, level 0..3, relAltFt, vsFpm, palette, typeface, baseColor,
  size = 9)`: 0 = other, 1 = proximate, 2 = TA, 3 = RA. Draws the relative altitude and the
  climb/descent arrow (above 500 fpm).
- `drawOwnship(ctx, x, y, angle, style, palette, size = 16)`
- `drawLocalizerFeather(ctx, x, y, inboundScreenAngle, lengthPx, color)`

### 10.9 `MovingMap`

```ts
new MovingMap({ rect, style, ownX?, ownY?, rangePx?,
  nav?: Pick<NavDatabase, 'airportsNear' | 'navaidsNear' | 'fixesNear'>,
  world?: Pick<WorldQuery, 'elevationAt'>, terrainCells = 128, trafficCapacity = 30 })
```

- Presets: `MAP_GARMIN`, `MAP_BOEING` (ND arc rings), `MAP_HONEYWELL`. `MapStyle.ranges` is the
  ordered range list.
- `MapState` fields:
  - own-ship: `valid`, `lat`, `lon`, `altFt`, `vsFpm`, `heading`, `track`, `gsKt`, `dtk`;
  - view: `orientation: 'north-up' | 'track-up' | 'heading-up' | 'dtk-up'`, `rangeNm` (own-ship
    to the range edge), `declutter: 0..3`;
  - terrain: `terrain: TerrainMode`, `tawsLevel: 0..2`, `gearDown`;
  - layers: `showAirports`, `showNavaids`, `showFixes`, `showTraffic`, `showRoute`,
    `showRangeRings`;
  - pan: `panActive`, `panLat`, `panLon`;
  - route markers: `todDistNm`, `selAltFt` (range-to-altitude arc);
  - `traffic: TrafficTarget[]`, a fixed array of `{ active, lat, lon, relAltFt, vsFpm, level }`.
- Methods:
  - `setRoute(legs: MapRouteLeg[] | null, activeIndex)`: nav's `PlanLeg[]` works directly.
    It draws TF/DF/CF legs, arcs, holds (racetrack), heading legs (dashed) and fly-by turns.
    The active leg is magenta, others white, missed approach cyan.
  - `setActiveLeg(i)`, `setRange(nm)`, `rangeUp()`, `rangeDown()`.
  - `pan(dxPx, dyPx)`, `clearPan()`.
  - `pxPerNmNow()`, `upBearing()`, `project(lat, lon, out)`, `unproject(x, y, out)`.
  - `update(dt)` (terrain, cached database queries), `draw(ctx)`.
- `weatherOverlay: ((ctx, map) => void) | null` is a hook drawn after terrain and before
  symbols. `terrain` exposes the `TerrainRaster`.
- Database queries refresh when the aircraft moves 15 % of the range, the range changes, or 5 s
  pass.

### 10.10 Engine indications (`draw/EngineIndications.ts`)

Shared types:

- `GaugeScale { min, max, bands: GaugeBand[], redlines, amberlines, ticks, labels,
  limits: ExceedanceLimits, decimals: 0 | 1 | 2, readoutStep, unit }`.
- `GaugeBand { from, to, color }`.

Gauges:

- **`DialGauge({ x, y, radius, scale, style: DialStyle, caption? })`**
  - Presets: `DIAL_BOEING` (737 N1/EGT: shaded sector needle, digital box), `DIAL_GARMIN`.
  - State: `valid`, `value`, `commandValue`, `referenceValue`, `targetValue` (NaN = hidden).
  - Also `exceed` (ExceedanceMonitor) and `angle(v)`.
- **`LinearGauge({ x, y, length, scale, style: LinearStyle, caption?, pointerLabels? })`**
  - Presets: `BAR_GARMIN` (horizontal triangles), `TAPE_GARMIN` (vertical), `TAPE_FILL` (filled
    bar).
  - State: `valid`, `value`, `value2` (the second L/R pointer; NaN = single).
  - Also `exceed`, `exceed2` and `pos(v)`.
- **`DigitalReadout({ x, y, label, unit, decimals, limits, palette, typeface, size?,
  normalColor?, labelColor? })`**: fields `valid`, `value`, `exceed`. It shows inverse video
  while an exceedance flashes.

`formatValue(v, scale)` formats a value with the scale's decimals and readout step.

Presets:

- `C172S_SCALES` (from 172S POH Figure 2-3):
  - `rpm`: green 2100-2700, red 2700;
  - `oilTempF`: green 100-245, red 245;
  - `oilPressPsi`: red 20, green 50-90, red 115;
  - `fuelFlowGph`: 0-12 green;
  - `vacuumInHg`: 4.5-5.5;
  - `fuelQtyGal`: red at 1.5.
- `B737_N1_SCALE`: redline 104 % (EASA TCDS E.004).
- `B737_EGT_SCALE`: amber 925, red 950 deg C (CFM56-7B).

### 10.11 CAS (`draw/CasWindow.ts`)

**`CasModel(ackLevels = ['warning', 'caution'])`**

- `define(id, text, level)` (setup), `setActive(id, on)` (per frame, no allocation),
  `set(id, text, level, on)`, `isActive(id)`.
- `acknowledge(level?)` (MASTER WARNING / CAUTION), `acknowledgeAll()` (at power-up, messages
  already present do not flash).
- `list` (display order: warnings, cautions, advisories, status; newest first within a level),
  `unackedWarnings`, `unackedCautions`, `highestLevel`.
- `scroll`, `scrollBy(rows, visibleRows)`.

**`CasWindow({ x, y, w, h, model, style })`**

- Presets: `CAS_GARMIN` (unacknowledged messages flash in inverse video), `CAS_HONEYWELL`,
  `CAS_BOEING`.
- Warnings are pinned at the top. The scroll indicator takes the colour of the hidden messages.
- Also `visibleRows`, `animating`, `levelColor(level)`, `update(dt)`, `draw(ctx)`.
- Drive the master lights from the model: set `ALERT.masterWarning` (`alert.master_warning`)
  while `cas.unackedWarnings > 0`, and `ALERT.masterCaution` while `cas.unackedCautions > 0`.
  Pressing a MASTER light calls `cas.acknowledge('warning')` or `cas.acknowledge('caution')`.

### 10.12 `SoftKeyBar`

```ts
new SoftKeyBar({ x, y, w, h, count, style: SOFTKEYS_GARMIN, orientation?: 'horizontal' | 'vertical' })
```

- `keys: SoftKey[]`, each `{ label, state: 'normal' | 'active' | 'highlight' | 'disabled' |
  'blank', status }`.
- `setKey(i, label, state = 'normal', status = '')`, `setLabels(labels)`.
- `press(i)` flashes the key and returns its label, or `''` for a blank or disabled key. Bezel
  button controls call it.
- `keyAt(px, py)` (touch), `animating`, `update(dt)`, `draw(ctx)`.
- Garmin conventions: an active key shows black on grey; `MSG` stays highlighted while messages
  remain.

### 10.13 Text UI: `MenuList`, `DataField`, `ModeAnnunciator`

**`MenuList({ x, y, w, h, style: TEXT_UI_GARMIN, title? })`**

- `items: MenuItem[]`, each `{ label, value, enabled, checked }`.
- `setItems(items)`: allocates, so call it on page change only.
- `cursor`, `scroll`, `cursorActive`.
- `move(delta)` skips disabled items and returns the new index. `select()` returns the index,
  or -1 if the item is disabled. `itemAt(px, py)`, `visibleRows`, `draw(ctx)`.

**`DataField({ x, y, w, label?, style, color?, align? })`**

- Fields `value`, `selected`, `editing`, `editPos` (the flashing character).
- The owner implements the editing rules; `DataField` only renders.

**`ModeAnnunciator({ x, y, w, h, columns, style: FMA_GARMIN })`**: Garmin AFCS status bar,
Boeing FMA, Primus / Fusion mode line.

- `set(i, active, armed = '', activeColor = '', armedColor = '')`: a change of the active mode
  starts the 10 s change highlight. Garmin flashes the new mode; the Boeing style
(`change: 'box'`) draws a box around it.
- `columns: FmaColumn[]`, `animating`, `update(dt)`, `draw(ctx)`.
- `TextUiStyle` and `FmaStyle` are plain objects. Build a Boeing FMA style from
  `{ ...FMA_GARMIN, palette: BOEING_PALETTE, typeface: BOEING_TYPEFACE, change: 'box' }`.

### 10.14 `ChecklistView`

```ts
new ChecklistView({ x, y, w, h, style: CHECKLIST_GARMIN })
```

- It renders `Checklist` from `aircraft/types.ts`
  (`{ title, phase, items: { challenge, response, check?(vars) }[] }`).
- `setChecklist(cl)`, `move(delta)`, `toggle()` (ticks the item and advances), `next()`.
- `autoCheck(vars)` ticks closed-loop items whose `check(vars)` passes.
- `complete`, `checked[]`, `cursor`, `visibleRows`, `draw(ctx)`.

---

## 11. Building each avionics family from the primitives

In every case, subclass `CanvasDisplay` at the family's design size. In `update(dt)`, read
**sensor** vars (`ADC.*`, `NAV.*`, `GPS.*`, `FMS.*`, `AP.*`, `ENG.*`, `FUEL.*`), never `fdm.*`
(except GPS position and ground speed, per CLAUDE.md). Write the values into primitive state,
advance the alerters and primitives, then draw.

| Family | Palette / typeface | ADI | Speed / Alt / VSI | HSI / Map | Engine / CAS |
|---|---|---|---|---|---|
| Garmin G1000 NXi (172S G1000), G3000 (Citation M2), G5000 (Citation Longitude) | `GARMIN_*` | `ADI_GARMIN`, full screen | `SPEED_TAPE_GARMIN` + `C172S_ASI_RANGES` (172) or `maxKt`/`lowSpeedAwarenessKt` (jets); `ALT_TAPE_GARMIN`; `VSI_GARMIN_2000` (172) / `VSI_GARMIN_4000` | `HSI_GARMIN` rose on PFD, arc for inset; `MAP_GARMIN`, `terrain: 'relative'` (TAWS-B) | `C172S_SCALES` + `LinearGauge`/`DialGauge(DIAL_GARMIN)`; `CAS_GARMIN` (jets); `SOFTKEYS_GARMIN` x12; `FMA_GARMIN` |
| Honeywell Primus Epic: PlaneView II (G650), Symmetry (G800) | `HONEYWELL_*` | `ADI_HONEYWELL` | `SPEED_TAPE_HONEYWELL`, `ALT_TAPE_HONEYWELL`, `VSI_HONEYWELL` | `HSI_HONEYWELL`, `MAP_HONEYWELL`, `terrain: 'egpws'` | `LinearGauge(TAPE_FILL)`, `CAS_HONEYWELL`, `MINIMUMS_HONEYWELL`, `ALT_ALERT_HONEYWELL` |
| Collins Pro Line Fusion, as Bombardier Vision (Global 6000) | `COLLINS_*` | `ADI_COLLINS` | `SPEED_TAPE_COLLINS`, `ALT_TAPE_COLLINS`, `VSI_COLLINS` | `HSI_COLLINS`, `MAP_HONEYWELL` with `derivePalette(COLLINS_PALETTE, ...)`, `terrain: 'egpws'` | `TAPE_FILL`, CAS with the Collins palette |
| 737NG CDS | `BOEING_*` (stroke font) | `ADI_BOEING` (+RA, minimums, rising runway, PLI, FPV) | `SPEED_TAPE_BOEING` (max/min/minManeuver, bugs `V1`/`VR`/`REF`/flap numbers), `ALT_TAPE_BOEING`, `VSI_BOEING` | `HSI_BOEING` arc/rose (EXP/MAP), `MAP_BOEING`, `terrain: 'egpws'`; `GS_SCALE_BOEING`, `LOC_SCALE_BOEING` | `DialGauge(DIAL_BOEING, B737_N1_SCALE / B737_EGT_SCALE)` with `commandValue`/`referenceValue`; EICAS messages via `CasModel` + `CAS_BOEING`; `ALT_ALERT_BOEING`, `MINIMUMS_BOEING` (RST = `reset()`) |
| 737 FMC CDU | `MONO_TYPEFACE` | - | - | - | Use `CallbackDisplay` + `MONO_TYPEFACE`; `DataField` for scratchpad/LSK lines |

Typical var mapping:

- ADI: `ADC.pitch(s)`, `ADC.bank(s)`, `ADC.slip(s)`, `ADC.ahrsValid(s)`. FD: `AP.fdOn(side)`,
  `AP.fdPitch`, `AP.fdBank`.
- Speed: `ADC.ias(s)`, `ADC.mach(s)`, `AP.selSpeed`, `AP.selMach`, `AP.speedIsMach`.
- Altitude: `ADC.baroAlt(s)`, `ADC.vs(s)`, `ADC.baroSetting(s)`, `ADC.baroStd(s)`,
  `AP.selAltitude`, `FMS.vnavTargetAltFt`.
- HSI: `ADC.heading(s)`, `GPS.trackMag`, `ADC.turnRate(s)`, `AP.selHeading`, `AP.selCourse(n)`.
  For NAV sources: `NAV.cdi(r)`, `NAV.toFrom(r)`, `NAV.received(r)`. For GPS: `FMS.cdi`,
  `FMS.toFrom`, `FMS.xtkNm`. Bearing pointers: `NAV.bearing(r)` / `NAV.bearingValid(r)`, or
  heading + `NAV.adfBearing(r)`.
- GS: `NAV.gsValid(r)`, `NAV.gsDev(r)`. Markers: `NAV.markerOuter`, `NAV.markerMiddle`,
  `NAV.markerInner`.
- Map: `GPS.lat`, `GPS.lon`, `GPS.gs`, `GPS.trackTrue`, `FMS.todDistNm`.
- RVSI: `FMS.vsRequiredFpm`.

---

## 12. Analog instruments: frame, sizes, SimVars

- `INSTRUMENT_SIZE.ATI3 = 0.079375` m (3-1/8 in, the six-pack) and `INSTRUMENT_SIZE.ATI2 =
  0.05715` m (2-1/4 in), per ARINC 408 / AS 26 cut-outs. `DIAL_RADIUS_FRACTION = 0.43`
  (EST).
- Every instrument is a `CockpitControl`: `object` (a THREE.Group in the gauge frame, placed by
  the cockpit builder), `hitTargets` (the knobs and buttons only), `update(dt)`, `tooltip()`,
  and the pointer handlers.
- **`ANALOG_VARS`** (defaults; every instrument option can override them).

  Inputs the aircraft or systems **must write**:

  | Key | Var | Meaning |
  |---|---|---|
  | `instrumentLight` | `ac.light.instruments` | 0..1, dimmer x bus |
  | `suction` | `ac.vac.suction_inhg` | **missing = 0 inHg** (gyros stopped) |
  | `turnCoordVolts` | `ac.elec.turn_coord_v` | |
  | `gaugeVolts` | `ac.elec.gauges_v` | fuel qty / oil / FF senders |
  | `clockVolts` | `ac.elec.clock_v` | |
  | `busVolts` | `ac.elec.bus_v` | |
  | `ammeterAmps` | `ac.elec.batt_amps` | + = charging |
  | `compassExtraDeviation` | `ac.compass.extra_dev_deg` | e.g. alternator off, up to 25 deg per POH |

  A missing supply-**voltage** var reads 28 V, so the instrument counts as powered.

  Standard sensor vars read:

  | Key | Var |
  |---|---|
  | `ias` | `adc1.ias_kt` |
  | `altitude` | `adc1.alt_ft` |
  | `pressureAlt` | `fdm.press_alt_ft` (static pressure, used by the standby-altimeter mode) |
  | `vs` | `adc1.vs_fpm` |
  | `baroSetting` | `adc1.baro_inhg` |
  | `oatC` | `adc1.tat_c` |
  | `utcHours` | `env.time_utc_h` |
  | `navCdi` | `NAV.cdi` |
  | `fuelTankKg` | `FUEL.tankKg` |

  Instrument state written by the instruments, which the aircraft may persist or read:

  | Key | Var | Meaning |
  |---|---|---|
  | `asiTasRing` | `ac.asi.tas_ring` | TAS factor k |
  | `aiSymbolOffset` | `ac.ai.symbol_adj` | -1..1 |
  | `headingBug` | `ap.sel_hdg_deg` | |
  | `dgHeadingOut` | `ac.dg.hdg_deg` | displayed DG heading, for the KAP 140 HDG error |
  | `adfCard` | `ac.adf.card_deg` | |
  | `egtReference` | `ac.egt.ref_f` | |
  | `tachHours` | `ac.eng1.tach_hours` | |
  | `vsiZero` | `ac.vsi.zero_fpm` | |

- **`PHYSICAL_INPUTS`**: `fdm.pitch_deg`, `bank`, `hdg_mag_deg`, `p/q/r_dps`, `nx/ny/nz_g`,
  `lat/lon`, `alt_msl_ft`. The gyros, compass and ball are self-contained mechanical sensors.
  Their failure modes (suction, power, tumbling, precession, turning and acceleration errors)
  are modelled inside the instrument, so they sample FDM truth, as the GPS exception allows.
  Every such input is overridable through the instrument options.

---

## 13. `AnalogGauge`, `GaugeKnob`, `FaceCanvas`, geometry

**`abstract class AnalogGauge implements CockpitControl`**

```ts
interface AnalogGaugeOptions {
  id: string; name?: string; vars: SimVars; audio?: AudioApi;
  size?: number;                          // INSTRUMENT_SIZE.ATI3 default
  bezel?: 'square' | 'round' | 'none';    // default 'square' (flange with 4 screws)
  depth?: number;                         // dial-to-glass (default 0.11 x size)
  textureSize?: number;                   // face px, default 512
  lightVar?: string;                      // default ANALOG_VARS.instrumentLight
  lightColor?: THREE.ColorRepresentation; // default '#ffd9a8' (EST warm post light)
  materials?: Partial<{ bezel, knob, screw }>;   // share cockpit materials
  knobCorners?: ('tl' | 'tr' | 'bl' | 'br')[];  // no screw drawn there
}
```

- Public: `id`, `name`, `object`, `hitTargets`, `size`, `dialR`, `depth`, `frontZ`,
  `textureSize`, `update(dt)`, `tooltip()`, `onPointerDown`, `onPointerUp`, `onDrag`, `onWheel`,
  `onCancel`, `cursor()` (`'grab'`), `dispose()`, `knob(name)` (programmatic access for key
  bindings and tests), and `static setAngle(obj, degCW)`.
- `update(dt)` sets the emissive intensity of lit materials to `0.9 x light` (EST), updates
  the knobs, then calls `updateGauge(dt)`.
- Protected helpers for subclasses:
  - `face(px?)` creates a `FaceCanvas`.
  - `addDial(face, z, radius, parent, windows, lit)` adds the painted disc; `windows = true`
    uses alphaTest holes.
  - `addPlane(face, w, h, x, y, z, parent, lit, alpha)`.
  - `addDynamicPlane(pxW, pxH, w, h, x, y, z, { lit, parent })` returns a `DynamicPlane`
    `{ canvas, ctx, texture, material, mesh, commit() }` for LCDs, hour meters and drums.
  - `addNeedle(spec, { x, y, z, material, hubRadius, parent })` returns the pivot group.
  - `addKnob(opts)`, `track(disposable)`.
  - Fields `vars`, `audio`, `mats`, `knobs`, `litMaterials`, `light`.
- `cornerKnobPosition(size, corner)` gives the standard knob positions in the flange corners.

**`GaugeKnob`** (created through `addKnob`)

```ts
interface GaugeKnobOptions {
  name: string;                     // tooltip label: 'BARO', 'OBS', 'HDG', 'ADJ', 'TAS', 'ZERO', 'EGT REF'
  x: number; y: number; z?: number; radius?: number; length?: number;
  onTurn(steps: number, fine: boolean): void;   // + = clockwise
  onPush?(): void; onRelease?(): void;
  dragPxPerStep?: number;           // default 10
  detentDeg?: number;               // default 18 (visual rotation per detent)
  material?: THREE.Material; onDetent?(): void; // default: plays COCKPIT_SOUNDS.knobDetent at 0.5
}
```

The mouse model follows `cockpit/types.ts`:

- left click = one detent clockwise; right click = one detent counter-clockwise;
- wheel = detents, and Shift sets `fine`;
- left drag = continuous;
- middle click = push.

Methods: `turn(steps, fine)`, `down`, `up`, `wheel`, `drag`, `update`, `owns(obj)`,
`attachIndex(mark)` and `dispose`.

**`FaceCanvas(sizePx = 512, family = FONT_STACKS.gauge)`**: dial painting in normalised
coordinates (dial radius 1, +y up). Angles are degrees clockwise from 12.

- Coordinate helpers: `X`, `Y`, `px`, `py`.
- Painting: `background(color = DIAL_BLACK, square)`, `tick(deg, f0, f1, width, color)`,
  `ticks(from, to, step, angleOf, f0, f1, width, color)`, `band(a0, a1, f0, f1, color)`,
  `arc(a0, a1, f, width, color)`, `text(str, x, y, size, color, align, weight, family)`,
  `label(str, deg, f, size, color, radial = false, rotOffset = 0)`,
  `poly(pts, fill, stroke, width)`, `dot(x, y, rf, fill, stroke, width)`.
- Transparent holes: `window(x, y, w, h)`, `sectorWindow(a0, a1, f0, f1)`,
  `circleWindow(x, y, rf)`.
- `texture()` returns an sRGB `CanvasTexture`.
- Colours: `DIAL_BLACK`, `DIAL_WHITE`, `MARK_GREEN`, `MARK_YELLOW`, `MARK_RED`, `MARK_WHITE`,
  `MARK_BLUE`.

**Geometry** (`analog/geometry.ts`):

- Bezels and case: `roundBezelGeometry`, `squareBezelGeometry`, `rectBezelGeometry`,
  `roundedRectShape`, `caseWallGeometry`.
- Needles: `needleGeometry(spec: NeedleSpec, dialR)`, where
  `NeedleSpec { length, tail, width, tipWidth` (fractions of dialR)
  `, style: 'pointer' | 'sword' | 'thin' | 'bar', thickness? }`.
- Small parts: `hubGeometry`, `knobGeometry`, `screwGeometry`.
- Materials: `createGaugeMaterials(lightColor, overrides) -> GaugeMaterialSet { bezel, wall,
  needle, hub, glass, knob, screw }`.

---

## 14. Generic gauges and 172S engine gauges

**`RoundGauge(opts: RoundGaugeOptions)`**: a single needle.

- `scale: RoundScale { min, max, startDeg, endDeg, table?: { v, a }, majorStep, minorStep,
  labelStep?, labelDivisor?, labelSize?, bands?: ScaleBand[], redlines?, captions?,
  restValue? }`.
- Input: `inputVar` with `inputScale` and `inputOffset`, or `read(vars)` (no allocation).
- Power: `powerVar` and `minVolts` (default 10 V). Below `minVolts` the needle falls to
  `restValue`; leave `powerVar` unset for mechanical gauges.
- Other options: `needle` (`DEFAULT_NEEDLE`), `dynamics`, `paint(face)`, `windows`, `unit`,
  `decimals`.
- Public: `value` (displayed) and `angleOf(v)`.

**`TwinGauge(opts)`**: the Cessna dual 2-1/4 in indicator with `left` and `right`
`TwinSide`.

- `TwinSide { caption, unit?, min, max, ticks, labels?, minorStep?, bands?, redlines?,
  inputVar | read, inputScale?, inputOffset?, restValue?, selfPowered?, dynamics?,
  reference?: { var, step, name } }`.
- A `reference` adds an adjustable index needle with a knob in that side's lower corner.
- Also `captions`, `powerVar`, `minVolts`.

172S presets (every option can be overridden; `BaseOpts` = `AnalogGaugeOptions` without
`knobCorners`):

- **`FuelQuantityGauge({ ..., leftVar = fuel.tank0_kg, rightVar = fuel.tank1_kg, kgPerGal =
  6.0 lb/gal avgas, unusableGal = 1.5, fullScaleGal = 26.5, powerVar = ac.elec.gauges_v,
  sloshGalPerG = 0.8 })`**: reads 0 with the unusable fuel left. The float bounces with nz
  (EST).
- **`OilTempPressGauge({ engine = 1, powerVar })`**: reads `eng1.oil_temp_f` and
  `eng1.oil_press_psi`. Both senders are electric.
- **`VacuumAmmeterGauge({ suctionVar, ampsVar })`**: suction 3-7 inHg with a 4.5-5.5 green
  range, and amps +/-60. Both are direct-reading.
- **`EgtFuelFlowGauge({ engine, egtVar = eng1.egt_f, fuelFlowVar = eng1.ff_gph, referenceVar =
  ac.egt.ref_f, powerVar })`**
  - EGT is a self-powered thermocouple with an adjustable reference needle.
  - The scale is 1250-1650 F (EST; the dial has no numbers).
  - Fuel flow is 0-12 GPH, green.
- **`Tachometer({ engine = 1, rpmVar, hoursVar = ac.eng1.tach_hours, referenceRpm = 2400,
  initialHours, scale = C172S_TACH_SCALE })`**
  - Mechanical; the needle flickers with `eng1.rough` (`ENG.roughness`, +/-15 rpm EST).
  - The hour meter integrates hours x rpm / 2400 (EST reference) and writes `hoursVar`. Public
    `hours`.
  - Green is 2100-2500, narrowing to 2700 with altitude; red line 2700 (POH Figure 2-3).
- `createSuctionGauge(o)`, `createVoltmeter(o)` (0-35 V, green 24-30 V EST),
  `createAmmeter(o)`.

---

## 15. Flight instruments

Each class extends `AnalogGauge` (except `MagneticCompass`) and takes `AnalogGaugeOptions` plus
the options below.

### `AirspeedIndicator`

- Options: `iasVar = adc1.ias_kt`, `tasRingVar = ac.asi.tas_ring`, `markings =
  C172S_ASI_MARKINGS` (white 40-85, green 48-129, yellow 129-163, red 163), `table =
  C172S_ASI_TABLE` (EST dial angles), `tasReferenceKt = 110`.
- Knob `TAS` (lower left): k +/-0.005 per detent (0.001 with Shift), clamped to 0.9..1.45.
- A PA-over-OAT alignment gives the correct TAS/IAS factor; see `models/tasRing`.
- `angle(kt)`.

### `AnalogAttitudeIndicator`

- Options: `suctionVar`, `symbolVar = ac.ai.symbol_adj`, `bankScale: 'dial' | 'case'`,
  `gyro: AttitudeGyroOptions`, `pitchScale = 0.021 R/deg`, `maxPitchDeg = 25`, and input
  overrides `pitchVar`, `bankVar`, `nxVar`, `nyVar`, `nzVar`.
- The horizon card scrolls by UV offset inside a roll ring.
- Knob `ADJ` (bottom): +/-0.05 per detent.
- `gyro` (public), `setSpunUp()`, `setStopped()`. Use these to apply initial states.

### `Altimeter`

- Options: `source: 'adc' | 'pressure' = 'adc'`, `altVar = adc1.alt_ft`, `pressureAltVar =
  fdm.press_alt_ft`, `baroVar = adc1.baro_inhg`, `degPerInHg = 55`.
- Three pointers (100 / 1,000 / 10,000 ft) and the Kollsman drum (inHg at 3 o'clock, mb at 9).
- Knob `BARO` (lower left): 0.01 inHg per detent (0.002 with Shift), 28.1-31.0.
- In `'adc'` mode the knob writes `adc1.baro_inhg`, which the 172's air-data model uses.
  `'pressure'` mode computes the reading itself (standby altimeter).
- `kollsmanInHg`.

### `TurnCoordinator`

- Options: `voltsVar = ac.elec.turn_coord_v`, `gyro: TurnGyroOptions`, `ball:
  InclinometerOptions`, and input overrides `pVar`, `rVar`, `nyVar`, `nzVar`.
- Airplane symbol with L/R standard-rate marks; the OFF flag drops in and the motor stops
  below `gyro.minVolts` (default 18 V, EST for a 28 V system).
- Ball from `ny`/`nz` specific force.
- `gyro`, `ball`, `setSpunUp()`.

### `HeadingIndicator`

- Options: `suctionVar`, `bugVar = ap.sel_hdg_deg`, `headingOutVar = ac.dg.hdg_deg`, `gyro:
  DirectionalGyroOptions`, `bug = true`, and input overrides `headingVar`, `pitchVar`,
  `bankVar`, `latVar`.
- Precession: random friction drift plus uncompensated earth rate (15.041 sin(lat) deg/h).
  Tumbles beyond its gimbal limits.
- Knobs: `ADJ` (lower left, 1 deg per detent, 0.25 with Shift; also cages) and `HDG` bug (lower
  right, 1 deg per detent, 10 with Shift).
- Writes `headingOutVar` every frame.
- `heading`, `setSpunUp(errDeg = 0)`, `setStopped()`.

### `AnalogVerticalSpeedIndicator`

- Options: `vsVar = adc1.vs_fpm`, `zeroVar = ac.vsi.zero_fpm`, `lagTau = 2.5 s` (PHAK:
  6-9 s to stabilise), `table = C172S_VSI_TABLE`.
- Knob `ZERO`: 10 fpm per detent, +/-300.
- `angle(fpm)`.

### `CourseIndicator` (KI 208 / KI 209A)

- Options: `receiver = 1`, `glideslope = false` (true = KI 209A).
- Reads `nav{r}.cdi`, `.to_from`, `.received`, `.powered`, `.gs_valid` and `.gs_dev`.
- Knob `OBS`: writes `nav{r}.obs_deg`, 1 deg per detent (10 with Shift).
- 5 dots per side.
- Flags: the TO/FROM/NAV vane (red striped NAV when unpowered or no signal), and the GS flag.

### `AdfIndicator` (KI 227)

- Options: `receiver = 1`, `cardVar = ac.adf.card_deg`.
- Reads `adf{r}.rel_bearing_deg`.
- Knob `HDG`: 1 deg per detent (10 with Shift).
- Slow, swinging needle (EST omega 2.5, zeta 0.55).

### `DavtronClock` (M803)

- Options: `powerVar = ac.elec.clock_v`, `voltsVar = ac.elec.bus_v`, `oatVar = adc1.tat_c`,
  `utcVar = env.time_utc_h`, `flightTimeVar?`, `localOffsetH?`. The size is 2-1/4 in.
- Three buttons (hit targets):
  - upper: OAT / volts;
  - SELECT (lower left): UT, then LT, FT, ET;
  - CONTROL (lower right).
- Mouse: hold for 3 s functions. Middle click or Shift+click on SELECT or CONTROL presses both
  (set mode).
- Plays `COCKPIT_SOUNDS.buttonPress`.
- The LCD backlight follows the instrument light. The display is blank and the buttons dead
  without power.
- `model` (a `DavtronM803`) is public.

### `MagneticCompass` (not an `AnalogGauge`)

- Options: `new MagneticCompass({ id, vars, compass?: CompassOptions, lightVar,
  extraDeviationVar = ac.compass.extra_dev_deg, width = 0.075, correctionCard = true, year? })`.
- Drum card seen edge-on through a window with a lubber line. The labels run the real
  instrument's "wrong" way.
- Errors: northerly turning error, acceleration error (ANDS), oscillation and deviation.
- Magnetic dip comes from the WMM2025, refreshed every 5 s.
- `model: CompassModel` is public.

---

## 16. Pure instrument models (`analog/models`)

All are deterministic (seeded), allocation-free and unit tested.

### `gyro.ts`

**`GyroRotor(spinUpTau, spinDownTau)`**: `speed` (fraction of rated), `update(drive, dt)`.
`vacuumRotorDrive(suctionInHg, rated = 5.0)` returns sqrt(suction / rated), with
`RATED_SUCTION_INHG = 5.0` (POH green range 4.5-5.5).

**`AttitudeGyro(opts)`**

- Options (defaults, EST unless in PHAK): `pitchLimitDeg` (65), `bankLimitDeg` (105),
  `nonTumbling`, `erectionDegMin` (6), `cutoutDeg` (10), `cutoutFactor` (0.3),
  `recoveryDegMin` (25), `spinUpTau` (60 s), `spinDownTau` (180 s), `wanderDeg` (0.3), rest
  attitude (-12 deg pitch, 22 deg bank), `seed`.
- `update(truePitch, trueBank, nx, ny, nz, driveSpeed, dt)` updates `pitch`, `bank`,
  `errPitch`, `errBank`, `tumbled` and `erecting`.
- The gyro erects to the apparent vertical, which produces turn and acceleration errors.
- `setSpunUp`, `setStopped`.

**`DirectionalGyro(opts)`**

- Options: `driftMin/MaxDegH`, `compensatedLatDeg`, `tumbleLimitDeg`, taus, `seed`.
- `update(trueHeading, pitch, bank, latDeg, drive, dt)`, `adjust(deltaDeg)`, `heading`, `err`,
  `biasDegH`, `tumbled`.
- `EARTH_RATE_DEG_H = 15.041`.

**`TurnGyro(opts)`**

- Options: `standardMarkDeg`, `cantDeg` (30), `calibrationBankDeg`, `minVolts`, taus, `omega`,
  `zeta`.
- `update(pDps, rDps, volts, dt)`, `symbolDeg`, `flag`, `target(p, r, w)`, `setSpunUp()`.

### `inclinometer.ts`

**`InclinometerBall({ tubeRadiusM, limitDeg, dampingRatio, restitution })`**: a bead on an
arc in liquid.

- `update(ny, nz, dt) -> angleDeg`, `normalized` (-1..1), `reset(ny, nz)`.
- `static equilibriumDeg(ny, nz)` = atan2(ny, nz).

### `compass.ts`

**`CompassModel({ tiltLimitDeg, omega, zeta, deviation })`**: a pendulous card.

- `update(headingMag, pitch, bank, nx, ny, nz, dipDeg, extraDevDeg, dt) -> reading`.
- Also `equilibriumReading(...)`, `deviationAt(hdg)`, `reset(reading)`, `tiltPitchDeg`,
  `tiltRollDeg`, `fieldStrength`.
- `TYPICAL_DEVIATION` is a 12-point card at 30 deg steps.

### `altimeter.ts`

- `pressureAltitudeFt(pInHg)` = 145366.45 (1 - (p / 29.92126)^0.190263), and its inverse
  `pressureAtAltitudeInHg`.
- `indicatedAltitudeFt(paFt, kollsmanInHg)`.
- `altimeterPointers(altFt, out)` fills `{ hundreds, thousands, tenThousands }` in degrees.
- `kollsmanDrumAngle(inHg, degPerInHg)`.
- Constants: `ISA_SL_INHG`, `KOLLSMAN_MIN_INHG = 28.1`, `KOLLSMAN_MAX_INHG = 31.0`,
  `HPA_PER_INHG = 33.86389`.

### `tasRing.ts`

- `densityRatio(paFt, oatC)`, `tasFactor(paFt, oatC)`.
- `ringRotationDeg(k, S)`, `paMarkDeg(paFt, S)`, `oatMarkDeg(oatC, S)`.
- `alignedFactor(paFt, oatC, S)`: identity check, k^2 = rho0 / rho.
- `ISA_T0_K`.

### `davtron.ts`

**`DavtronM803`**: the full button logic from 172S POH Supplement 9.

- Fields: `upper: 'volts' | 'F' | 'C'`, `mode: 'UT' | 'LT' | 'FT' | 'ET'`, `utcS`,
  `localOffsetH`, `flightTimeS`, `ftAlarmS`, `etS`, `etRunning`, `etCountdown`, `alarm`,
  `alarmSource`, `setDigit`, `setValue`, `powered`, `volts`, `oatC`.
- Methods: `setUtcHours(h)`, `pressUpper()`, `pressSelect()` / `releaseSelect()`,
  `pressControl()` / `releaseControl()`, `pressBoth()`,
  `update(dt, powered, volts, oatC, ftRunning = true)`.
- Outputs: `upperText()` (`'28.2E'`, `'45F'`, `'7C'`), `lowerText()` (`'14:30'`), `flashing`,
  `blinkPhase`, `testing`, `flashingDigit`, `annunciatorLit(mode)`.

---

## 17. Building the steam-gauge 172S panel

```ts
const S = INSTRUMENT_SIZE.ATI3;
const common = { vars: ctx.vars, audio: ctx.audio, materials: { bezel: mats.bezel, knob: mats.knob, screw: mats.screw } };
const six = [
  new AirspeedIndicator({ id: 'asi', ...common }),
  new AnalogAttitudeIndicator({ id: 'ai', ...common }),
  new Altimeter({ id: 'alt', ...common }),
  new TurnCoordinator({ id: 'tc', ...common }),
  new HeadingIndicator({ id: 'dg', ...common }),
  new AnalogVerticalSpeedIndicator({ id: 'vsi', ...common }),
];
six.forEach((g, i) => { g.object.position.set((i % 3 - 1) * S * 1.08, i < 3 ? S * 0.55 : -S * 0.55, 0); panel.add(g.object); });
const cdi1 = new CourseIndicator({ id: 'cdi1', receiver: 1, glideslope: true, ...common });
const cdi2 = new CourseIndicator({ id: 'cdi2', receiver: 2, ...common });
const adf = new AdfIndicator({ id: 'adf', ...common });
const engine = [
  new Tachometer({ id: 'tach', ...common }),
  new FuelQuantityGauge({ id: 'fuel', ...common, size: INSTRUMENT_SIZE.ATI2 }),
  new OilTempPressGauge({ id: 'oil', ...common, size: INSTRUMENT_SIZE.ATI2 }),
  new EgtFuelFlowGauge({ id: 'egt', ...common, size: INSTRUMENT_SIZE.ATI2 }),
  new VacuumAmmeterGauge({ id: 'vacamp', ...common, size: INSTRUMENT_SIZE.ATI2 }),
];
const clock = new DavtronClock({ id: 'clock', ...common });
const compass = new MagneticCompass({ id: 'compass', vars: ctx.vars });
// Register each with the cockpit builder as a CockpitControl (hit targets = knobs/buttons).
```

To apply an initial state, call `ai.setSpunUp()`, `dg.setSpunUp(errDeg)` and `tc.setSpunUp()`
for "ready for takeoff", or the `setStopped()` variants for cold and dark. Also write the tach
hours.

The aircraft's systems must write, every frame:

- `ac.vac.suction_inhg`, from the engine-driven vacuum pump, regulator and failures;
- `ac.elec.turn_coord_v`, `ac.elec.gauges_v`, `ac.elec.clock_v`, `ac.elec.bus_v` and
  `ac.elec.batt_amps`;
- `ac.light.instruments`, from the panel dimmer x bus;
- `ac.compass.extra_dev_deg`;
- the sensor vars `adc1.*`, `nav{r}.*`, `adf{r}.*`, `eng1.*` and `fuel.tank{0,1}_kg`.

---

## 18. SimVars, events and sounds summary

The `common` library reads SimVars only through `CanvasDisplay`: the
`display.<id>.power` and `display.<id>.brt` vars, plus watched vars. `ChecklistView.autoCheck`
reads vars through `Checklist.check`. It writes nothing and emits no events. Aural cues are
returned by `consumeAural()`, and the owning display plays them, for example
`audio.callout('MINIMUMS')`.

The `analog` library reads and writes the vars listed in sections 12 and 15. It emits no
EventBus events. Sounds: knob detents play `COCKPIT_SOUNDS.knobDetent` (`'knob.detent'`, volume
0.5), and Davtron buttons play `COCKPIT_SOUNDS.buttonPress` (volume 0.4).

---

## 19. Performance rules and known scope limits

Performance:

- Glass: keep `refreshHz` at 30 or below. Return false from `render` when nothing changed: use
  `watch()` for slowly changing displays and `animating = true` only for continuously moving
  ones.
- Steady-state drawing allocates nothing. `MenuList.setItems`, `CasModel.define` and
  `setRoute` are setup calls.
- The terrain raster samples at most `samplesPerUpdate` elevations per update.
- The Davtron LCDs redraw at 10 Hz, and only when the text changes.

Known SCOPE limits (also listed in code comments):

- The map projection is equirectangular around the aircraft. Error is below 2 % within 300 nm.
- The EGPWS alert overlay approximates the look-ahead envelope with a forward sector. There is
  no blanking within 400 ft of the nearest runway.
- The weather overlay is a hook only.
- Airport "towered" status is inferred from the airport type.
- The TAS ring is exact at `tasReferenceKt` and close nearby, as on the real instrument.
- The altimeter has no low-altitude crosshatch flag and no mechanical hysteresis.
- DG gimbal error is not modelled; the gimbal limits only tumble the gyro.
- Most Honeywell and Collins style values are EST.
- The stroke font is an original design, not the Boeing CDS font.
- Changing a style's `typeface` or `readoutSize` after the first draw leaves the tapes' cached
  digit advance stale. Create a new tape instead.
