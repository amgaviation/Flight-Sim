# Cockpit module (`src/cockpit`)

Library for building fully interactive 3D cockpits entirely from code: frames and panel
placement, an interaction manager (hover, tooltips, clicks, wheel, drags, touch displays),
data-bound control classes with pure logic cores, procedural geometry, PBR materials and
manufacturer palettes, engraved backlit labels, cockpit lighting, a display manager for canvas
displays, a builder that assembles everything into a `CockpitBuild`, and a runtime that wires a
build into the app frame loop.

```ts
import {
  CockpitBuilder, CockpitRuntime, ToggleSwitch, PushButton, RotaryKnob, SelectorKnob, Lever,
  GuardedSwitch, GearHandle, CircuitBreaker, Yoke, RudderPedals, TBarHandle, PushPullKnob,
  FuelSelector, KeyPad, Thumbwheel, TrimWheel, RockerSwitch, AnnunciatorLight, Placard,
  COCKPIT_VARS, COCKPIT_SOUNDS, DISPLAY_VARS, geometry,
} from '../../cockpit';
import type { CockpitBuild, CockpitControl, CockpitDisplay } from '../../cockpit/types';
```

Everything is exported from the barrel `src/cockpit/index.ts` (geometry under the `geometry`
namespace; `src/cockpit/geometry/index.ts` also re-exports the frame helpers so the
`cockpit/geometry` path named in `docs/ARCHITECTURE.md` works). The demo cockpit lives in
`src/cockpit/demo/DemoPanel.ts` (not in the barrel).

## Contents

1. Frames and placement
2. Integration: `CockpitRuntime`, frame order, input and audio contracts
3. `CockpitBuilder` and `Panel`
4. Controls: common behaviour
5. Control reference (one section per class)
6. Pure logic cores
7. Displays: `DisplayManager`
8. Interaction: `CockpitInteraction`
9. Materials and palettes
10. Labels and placards
11. Lighting
12. Geometry library
13. SimVars, events and sound ids (summary)
14. Performance rules
15. Demo cockpit
16. Recipes (737, bizjets, 172)
17. Limits and simplifications

---

## 1. Frames and placement (`frame.ts`)

| Frame | Axes | Used for |
|---|---|---|
| Body | x fwd, y right, z down, metres from the aircraft datum | all placement APIs (`center_m`, `position_m`, `eyePosition_m`) |
| Cockpit-local (Three.js) | x right, y up, z aft (nose = -z) | `build.root` and anything added directly to it; structure geometry |
| Panel | u = x right, v = y up (label reading direction), n = z out of the panel toward the viewer | every panel group and every control's `object`; the panel front surface is z = 0 |

`build.root` is the cockpit group; add it as a child of the aircraft object at identity (its origin is
the datum). Conversion: `local = (body.y, -body.z, -body.x)`.

```ts
bodyToLocal(x, y, z, out: Vector3): Vector3
bodyToLocalV(b: [x, y, z], out?): Vector3          // allocates when out omitted
localToBody(v: Vector3, out?: [n, n, n]): [n, n, n]
bl(x, y, z): Vector3                               // setup-code shorthand for bodyToLocalV
viewQuaternion(yawDeg, pitchDeg, out?): Quaternion // camera orientation, yaw + right, pitch + up
objectPointToBody(obj, root, local | null, out?)  // world point of obj -> body metres rel. root
```

### Panel placement

```ts
interface PanelPlacement {
  center_m: [x, y, z];                // body metres of the panel origin
  facing?: 'aft' | 'up' | 'down' | 'left' | 'right' | 'fwd';   // default 'aft'
  normal?: BodyVec; up?: BodyVec;     // explicit alternative to facing (body axes)
  tiltDeg?: number;  // about u: + tips the normal toward the panel's own +v (top edge leans away)
  yawDeg?: number;   // about v: + turns the normal toward +u (right)
  rollDeg?: number;  // about n: + turns u toward v (counter-clockwise as seen by the viewer)
}
placePanel(obj, placement)        // sets obj.position/quaternion (obj must be a child of root)
panelBasis(placement, out?)       // { u, v, n, origin } in cockpit-local
placeOnPanel(obj, u, v, { z?, rotDeg?, tiltDeg? })  // rotDeg CCW about n; tiltDeg about the object's rotated x
```

Facing presets (normal / label-up in body axes):

| facing | normal | label up | typical use | typical tilt |
|---|---|---|---|---|
| `aft` | -x | -z (up) | main instrument panel, glareshield panel, MCP | +5..+15 (face tilted up toward the eye) |
| `up` | -z | +x (toward nose) | pedestal, side consoles | negative when the forward end is raised (e.g. -9) |
| `down` | +z | -x (toward tail) | overhead panel | negative when the forward end is lower (e.g. -12..-20) |
| `left` | -y | up | right sidewall panel facing inboard | |
| `right` | +y | up | left sidewall panel facing inboard | |
| `fwd` | +x | up | aft bulkhead panels, circuit-breaker panels behind the crew | |

---

## 2. Integration

### 2.1 `CockpitRuntime` (app shell / integration agent)

```ts
const inst = await module.create(ctx);           // AircraftInstance, inst.cockpit: CockpitBuild
aircraftObject.add(inst.cockpit.root);
const rt = new CockpitRuntime({
  build: inst.cockpit, vars: ctx.vars,
  domElement: renderer.domElement, camera,       // omit both to disable interaction
  renderer,                                      // optional: interior reflection env map
  interaction: { onLook: (dx, dy) => cam.look(dx, dy), onEmptyWheel: (n) => cam.zoom(n) },
  displays: { maxRendersPerFrame: 4 },
});
// every frame, after SimLoop stepping and after positioning the aircraft + camera:
rt.update(dt);
renderer.render(scene, camera);
// on aircraft change:
rt.dispose();
```

```ts
interface CockpitRuntimeOptions {
  build: CockpitBuild; vars: SimVars;
  domElement?: HTMLElement; camera?: THREE.Camera;
  interaction?: Omit<CockpitInteractionOptions, 'domElement' | 'camera'>;
  displays?: DisplayManagerOptions;
  renderer?: THREE.WebGLRenderer;   // createInteriorEnvironment(renderer) -> materials.setEnvironment
}
class CockpitRuntime {
  readonly build; readonly displays: DisplayManager; readonly interaction: CockpitInteraction | null;
  readonly controls: CockpitControl[];          // every control incl. composite sub-controls, deduped
  setCamera(camera): void;
  update(dt): void;   // 1) control.update(dt) for every control (once), 2) build.update(dt),
                      // 3) displays.update(dt), 4) interaction.update(dt)
  dispose(): void;    // interaction, displays, env texture, build.dispose()
}
createInteriorEnvironment(renderer): THREE.Texture   // PMREM(RoomEnvironment)
```

If you do not use `CockpitRuntime`, replicate the same order: update every entry of
`build.controls` exactly once per frame (sub-controls of yokes are in that list and are *not*
updated by their owner), call `build.update(dt)`, then a `DisplayManager.update(dt)`.

Renderer notes: the cockpit works with the world module's renderer settings (ACES tone mapping,
sRGB output, logarithmic depth buffer; the hover shader includes the log-depth chunks). Displays
use `toneMapped: false` so avionics colours are exact.

### 2.2 Input-module contract (mouse yoke, pedals, toe brakes, throttle axes)

The cockpit never overwrites `input.*` (the input module owns them). While the pilot drags the
3D controls it writes:

| Var (`COCKPIT_VARS`) | Meaning | Input module should |
|---|---|---|
| `cockpit.yoke_active` | 1 while the 3D yoke is dragged | when 1, use yoke_pitch/roll as the pitch/roll source |
| `cockpit.yoke_pitch` / `cockpit.yoke_roll` | -1..1, same signs as `input.pitch` / `input.roll` | copy into input.pitch/roll |
| `cockpit.pedals_active` / `cockpit.pedals_yaw` | 1 while dragged / -1..1 (+ right) | use as `input.yaw` while active |
| `cockpit.toe_brake_left` / `_right` | 0..1 while the pedal toe is held | `input.brake_* = max(hw, these)` |

(`Yoke` has `writeInput: true` to also write `input.pitch/roll` directly when no input module
merges these.) Levers and push-pull knobs with an `axis` binding follow `input.throttle<i>` /
`input.mixture<i>` whenever `input.throttle_axis_bound` (or the given `boundVar`) is non-zero,
and ignore the mouse meanwhile.

### 2.3 Audio contract

Controls call `ctx.audio.play(id, { volume, rate, position })` with ids from `COCKPIT_SOUNDS`
(section 13). `position` is the control position in **body metres** (x fwd, y right, z down)
from the datum (only when the control belongs to a builder root). `env.soundVolume` scales all
control sounds. No audio object = silent.

---

## 3. `CockpitBuilder` and `Panel` (`CockpitBuilder.ts`)

```ts
const b = new CockpitBuilder(ctx /* SimContext or { vars, events, audio? } */, {
  palette: 'boeing',                       // PaletteId | PaletteDef (section 9)
  eyePosition_m: [x, y, z],
  views?: [{ name, position_m, yawDeg, pitchDeg, fovDeg? }],
  mergeStatic?: true,                      // static consolidation in build()
  env?: CockpitEnv,                        // reuse a shared env
  soundVolume?: 1, atlasSize?: 2048, name?: 'b737',
});
```

`CockpitBuilder` members:

| Member | Description |
|---|---|
| `env: CockpitEnv` | shared resources: `vars, events, audio, materials, labels, lighting, geometry, root, play()` |
| `root: THREE.Group` | cockpit root (the datum frame) |
| `controls`, `displays`, `occluders`, `panels: Map<string, Panel>` | collected so far |
| `panel(o: PanelOptions): Panel` | top-level panel placed in body axes |
| `add(control)` | registers a control (id must be unique), its `subControls` and `occluders`; adds `object` to root if unparented. Does not place it |
| `place(control, placement)` | places a control's object with a panel frame directly in body axes (yokes, pedals, floor controls) and registers it |
| `addDisplay(display, mesh, opts?: DisplayOptions)` | registers a display mesh (options stored on `mesh.userData.displayOptions`) |
| `addStructure(obj, position_m?, { occluder = true, static = true })` | adds structure (cockpit-local axes) at a body position; meshes flagged static; registered as occluder |
| `structureMesh(geometry, material, position_m?, rotation?: Euler, occluder = true)` | one-line structure mesh (geometry disposed with the build) |
| `seat(style: 'airline' \| 'bizjet' \| 'ga', position_m, material?)` | crew seat; origin on the floor under the front of the seat pan |
| `addSwitchRow(panel, RowLayout, ControlSpec[])` | lays out data specs in a row/column; returns controls |
| `addGrid(panel, GridLayout, (ControlSpec \| null)[][])` | rows go down the panel |
| `zone(LightingZoneOptions)` / `light(CockpitLightSpec)` | lighting (section 11) |
| `onUpdate(fn(dt))` | per-frame hook (aircraft demo systems, visual-only animation) |

`build()` returns the `CockpitBuild`. Its optional `eyePitchDeg` (deg, + up,
default -8 in the app) sets the pitch of the default pilot view; set it on the
returned build when the PFD sits low (`build.eyePitchDeg = -12`).
| `trackGeometry(...g)` | geometry disposed with the build |
| `build(): CockpitBuildEx` | finalizes (once): flushes labels, consolidates static meshes |

`CockpitBuildEx = CockpitBuild & { env: CockpitEnv; mergeStats: MergeStats | null }`; its
`update(dt)` runs `lighting.update`, `labels.flush`, then the `onUpdate` hooks; `dispose()`
disposes controls, displays, merged geometry, owned geometry and the env, and detaches root.
`occluders` is filled (yoke columns/hubs, structure).

### 3.1 `PanelOptions`

```ts
interface PanelOptions extends PanelPlacement {
  name: string;                      // unique
  width: number; height: number;     // m
  thickness?: 0.0032; radius?: 0.004; bevel?: 0.001;
  cutouts?: Cutout[];                // in this panel's coordinate convention
  material?: MaterialName | Material; // default 'panel'
  screws?: false | { kind?: 'phillips'|'slot'|'hex'|'dzus'; diameter?: 0.0042; inset?: 0.006; pitch?: 0.2; positions?: [x, y][] };
  origin?: 'center' | 'top-left';    // coordinate convention (below)
  recessCutouts?: true;              // dark 25 mm recess boxes behind rect cutouts
  invisible?: false;                 // frame only, no plate
}
type Cutout = { shape: 'rect'; u; v; w; h; r? } | { shape: 'circle'; u; v; d };
```

**Coordinate convention**: with `origin: 'center'`, `(x, y)` = metres right / up from the panel
centre. With `origin: 'top-left'`, `(x, y)` = metres right from the left edge and **down** from
the top edge (convenient when transcribing panel drawings). Every `Panel` method below takes
`(x, y)` in its panel's convention. Default fasteners: Phillips screws at the corners and every
0.2 m, rendered as one InstancedMesh per panel.

### 3.2 `Panel` methods

| Method | Result |
|---|---|
| `uv(x, y): [u, v]` | converts to centred panel coordinates |
| `add(control, x, y, { z?, rotDeg?, tiltDeg? })` | places + registers a control (returns it) |
| `addObject(obj, x, y, opts?)` | places any object (not registered) |
| `label(text, x, y, Partial<TextStyle>)` | engraved backlit text (default 2.8 mm, weight 700) |
| `bracket(title, x, y, width, style?)` | overhead-style group bracket line with centred title and down-ticks |
| `line(x0, y0, x1, y1, width = 0.0005, zone = 'panel')` | engraved line |
| `placard(PlacardOptions, x, y, opts?)` | placard |
| `subPanel({ name, x, y, z?, rotDeg?, width, height, ...PanelOptions })` | module plate mounted on this panel with its **centre** at (x, y) (Boeing overhead modules, bizjet sub-panels); default z 0.6 mm; the sub-panel has its own `origin` convention |
| `display(display, x, y, w, h, { bezel?: false \| { border?, depth?, material? }, z?, display?: DisplayOptions })` | screen plane + bezel frame (border default 12 mm, depth 8 mm; screen recessed); registers the display; returns the screen mesh |
| `roundInstrument(display, x, y, '3ATI' \| '2ATI' \| diameter_m, { flange?, display? })` | 3ATI (79.4 mm) / 2ATI (57.2 mm) instrument: square flange, bezel ring, canvas face disc (the canvas' inscribed circle), cover glass; no cutout needed |

### 3.3 Data specs (`ControlSpec`, `createControl`)

```ts
type ControlSpec = {
  dx?, dy?,            // extra offset from the slot (m)
  rotDeg?,             // rotation about the panel normal
  caption?: string, captionOffset?: number,   // engraved caption above the control
  gap?: number,        // spacing after this item (overrides layout.spacing)
} & (
  | { type: 'toggle' } & ToggleSwitchOptions      | { type: 'rocker' } & RockerSwitchOptions
  | { type: 'guarded' } & GuardedSwitchOptions    | { type: 'guardedButton' } & GuardedButtonOptions
  | { type: 'button' } & PushButtonOptions        | { type: 'annunciator' } & AnnunciatorLightOptions
  | { type: 'knob' } & RotaryKnobOptions          | { type: 'selector' } & SelectorKnobOptions
  | { type: 'breaker' } & CircuitBreakerOptions   | { type: 'thumbwheel' } & ThumbwheelOptions
  | { type: 'pushpull' } & PushPullKnobOptions    | { type: 'tbar' } & TBarHandleOptions
  | { type: 'placard' } & PlacardOptions          | { type: 'spacer' });
createControl(env, spec): CockpitControl | Placard | null
interface RowLayout { x; y; spacing; direction?: 'right' | 'down'; captionHeight?: 0.0026 }
interface GridLayout { x; y; dx; dy; captionHeight? }
```

Default caption offsets above the control centre (m): toggle 0.0175, rocker 0.017, guarded 0.026,
guardedButton 0.016, button 0.0135, annunciator 0.011, knob 0.0165, selector 0.03, breaker
0.0105, thumbwheel 0.012, pushpull 0.022, tbar 0.022. Controls with their own naming options
(`ToggleSwitch.labels`, `RockerSwitch.name`, `PushButton.name`, `CircuitBreaker.name`,
`SelectorKnob.title`) can use those instead.

### 3.4 Static consolidation and moving parts

`build()` calls `consolidateStatic(root)` (`merge.ts`): meshes with `userData.cockpitStatic = true`
are frozen relative to the root: parts sharing geometry+material (>= 3) become one
`InstancedMesh`; the rest are merged per material. Controls flag only their fixed parts (bushings,
bezels, slots, labels). **Anything the aircraft moves after build() must not contain static
meshes, or must set `userData.cockpitDynamic = true` on the moving group** (Yoke and RudderPedals
do this themselves). Consolidated originals are removed from the scene graph.

---

## 4. Controls: common behaviour

Every control extends `ControlBase` and implements `CockpitControl` (`types.ts`):
`id`, `object` (root group, panel frame, stands on z = 0), `hitTargets` (invisible boxes),
`tooltip()`, pointer handlers, `update(dt)`, `dispose()`; optional `pointerLock`, `cursor(p)`,
`onKey`, `onHover`, `onCancel`, `enabled`.

```ts
interface ControlOptions {
  id: string;                      // unique within the cockpit
  label?: string;                  // tooltip name (default id)
  tooltip?: string | (() => string);   // replaces the tooltip text
  sound?: string | null;           // overrides every actuation sound id; null = silent
  volume?: number;                 // sound volume multiplier
  onChange?: (value: number) => void;  // after the control wrote a *changed* value to its var
  enabledVar?: string;             // interaction disabled (click-through) while this var is 0
}
```

Rules shared by all controls:

- **Vars are the single source of truth.** Constructors call `initVar`: if the bound var is unset,
  it is initialised to the control's default (so `vars.has(var)` is true after construction).
  Each frame `update` follows external writes to the var (systems resetting switches,
  autothrottle moving levers, state presets); the control animates to the new position (and
  switches play their sound, e.g. a solenoid-held start switch releasing).
- Writes happen immediately on actuation (lever-lock toggles and gear handles write after the
  pull animation, ~60-100 ms later).
- Tooltip: `"LABEL: STATE"` (e.g. `BATT: ON`, `HDG 270`, `IN 7.5A`).
- Sounds: see each control; all go through `env.play` with the control's body position.
- Animation: exponential/snap animation in `update(dt)`; nothing allocates per frame.
- `ControlPointer` objects are reused by the manager; never keep references.

Mouse model (identical in all aircraft):

| Gesture | Effect |
|---|---|
| Left click | primary: toggle / press / step up-clockwise / pull handle |
| Right click | secondary: step down-counter-clockwise / push handle in |
| Middle click or Ctrl+left | push (knob push functions) |
| Wheel | rotate knobs, step switches/levers; Shift+wheel = inner knob |
| Drag | levers, yoke, pedals, trim wheels, thumbwheels, knobs, flick switches |
| Drag on empty space | camera free look (callback) |

---

## 5. Control reference

### 5.1 `ToggleSwitch` (bat / paddle / ball handle toggles)

```ts
new ToggleSwitch(env, {
  ...ControlOptions,
  var?: string,
  positions?: string[],            // bottom->top (left->right); default ['OFF','ON']; 2..n
  values?: number[],               // var value per position (default index)
  initial?: number,                // index used when the var is unset (default 0)
  springs?: { [index]: returnIndex },   // momentary positions
  leverLock?: number[] | true,     // positions that need a pull to enter/leave
  events?: { [index]: eventName }, // emitted on entering a position
  orientation?: 'vertical' | 'horizontal',
  handle?: 'bat' | 'paddle' | 'ball' | 'lever-lock',  // default bat (lever-lock when locked)
  handleMaterial?: MaterialName | Material,          // default 'handle' (palette chrome/black)
  scale?: 1,                       // 1 = MS24523 (17.3 mm handle, 15/32 bushing, 9/16 nut)
  throwDeg?: 24,
  fence?: 'none' | 'plates' | 'wire',
  labels?: { name?: string | true, positions?: boolean, height?: 0.0026, zone?: string | null },
  base?: true,                     // nut/bushing
  inhibit?: (to, from) => boolean, // interlock
})
```

Mouse: left click flips 2-position switches; on 3+ positions moves toward the clicked half
(upper/right half = up/right); holding the button holds a momentary position; right click = one
position down/left; wheel = up/down (momentary positions return after 0.25 s); drag = flick
(14 px). Lever-lock: pull (2.2 mm) -> move -> re-seat, automatically.
Public: `logic: SwitchLogic`, `positions`, `index`, `force(index, silent?)`, `commit(moveResult)`.
Writes `var` = `values[index]`; emits `events[index]`. Sounds `switch.toggle`
(`switch.toggle_heavy` for lever-lock or scale > 1.2). Hit box 13 x 30 x 24 mm.
Labels option: position legends above/below (3rd position to the right), name above.

### 5.2 `RockerSwitch`

```ts
new RockerSwitch(env, {
  var?, positions?: ['OFF','ON'], values?, initial?, springs?, events?, inhibit?,
  orientation?: 'vertical' | 'horizontal',
  width?: 0.011, height?: 0.021, capMaterial?: 'plasticBlack', tiltDeg?: 10,
  legend?: { top?, bottom?, color?, zone? },       // printed on the cap
  indicator?: { var, color?: LampColor },          // lit window on the cap
  name?: string | true,
})
```
Mouse: left on upper/lower half presses that half (2-position non-momentary: any left click
toggles); holding keeps momentary ends; right = down; wheel. Sound `switch.rocker`.
Split rockers (172 MASTER ALT/BAT) = two RockerSwitches; implement the mechanical interlock with
`onChange` writing the other var (the other rocker follows its var).

### 5.3 `GuardedSwitch` / `GuardedButton`

```ts
new GuardedSwitch(env, { ...ToggleSwitchOptions, guard?: GuardOptions })
new GuardedButton(env, { ...PushButtonOptions, guard?: GuardOptions })
interface GuardOptions {
  color?: 'red' | 'black' | 'yellow' | 'clear';     // default red
  guardedPosition?: 0;                              // switch index protected
  close?: 'returns' | 'blocks' | 'free';            // default 'returns' (switch) / 'free' (button)
  hinge?: 'top' | 'bottom' | 'left' | 'right';      // default top
  width?, length?, height?;                         // cover size (defaults fit the inner control)
  openDeg?: 105;
  var?: string;                                     // 1 while open; external writes open/close it
  initialOpen?: boolean;
}
```
First click on the closed cover opens it; with the cover open the switch/button works normally;
clicking the open cover closes it. `'returns'`: closing forces the switch to `guardedPosition`
(writes the var, plays the switch sound) as real spring guards do; `'blocks'`: cannot close unless
the switch is already there; `'free'`: closes regardless. Wheel over the cover: up opens, down
closes. Public: `inner` (ToggleSwitch / PushButton), `guard: GuardLogic`, `toggleGuard()`.
Sounds `switch.guard_open` / `switch.guard_close`. Tooltip `"NAME: ON (guard OPEN)"`.

### 5.4 `PushButton` (Korry switch-lights, round, MCP, keys, softkeys, master warning)

```ts
new PushButton(env, {
  var?, mode?: 'momentary' | 'toggle' | 'cycle', values?: [0, 1], stateNames?, initial?,
  event?: string,          // emitted on press, payload = new value
  releaseEvent?: string,
  style?: 'korry' | 'round' | 'mcp' | 'key' | 'softkey' | 'mushroom' | 'small',
  width?, height?,         // defaults per style (korry 15.9 mm = Korry 389 5/8 in)
  capMaterial?, engraved?: string, engravedHeight?, engravedColor?, zone?,
  segments?: LegendSegment[], layout?: 'stack' | 'split',
  lightBar?: { var?, whenOn?, color? },    // MCP-style bar
  intensity?: 1.4, name?: string | true,
})
interface LegendSegment {
  text: string | string[];          // lines; '' = plain lamp
  color: LampColor | ColorRepresentation;
  var?: string; test?: (v) => boolean;   // lit when test(var) (default v != 0)
  whenOn?: boolean;                 // lit while the button's own value != 0 (latched ON legend)
  style?: 'legend' | 'field';       // text glows | whole lens glows with dark text
}
```
Style defaults (w x h, travel): korry 15.9 x 15.9 mm; round 12 mm; mcp 17 x 12; key 10.5 x 9.5;
softkey 12 x 7; mushroom 24 mm; small 9 mm. Momentary: var = 1 while held. Toggle: alternate
action (latched cap rests 40 % in). Cycle: advances through `values`. External writes unlatch.
Segments light with lamp test (`alert.annun_test`), follow annunciator dimming/power, 25 ms lamp
lag. Public: `logic`, `face: LegendFace | null`, `value`, `doPress()`, `doRelease()`.
Sounds `button.press` / `button.release`.

### 5.5 `AnnunciatorLight`

```ts
new AnnunciatorLight(env, { segments: LegendSegment[], layout?, width?: 0.016, height?: 0.012,
  bezel?: true, pressToTest?: false, intensity?: 1.4, ...ControlOptions })
```
Stand-alone lamp (gear lights, marker beacons, caution panels). Hover shows lit legends;
`pressToTest` lights all segments while pressed. `face: LegendFace` (`isLit(i)`, `litText()`).
`LegendFace(env, segments, w, h, layout, { intensity?, gap?, own? })` is reusable for any lit lens.

### 5.6 `RotaryKnob` (single or concentric, detented or continuous, push)

```ts
new RotaryKnob(env, {
  outer: KnobChannelOptions, inner?: KnobChannelOptions, push?: KnobPushOptions,
  cap?: KnobCap, innerCap?: KnobCap,              // default 'fluted' ('ring' outer when concentric)
  diameter?, height?,                             // 19/12 mm single; 23/9 mm concentric outer
  innerDiameter?, innerHeight?,                   // default 0.6 x outer, 1.25 x outer height
  material?, innerMaterial?,                      // default 'knob' ('knobKnurled' for knurled)
  pointer?: 'line' | 'dot' | 'none',              // backlit index mark (default line for absolute knobs)
  zone?, dragPxPerClick?: 14, ...ControlOptions,
})
interface KnobChannelOptions {
  var?: string;                       // absolute value
  incEvent?: string; decEvent?: string;   // encoder events, payload = click count (> 0)
  positions?: { value, label?, spring?, gated? }[];   // detent mode
  angles?: number[];                  // deg clockwise from 12 o'clock per detent (default 30 deg spacing, centred)
  min?, max?, step?, wrap?, initial?, // continuous mode (quantized to the step grid)
  accel?: { fastStep, midStep?, slow?: 6, fast?: 14 },   // clicks/s thresholds
  degPerClick?: 15,                   // visual rotation per click (encoders/continuous)
  angleRange?: [deg, deg],            // continuous knob with pointer (dimmers)
  format?: (v) => string; label?: string; sound?: string | null;
}
interface KnobPushOptions { event?: string; var?: string; mode?: 'momentary' | 'toggle'; label?: string }
type KnobCap = 'fluted' | 'knurled' | 'smooth' | 'skirted' | 'pointer' | 'bar' | 'chicken-head' | 'wing' | 'key' | 'ring' | 'dimmer';
```
Channel without var and positions = pure encoder (events only, unbounded). Mouse: wheel turns the
channel under the cursor (inner cap -> inner; Shift -> inner) by the notch count; left/right click
= one click CW/CCW (deliberate, passes gated detents; holding keeps spring positions); middle or
Ctrl+left = push; drag = 14 px per click. Acceleration applies to continuous channels.
Public: `outer`, `inner` (`Channel`: `{ o, logic: KnobLogic, group, hit, angle, target }`),
`channels()`, `turnBy(clicks, inner?)`. Sounds `knob.detent` (continuous/encoder),
`knob.selector` (detented), `knob.push`, `lever.gate` (blocked at a gate).
`cap: 'key'` adds a chrome escutcheon and lock cylinder (ignition/magneto keys).

### 5.7 `SelectorKnob`

```ts
new SelectorKnob(env, {
  var?, positions: { value, label, angle?, spring?, gated?, display? }[], initial?, wrap?,
  labelRadius?, labelHeight?: 0.0024, ticks?: true, labelZone?, title?,
  incEvent?, decEvent?, cap?: 'pointer', ...RotaryKnobOptions (minus outer/inner),
})
```
Rotary selector with engraved position labels (upright, arranged on a circle; `display` may
contain `\n`) and tick marks. Example magneto: positions OFF/R/L/BOTH/START with
`{ value: 4, label: 'START', spring: 3 }` and `cap: 'key'`.

### 5.8 `Lever` (thrust/power, flaps, speedbrake, start/cutoff, reverse)

```ts
new Lever(env, {
  var: string, min?: 0, max?: 1, initial?,
  detents?: { value, label?, kind?: 'soft' | 'gate', width?, direction?: 'both'|'increasing'|'decreasing' }[],
  discrete?: boolean,            // always rests on a detent (flap handle)
  softWidth?: 3 % of range, step?: 5 % of range,   // wheel step for continuous levers
  travel?: { kind: 'arc', minDeg, maxDeg, pivotDepth?: 0.05 } | { kind: 'linear', length },
                                 // default arc -30..+30 deg; + angle tilts toward panel +v
  armLength?: 0.11, armWidth?: 0.011, armThickness?: 0.006,
  knob?: 'throttle'|'boeing-thrust'|'ga-throttle'|'flap'|'gear'|'speedbrake'|'start'|'condition'|'reverser'|'ball',
  knobScale?, knobMaterial?, armMaterial?: 'aluminium',
  slot?: true | { width?, plateWidth? },   // quadrant slot plate
  detentLabels?: 'left' | 'right' | false, labelHeight?: 0.0028,
  axis?: { var, boundVar?: 'input.throttle_axis_bound', map?: (axis) => value },
  limit?: (vars) => [lo, hi],    // dynamic interlock, evaluated every frame
  dragPxFull?: 300, dragInvert?, dragAxis?: 'y' | 'x', pointerLock?, format?,
})
```
Value mapping: `min` at `minDeg`, `max` at `maxDeg`. Mouse: drag (mouse up = toward max);
soft detents are magnetic; a **gate stops a drag; release and drag again (after 0.35 s) to lift
over it**; direction-limited gates block only that motion (reverse latch: `direction:
'decreasing'` at IDLE). Click (no drag): left = next detent toward max, right = toward min
(deliberately lifts over gates). Wheel: one `step` (or next detent within a step); fast notches
stop at gates, a pause + notch passes. Hardware axis bound: lever follows the axis, mouse
ignored, tooltip "(hardware axis)". Writes `var` = output (nearest reachable detent for discrete
levers, physical position otherwise); follows external writes when not dragged (autothrottle).
Public: `logic: LeverLogic`, `value`, `handle` (the moving arm group, +z along the arm; mount handle buttons such as TO/GA here with a higher `userData.hitPriority`). Sounds `lever.detent`, `lever.gate`.

### 5.9 `GearHandle`

```ts
new GearHandle(env, { var, positions?: ['DN','UP'] /* bottom->top, e.g. ['DN','OFF','UP'] */, values?, initial?,
  inhibit?: (to, from, vars) => boolean,         // e.g. WOW down-lock solenoid
  lights?: { var, color?: 'red', test? }[],      // lamps in the wheel hub
  length?: 0.085, swingDeg?: 30, pull?: 0.012, knobScale?, labels?: true, ...ControlOptions })
```
Wheel-shaped knob (25.781). Every move: pull out 12 mm -> swing -> re-seat; the var changes
when it leaves the detent. Blocked by `inhibit`: `lever.gate` sound, no change. Mouse: left =
other position / clicked half, right = down, wheel, drag flick. Sound `gear.handle`.

### 5.10 `Thumbwheel`

```ts
new Thumbwheel(env, { channel: KnobChannelOptions, diameter?: 0.022, width?: 0.008,
  exposure?: 0.3, orientation?: 'vertical' | 'horizontal', ribs?: 30, material?, ...ControlOptions })
```
Ribbed wheel through a slot. Wheel/drag (10 px per click) roll it; left/right click = +1/-1.

### 5.11 `TrimWheel`

```ts
new TrimWheel(env, { var, min?: -1, max?: 1, perRev: number,   // trim change per wheel revolution
  manualEvent?: string,          // emit { delta } instead of writing var
  forwardDecreases?: true,       // rolling the top away (+v) = nose down
  diameter?: 0.26, thickness?: 0.03, exposure?: 0.5, spokes?: 5, stripes?, handle?, material?,
  holdRevPerS?: 0.8,
  indicator?: { length, offset: [x, y, z], marks?: { value, label? }[], band?: [a, b], increasingUp?: true },
  ...ControlOptions })
```
Wheel axis = panel x; mount it on a pedestal/console panel whose +v points forward. Wheel angle
is proportional to the var, so electric/autopilot trim spins it. Mouse: drag (down = top toward
pilot = nose up), wheel (1/24 rev per notch, up = nose down), hold left/right = continuous roll
away/toward. `trim.wheel` clack per spoke passage (rate-limited). `manual(revsForward)` public.

### 5.12 `CircuitBreaker`

```ts
new CircuitBreaker(env, { var /* 1 = in */, trippedVar?, rating?: number | string, name?: string | true,
  pullable?: true, diameter?: 0.0095, collar?: 'round' | 'hex', ...ControlOptions })
```
Click toggles (pull when in, push/reset when out; push-to-reset-only when `pullable: false`);
wheel up = push, down = pull. Popped state shows the white band (4.2 mm travel). Systems trip it
by writing `var = 0, trippedVar = 1` (plays `cb.trip`, pops fast); a push writes `var = 1,
trippedVar = 0`. Sounds `cb.pull`, `cb.push`, `cb.trip`. `toggle()` public.

### 5.13 `Yoke` (composite)

```ts
new Yoke(env, { style: 'cessna' | 'bizjet' | 'gulfstream' | 'boeing', scale?: 1,
  column?: { kind: 'translate' | 'pivot', length?, travelAft?: 0.1, travelFwd?: 0.08, aftDeg?: 12, fwdDeg?: 10, radius? },
                                  // default translate for cessna (172 push-pull column), pivot otherwise
  rollDeg?: 45 (cessna) | 90,     // EST wheel rotation at full roll
  pitchVar?: 'input.pitch', rollVar?: 'input.roll',   // animation sources (use surf.* for AP-back-driven wheels)
  dragPxFull?: 220, writeInput?: false,
  switches?: YokeSwitchSpec[], ...ControlOptions })
type YokeSwitchSpec = { anchor: YokeAnchorName; offset?: [x, y, z]; rotDeg? } &
  ({ kind: 'button'; options: PushButtonOptions } | { kind: 'rocker'; options: RockerSwitchOptions } | { kind: 'toggle'; options: ToggleSwitchOptions });
type YokeAnchorName = 'leftTop'|'leftOutboard'|'leftInboard'|'leftFront'|'leftBack'
                    | 'rightTop'|'rightOutboard'|'rightInboard'|'rightFront'|'rightBack'|'hub'|'hubTop';
```
Place with `b.place(yoke, { center_m: hubPosition, facing: 'aft' })` (object frame: origin at the
hub, x right, y up, z toward the pilot). Drag the grips (pointer lock): mouse right = roll right,
mouse down = pull; writes `COCKPIT_VARS` (section 2.2). `addSwitch(spec)` adds more grip controls
(defaults: button style 'small', rocker 7 x 14 mm, toggle scale 0.7); they ride on `wheel`, are
listed in `subControls` (registered by the builder and updated by the host). `anchors` exposes the
anchor Object3Ds (+z = outward surface normal); `wheel` is the rotating group; `occluders` =
column and hub. Grip hit boxes have `hitPriority -1` so grip switches win. Standard grip layouts:
AP disconnect on `leftOutboard` / `rightOutboard`, split pitch-trim rocker on `leftTop`, PTT on
`leftInboard` or `leftBack` (trigger), CWS on `leftFront`, chrono on `hub`.

### 5.14 `RudderPedals`

```ts
new RudderPedals(env, { style: 'hanging' | 'floor', spacing?: 0.3, travel?: 0.09, toeTiltDeg?: 18,
  yawVar?: 'input.yaw', brakeLeftVar?: 'input.brake_left', brakeRightVar?: 'input.brake_right',
  dragPxFull?: 220, padWidth?: 0.085, padHeight?: 0.16, ...ControlOptions })
```
One crew station. Origin between the pedals at pivot height (hanging: pivot above, pads 0.2 m
below; floor: pads rise from the floor pivot). Right rudder moves the right pedal forward.
Toe brakes tilt the pads (display = max(brake var, COCKPIT toe var)). Mouse: sideways drag =
rudder; press on the upper pad = toe brake while held.

### 5.15 `TBarHandle` (T-handles, D-rings, pull knobs, fire handles)

```ts
new TBarHandle(env, { var, valueIn?: 0, valueOut?: 1, rotateVar?,
  style?: 'tbar' | 'ring' | 'fire' | 'knob' | 'lever',
  rotate?: 'none' | 'lock' | 'discharge',   // default 'discharge' for fire, else 'none'
  springIn?: boolean,                        // pulled but not locked handles return when released
  pullLength?: 0.045 (fire 0.022), rotateDeg?: 90 lock / 40 discharge,
  unlockVar?, overrideVar?,                  // pull allowed while unlockVar != 0 or overrideVar != 0
  lightVar?, lightColor?: 'red', legend?, material?, scale?, ...ControlOptions })
```
Left click: pull (blocked by the lock -> `lever.gate`); 'lock' handles also rotate to lock
(parking brake: pull + turn). On a pulled handle: 'discharge' handles rotate toward the clicked
half while held (var `rotateVar` = -1/+1, springs back to 0 on release); others push in. Right
click = push in; wheel down/up = pull/push. Fire handle: red lens with the legend lights with
`lightVar`. Sounds `handle.pull`, `handle.push`, `handle.rotate`.

### 5.16 `PushPullKnob` (Cessna throttle, mixture, carb heat, cabin heat/air)

```ts
new PushPullKnob(env, { var, valueIn?: 1, valueOut?: 0, travel?: 0.07,
  style?: 'throttle' | 'mixture' | 'carbheat' | 'cabin' | 'plain',
  vernierStep?: 0.01, lockButton?: (mixture), clickToggles?: (carbheat/cabin/plain),
  detents?, axis?: { var, boundVar?, map?: (axis) => fractionOut /* default 1 - axis */ },
  legend?, material?, dragPxFull?: 250, ...ControlOptions })
```
Internally `logic.value` = fraction pulled out. Drag down = pull out, up = push in (mixture lock
button animates pressed); wheel = vernier (up = in by `vernierStep`, knob rotates); click toggles
fully in/out for carb heat / cabin knobs. Writes `var = valueIn + (valueOut - valueIn) * fraction`.

### 5.17 `FuelSelector`

```ts
new FuelSelector(env, { ...SelectorKnobOptions (cap fixed to 'wing'), placardDiameter?: 0.12,
  sublabels?: string[] /* engraved under each position, e.g. '26 GAL' */ })
```
Floor selector with printed placard; defaults: 50 mm handle, 5.5 mm labels, no ticks, unlit
labels; sound `fuel.selector`. Gated positions (e.g. OFF on types that have one) need a
deliberate click. Cessna 172S: LEFT / BOTH / RIGHT with a separate red push-pull FUEL SHUTOFF
(use `PushPullKnob`).

### 5.18 `KeyPad` (CDU/MCDU, Garmin keypads, LSK columns)

```ts
new KeyPad(env, { rows: KeyDef[][], eventPrefix?: '', singleEvent?, releaseEvents?,
  keyWidth?: 0.0105, keyHeight?: 0.0095, gap?: 0.0028, rowOffsets?: number[],
  keyMaterial?: 'plasticGrey', styleMaterials?: { [style]: MaterialName },
  legendHeight?, legendColor?, zone?, keyboard?: false,
  lights?: { text, color, var, x, y, w?, h? }[], ...ControlOptions })
interface KeyDef { id: string; label?: string /* '\n' allowed */; w?: 1; h?: 1; spacer?: boolean;
  event?: string; keys?: string[] /* PC keys */;
  style?: string /* selects styleMaterials[style] */; lightVar?: string /* EXEC-style lit bar in the key */ }
```
Origin = top-left corner of the key grid; keys extend right (+x) and down (-y); `width`/`height`
give the laid-out size. Each key: `${eventPrefix}${id}` (payload `'down'`), optional
`singleEvent(id)`, and `${...}:up` when `releaseEvents`. Keyboard (when `keyboard: true`, after
clicking the keypad): letters/digits map to same-id keys, Space -> SP/SPC/SPACE, Backspace ->
CLR/BKSP/DEL, Delete -> DEL/CLR, Enter -> ENT/ENTER/EXEC, '.' -> DOT, '/' -> SLASH, '-'/'+' ->
'+/-', plus explicit `keys`. Tooltip shows the hovered key. `press(id)` public. Sound `key.press`.

### 5.19 `Placard` (not a control)

```ts
new Placard(env, { text, height?: 0.0028, style?: 'engraved' | 'printed' | 'plate' | 'warning' | 'caution' | 'inverse',
  align?, padding?, color?, plateColor?, zone?, font?, weight?, box? })   // extends THREE.Group; width, heightM
```

---

## 6. Pure logic cores (`controls/logic/*`, no Three.js)

All are deterministic; time is passed in (seconds, any monotonic clock).

- `SwitchLogic({ positions, values?, initial?, springs?, locked?, momentaryHoldS?: 0.25 })`:
  `index`, `value`, `pulled`, `held`, `inhibit`; `check(to)`, `moveTo(to, hold?)`,
  `step(±1, hold?)`, `toggle(hold?, preferDir?)`, `force(to)`, `release()`, `tick(dt)`,
  `pull()/unpull()`, `needsPull(to)`, `isLocked(i)`, `isMomentary(i)`, `indexOf(v)`, `sync(v)`.
  `MoveResult = { moved, from, to, blocked: 'none'|'limit'|'locked'|'inhibited' }`.
- `GuardLogic(switchLogic | null, { guardedPosition?, close?, open? })`: `open`, `canOperate()`,
  `openGuard()`, `closeGuard() -> { closed, moved }`, `toggle() -> 'opened'|'closed'|'blocked'`.
- `ButtonLogic({ mode?, values?, initial? })`: `pressed`, `index`, `value`, `press()`, `release()`, `sync(v)`.
- `KnobLogic({ positions? | min/max/step/wrap/accel, initial?, momentaryHoldS?: 0.3, gatePauseS?: 0.35 })`:
  `value`, `index`, `label`, `rate`, `currentStep()`, `turn(clicks, nowS, { deliberate?, hold? }) -> { delta, clicks, blocked }`,
  `setIndex`, `release()`, `tick(dt)`, `sync(v)`, `fraction()`.
- `LeverLogic({ min, max, initial?, detents?, discrete?, softWidth?, step?, gatePauseS?: 0.35 })`:
  `value` (physical), `output`, `detent`, `moving`, `setLimits(lo, hi)`, `beginMotion(nowS, deliberate?)`,
  `moveTo(target, nowS?) / moveBy(delta, nowS?) -> { value, blockedBy, entered }`, `endMotion()`,
  `stepDetent(±1, nowS, deliberate?, toNextDetent?)`, `sync(v)`, `label()`, `nearestDetent(v)`.
  Gate rule: passing a gate needs a motion that *starts* on it, begun >= `gatePauseS` after the
  lever arrived there (or a deliberate motion).
- `CircuitBreakerLogic({ pullable?, closed? })`: `state: 'in'|'out'|'tripped'`, `pull()`, `push()`,
  `trip()`, `toggle()`, `sync(closedVal, trippedVal) -> 'tripped'|'reset'|'opened'|null`.
- `KeyPadLogic({ rows, eventPrefix?, singleEvent?, releaseEvents?, emit })`: `keys()`, `has(id)`,
  `eventName(id)`, `press(id)`, `release(id)`, `keyFor(pcKey)`.
- `PullHandleLogic({ rotate?, springIn?, pulled?, rotation? })`: `pulled`, `rotation`, `locked`,
  `canPull`, `pull(hold?) -> 'pulled'|'blocked'|'none'`, `push()`, `rotate(±1, hold?)`, `release()`, `sync()`.
- `TrimWheelLogic({ min, max, perRev, initial? })`: `angleOf(v)`, `turn(revs)`, `sync(v)`,
  `static spokesPassed(a0, a1, spokes)`.

---

## 7. Displays: `DisplayManager` (`DisplayManager.ts`)

```ts
const dm = new DisplayManager(vars, { maxRendersPerFrame?: 4, materials?: env.materials, anisotropy?: 4 });
const h = dm.add(display, mesh, {       // opts default to mesh.userData.displayOptions
  powerVar?: DISPLAY_VARS.power(id),    // 'display.<id>.power', missing var = powered
  brightnessVar?: DISPLAY_VARS.brightness(id),   // 'display.<id>.brt', 0..1, missing = 1
  boot?: { seconds, title?, draw?(ctx, w, h, elapsedS, totalS) } | false,  // default none
  glass?: true, gain?: 1, mipmaps?: true, anisotropy?,
  dimMaterial?,   // default: true only when the display has no setBrightness()
});
dm.update(dt); dm.get(id); dm.handles(); dm.remove(id); dm.dispose(); dm.stats
```

Per display: sRGB `CanvasTexture` on `display.canvas` (HTMLCanvasElement or OffscreenCanvas),
`MeshBasicMaterial` (toneMapped false, colour = gain, x brightness when `dimMaterial`) replacing
the mesh material. Brightness: `setBrightness(brt)` is called on change; displays that implement
it dim themselves (avionics `CanvasDisplay` with its default `applyBrightness: true`), so the
material is only dimmed for displays without `setBrightness` or with `dimMaterial: true` (use
that if you create a `CanvasDisplay` with `applyBrightness: false`). A `CanvasDisplay` also
checks power itself and has its own `bootTimeS`; leave the manager's `boot` off for those.
and a cover-glass child mesh 1.5 mm in front (+z) when `materials` is given. Unpowered: colour 0,
no renders, `setBrightness(0)`, `display.<id>.ready = 0`. Power-up with `boot`: a half-resolution
splash (default: title + progress bar, redrawn at 10 Hz) replaces the map for `seconds`, then
`display.<id>.ready = 1` and rendering starts with a forced render. `render(dt)` is called at
`refreshHz` (dt = time since its last render), staggered, most-overdue first within the per-frame
budget; returning `false` skips the upload. `DisplayHandle`: `{ display, mesh, texture, material,
options, powered, booting, bootLeft, brightness, renders, uploads, forceRender() }`.
`RefreshScheduler` (pure) is exposed for tests/tools. `drawDefaultSplash(ctx, w, h, title, p)`.

Display implementers (avionics agents): canvas pixel (0,0) is the top-left of the screen mesh;
`onPointer(x, y, kind, delta?)` receives canvas pixels (`kind: 'down'|'move'|'up'|'wheel'`,
`'up'` may carry -1,-1 when released off-screen; hover moves are also forwarded); keep canvases
<= 1024 px on the long side; target <= 30 Hz for glass, <= 60 Hz for gauges.

---

## 8. Interaction: `CockpitInteraction` (`Interaction.ts`)

```ts
new CockpitInteraction({
  domElement, camera,
  lookButtons?: [0, 2],         // buttons that start free look on empty space
  onLook?(dx, dy), onLookStart?(), onLookEnd?(), lookPointerLock?: false,
  onEmptyWheel?(notches),       // e.g. zoom
  tooltips?: true, highlight?: true, highlightColor?: '#9fd3ff', tooltipContainer?: document.body,
  maxDistance?: 12,
})
register(c) / registerAll(cs) / unregister(c) / registerDisplay(d, mesh) / unregisterDisplay(d)
setOccluders(objects[])  setCamera(cam)  pick(clientX, clientY) / pickNdc(ndc) -> PickResult
update(dt)  dispose()  enabled  hoveredControl  focused  busy
```

- Picking: all control hit targets, display meshes and occluder meshes; among hits within 3 cm of
  the nearest, the highest `userData.hitPriority` wins (default 0, occluders -2, yoke grips -1);
  an occluder winning = nothing is hit. Disabled (`enabled === false`) or invisible controls are
  skipped. Scene world matrices must be current (the renderer updates them each frame).
- Pointer capture during drags; pointer lock for controls with `pointerLock` (yoke).
- Wheel normalisation: >= 50 px per event = one notch (mice), smaller deltas accumulate at 100 px
  per notch (trackpads); line mode 33 px/line; Shift+wheel reported as horizontal scroll is
  handled.
- Hover: rim-glow overlay on the control's moving parts (`HoverHighlighter`), CSS cursor from
  `control.cursor(p)` (default pointer), DOM tooltip (class `cockpit-tooltip`) refreshed every
  frame; hover re-picked at ~8 Hz when the pointer is still (moving yoke under the cursor).
- Keyboard: `window` keydown/keyup (capture phase) go to the focused control's `onKey`; consumed
  keys are `preventDefault` + `stopPropagation` (sim key bindings do not fire).
- Window blur / pointercancel -> `onCancel()` on the active control.

---

## 9. Materials and palettes (`materials.ts`)

`new CockpitMaterials(palette)` (use `env.materials`). Palettes (`PALETTES`):

| id | panel | finish | backlight | source |
|---|---|---|---|---|
| `boeing` | #ACACA4 (FS 595 36440 Light Gull Gray) | textured | incandescent #ffd29a | Boeing spec per flaps2approach.com; FS->sRGB perbang.dk |
| `boeing-ral7011` | #434B4D (RAL 7011) | textured | incandescent | Gables aftermarket panels |
| `gulfstream` | #3a3c3f | smooth | LED #eef2ff | EST from press photos |
| `bombardier` | #34373b | smooth | LED | EST |
| `citation` | #2e3033 | smooth | LED | EST |
| `cessna172` | #2c2d2f | textured | #fff0d8 | EST |

`PaletteDef` fields: `panel, panelRoughness, panelFinish, panelDark, glareshield, bezel, knob,
knobRoughness, handle ('chrome'|'black'), interior, headliner, carpet, seat, seatMaterial, yoke,
labelFill, backlight, flood`. Pass a custom `PaletteDef` for variants.

Shared materials (`get(name)`): `panel, panelDark, panelEdge, glareshield` (black wrinkle crackle
normal map, ~2.5 mm cells), `bezel, bezelGloss, knob, knobKnurled` (diamond knurl normal map),
`knobGrey, knobWhite, knobRed, knobMetal, chrome, aluminium, steel, brass, handle, handleBlack,
screw, screwPhillips, screwSlot, screwHex, rubber, plasticBlack, plasticGrey, guardRed,
guardBlack, guardYellow, guardClear, wire, leather, fabric, carpet, interior, headliner, frame,
yoke, yokeGrip, paintWhite, paintRed, paintYellow, paintBlack, windowGlass, lcdOff, hitbox`.

Other API: `custom(kind: 'paint'|'plastic'|'metal'|'gloss', color, roughness?)` (cached),
`lens(color, emissiveMap, tintOff?)` (per-instance annunciator lens: dark tinted off, emissive in
lamp colour; drive `emissiveIntensity`), `backlitLegend(map, fill, glow)`, `displayGlass()`,
`track(m)`, `release(m)`, `texture(name)`, `setEnvironment(tex | null)`,
`setEnvironmentScale(s)`, `setInteriorOcclusion(diffuse = 0.4, specular = 0.7)`,
`patchInterior(m)`, `dispose()`. `LAMP_COLORS`: red, amber, green, white, blue, cyan, magenta
(meanings per 14 CFR 25.1322).

Interior occlusion: every cockpit MeshStandard/Physical material gets an `onBeforeCompile` patch
scaling indirect diffuse/specular (hemisphere + environment light) by `interior.diffuse/specular`
(the cockpit sees only part of the sky; there is no SSAO). Direct light (sun, floods) is
unaffected. `build()` applies the patch to every MeshStandard/Physical material under the root
(including materials made by other modules, e.g. analog gauges; existing `onBeforeCompile` hooks
are chained); call `env.materials.patchInterior(m)` yourself for materials added after build(). Procedural
textures (`textures.ts`) are DataTextures (node-safe): crackle, paint, leather, fabric, carpet,
knurl, brushed, screw heads.

---

## 10. Labels (`labels.ts`, `env.labels`)

```ts
interface TextStyle { height: number /* cap height m, typical 0.0025-0.0035 */; font?: PANEL_FONT; weight?: 600;
  color?: fill colour (palette labelFill); zone?: 'panel' | string | null /* null = unlit */;
  align?: 'center'|'left'|'right'; anchor?: 'middle'|'top'|'bottom'; spacing?: 0.04 /* em */;
  lineHeight?: 1.35; box?: number /* outline width in em */ }
labels.text(text, style): LabelMesh          // quad in XY facing +Z at z = 0.15 mm; userData.width_m/height_m
labels.rect(w, h, zone?, color?)  labels.line(x0, y0, x1, y1, width, zone?, color?)
labels.bracket(title, width, style, tick?)   labels.arc(items[{ text, angleDeg }], radius, style, ticks?)
labels.legend(lines, pxW, pxH, 'legend'|'field', font?, weight?) -> { rect, texture }   // annunciator cells
labels.quad(rect, w, h, ox?, oy?)  labels.flush()  labels.atlas (LabelAtlas: cell(), texture(page), pageCount)
```
Text is rasterised once into shared 2048² atlas pages (34 px cap height, padded); identical
strings share cells and geometry. Label materials are shared per (page, zone, colour) and their
emissive follows the zone (engraved white text lit from behind). Fonts are system stacks
(`PANEL_FONT` condensed grotesque, `KEY_FONT`). In node (no canvas) quads are untextured.

---

## 11. Lighting (`Lighting.ts`, `env.lighting`)

```ts
lighting.addZone({ id, intensityVar?: `ac.light.${id}`, powerVar?, color?: palette.backlight,
                   gain?: 0.9, lagS?: 0.05 /* 0 = LED */, gamma?: 1 })
lighting.registerBacklight(material, zoneId, gain?)  lighting.unregister(material)
lighting.addLight({ id, kind: 'point'|'spot', zone, position_m, target_m?, color?, candela,
                    distance?: 2.5, decay?: 2, angleDeg?: 35, penumbra? }, parent /* root */)
lighting.addDomeLight(id, zone, pos, parent, cd = 3) / addFloodLight(id, zone, pos, target, parent, cd = 2, angle = 50)
lighting.addStormLight(..., cd = 8) / addMapLight(..., cd = 3)
lighting.setAnnunciatorDimming(varName /* 1 = BRT */, dimLevel = 0.3, invert = false, powerVar = null)
lighting.annunciatorLevel()  lighting.lampTest()  lighting.level(zone)  lighting.zones()
lighting.daylightWashout = 0.85   lighting.ambientVar = 'env.ambient_light'   lighting.lampTestVar = 'alert.annun_test'
```
Zones are dimmer channels: `level = clamp(var)^gamma`, 0 while `powerVar` is 0 (missing var =
powered), first-order lag. Materials in a zone get `emissiveIntensity = level * wash * gain`;
lights get `intensity = level * wash * candela`. Zones used by labels are created on demand with
var `ac.light.<zone>` (the default label zone is `'panel'`), so aircraft must write
`ac.light.panel` (or reconfigure the zone's var) from their lighting system. `wash` =
`1 - daylightWashout * smoothstep(0.45, 0.9, env.ambient_light)`: backlighting/floods are drawn
at night-adapted brightness and fade by day (annunciators and displays are not washed out).
Reflections (env map intensity) also scale with ambient light. Keep real lights <= 4-5 per
cockpit; they stay visible at zero intensity (no shader recompiles).

---

## 12. Geometry library (`geometry/*`, `import { geometry } from '../cockpit'`)

Panel-frame convention (x right, y up, z out; parts stand on z = 0), metres.

- `primitives`: `roundedRectShape/Path(w, h, r, cx?, cy?)`, `circlePath/Shape(r, cx?, cy?, seg?)`,
  `extrude(shape, { depth, bevel?, bevelSegments?, curveSegments?, anchor?: 'back0'|'front0' })`
  (UVs in metres), `roundedBox(w, h, d, r, seg?)`, `roundedBoxOnSurface`, `revolve(profile [r, z][],
  segments?, ridge?: { count, depth, zMin, zMax, kind?: 'flute'|'ridge'|'scallop', blend? })`
  (surface of revolution about +Z; repeat a point for a crisp edge), `cylinderZ(rB, rT, z0, z1, seg?)`,
  `hexPrism(af, z0, z1)`, `torusZ`, `tube(points, r)`, `sphere`, `sweep(profile, points)`,
  `merge(geoms)`, `prepareForMerge(g)`, `transform(g, x, y, z, rx, ry, rz, s)`, `hitBox(mat, w, h, d, x, y, z)`.
- `panel`: `ATI3_HOLE`, `ATI2_HOLE`, `panelGeometry({ width, height, thickness?, radius?, bevel?, cutouts? })`
  (front at z = 0), `screwHeadGeometry(kind, d)` (groups side/top/bottom), `screwPattern(w, h, inset, pitch?)`,
  `screwInstances(pos, geo, [side, top, bottom])`, `roundBezelGeometry(holeD, width?, height?)`,
  `squareFlangeGeometry(size, holeD)`, `rectBezelGeometry(w, h, border | [l, r, t, b], depth?, outerR?, innerR?)`,
  `glassDiscGeometry(d)`, `displayScreenGeometry(w, h)`, `recessGeometry(w, h, depth)`.
- `knobs`: `knobGeometry({ style: KnobCap, diameter, height, ridges?, innerRadius? })`, `knobShaft`, `escutcheon`.
- `switches`: `TOGGLE_DIMS`, `toggleBaseGeometry(scale)`, `toggleHandleGeometry(style, scale, length?)`,
  `leverLockCollarGeometry`, `rockerFrameGeometry`, `rockerCapGeometry`, `guardCoverGeometry(w, len, h)`
  (hinge frame: axis X at origin, cover along -Y), `guardBaseGeometry`, `fenceGeometry`, `wireGuardGeometry`.
- `levers`: `leverArmGeometry(len, w?, t?)`, `leverKnobGeometry(style, scale?)` (flap = NACA 0018 airfoil,
  gear = wheel, per 14 CFR 25.781), `quadrantSlotGeometry(len, slotW, plateW?, h?)`, `slotSealGeometry`.
- `yokes`: `yokeParts(style, scale?) -> { frame, grips, hub, gripBoxes, anchors, width }`,
  `yokeColumnGeometry(kind, length, radius)`, `flipWinding(g)`.
- `structure` (cockpit-local frame): `glareshieldGeometry(width, depth, drop?, brow?, endTaper?)` (brow's aft
  edge at z = 0, top at y = 0, extends to -z), `pillarGeometry(points, w?, d?)`, `shellBoxGeometry(w, h, d, t?, r?)`
  (open +Z face), `pedestalGeometry(w, len, hAft, hFwd, r?)` (stands on y = 0), `floorGeometry(w, len)`,
  `sidewallGeometry(R, len, a0, a1)`, `seatGeometry(style)`, `pedalGeometry(style)`, `pedalTreadGeometry`,
  `trimBoxGeometry`, `plateGeometry(w, h, t?, r?)`.

Share repeated geometry through `env.geometry.get(key, make)` (the cache owns and disposes it).

---

## 13. SimVars, events and sound ids

Written by the cockpit module itself (besides each control's bound vars):

| Var | Writer | Meaning |
|---|---|---|
| `cockpit.yoke_active`, `cockpit.yoke_pitch`, `cockpit.yoke_roll` | Yoke drag | section 2.2 |
| `cockpit.pedals_active`, `cockpit.pedals_yaw` | RudderPedals drag | section 2.2 |
| `cockpit.toe_brake_left`, `cockpit.toe_brake_right` | RudderPedals toe press | 0/1 |
| `display.<id>.ready` | DisplayManager | 1 after boot |

Read: `display.<id>.power`, `display.<id>.brt`, `ac.light.<zone>` (or the zone var you set),
zone power vars, `alert.annun_test` (lamp test), the annunciator dim/power vars you configure,
`env.ambient_light`, `input.throttle_axis_bound` and axis vars (bound levers), `input.pitch/roll/yaw`,
`input.brake_left/right` (animation defaults), plus every control's own vars.

Events: only those you configure (`events`, `event`, `releaseEvent`, `incEvent`/`decEvent`,
knob `push.event`, keypad `${eventPrefix}${id}` / `singleEvent` / `:up`, trim `manualEvent`).

`COCKPIT_SOUNDS` (`types.ts`): `switch.toggle`, `switch.toggle_heavy`, `switch.rocker`,
`switch.guard_open`, `switch.guard_close`, `button.press`, `button.release`, `key.press`,
`knob.detent`, `knob.selector`, `knob.push`, `lever.detent`, `lever.gate`, `lever.slide`,
`gear.handle`, `cb.pull`, `cb.push`, `cb.trip`, `handle.pull`, `handle.push`, `handle.rotate`,
`fuel.selector`, `trim.wheel`, `yoke.button` (reserved).

---

## 14. Performance rules

- Build dense panels with specs/rows; share geometry through `env.geometry`; keep `mergeStatic`
  on. The demo (48 controls, 2 displays) renders in ~140 draw calls; a full airliner flight deck
  should stay under ~2,500 (moving parts are separate meshes by necessity).
- Label text is cheap (atlas + merged quads); annunciator segments cost one material each.
- `control.update` and `DisplayManager.update` do not allocate; `Lever.limit` callbacks should
  not allocate either (return a cached tuple if called per frame).
- Real lights: <= 4-5 per cockpit.
- Canvas displays: `render()` must return `false` when nothing changed.

---

## 15. Demo cockpit (`demo/DemoPanel.ts`)

```ts
import { buildDemoCockpit, DEMO_EYE, DEMO_VARS, DemoDisplay, DemoGauge } from '../cockpit/demo/DemoPanel';
const build = buildDemoCockpit(ctx, 'citation' /* or 'boeing' | 'gulfstream' | 'bombardier' | 'cessna172' */);
```
Contains one of every control type (toggles incl. momentary and lever-lock, guarded switch and
button, rocker with indicator, Korry/round/mushroom buttons, annunciators, concentric HDG/CRS knob
with push, BARO knurled knob, MODE and magneto selectors, dimmer knobs, thumbwheel, gear handle
with lamp and WOW interlock, parking-brake T-handle, fire handle with lock/override, push-pull
throttle and mixture, breakers, overhead row + grid from specs, thrust levers with reverse
gate, discrete flap lever with a gate, speedbrake with ARM, fuel cutoff lever, trim wheel with
indicator, fuel selector, CDU keypad with keyboard focus, yoke with AP DISC/trim/PTT, rudder
pedals), a touch display with boot splash, a round gauge, structure, lighting zones
(`ac.light.panel|flood|dome`), and a small demo system (`ac.demo.*`) so every control drives
visible state. Eye at `DEMO_EYE`; `views` Pedestal and Overhead.

---

## 16. Recipes

**Boeing 737 overhead module from a data table**

```ts
const ovhd = b.panel({ name: 'ovhd', center_m: [..], facing: 'down', tiltDeg: -15, width: 0.9, height: 0.62,
                       origin: 'top-left', material: 'panelDark', screws: false });
const elec = ovhd.subPanel({ name: 'ovhd.elec', x: 0.2, y: 0.12 /* centre */, width: 0.2, height: 0.14, origin: 'top-left',
                             screws: { kind: 'dzus', diameter: 0.009, positions: [[0.008, 0.008], [0.192, 0.008], [0.008, 0.132], [0.192, 0.132]] } });
elec.bracket('STANDBY POWER', 0.1, 0.02, 0.12);
b.addSwitchRow(elec, { x: 0.03, y: 0.06, spacing: 0.035 }, [
  { type: 'guarded', id: 'ovhd.stby_pwr', var: 'ac.elec.stby_pwr_sw', positions: ['BAT', 'OFF', 'AUTO'], values: [-1, 0, 1], initial: 2,
    guard: { color: 'red', guardedPosition: 2 }, label: 'STANDBY POWER' },
  { type: 'button', id: 'ovhd.gen1', var: 'ac.elec.gen1_sw', mode: 'momentary', label: 'GEN 1',
    segments: [{ text: ['GEN OFF', 'BUS'], color: 'blue', var: 'ac.elec.gen1_off_bus' }] },
]);
```

**Thrust levers with reverse (bizjet lift-to-pass idle gate)**: `min: -0.3, max: 1`, detents
`{ value: 0, label: 'IDLE', kind: 'gate', direction: 'decreasing' }`, soft detents CRU/CLB/TO,
`axis: { var: INPUT.throttle(1), map: (a) => a }` (maps the hardware axis to the forward range).
737 piggy-back reverse levers: a separate `Lever` with `knob: 'reverser'` and
`limit: (v) => v.get('ac.tla1') <= 0.001 ? [0, 1] : [0, 0]`.

**Flap handle**: `discrete: true`, detents UP/1/2/5/10/15/25/30/40 (gates where the AFM has
them), `knob: 'flap'`. **Speedbrake**: DOWN (gate, increasing), ARMED (soft), FLIGHT DETENT, UP.
**Start/cutoff lever**: `discrete`, two gate detents, `knob: 'start'` (lift over the gate).

**Glass cockpit bezel** (G1000 GDU): `panel.display(gdu, x, y, 0.211, 0.158, { bezel: { border:
[0.03, 0.03, 0.012, 0.03] }, display: { boot: { seconds: 6, title: 'GARMIN' } } })`, softkeys as a
`KeyPad` row (`keyHeight: 0.007`, `eventPrefix: 'g1000.pfd.softkey.'`), concentric FMS/NAV/COM
knobs as `RotaryKnob` encoders (`incEvent`/`decEvent`, `push.event`).

**Cessna 172S steam**: magneto = `SelectorKnob` `cap: 'key'` OFF/R/L/BOTH/START(spring->BOTH);
throttle/mixture = `PushPullKnob` (`style` 'throttle'/'mixture', axis bindings); carb heat not on
the 172S (fuel injected) - use `PushPullKnob` style 'cabin' for CABIN HT/AIR; fuel selector =
`FuelSelector` LEFT/BOTH/RIGHT + red `PushPullKnob` FUEL SHUTOFF; elevator trim = `TrimWheel`
with indicator; parking brake = `TBarHandle` `rotate: 'lock', springIn: true`; yoke `style:
'cessna'` (translate column); floor pedals `style: 'floor'`.

**Fire handle (737)**: `TBarHandle` `style: 'fire'`, `unlockVar: 'ac.fire.eng1_warn'`,
`overrideVar: 'ac.fire.eng1_ovrd'`, `rotateVar`, `lightVar`, `legend: '1'`.

---

## 17. Limits and simplifications (SCOPE)

- Pull/lever-lock/lift gestures are automatic animations triggered by clicks (not separate
  mouse gestures); gates use the "new motion from the gate" rule.
- Yoke/pedal mouse flying writes `cockpit.*` vars; the input module must merge them.
- Knurling is a normal map (diamond) plus fine geometric ridges; screw recesses are textures.
- Sizes marked EST in code (knob, lever, yoke, seat, pedal dimensions; palettes other than
  Boeing; lamp shades; light candela) come from photographs, not drawings.
- No shadows inside the cockpit; indirect light is reduced by a constant interior-occlusion
  factor instead of real occlusion.
- Label fonts are system fonts (no bundled engraving font), so glyph shapes vary by OS.
- Static consolidation freezes transforms at build(); moving groups must be flagged
  `cockpitDynamic`.
