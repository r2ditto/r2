// Interactive photo cube.
// 54 rounded photo tiles laid out like a Rubik's cube, with nine images per face. It drifts on its own and can be dragged to orbit.
// Hovering a face lifts it; clicking turns that face toward the viewer and
// reports it (cube:select) so its details can be shown.
// Double-clicking empty space explodes the cube into floating, spinning tiles;
// rebuild() pulls them back home. The wrecked share is reported as gallery:ruin,
// matching the interface src/lib/ruin.ts expects.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { GalleryItem } from "@lib/timeline-gallery";

export type CubeOptions = {
  gap: number; // spacing between tiles, as a share of a tile
  cornerRadius: number; // rounded corners, in tile UV units
  emptyColor: string;
  coreColor: string; // the dark body showing through the gaps between tiles
  backShade: number; // brightness of a tile's back
  lift: number; // how far a hovered face's tiles rise (world units)
  fit: number; // share of the viewport's short side the cube fills
};

const DEFAULTS: CubeOptions = {
  gap: 0.09,
  cornerRadius: 0.11,
  emptyColor: "#222222",
  coreColor: "#0b0b0b",
  backShade: 0.35,
  lift: 0.08,
  fit: 0.62,
};

const FOV = 35;
const CUBE_RADIUS = 2.8; // bounding sphere of the cube, for fitting the camera
const SPIN_Y = 0.25; // rad/s auto-rotate
const SPIN_X = 0.1;
const IDLE_RESUME = 2; // seconds after an interaction before auto-rotate resumes
const FACE_TURN = 0.7; // seconds to turn a clicked face toward the viewer
const LIFT_RATE = 10;
const CORE_RATE = 12;
const TAP_SLOP = 6; // px
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DIST = 30;

// Explosion
const BURST_MIN = 3; // units/s
const BURST_MAX = 6;
const BURST_DAMPING = 1.6;
const SPIN_MIN = 2; // rad/s
const SPIN_MAX = 6;
const FLOAT_SPIN = 0.3; // spin never quite stops while floating
const DEBRIS_RADIUS = 4.5; // soft limit that keeps debris mostly in frame
const REBUILD_DURATION = 1.1; // seconds per tile
const REBUILD_STAGGER = 0.6; // seconds of random start delay

// Each face's outward normal, plus right/up for an upright image seen from outside
const FACES: { n: THREE.Vector3; r: THREE.Vector3; u: THREE.Vector3 }[] = [
  { n: v(0, 0, 1), r: v(1, 0, 0), u: v(0, 1, 0) }, // front
  { n: v(1, 0, 0), r: v(0, 0, -1), u: v(0, 1, 0) }, // right
  { n: v(0, 0, -1), r: v(-1, 0, 0), u: v(0, 1, 0) }, // back
  { n: v(-1, 0, 0), r: v(0, 0, 1), u: v(0, 1, 0) }, // left
  { n: v(0, 1, 0), r: v(1, 0, 0), u: v(0, 0, -1) }, // top
  { n: v(0, -1, 0), r: v(1, 0, 0), u: v(0, 0, 1) }, // bottom
];

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uTexture;
  uniform bool uHasTexture;
  uniform vec3 uColor;
  uniform float uRadius;
  uniform float uAspect;
  uniform float uBackShade;
  varying vec2 vUv;

  float roundedBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    if (roundedBox(vUv - 0.5, vec2(0.5), uRadius) > 0.0) discard;

    // Show the whole photo on each tile, cover-fitted to a square.
    vec2 uv = vUv;
    if (uAspect > 1.0) uv.x = (uv.x - 0.5) / uAspect + 0.5;
    else uv.y = (uv.y - 0.5) * uAspect + 0.5;

    vec3 color = uHasTexture ? texture2D(uTexture, uv).rgb : uColor;
    float shade = gl_FrontFacing ? 1.0 : uBackShade;
    gl_FragColor = vec4(color * shade, 1.0);
    #include <colorspace_fragment>
  }
`;

type Tile = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  face: number;
  home: THREE.Vector3;
  homeQuat: THREE.Quaternion;
  normal: THREE.Vector3;
  lift: number;
  // Explosion
  velocity: THREE.Vector3;
  spinAxis: THREE.Vector3;
  spinRate: number;
  phase: number;
  // Rebuild tween
  from: { pos: THREE.Vector3; quat: THREE.Quaternion; delay: number; t: number } | null;
};

type State = "intact" | "exploded" | "rebuilding";

export class PhotoCube {
  private opts: CubeOptions;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  private group = new THREE.Group();
  private controls: OrbitControls;
  private geometry = new THREE.PlaneGeometry(1, 1);
  private core: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private textures: THREE.Texture[] = [];
  private tiles: Tile[] = [];
  private raycaster = new THREE.Raycaster();
  private lastTime = 0;

  private state: State = "intact";
  private finishRebuild: (() => void) | null = null;
  private rebuilding: Promise<void> | null = null;
  private lastRuin = -1;
  private lastEmittedState: State | null = null;

  private pointer: THREE.Vector2 | null = null; // NDC
  private pointerIsTouch = false;
  private press: { x: number; y: number } | null = null;
  private lastTap: { time: number; x: number; y: number } | null = null;
  private hovered: number | null = null; // face index
  private selected: number | null = null;
  private turn: { from: THREE.Quaternion; to: THREE.Quaternion; t: number } | null = null;
  private interacting = false;
  private idleTime = IDLE_RESUME;
  private autoRotate: boolean;

  private cleanup: (() => void)[] = [];

  constructor(
    private container: HTMLElement,
    private items: GalleryItem[],
    options: Partial<CubeOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...options };
    this.autoRotate = !matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera.position.set(1, 0.8, 1).normalize();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.enableZoom = false;
    this.controls.rotateSpeed = 0.7;

    // Dark body inside the tiles, like the plastic of a Rubik's cube. It hides
    // the backs of the far tiles through the gaps, and shrinks away on explode.
    const coreSize = 3 * (1 + this.opts.gap) - 0.04;
    this.core = new THREE.Mesh(
      new THREE.BoxGeometry(coreSize, coreSize, coreSize),
      new THREE.MeshBasicMaterial({ color: this.opts.coreColor }),
    );
    this.group.add(this.core);

    this.scene.add(this.group);
    this.buildTiles();
    this.resize();
    this.bindEvents();
    // Start with the photos already scattered, ready to be rebuilt.
    this.explode();
    for (let step = 0; step < 120; step++) {
      for (const tile of this.tiles) this.float(tile, 1 / 60, step / 60);
    }
    this.core.scale.setScalar(0.0001);
    this.core.visible = false;
    this.renderer.setAnimationLoop(this.frame);
  }

  destroy() {
    this.renderer.setAnimationLoop(null);
    this.cleanup.forEach((fn) => fn());
    this.controls.dispose();
    this.geometry.dispose();
    this.core.geometry.dispose();
    this.core.material.dispose();
    this.tiles.forEach((t) => t.mesh.material.dispose());
    this.textures.forEach((t) => t.dispose());
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // 1 while exploded; during a rebuild, the share of tiles not yet home
  get ruinLevel() {
    if (this.state === "exploded") return 1;
    if (this.state === "rebuilding") {
      return this.tiles.filter((t) => !t.from || t.from.t < 1).length / this.tiles.length;
    }
    return 0;
  }

  // Blow the cube apart into floating, spinning tiles
  explode() {
    if (this.state !== "intact") return;
    this.state = "exploded";
    this.select(null);
    for (const tile of this.tiles) {
      const dir = tile.home
        .clone()
        .normalize()
        .add(randomUnit().multiplyScalar(0.5))
        .normalize();
      tile.velocity.copy(dir).multiplyScalar(lerp(BURST_MIN, BURST_MAX, Math.random()));
      tile.spinAxis.copy(randomUnit());
      tile.spinRate = lerp(SPIN_MIN, SPIN_MAX, Math.random());
      tile.phase = Math.random() * Math.PI * 2;
    }
  }

  // Pull every tile back home. Resolves once the last one lands.
  rebuild(): Promise<void> {
    if (this.rebuilding) return this.rebuilding;
    if (this.state !== "exploded") return Promise.resolve();
    this.state = "rebuilding";
    for (const tile of this.tiles) {
      tile.from = {
        pos: tile.mesh.position.clone(),
        quat: tile.mesh.quaternion.clone(),
        delay: Math.random() * REBUILD_STAGGER,
        t: 0,
      };
    }
    this.rebuilding = new Promise((resolve) => (this.finishRebuild = resolve));
    return this.rebuilding;
  }

  // Select a face (turning it toward the viewer), or clear the selection
  select(tile: number | null) {
    const face = tile === null ? null : Math.floor(tile / 9);
    if (tile === this.selected) return;
    this.selected = tile;
    if (face !== null && this.state === "intact") {
      this.turn = { from: this.group.quaternion.clone(), to: this.faceTowardCamera(face), t: 0 };
    }
    this.idleTime = 0;
    this.container.dispatchEvent(
      new CustomEvent("cube:select", { detail: { index: tile === null ? null : tile % this.items.length }, bubbles: true }),
    );
  }

  // --- Setup ------------------------------------------------------------------

  private buildTiles() {
    const loader = new THREE.TextureLoader();
    const itemMaterials: THREE.ShaderMaterial[][] = this.items.map(() => []);

    FACES.forEach(({ n, r, u }, face) => {
      const homeQuat = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(r, u, n),
      );
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const material = new THREE.ShaderMaterial({
            uniforms: {
              uTexture: { value: null },
              uHasTexture: { value: false },
              uColor: { value: new THREE.Color(this.opts.emptyColor) },
              uRadius: { value: this.opts.cornerRadius },
              uAspect: { value: 1 },
              uBackShade: { value: this.opts.backShade },
            },
            vertexShader,
            fragmentShader,
            side: THREE.DoubleSide,
          });
          const tileIndex = face * 9 + row * 3 + col;
          itemMaterials[tileIndex % this.items.length]?.push(material);

          const home = n
            .clone()
            .multiplyScalar(1.5)
            .addScaledVector(r, col - 1)
            .addScaledVector(u, 1 - row)
            .multiplyScalar(1 + this.opts.gap);
          const mesh = new THREE.Mesh(this.geometry, material);
          mesh.position.copy(home);
          mesh.quaternion.copy(homeQuat);
          mesh.userData.tile = tileIndex;
          this.group.add(mesh);

          this.tiles.push({
            mesh,
            face,
            home,
            homeQuat,
            normal: n.clone(),
            lift: 0,
            velocity: new THREE.Vector3(),
            spinAxis: new THREE.Vector3(0, 1, 0),
            spinRate: 0,
            phase: 0,
            from: null,
          });
        }
      }
    });

    // Load each photo once and share its texture among matching tiles.
    this.items.forEach((item, index) => {
      const texture = loader.load(item.src, (t) => {
        const img = t.image as HTMLImageElement;
        for (const m of itemMaterials[index]) {
          m.uniforms.uAspect.value = img.width / img.height;
          m.uniforms.uHasTexture.value = true;
        }
      });
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      for (const m of itemMaterials[index]) m.uniforms.uTexture.value = texture;
      this.textures.push(texture);
    });
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // Back the camera off until the cube's bounding sphere fills `fit` of the
    // viewport's short side, whichever way it's turned
    const vFov = THREE.MathUtils.degToRad(FOV);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const half = Math.min(vFov, hFov) / 2;
    const distance = CUBE_RADIUS / (Math.tan(half) * this.opts.fit);
    this.camera.position.setLength(distance);
    this.camera.updateProjectionMatrix();
  }

  private bindEvents() {
    const el = this.renderer.domElement;
    const on = (target: EventTarget, type: string, fn: (e: any) => void) => {
      target.addEventListener(type, fn);
      this.cleanup.push(() => target.removeEventListener(type, fn));
    };

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.container);
    this.cleanup.push(() => ro.disconnect());

    const setPointer = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      this.pointer = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.pointerIsTouch = e.pointerType !== "mouse";
    };

    on(el, "pointermove", setPointer);
    on(el, "pointerleave", (e: PointerEvent) => {
      if (e.pointerType === "mouse") this.pointer = null;
    });
    on(el, "pointerdown", (e: PointerEvent) => {
      setPointer(e);
      this.press = { x: e.clientX, y: e.clientY };
    });
    on(el, "pointerup", (e: PointerEvent) => {
      const press = this.press;
      this.press = null;
      if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP) return;
      setPointer(e);
      const face = this.hitTile();

      if (this.pointerIsTouch && face === null) {
        // Touch has no dblclick: detect a double tap on empty space ourselves
        const last = this.lastTap;
        const isDouble =
          last &&
          e.timeStamp - last.time < DOUBLE_TAP_MS &&
          Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_TAP_DIST;
        this.lastTap = isDouble ? null : { time: e.timeStamp, x: e.clientX, y: e.clientY };
        if (isDouble) {
          this.explode();
          return;
        }
      }
      this.select(face);
    });
    on(el, "dblclick", () => {
      if (!this.pointerIsTouch && this.hitTile() === null) this.explode();
    });
    on(window, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape") this.select(null);
    });

    const start = () => {
      this.interacting = true;
      this.turn = null; // the user takes over from a face turn
      el.classList.add("is-dragging");
    };
    const end = () => {
      this.interacting = false;
      this.idleTime = 0;
      el.classList.remove("is-dragging");
    };
    this.controls.addEventListener("start", start);
    this.controls.addEventListener("end", end);
    this.cleanup.push(() => {
      this.controls.removeEventListener("start", start);
      this.controls.removeEventListener("end", end);
    });
  }

  // --- Frame ------------------------------------------------------------------

  private frame = (now: number) => {
    const dt = this.lastTime ? Math.min(0.05, (now - this.lastTime) / 1000) : 0;
    this.lastTime = now;
    const time = now / 1000;

    this.updateRotation(dt);
    this.updateHover();
    for (const tile of this.tiles) {
      if (this.state === "intact") this.placeHome(tile, dt);
      else if (this.state === "exploded") this.float(tile, dt, time);
      else this.returnHome(tile, dt);
    }
    if (this.state === "rebuilding" && this.tiles.every((t) => t.from && t.from.t >= 1)) {
      this.state = "intact";
      this.tiles.forEach((t) => (t.from = null));
      this.rebuilding = null;
      this.finishRebuild?.();
      this.finishRebuild = null;
    }

    // Core is solid when intact, gone when exploded, and fills back in as tiles land
    const coreTarget =
      this.state === "intact" ? 1 : this.state === "rebuilding" ? 1 - this.ruinLevel : 0;
    const scale = this.core.scale.x + (coreTarget - this.core.scale.x) * (1 - Math.exp(-CORE_RATE * dt));
    this.core.scale.setScalar(Math.max(scale, 0.0001));
    this.core.visible = scale > 0.01;

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.emitRuin();
  };

  private updateRotation(dt: number) {
    if (this.turn) {
      this.turn.t = Math.min(1, this.turn.t + dt / FACE_TURN);
      this.group.quaternion.slerpQuaternions(this.turn.from, this.turn.to, easeInOutCubic(this.turn.t));
      if (this.turn.t >= 1) this.turn = null;
      return;
    }
    // Hold still while a face is shown or the user is handling the cube
    if (this.selected !== null || this.interacting) return;
    this.idleTime += dt;
    if (!this.autoRotate || this.idleTime < IDLE_RESUME) return;
    // Ease back in after an interaction
    const ramp = Math.min(1, (this.idleTime - IDLE_RESUME) / 1.5);
    const calm = this.state === "intact" ? 1 : 0.4;
    this.group.rotateOnWorldAxis(Y_AXIS, SPIN_Y * dt * ramp * calm);
    this.group.rotateOnWorldAxis(X_AXIS, SPIN_X * dt * ramp * calm);
  }

  private updateHover() {
    const face = this.state !== "rebuilding" && !this.interacting && !this.pointerIsTouch
      ? this.hitTile()
      : null;
    this.hovered = face === null ? null : Math.floor(face / 9);
    let bounds: { x: number; y: number; width: number; height: number } | null = null;
    if (face !== null) {
      const mesh = this.tiles[face].mesh;
      mesh.updateWorldMatrix(true, false);
      const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, y]) => {
        const point = mesh.localToWorld(new THREE.Vector3(x, y, 0)).project(this.camera);
        return { x: (point.x + 1) * this.container.clientWidth / 2,
          y: (1 - point.y) * this.container.clientHeight / 2 };
      });
      const x = Math.min(...corners.map((p) => p.x));
      const y = Math.min(...corners.map((p) => p.y));
      bounds = { x, y, width: Math.max(...corners.map((p) => p.x)) - x,
        height: Math.max(...corners.map((p) => p.y)) - y };
    }
    this.container.dispatchEvent(new CustomEvent("cube:hover", {
      bubbles: true,
      detail: {
        bounds,
        index: face === null || this.selected !== null ? null : face % this.items.length,
        x: ((this.pointer?.x ?? 0) + 1) * this.container.clientWidth / 2,
        y: (1 - (this.pointer?.y ?? 0)) * this.container.clientHeight / 2,
      },
    }));
    // Falls back to the stylesheet's grab / grabbing cursors
    this.renderer.domElement.style.cursor = !this.interacting && face !== null ? "pointer" : "";
  }

  private hitTile(): number | null {
    if (!this.pointer) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.tiles.map((t) => t.mesh), false)[0];
    return hit ? (hit.object.userData.tile as number) : null;
  }

  private placeHome(tile: Tile, dt: number) {
    const raised = tile.face === this.hovered || (this.selected !== null && tile.face === Math.floor(this.selected / 9));
    const target = raised ? this.opts.lift : 0;
    tile.lift += (target - tile.lift) * (1 - Math.exp(-LIFT_RATE * dt));
    tile.mesh.position.copy(tile.home).addScaledVector(tile.normal, tile.lift);
    tile.mesh.quaternion.copy(tile.homeQuat);
  }

  private float(tile: Tile, dt: number, time: number) {
    const { mesh, velocity } = tile;
    velocity.multiplyScalar(Math.exp(-BURST_DAMPING * dt));
    // Soft limit so the debris stays mostly in frame
    const dist = mesh.position.length();
    if (dist > DEBRIS_RADIUS) {
      velocity.addScaledVector(mesh.position, (-(dist - DEBRIS_RADIUS) / dist) * 2 * dt);
    }
    mesh.position.addScaledVector(velocity, dt);
    mesh.position.y += Math.sin(time * 1.3 + tile.phase) * 0.12 * dt; // gentle bob
    tile.spinRate = Math.max(FLOAT_SPIN, tile.spinRate * Math.exp(-0.6 * dt));
    mesh.rotateOnAxis(tile.spinAxis, tile.spinRate * dt);
  }

  private returnHome(tile: Tile, dt: number) {
    const from = tile.from;
    if (!from) return;
    if (from.delay > 0) {
      from.delay -= dt;
      return;
    }
    from.t = Math.min(1, from.t + dt / REBUILD_DURATION);
    const e = easeInOutCubic(from.t);
    tile.lift = 0;
    tile.mesh.position.lerpVectors(from.pos, tile.home, e);
    tile.mesh.quaternion.slerpQuaternions(from.quat, tile.homeQuat, e);
  }

  // Group rotation that points `face` at the camera with its image upright on screen
  private faceTowardCamera(face: number) {
    const { n, r, u } = FACES[face];
    const local = new THREE.Matrix4().makeBasis(r, u, n);
    const toCamera = this.camera.position.clone().sub(this.controls.target).normalize();
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const up = screenUp.addScaledVector(toCamera, -screenUp.dot(toCamera)).normalize();
    const right = new THREE.Vector3().crossVectors(up, toCamera);
    const world = new THREE.Matrix4().makeBasis(right, up, toCamera);
    const qLocal = new THREE.Quaternion().setFromRotationMatrix(local);
    const qWorld = new THREE.Quaternion().setFromRotationMatrix(world);
    return qWorld.multiply(qLocal.invert());
  }

  private emitRuin() {
    const level = this.ruinLevel;
    if (Math.abs(level - this.lastRuin) < 1e-4 && this.state === this.lastEmittedState) return;
    this.lastRuin = level;
    this.lastEmittedState = this.state;
    this.container.dispatchEvent(
      new CustomEvent("gallery:ruin", { detail: { level, state: this.state }, bubbles: true }),
    );
  }
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function v(x: number, y: number, z: number) {
  return new THREE.Vector3(x, y, z);
}

function randomUnit() {
  return new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1)
    .normalize();
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
