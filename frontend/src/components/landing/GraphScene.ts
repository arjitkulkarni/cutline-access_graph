import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/**
 * The CUTLINE demo graph in 3D, driven by the scroll story.
 *   step 0 breach  · Maya's and Noah's forbidden routes pulse red
 *   step 1 trace   · same, with the legitimate routes that share those roles hinted in bone
 *   step 2 reject  · the two obvious fixes are tried, alternately, and visibly fail
 *   step 3 repair  · two assignments are cut (sparks), Support (safe) grows in
 *   step 4 verify  · the routes Finance and the DSAR Bot need are re-traced in bone
 * Every visual quantity is a channel eased toward the target of the current state, so
 * scrolling backwards un-cuts the graph just as smoothly.
 */

export type StoryStep = 0 | 1 | 2 | 3 | 4;
export type RejectAttempt = "A" | "B";

export interface GraphSceneOptions {
  container: HTMLElement;
  labelLayer: HTMLElement;
  reducedMotion: boolean;
  /** Phones: lay the graph out top to bottom (people above, capabilities below) to fill a narrow stage. */
  portrait?: boolean;
  onAttempt?: (attempt: RejectAttempt) => void;
}

export interface GraphSceneHandle {
  setStep(step: StoryStep): void;
  dispose(): void;
}

// ── Scenario ─────────────────────────────────────────────────────────────────────────────
type Kind = "principal" | "role" | "capability";
interface NodeDef {
  id: string;
  label: string;
  kind: Kind;
  pos: [number, number, number];
  layer: number;
  /** Label used in the portrait layout, where four people share one row. */
  short?: string;
}

const NODES: NodeDef[] = [
  { id: "felix", label: "felix · finance", short: "felix", kind: "principal", pos: [-3.5, 1.75, 0.35], layer: 0 },
  { id: "dsar", label: "dsar_bot", kind: "principal", pos: [-3.5, 0.6, -0.35], layer: 0 },
  { id: "maya", label: "maya · support", short: "maya", kind: "principal", pos: [-3.5, -0.55, 0.4], layer: 0 },
  { id: "noah", label: "noah · support", short: "noah", kind: "principal", pos: [-3.5, -1.7, -0.25], layer: 0 },
  { id: "finance", label: "Finance", kind: "role", pos: [-1.2, 1.45, -0.25], layer: 1 },
  { id: "support", label: "Support", kind: "role", pos: [-1.2, -0.05, 0.2], layer: 1 },
  { id: "support_safe", label: "Support (safe)", kind: "role", pos: [-1.05, -1.85, 0.55], layer: 1 },
  { id: "shared_ops", label: "Shared Ops", kind: "role", pos: [1.15, 0.95, 0.3], layer: 2 },
  { id: "export_helper", label: "Export Helper", kind: "role", pos: [1.15, -0.45, -0.35], layer: 2 },
  { id: "export", label: "export_customers", kind: "capability", pos: [3.45, 0.3, 0], layer: 3 },
  { id: "reports", label: "generate_reports", kind: "capability", pos: [3.45, -1.0, 0.35], layer: 3 },
  { id: "orders", label: "view_orders", kind: "capability", pos: [3.45, -2.05, -0.2], layer: 3 },
];

type EdgeKind = "base" | "cut" | "new";
const EDGES: Array<[string, string, EdgeKind]> = [
  ["felix", "finance", "base"],
  ["dsar", "support", "base"],
  ["maya", "support", "cut"],
  ["noah", "support", "cut"],
  ["finance", "shared_ops", "base"],
  ["support", "shared_ops", "base"],
  ["support", "export_helper", "base"],
  ["shared_ops", "export", "base"],
  ["export_helper", "export", "base"],
  ["support", "reports", "base"],
  ["support", "orders", "base"],
  ["maya", "support_safe", "new"],
  ["noah", "support_safe", "new"],
  ["support_safe", "reports", "new"],
  ["support_safe", "orders", "new"],
];
const NEW_ORDER = ["maya>support_safe", "noah>support_safe", "support_safe>reports", "support_safe>orders"];

/** Forbidden-route edges that stay open after either obvious fix. */
const RISK_CORE = new Set(["maya>support", "noah>support", "support>export_helper", "export_helper>export"]);
/** Forbidden-route edges through Shared Ops (closed by either obvious fix). */
const RISK_SHARED = new Set(["support>shared_ops", "shared_ops>export"]);
const KEEP_EDGES = new Set(["felix>finance", "finance>shared_ops", "shared_ops>export", "dsar>support", "support>export_helper", "support>shared_ops", "export_helper>export"]);

// ── States & channels ────────────────────────────────────────────────────────────────────
type State = "breach" | "trace" | "rejectA" | "rejectB" | "repair" | "verify";
interface Channels {
  riskCore: number;
  riskShared: number;
  keepHint: number;
  keep: number;
  ghostA: number; // "Detach Shared Ops from Support"
  ghostB: number; // "Revoke export_customers from Shared Ops"
  cut: number;
  safe: number;
}
const ZERO: Channels = { riskCore: 0, riskShared: 0, keepHint: 0, keep: 0, ghostA: 0, ghostB: 0, cut: 0, safe: 0 };
const TARGETS: Record<State, Channels> = {
  breach: { ...ZERO, riskCore: 1, riskShared: 1 },
  trace: { ...ZERO, riskCore: 1, riskShared: 1, keepHint: 1 },
  rejectA: { ...ZERO, riskCore: 1, ghostA: 1 },
  rejectB: { ...ZERO, riskCore: 1, ghostB: 1 },
  repair: { ...ZERO, cut: 1, safe: 1 },
  verify: { ...ZERO, cut: 1, safe: 1, keep: 1 },
};
const ATTEMPT_SECONDS = 3.8;

interface PulseSpec {
  path: string[];
  tone: "red" | "bone";
  period: number;
  duration: number;
  offset: number;
  blocked?: boolean; // dies at the last node with a red flash
}
const R = (path: string[], i: number, period = 2.6, duration = 1.7): PulseSpec => ({ path, tone: "red", period, duration, offset: i * 0.55 });
const B = (path: string[], i: number, period = 3.0, duration = 1.5): PulseSpec => ({ path, tone: "bone", period, duration, offset: i * 0.45 });
const PULSES: Record<State, PulseSpec[]> = {
  breach: [
    R(["maya", "support", "shared_ops", "export"], 0),
    R(["noah", "support", "export_helper", "export"], 1),
    R(["maya", "support", "export_helper", "export"], 2),
    R(["noah", "support", "shared_ops", "export"], 3),
  ],
  trace: [
    R(["maya", "support", "shared_ops", "export"], 0),
    R(["maya", "support", "export_helper", "export"], 1.6),
    R(["noah", "support", "shared_ops", "export"], 3),
    R(["noah", "support", "export_helper", "export"], 4),
  ],
  rejectA: [
    R(["maya", "support", "export_helper", "export"], 0, 2.2, 1.5),
    R(["noah", "support", "export_helper", "export"], 1.3, 2.2, 1.5),
  ],
  rejectB: [
    { path: ["felix", "finance", "shared_ops"], tone: "bone", period: 2.4, duration: 1.2, offset: 0.2, blocked: true },
    R(["maya", "support", "export_helper", "export"], 0.6, 2.4, 1.5),
    R(["noah", "support", "export_helper", "export"], 2.4, 2.4, 1.5),
  ],
  repair: [
    B(["maya", "support_safe", "orders"], 0, 2.4, 1.1),
    B(["noah", "support_safe", "reports"], 1, 2.4, 1.1),
    B(["maya", "support_safe", "reports"], 2.2, 2.4, 1.1),
    B(["noah", "support_safe", "orders"], 3.2, 2.4, 1.1),
  ],
  verify: [
    B(["felix", "finance", "shared_ops", "export"], 0, 3.4, 1.7),
    B(["dsar", "support", "export_helper", "export"], 1.2, 3.4, 1.7),
    B(["maya", "support_safe", "orders"], 2.4, 3.4, 1.2),
    B(["noah", "support_safe", "reports"], 3.4, 3.4, 1.2),
    B(["dsar", "support", "shared_ops", "export"], 4.8, 3.4, 1.7),
  ],
};

// ── Palette: black, bone, blood ──────────────────────────────────────────────────────────
/** Page black #050505 (5/255 in sRGB) expressed in linear light: 0.0196 / 12.92. */
const BG_LINEAR = 5 / 255 / 12.92;
const C = {
  bone: new THREE.Color("#c4bdb1"),
  boneCore: new THREE.Color("#9a938a"),
  boneDim: new THREE.Color("#6a645e"),
  edge: new THREE.Color("#343131"),
  edgeGhost: new THREE.Color("#1a1818"),
  red: new THREE.Color("#b5102a"),
  blood: new THREE.Color("#7d0a14"),
  roleFill: new THREE.Color("#0d0c0c"),
  dust: new THREE.Color("#3a3633"),
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (v: number) => v * v * (3 - 2 * v);
const backOut = (v: number) => {
  const x = v - 1;
  return 1 + x * x * (2.7 * x + 1.7);
};

/** Maps [0, 1] onto [from, to] of a parent curve so an edge can be split at the cut. */
class SubCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private parent: THREE.Curve<THREE.Vector3>, private from: number, private to: number) {
    super();
  }
  getPoint(t: number, target = new THREE.Vector3()) {
    return this.parent.getPoint(this.from + (this.to - this.from) * t, target);
  }
}

const RADIAL = 6;
const UNIT = RADIAL * 6;
interface Tube {
  mesh: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  segments: number;
}
function makeTube(curve: THREE.Curve<THREE.Vector3>, segments: number, radius: number): Tube {
  const geometry = new THREE.TubeGeometry(curve, segments, radius, RADIAL, false);
  const material = new THREE.MeshBasicMaterial({ color: C.edge.clone(), transparent: true, opacity: 0.9, depthWrite: false });
  return { mesh: new THREE.Mesh(geometry, material), segments };
}
function showTube(tube: Tube, fraction: number, fromEnd = false) {
  const shown = Math.round(clamp01(fraction) * tube.segments);
  tube.mesh.geometry.setDrawRange(fromEnd ? (tube.segments - shown) * UNIT : 0, shown * UNIT);
  tube.mesh.visible = shown > 0;
}

function glowTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.22, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface NodeView {
  def: NodeDef;
  group: THREE.Group;
  core: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  wire: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  glow: THREE.Sprite;
  label: HTMLDivElement;
}
interface EdgeView {
  key: string;
  kind: EdgeKind;
  curve: THREE.QuadraticBezierCurve3;
  tubes: Tube[];
  slash?: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
}

/**
 * The scenario is authored left to right (people → roles → capabilities). The portrait layout
 * turns it a quarter so the flow runs top to bottom, keeping people in their row order. Linear,
 * so mapping a curve's control points maps the whole curve.
 */
const PORTRAIT_X = 1.4;
const PORTRAIT_Y = 0.7;
const PORTRAIT_MID = -0.15; // centre of the authored y range
function orienter(portrait: boolean) {
  return (v: THREE.Vector3) => (portrait ? v.set(-(v.y - PORTRAIT_MID) * PORTRAIT_X, -v.x * PORTRAIT_Y, v.z) : v);
}

export function createGraphScene({ container, labelLayer, reducedMotion, portrait = false, onAttempt }: GraphSceneOptions): GraphSceneHandle {
  const orient = orienter(portrait);
  /** Orients an offset (no translation), for markers placed relative to a point. */
  const offset = (x: number, y: number) => (portrait ? new THREE.Vector3(-y * PORTRAIT_X, -x * PORTRAIT_Y, 0) : new THREE.Vector3(x, y, 0));
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  const dpr = Math.min(window.devicePixelRatio || 1, portrait ? 1.5 : 1.75);
  renderer.setPixelRatio(dpr);
  // Through EffectComposer the clear colour is sRGB-encoded twice (once when clearing the linear
  // render target, again by OutputPass), so #050505 came out as #262626. Store the value whose
  // double encoding lands on the page black: linear BG_LINEAR, set as if it were sRGB.
  renderer.setClearColor(new THREE.Color().setRGB(BG_LINEAR, BG_LINEAR, BG_LINEAR, THREE.SRGBColorSpace), 1);
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, { display: "block", width: "100%", height: "100%" });
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  const world = new THREE.Group();
  scene.add(world);

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(dpr);
  composer.addPass(new RenderPass(scene, camera));
  // Glow only at the source. The pass blends five blur mips; the low-res ones spread a faint veil
  // over the whole frame (worst when many bone routes are lit), so taper them to nothing. Radius 0
  // keeps the shader from lerping those weights back up (lerpBloomFactor mixes toward 1.2 - w).
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.45, 0, 0.12);
  bloom.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.55, 0.18, 0.03, 0.0];
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const glowTex = glowTexture();
  const disposables: Array<{ dispose(): void }> = [glowTex, bloom];
  const track = <T extends { dispose(): void }>(d: T) => {
    disposables.push(d);
    return d;
  };

  // ── Ambient dust: a sparse, slowly turning field ────────────────────────────────────
  const dustN = 520;
  const dustPos = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) {
    const r = 5.5 + Math.random() * 8;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    dustPos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    dustPos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * 0.6;
    dustPos[i * 3 + 2] = r * Math.cos(ph) - 5;
  }
  const dustGeo = track(new THREE.BufferGeometry());
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, track(new THREE.PointsMaterial({ color: C.dust, size: 0.03, transparent: true, opacity: 0.6, depthWrite: false })));
  scene.add(dust);

  // ── Nodes ───────────────────────────────────────────────────────────────────────────
  const halo = track(new THREE.IcosahedronGeometry(0.2, 0));
  const solid = {
    principal: track(new THREE.SphereGeometry(0.1, 24, 16)),
    role: track(new THREE.BoxGeometry(0.16, 0.16, 0.16)),
    capability: track(new THREE.OctahedronGeometry(0.09, 0)),
  };
  const wires = {
    principal: track(new THREE.EdgesGeometry(halo)),
    role: track(new THREE.EdgesGeometry(track(new THREE.BoxGeometry(0.34, 0.34, 0.34)))),
    capability: track(new THREE.EdgesGeometry(track(new THREE.OctahedronGeometry(0.22, 0)))),
  };
  const nodes = new Map<string, NodeView>();
  for (const def of NODES) {
    const group = new THREE.Group();
    group.position.copy(orient(new THREE.Vector3(...def.pos)));
    const core = new THREE.Mesh(solid[def.kind], track(new THREE.MeshBasicMaterial({ color: C.boneCore.clone(), transparent: true })));
    const wire = new THREE.LineSegments(wires[def.kind], track(new THREE.LineBasicMaterial({ color: C.boneDim.clone(), transparent: true })));
    const glow = new THREE.Sprite(
      track(new THREE.SpriteMaterial({ map: glowTex, color: C.bone.clone(), transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending })),
    );
    glow.scale.setScalar(0.8);
    if (def.kind !== "principal") {
      core.rotation.set(0.6, 0.7, 0);
      wire.rotation.copy(core.rotation);
    }
    group.add(glow, core, wire);
    world.add(group);
    const label = document.createElement("div");
    label.className = `lp-gl-label lp-gl-label--${def.kind}`;
    label.textContent = portrait && def.short ? def.short : def.label;
    labelLayer.appendChild(label);
    nodes.set(def.id, { def, group, core, wire, glow, label });
  }

  // ── Edges ───────────────────────────────────────────────────────────────────────────
  const edges = new Map<string, EdgeView>();
  for (const [from, to, kind] of EDGES) {
    const a = new THREE.Vector3(...nodes.get(from)!.def.pos);
    const b = new THREE.Vector3(...nodes.get(to)!.def.pos);
    const ctrl = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, (b.y - a.y) * -0.12, 0.45));
    const curve = new THREE.QuadraticBezierCurve3(orient(a), orient(ctrl), orient(b));
    const radius = kind === "new" ? 0.014 : 0.011;
    const tubes =
      kind === "cut"
        ? [makeTube(new SubCurve(curve, 0, 0.5), 24, radius), makeTube(new SubCurve(curve, 0.5, 1), 24, radius)]
        : [makeTube(curve, 48, radius)];
    for (const t of tubes) {
      track(t.mesh.geometry);
      track(t.mesh.material);
      world.add(t.mesh);
    }
    let slash: EdgeView["slash"];
    if (kind === "cut") {
      slash = new THREE.Mesh(track(new THREE.BoxGeometry(0.03, 0.62, 0.03)), track(new THREE.MeshBasicMaterial({ color: C.red, transparent: true, opacity: 0 })));
      slash.position.copy(curve.getPoint(0.5));
      // Across the edge: edges run left to right in landscape, top to bottom in portrait.
      slash.rotation.z = portrait ? Math.PI / 2 - 0.42 : -0.42;
      world.add(slash);
    }
    edges.set(`${from}>${to}`, { key: `${from}>${to}`, kind, curve, tubes, slash });
  }

  // ── Markers that explain the failed attempts (HTML, projected) ─────────────────────
  const marker = (text: string, tone: "red" | "bone", optional = false) => {
    const el = document.createElement("div");
    el.className = `lp-gl-marker lp-gl-marker--${tone}${optional ? " lp-gl-marker--opt" : ""}`;
    el.textContent = text;
    el.style.opacity = "0";
    labelLayer.appendChild(el);
    return el;
  };
  const markers = [
    { el: marker("✕ detached", "bone"), at: () => edges.get("support>shared_ops")!.curve.getPoint(0.5, new THREE.Vector3()), channel: "ghostA" as const },
    // Optional: hidden on narrow landscape stages, where it would sit on the Support label.
    { el: marker("still open", "red", true), at: () => edges.get("support>export_helper")!.curve.getPoint(0.55, new THREE.Vector3()).add(offset(0, -0.32)), channel: "ghostA" as const },
    { el: marker("✕ revoked", "bone"), at: () => edges.get("shared_ops>export")!.curve.getPoint(0.5, new THREE.Vector3()), channel: "ghostB" as const },
    { el: marker("finance close breaks", "red"), at: () => nodes.get("shared_ops")!.group.position.clone().add(offset(0, 0.42)), channel: "ghostB" as const },
  ];

  // ── Pulses and sparks ───────────────────────────────────────────────────────────────
  const TRAIL = [1, 0.5, 0.25];
  const pool = Array.from({ length: 12 }, () =>
    TRAIL.map((k) => {
      const s = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })));
      s.scale.setScalar(0.34 * (0.5 + 0.5 * k));
      s.visible = false;
      world.add(s);
      return s;
    }),
  );
  const pathPoint = (path: string[], u: number, target: THREE.Vector3) => {
    const n = path.length - 1;
    const x = clamp01(u) * n;
    const i = Math.min(n - 1, Math.floor(x));
    return edges.get(`${path[i]}>${path[i + 1]}`)!.curve.getPoint(x - i, target);
  };

  const SPARKS = 90;
  const sparkPos = new Float32Array(SPARKS * 3);
  const sparkVel = new Float32Array(SPARKS * 3);
  const sparkLife = new Float32Array(SPARKS);
  const sparkGeo = track(new THREE.BufferGeometry());
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  const sparkMat = track(new THREE.PointsMaterial({ color: C.red, size: 0.045, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  const sparks = new THREE.Points(sparkGeo, sparkMat);
  world.add(sparks);
  let sparkAge = 99;
  const burst = () => {
    sparkAge = 0;
    const origins = ["maya>support", "noah>support"].map((k) => edges.get(k)!.curve.getPoint(0.5));
    for (let i = 0; i < SPARKS; i++) {
      const o = origins[i % 2];
      sparkPos.set([o.x, o.y, o.z], i * 3);
      const th = Math.random() * Math.PI * 2;
      const sp = 0.6 + Math.random() * 1.8;
      sparkVel.set([Math.cos(th) * sp, Math.sin(th) * sp * 0.8 + 0.6, (Math.random() - 0.5) * sp], i * 3);
      sparkLife[i] = 0.5 + Math.random() * 0.7;
    }
    sparkGeo.attributes.position.needsUpdate = true;
  };

  // ── Layout ──────────────────────────────────────────────────────────────────────────
  let width = 1;
  let height = 1;
  const fit = () => {
    const rect = container.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    bloom.resolution.set(width * dpr * 0.5, height * dpr * 0.5);
    camera.aspect = width / height;
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const compact = width < 560;
    // Portrait: the graph spans about 5.3 × 4.9 units; leave room for labels above and below.
    const needW = portrait ? 7.0 : compact ? 10.4 : 9.4;
    const needH = portrait ? 6.4 : 5.2;
    const dist = Math.max(needW / (2 * tan * camera.aspect), needH / (2 * tan));
    camera.position.set(0, 0.05, dist);
    camera.lookAt(0, portrait ? 0.28 : -0.12, 0);
    camera.updateProjectionMatrix();
    labelLayer.dataset.compact = compact ? "true" : "false";
    labelLayer.dataset.portrait = portrait ? "true" : "false";
  };
  fit();

  // ── State ───────────────────────────────────────────────────────────────────────────
  let step: StoryStep = 0;
  let attempt: RejectAttempt = "A";
  let local = 0; // seconds since the current state began (drives pulses)
  let elapsed = 0;
  const ch: Channels = { ...TARGETS.breach };
  const stateOf = (): State => (step === 0 ? "breach" : step === 1 ? "trace" : step === 2 ? (attempt === "A" ? "rejectA" : "rejectB") : step === 3 ? "repair" : "verify");

  const pt = new THREE.Vector3();

  const apply = (animatePulses: boolean) => {
    const intro = reducedMotion ? 1 : smooth(clamp01(elapsed / 1.4));

    for (const e of edges.values()) {
      if (e.kind === "base") {
        const tube = e.tubes[0];
        showTube(tube, intro);
        const m = tube.mesh.material;
        m.color.copy(C.edge);
        if (RISK_CORE.has(e.key)) m.color.lerp(C.red, ch.riskCore);
        if (RISK_SHARED.has(e.key)) m.color.lerp(C.red, ch.riskShared);
        if (KEEP_EDGES.has(e.key)) m.color.lerp(C.bone, Math.max(ch.keepHint * 0.3, ch.keep * 0.78));
        let opacity = 0.92;
        const ghost = e.key === "support>shared_ops" ? ch.ghostA : e.key === "shared_ops>export" ? ch.ghostB : 0;
        if (ghost > 0.001) {
          m.color.lerp(C.edgeGhost, ghost);
          opacity = 0.92 - 0.75 * ghost;
        }
        m.opacity = opacity;
      } else if (e.kind === "cut") {
        const visible = Math.min(intro, 1 - ch.cut);
        showTube(e.tubes[0], visible);
        showTube(e.tubes[1], visible, true);
        for (const t of e.tubes) t.mesh.material.color.copy(C.edge).lerp(C.red, ch.riskCore);
        if (e.slash) {
          const s = smooth(clamp01(ch.cut * 1.6));
          e.slash.material.opacity = s;
          e.slash.scale.set(1, Math.max(0.001, backOut(s)), 1);
          e.slash.visible = s > 0.002;
        }
      } else {
        const i = NEW_ORDER.indexOf(e.key);
        const draw = clamp01((ch.safe - i * 0.09) / 0.73);
        showTube(e.tubes[0], smooth(draw));
        e.tubes[0].mesh.material.color.copy(C.bone);
        e.tubes[0].mesh.material.opacity = 0.85;
      }
    }

    for (const n of nodes.values()) {
      const appear = reducedMotion ? 1 : smooth(clamp01((elapsed - 0.1 - n.def.layer * 0.16) / 0.55));
      let scale = appear;
      let glow = n.def.kind === "principal" ? 0.05 : 0.025; // faint halo; roles/capabilities barely
      let labelOpacity = appear;
      let tone = "";
      n.core.material.color.copy(n.def.kind === "principal" ? C.boneCore : C.roleFill);
      n.wire.material.color.copy(C.boneDim);
      n.wire.material.opacity = n.def.kind === "principal" ? 0.28 : 0.85;
      n.glow.material.color.copy(C.bone);

      if (n.def.id === "support_safe") {
        scale = backOut(clamp01(ch.safe * 1.15)) * appear;
        labelOpacity = ch.safe;
        n.wire.material.color.copy(C.bone);
        glow = 0.1 * ch.safe;
        tone = "new";
      } else if (n.def.id === "export") {
        const risk = Math.max(ch.riskCore, ch.riskShared);
        n.wire.material.color.copy(C.blood).lerp(C.red, risk);
        n.core.material.color.copy(C.roleFill).lerp(C.red, risk * 0.8);
        n.glow.material.color.copy(C.red);
        glow = 0.06 + 0.26 * risk;
        if (risk > 0.5) tone = "red";
      } else if (n.def.id === "maya" || n.def.id === "noah") {
        n.glow.material.color.copy(C.bone).lerp(C.red, ch.riskCore);
        glow = 0.05 + 0.2 * ch.riskCore + 0.1 * ch.keep;
        if (ch.riskCore > 0.5) tone = "red";
      } else if (n.def.id === "felix" || n.def.id === "dsar") {
        glow = 0.05 + 0.12 * Math.max(ch.keep, ch.keepHint * 0.5);
        if (n.def.id === "felix" && ch.ghostB > 0.5) tone = "red";
      }
      n.group.scale.setScalar(Math.max(0.0001, scale));
      n.group.visible = scale > 0.003;
      n.glow.material.opacity = glow;
      if (!reducedMotion && n.def.kind !== "principal") {
        n.core.rotation.y = elapsed * 0.3 + n.def.layer;
        n.wire.rotation.y = elapsed * -0.18 + n.def.layer;
      }
      n.label.style.opacity = String(labelOpacity);
      n.label.dataset.tone = tone;
    }

    // Pulses for the current state, on the state's local clock.
    for (const sprites of pool) for (const s of sprites) s.visible = false;
    if (animatePulses) {
      let slot = 0;
      for (const p of PULSES[stateOf()]) {
        if (slot >= pool.length) break;
        const tt = local - p.offset;
        if (tt < 0) continue;
        const u = (tt % p.period) / p.duration;
        if (u > 1.12) continue;
        const sprites = pool[slot++];
        const fadeIn = Math.min(1, u * 7);
        const end = p.blocked ? Math.max(0, 1 - Math.max(0, u - 1) * 9) : Math.min(1, (1.12 - u) * 8);
        TRAIL.forEach((k, j) => {
          const s = sprites[j];
          const uu = Math.min(1, u - j * 0.035);
          if (uu < 0) return;
          pathPoint(p.path, uu, pt);
          s.position.copy(pt);
          const flash = p.blocked && u > 0.94 ? 1 : 0;
          s.material.color.copy(p.tone === "red" ? C.red : C.bone).lerp(C.red, flash);
          s.scale.setScalar(0.27 * (0.5 + 0.5 * k) * (1 + flash * 1.4 * (j === 0 ? 1 : 0)));
          s.material.opacity = fadeIn * end * k * 0.7;
          s.visible = true;
        });
      }
    }

    // Sparks
    if (sparkAge < 1.4) {
      sparkMat.opacity = Math.max(0, 1 - sparkAge / 1.2);
      sparks.visible = true;
    } else {
      sparks.visible = false;
    }
  };

  const project = () => {
    for (const n of nodes.values()) {
      n.group.getWorldPosition(pt).project(camera);
      // Below the node, clear of the role/capability wireframes. In portrait, people sit on the top
      // row with their edges leaving downwards, so their names go above.
      // The middle capability drops a line so three long names fit one row on a 360 px phone.
      const below = n.def.kind === "principal" ? 15 : portrait && n.def.id === "reports" ? 33 : 21;
      const shift = portrait && n.def.kind === "principal" ? "calc(-100% - 13px)" : `${below}px`;
      // Portrait columns at the stage edges hang their labels inwards so they never clip.
      const x = n.group.position.x;
      const anchor = portrait && x < -2 ? "-14px" : portrait && x > 2 ? "calc(-100% + 14px)" : "-50%";
      n.label.style.transform = `translate3d(${((pt.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-pt.y * 0.5 + 0.5) * height).toFixed(1)}px, 0) translate(${anchor}, ${shift})`;
    }
    for (const m of markers) {
      const p = m.at();
      world.localToWorld(p).project(camera);
      m.el.style.transform = `translate3d(${((p.x * 0.5 + 0.5) * width).toFixed(1)}px, ${((-p.y * 0.5 + 0.5) * height).toFixed(1)}px, 0) translate(-50%, -50%)`;
      m.el.style.opacity = String(smooth(clamp01(ch[m.channel] * 1.3 - 0.3)));
    }
  };

  // ── Interaction ─────────────────────────────────────────────────────────────────────
  const pointer = { x: 0, y: 0 };
  const onPointer = (e: PointerEvent) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  };
  if (!reducedMotion) window.addEventListener("pointermove", onPointer, { passive: true });
  // Touch screens have no hover pointer, so the graph leans with the scroll instead.
  let lastScroll = window.scrollY;
  let scrollTilt = 0;

  // ── Loop ────────────────────────────────────────────────────────────────────────────
  let last = 0;
  let inView = true;
  let running = false;
  let prevCut = ch.cut;

  const frame = (time: number) => {
    const dt = last ? Math.min((time - last) / 1000, 0.05) : 0;
    last = time;
    elapsed += dt;
    local += dt;

    if (step === 2 && local > ATTEMPT_SECONDS) {
      attempt = attempt === "A" ? "B" : "A";
      local = 0;
      onAttempt?.(attempt);
    }
    const target = TARGETS[stateOf()];
    const k = 1 - Math.exp(-dt * 3.4);
    (Object.keys(ch) as Array<keyof Channels>).forEach((key) => {
      const rate = key === "cut" ? 1 - Math.exp(-dt * 2.6) : k;
      ch[key] += (target[key] - ch[key]) * rate;
    });
    if (prevCut < 0.06 && ch.cut >= 0.06) burst();
    prevCut = ch.cut;

    if (sparkAge < 1.4) {
      sparkAge += dt;
      for (let i = 0; i < SPARKS; i++) {
        if (sparkAge > sparkLife[i]) {
          sparkPos[i * 3 + 1] = 999;
          continue;
        }
        sparkVel[i * 3 + 1] -= 3.2 * dt;
        sparkPos[i * 3] += sparkVel[i * 3] * dt;
        sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
        sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
      }
      sparkGeo.attributes.position.needsUpdate = true;
    }

    const scrollY = window.scrollY;
    const velocity = dt > 0 ? (scrollY - lastScroll) / dt : 0; // px per second
    lastScroll = scrollY;
    scrollTilt += (Math.max(-0.16, Math.min(0.16, velocity * 0.00016)) - scrollTilt) * 0.06;

    world.rotation.y += (Math.sin(elapsed * 0.1) * 0.18 + pointer.x * 0.14 - world.rotation.y) * 0.035;
    world.rotation.x += (pointer.y * 0.06 + Math.sin(elapsed * 0.07) * 0.025 + scrollTilt - world.rotation.x) * 0.035;
    world.position.y = Math.sin(elapsed * 0.45) * 0.035;
    dust.rotation.y = elapsed * 0.01;

    apply(true);
    composer.render();
    project();
  };

  const renderStatic = () => {
    Object.assign(ch, TARGETS[stateOf()]);
    world.rotation.set(0.03, -0.1, 0);
    apply(false);
    composer.render();
    project();
  };

  const setRunning = (next: boolean) => {
    if (reducedMotion || next === running) return;
    running = next;
    last = 0;
    renderer.setAnimationLoop(running ? frame : null);
  };
  const sync = () => setRunning(inView && document.visibilityState === "visible");
  const io = new IntersectionObserver((entries) => {
    inView = entries.some((e) => e.isIntersecting);
    sync();
  });
  io.observe(container);
  document.addEventListener("visibilitychange", sync);
  const ro = new ResizeObserver(() => {
    fit();
    if (reducedMotion) renderStatic();
  });
  ro.observe(container);
  if (reducedMotion) renderStatic();
  else sync();

  return {
    setStep(next) {
      if (next === step) return;
      step = next;
      local = 0;
      if (step === 2) {
        attempt = "A";
        onAttempt?.("A");
      }
      if (reducedMotion) renderStatic();
    },
    dispose() {
      renderer.setAnimationLoop(null);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pointermove", onPointer);
      for (const n of nodes.values()) n.label.remove();
      for (const m of markers) m.el.remove();
      for (const d of disposables) d.dispose();
      composer.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
