import * as THREE from "three";
import { makeActor, setActorTemplate, upgradeActor, type ActorVisual } from "@/game/actors";
import { applyCityModels, loadModels } from "@/game/models";
import { GameAudio } from "@/game/audio";
import type { HudSnapshot } from "@/game/types";
import { WEAPONS, createGuns } from "@/game/weapons";
import { buildCity, losClear, nearestBox, raySphere, resolveCircle, type Box3, type Medkit, type NavNode } from "@/game/world";

type Mode = HudSnapshot["mode"];

type Npc = ActorVisual & {
  id: number;
  kind: "hostile" | "civil";
  x: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  state: "patrol" | "chase" | "attack" | "flee" | "dead";
  node: number;
  prev: number;
  see: number;
  cd: number;
  phase: number;
  deadT: number;
  flash: number;
};

const STEP = 1 / 60;
const SPAWN = { x: 0, z: 36 };

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function approach(cur: number, goal: number, delta: number) {
  if (cur < goal) return Math.min(goal, cur + delta);
  return Math.max(goal, cur - delta);
}

function wrapPi(v: number) {
  let n = v;
  while (n > Math.PI) n -= Math.PI * 2;
  while (n < -Math.PI) n += Math.PI * 2;
  return n;
}

function norm3(x: number, y: number, z: number) {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

function aimBasis(yaw: number, pitch: number) {
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const fx = -Math.sin(yaw) * cp;
  const fy = sp;
  const fz = -Math.cos(yaw) * cp;
  const right = norm3(-fz, 0, fx);
  const ux = right.y * fz - right.z * fy;
  const uy = right.z * fx - right.x * fz;
  const uz = right.x * fy - right.y * fx;
  return { fx, fy, fz, rx: right.x, ry: right.y, rz: right.z, ux, uy, uz };
}

type Probe = {
  getYaw: () => number;
  getSpeed: () => number;
  getPos: () => { x: number; z: number };
  setKeys: (codes: string[]) => void;
  setRide: (on: boolean) => void;
};

declare global {
  interface Window {
    __controlsTest?: Probe;
  }
}

export class PortGame {
  readonly audio = new GameAudio();
  private readonly canvas: HTMLCanvasElement;
  private readonly onHud: (hud: HudSnapshot) => void;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly viewScene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly viewCamera: THREE.PerspectiveCamera;
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly colliders: Box3[];
  private readonly los: Box3[];
  private readonly nav: NavNode[];
  private readonly medkits: Medkit[];
  private readonly rain: THREE.BufferAttribute;
  private readonly guns: THREE.Group[];
  private readonly flashes: THREE.Mesh[];
  private readonly gunRoot: THREE.Group;
  private readonly muzzleLight: THREE.PointLight;
  private readonly ac = new AbortController();
  private readonly ro: ResizeObserver;
  private readonly npcs: Npc[] = [];
  private readonly liveKeys = new Set<string>();
  private probe: Probe;

  private raf = 0;
  private last = 0;
  private acc = 0;
  private hudAcc = 0;
  private emitSoon = false;
  private attr = 0.4;
  private clock = 0;
  private mode: Mode = "menu";
  private x = SPAWN.x;
  private z = SPAWN.z;
  private vx = 0;
  private vz = 0;
  private yaw = 0;
  private pitch = 0;
  private bob = 0;
  private stepT = 0.2;
  private health = 100;
  private score = 0;
  private best = 0;
  private wave = 1;
  private weaponIndex = 0;
  private mags = WEAPONS.map((w) => w.mag);
  private reserves = WEAPONS.map((w) => w.reserve);
  private reloading = 0;
  private reloadDur = 1;
  private cooldown = 0;
  private bloom = 0;
  private visualRecoil = 0;
  private shake = 0;
  private shakeT = 0;
  private muzzle = 0;
  private invuln = 0;
  private damageFlash = 0;
  private hitMarker = 0;
  private message = "";
  private msgT = 0;
  private cleared = false;
  private between = 0;
  private civilSpawned = 0;
  private nextId = 1;
  private mouseFire = false;
  private touchFire = false;
  private tapFire = false;
  private heldWas = false;
  private touchX = 0;
  private touchY = 0;
  private pedalGas = false;
  private pedalBrake = false;
  private forcedKeys: Set<string> | null = null;
  private locked = false;
  private dragging = false;
  private dragX = 0;
  private dragY = 0;
  private dragMoved = 0;
  private lookDx = 0;
  private lookDy = 0;
  private swayX = 0;
  private swayY = 0;
  private dead = false;
  private readonly coarse: boolean;
  private riding = false;
  private carX = 0;
  private carZ = 22;
  private carYaw = 0;
  private carSpeed = 0;
  private carSpin = 0;
  private readonly car: THREE.Group;
  private readonly carWheels: THREE.Mesh[] = [];

  constructor(canvas: HTMLCanvasElement, hooks: { onHud: (hud: HudSnapshot) => void }) {
    this.canvas = canvas;
    this.onHud = hooks.onHud;
    this.coarse = window.matchMedia("(pointer: coarse)").matches;
    try {
      this.best = Number(localStorage.getItem("port-cendre-best") || 0) || 0;
    } catch {
      this.best = 0;
    }

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x10151c, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

    this.camera = new THREE.PerspectiveCamera(78, 1, 0.08, 180);
    this.viewCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 8);
    this.viewScene.add(this.viewCamera);
    const viewKey = new THREE.DirectionalLight(0xfff2df, 2.4);
    viewKey.position.set(0.6, 1.4, 1);
    this.viewScene.add(viewKey);
    this.viewScene.add(new THREE.AmbientLight(0x9eb0c2, 0.55));
    const guns = createGuns();
    this.gunRoot = guns.root;
    this.guns = guns.guns;
    this.flashes = guns.flashes;
    this.viewCamera.add(this.gunRoot);
    this.muzzleLight = new THREE.PointLight(0xffe2b0, 0, 3, 2);
    this.gunRoot.add(this.muzzleLight);

    const city = buildCity(this.scene, this.renderer);
    this.colliders = city.colliders;
    this.los = city.los;
    this.nav = city.nav;
    this.medkits = city.medkits;
    this.rain = city.rain;
    this.car = this.buildCar();
    this.scene.add(this.car);
    this.placeCar();
    void loadModels()
      .then((kit) => {
        if (this.dead) return;
        applyCityModels(this.scene, kit);
        const sports = kit.cars["sedan-sports"];
        if (sports) this.mountDriveCar(sports);
        if (kit.actor) {
          setActorTemplate(kit.actor, kit.clips);
          for (const npc of this.npcs) upgradeActor(npc, npc.kind);
        }
      })
      .catch((err) => console.warn("modèles 3D", err));

    const signal = this.ac.signal;
    window.addEventListener("keydown", this.onKeyDown, { signal });
    window.addEventListener("keyup", this.onKeyUp, { signal });
    window.addEventListener("blur", this.onBlur, { signal });
    document.addEventListener("pointerlockchange", this.onLock, { signal });
    window.addEventListener("mousemove", this.onMouseMove, { signal });
    window.addEventListener("mousedown", this.onMouseDown, { signal });
    window.addEventListener("mouseup", this.onMouseUp, { signal });
    canvas.addEventListener("pointerdown", this.onPointerDown, { signal });
    canvas.addEventListener("pointermove", this.onPointerMove, { signal });
    window.addEventListener("pointerup", this.onPointerUp, { signal });
    canvas.addEventListener("contextmenu", (event) => event.preventDefault(), { signal });

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();

    this.probe = {
      getYaw: () => this.yaw,
      getSpeed: () => Math.hypot(this.vx, this.vz),
      getPos: () => ({ x: this.x, z: this.z }),
      setKeys: (codes) => {
        this.forcedKeys = codes.length ? new Set(codes) : null;
      },
      setRide: (on) => this.forceRide(on),
    };
    window.__controlsTest = this.probe;

    this.pushHud();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.ac.abort();
    this.ro.disconnect();
    if (window.__controlsTest === this.probe) delete window.__controlsTest;
    this.audio.destroy();
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    const collect = (obj: THREE.Object3D) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry && !mesh.geometry.userData.shared) geos.add(mesh.geometry);
      const material = mesh.material;
      const list = Array.isArray(material) ? material : material ? [material] : [];
      for (const mat of list) {
        if (!mat.userData.shared) mats.add(mat);
      }
    };
    this.scene.traverse(collect);
    this.viewScene.traverse(collect);
    for (const geo of geos) geo.dispose();
    for (const mat of mats) {
      const standard = mat as THREE.MeshStandardMaterial;
      if (standard.map && standard.map !== standard.emissiveMap) standard.map.dispose();
      standard.emissiveMap?.dispose();
      mat.dispose();
    }
    this.renderer.dispose();
  }

  start() {
    this.audio.unlock();
    this.resetSim();
    this.mode = "play";
    this.message = "Berline ambre. A gauche, D droite. F pour descendre.";
    this.msgT = 2.8;
    this.pushHud();
  }

  pause() {
    if (this.mode !== "play") return;
    this.mode = "pause";
    this.mouseFire = false;
    this.touchFire = false;
    this.pedalGas = false;
    this.pedalBrake = false;
    this.emitSoon = true;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.pushHud();
  }

  resume() {
    if (this.mode !== "pause") return;
    this.mode = "play";
    this.tryLock();
    this.pushHud();
  }

  tryLock() {
    if (this.usesHandset()) return;
    const lock = this.canvas.requestPointerLock.bind(this.canvas) as (opts?: { unadjustedMovement?: boolean }) => void | Promise<void>;
    try {
      const pending = lock({ unadjustedMovement: true });
      if (pending && typeof (pending as Promise<void>).then === "function") {
        void (pending as Promise<void>).catch(() => {
          try {
            this.canvas.requestPointerLock();
          } catch {
            /* iframe or mobile */
          }
        });
      }
    } catch {
      try {
        this.canvas.requestPointerLock();
      } catch {
        /* no pointer lock */
      }
    }
  }

  toggleMute() {
    this.audio.unlock();
    this.audio.setMuted(!this.audio.muted);
    this.pushHud();
  }

  setFire(held: boolean) {
    this.touchFire = held;
  }

  setPedal(which: "gas" | "brake", held: boolean) {
    if (which === "gas") this.pedalGas = held;
    else this.pedalBrake = held;
  }

  setTouchMove(x: number, y: number) {
    this.touchX = x;
    this.touchY = y;
  }

  addLook(dx: number, dy: number) {
    const sens = this.usesHandset() ? 0.0052 : 0.00215;
    this.yaw -= dx * sens;
    this.pitch = clamp(this.pitch - dy * sens, -1.35, 1.35);
    this.lookDx += dx;
    this.lookDy += dy;
  }

  requestReload() {
    if (this.mode === "play") this.startReload();
  }

  cycleWeapon() {
    if (this.mode !== "play" || this.riding) return;
    this.switchTo((this.weaponIndex + 1) % WEAPONS.length);
  }

  toggleVehicle() {
    if (this.mode !== "play") return;
    if (this.riding) this.exitCar();
    else this.enterCar(false);
  }

  private forceRide(on: boolean) {
    if (this.mode !== "play") this.start();
    if (on) {
      this.riding = true;
      this.x = this.carX;
      this.z = this.carZ;
      this.yaw = this.carYaw;
      this.vx = 0;
      this.vz = 0;
    } else if (this.riding) this.exitCar();
  }

  private enterCar(force: boolean) {
    const dist = Math.hypot(this.x - this.carX, this.z - this.carZ);
    if (!force && dist > 3.4) {
      this.message = "Trop loin de la berline";
      this.msgT = 1.1;
      this.emitSoon = true;
      return;
    }
    this.riding = true;
    this.carSpeed = 0;
    this.x = this.carX;
    this.z = this.carZ;
    this.yaw = this.carYaw;
    this.vx = 0;
    this.vz = 0;
    this.pitch = 0;
    this.message = "F pour descendre";
    this.msgT = 1.4;
    this.emitSoon = true;
  }

  private exitCar() {
    const rx = Math.cos(this.carYaw);
    const rz = -Math.sin(this.carYaw);
    this.riding = false;
    this.carSpeed = 0;
    this.x = clamp(this.carX + rx * 2.5, -47.2, 47.2);
    this.z = clamp(this.carZ + rz * 2.5, -47.2, 47.2);
    this.yaw = this.carYaw;
    this.pitch = 0;
    this.vx = 0;
    this.vz = 0;
    this.message = "À pied. F près de la voiture pour remonter.";
    this.msgT = 1.6;
    this.emitSoon = true;
    this.placeCar();
  }

  private buildCar() {
    const group = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ color: 0x8c2f24, metalness: 0.55, roughness: 0.32 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x14181e, metalness: 0.4, roughness: 0.45 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0xb7d4e2,
      metalness: 0.15,
      roughness: 0.05,
      transparent: true,
      opacity: 0.55,
    });
    const lamp = new THREE.MeshStandardMaterial({ color: 0xfff1d2, emissive: 0xffe2a8, emissiveIntensity: 0.8, roughness: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.46, 4.25), paint);
    body.position.y = 0.58;
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.16, 4.05), dark);
    skirt.position.y = 0.32;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.42, 1.7), glass);
    cabin.position.set(0, 0.98, -0.25);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.1, 0.28), lamp);
    nose.position.set(0, 0.62, 2.05);
    group.add(body, skirt, cabin, nose);
    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.24, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const rubber = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.92 });
    for (const [x, z] of [
      [-0.92, 1.35],
      [0.92, 1.35],
      [-0.92, -1.35],
      [0.92, -1.35],
    ] as const) {
      const wheel = new THREE.Mesh(wheelGeo, rubber);
      wheel.position.set(x, 0.32, z);
      group.add(wheel);
      this.carWheels.push(wheel);
    }
    return group;
  }

  private placeCar() {
    this.car.position.set(this.carX, 0, this.carZ);
    const fx = -Math.sin(this.carYaw);
    const fz = -Math.cos(this.carYaw);
    this.car.lookAt(this.carX + fx, 0, this.carZ + fz);
    for (const wheel of this.carWheels) {
      if (!wheel.userData.spin) wheel.rotation.x = this.carSpin;
    }
  }

  private mountDriveCar(template: THREE.Object3D) {
    this.car.clear();
    this.carWheels.length = 0;
    const model = template.clone(true);
    const measured = new THREE.Box3().setFromObject(template);
    const size = measured.getSize(new THREE.Vector3());
    const scale = 4.15 / Math.max(size.z, size.x, 0.01);
    model.scale.setScalar(scale);
    model.rotation.y = Math.PI;
    model.position.y = -measured.min.y * scale;
    this.car.add(model);
    model.traverse((obj) => {
      if (!obj.name.toLowerCase().includes("wheel")) return;
      obj.userData.spin = true;
      this.carWheels.push(obj as THREE.Mesh);
    });
    this.placeCar();
  }

  private simDrive(dt: number, down: (code: string) => boolean) {
    let throttle = (down("KeyW") || down("ArrowUp") ? 1 : 0) - (down("KeyS") || down("ArrowDown") ? 1 : 0);
    let steer = 0;
    if (down("KeyA") || down("ArrowLeft")) steer += 1;
    if (down("KeyD") || down("ArrowRight")) steer -= 1;
    if (!this.forcedKeys) {
      throttle = clamp(throttle + this.touchY, -1, 1);
      steer = clamp(steer - this.touchX, -1, 1);
      if (this.pedalGas) throttle = Math.max(throttle, 1);
      if (this.pedalBrake) throttle = Math.min(throttle, -1);
    }
    const drive = clamp(throttle, -1, 1);
    if (drive > 0.05) this.carSpeed = approach(this.carSpeed, 14, 16 * dt);
    else if (drive < -0.05) this.carSpeed = approach(this.carSpeed, -6, 20 * dt);
    else this.carSpeed = approach(this.carSpeed, 0, 9 * dt);

    const speedFactor = clamp(Math.abs(this.carSpeed) / 6, 0.25, 1);
    const reverse = this.carSpeed >= 0 ? 1 : -1;
    this.carYaw += steer * 2.15 * speedFactor * reverse * dt;

    const fx = -Math.sin(this.carYaw);
    const fz = -Math.cos(this.carYaw);
    const nextX = this.carX + fx * this.carSpeed * dt;
    const nextZ = this.carZ + fz * this.carSpeed * dt;
    const solved = resolveCircle(nextX, nextZ, 1.15, this.colliders);
    if (Math.hypot(solved.x - nextX, solved.z - nextZ) > 0.03) this.carSpeed *= -0.3;
    this.carX = clamp(solved.x, -46.5, 46.5);
    this.carZ = clamp(solved.z, -46.5, 46.5);
    this.x = this.carX;
    this.z = this.carZ;
    this.yaw = this.carYaw;
    this.pitch = approach(this.pitch, 0, dt * 5);
    this.vx = fx * this.carSpeed;
    this.vz = fz * this.carSpeed;
    this.carSpin += this.carSpeed * dt * 1.6;
    for (const wheel of this.carWheels) {
      if (wheel.userData.spin) wheel.rotateX(this.carSpeed * dt * 1.6);
    }
    this.placeCar();

    if (Math.abs(this.carSpeed) > 6) {
      for (const npc of this.npcs) {
        if (npc.state === "dead" || npc.flash > 0.2) continue;
        if (Math.hypot(npc.x - this.carX, npc.z - this.carZ) < 1.75) this.damageNpc(npc, 45, true);
      }
    }
  }

  private resetSim() {
    for (const npc of this.npcs) this.scene.remove(npc.group);
    this.npcs.length = 0;
    this.civilSpawned = 0;
    this.x = SPAWN.x;
    this.z = SPAWN.z;
    this.vx = 0;
    this.vz = 0;
    this.yaw = 0;
    this.pitch = 0;
    this.health = 100;
    this.score = 0;
    this.wave = 1;
    this.weaponIndex = 0;
    this.mags = WEAPONS.map((w) => w.mag);
    this.reserves = WEAPONS.map((w) => w.reserve);
    this.reloading = 0;
    this.cooldown = 0;
    this.bloom = 0;
    this.visualRecoil = 0;
    this.shake = 0;
    this.muzzle = 0;
    this.invuln = 1.6;
    this.damageFlash = 0;
    this.hitMarker = 0;
    this.cleared = false;
    this.between = 0;
    this.mouseFire = false;
    this.touchFire = false;
    this.tapFire = false;
    this.carX = 0;
    this.carZ = 22;
    this.carYaw = 0;
    this.carSpeed = 0;
    this.carSpin = 0;
    this.riding = true;
    this.x = this.carX;
    this.z = this.carZ;
    this.yaw = this.carYaw;
    this.placeCar();
    for (const kit of this.medkits) {
      kit.ready = true;
      kit.timer = 0;
      kit.mesh.visible = true;
    }
    this.spawnWave();
  }

  private spawnWave() {
    const count = Math.min(10, 3 + this.wave);
    for (let i = 0; i < count; i++) this.spawnOne("hostile");
    while (this.alive("civil") < 3 && this.civilSpawned < 7) this.spawnOne("civil");
  }

  private spawnOne(kind: "hostile" | "civil") {
    const node = this.randomNode(kind === "hostile" ? 16 : 10);
    const spot = this.nav[node] ?? { x: 8, z: -8, links: [] };
    const visual = makeActor(kind);
    const npc: Npc = {
      ...visual,
      id: this.nextId++,
      kind,
      x: spot.x,
      z: spot.z,
      yaw: Math.random() * Math.PI * 2,
      hp: kind === "hostile" ? 100 : 55,
      maxHp: kind === "hostile" ? 100 : 55,
      state: "patrol",
      node,
      prev: node,
      see: 0,
      cd: 0.5 + Math.random() * 0.8,
      phase: Math.random() * 6,
      deadT: 0,
      flash: 0,
    };
    npc.group.position.set(npc.x, 0, npc.z);
    this.scene.add(npc.group);
    this.npcs.push(npc);
    if (kind === "civil") this.civilSpawned += 1;
  }

  private randomNode(minDist: number) {
    let pick = (Math.random() * this.nav.length) | 0;
    for (let k = 0; k < 24; k++) {
      const i = (Math.random() * this.nav.length) | 0;
      const node = this.nav[i];
      if (!node) break;
      if (Math.hypot(node.x - this.x, node.z - this.z) >= minDist) return i;
      pick = i;
    }
    return pick;
  }

  private alive(kind?: Npc["kind"]) {
    let n = 0;
    for (const npc of this.npcs) {
      if (npc.state === "dead") continue;
      if (!kind || npc.kind === kind) n += 1;
    }
    return n;
  }

  private frame = (now: number) => {
    if (this.dead) return;
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.05) dt = 0.05;
    if (dt < 0) dt = 0;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 5) {
      this.simulate(STEP);
      this.acc -= STEP;
      steps += 1;
    }
    this.renderFrame(dt);
    this.raf = requestAnimationFrame(this.frame);
  };

  private simulate(dt: number) {
    this.visualRecoil *= Math.exp(-dt * 9);
    this.shake *= Math.exp(-dt * 8);
    this.muzzle = Math.max(0, this.muzzle - dt);
    this.hitMarker = Math.max(0, this.hitMarker - dt * 3.4);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.4);
    this.bloom = Math.max(0, this.bloom - dt * 1.5);
    if (this.msgT > 0) {
      this.msgT -= dt;
      if (this.msgT <= 0) this.message = "";
    }
    if (this.mode === "play") this.simPlay(dt);
    this.hudAcc += dt;
    if (this.emitSoon || this.hudAcc >= 0.08) {
      this.hudAcc = 0;
      this.emitSoon = false;
      this.pushHud();
    }
  }

  private simPlay(dt: number) {
    this.invuln = Math.max(0, this.invuln - dt);
    const down = (code: string) => (this.forcedKeys ? this.forcedKeys.has(code) : this.liveKeys.has(code));
    if (this.riding) {
      this.simDrive(dt, down);
    } else {
      let forward = (down("KeyW") || down("ArrowUp") ? 1 : 0) - (down("KeyS") || down("ArrowDown") ? 1 : 0);
      let strafe = (down("KeyD") || down("ArrowRight") ? 1 : 0) - (down("KeyA") || down("ArrowLeft") ? 1 : 0);
      if (!this.forcedKeys) {
        forward = clamp(forward + this.touchY, -1, 1);
        strafe = clamp(strafe + this.touchX, -1, 1);
      }
      const sprint =
        !this.forcedKeys &&
        (down("ShiftLeft") || down("ShiftRight") || Math.hypot(this.touchX, this.touchY) > 0.9);
      const fx = -Math.sin(this.yaw);
      const fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      let wx = fx * forward + rx * strafe;
      let wz = fz * forward + rz * strafe;
      const wish = Math.hypot(wx, wz);
      if (wish > 1e-4) {
        wx /= wish;
        wz /= wish;
      }
      const top = wish > 1e-4 ? (sprint ? 7.5 : 4.55) : 0;
      const accel = top > 0 ? 24 : 18;
      this.vx = approach(this.vx, wx * top, accel * dt);
      this.vz = approach(this.vz, wz * top, accel * dt);
      this.x += this.vx * dt;
      this.z += this.vz * dt;
      const solved = resolveCircle(this.x, this.z, 0.42, this.colliders);
      this.x = clamp(solved.x, -47.2, 47.2);
      this.z = clamp(solved.z, -47.2, 47.2);
      const speed = Math.hypot(this.vx, this.vz);
      if (speed > 1.4) {
        this.bob += dt * speed * 2.15;
        this.stepT -= dt;
        if (this.stepT <= 0) {
          this.stepT = sprint ? 0.32 : 0.46;
          this.audio.step();
        }
      }
    }

    const held = this.mouseFire || this.touchFire;
    const edge = this.tapFire || (held && !this.heldWas);
    this.heldWas = held;
    this.tapFire = false;
    const weapon = WEAPONS[this.weaponIndex];
    if (!this.riding) {
      if (this.reloading > 0) {
        this.reloading -= dt;
        if (this.reloading <= 0) {
          const need = weapon.mag - this.mags[this.weaponIndex];
          const take = Math.min(need, this.reserves[this.weaponIndex]);
          this.mags[this.weaponIndex] += take;
          this.reserves[this.weaponIndex] -= take;
          this.reloading = 0;
        }
      } else if (weapon.auto ? held || edge : edge) {
        this.tryFire(edge);
      }
    }
    this.cooldown = Math.max(0, this.cooldown - dt);

    for (const kit of this.medkits) {
      if (!kit.ready) {
        kit.timer -= dt;
        if (kit.timer <= 0) {
          kit.ready = true;
          kit.mesh.visible = true;
        }
        continue;
      }
      if (this.health < 100 && Math.hypot(kit.x - this.x, kit.z - this.z) < 1.35) {
        this.health = Math.min(100, this.health + 40);
        kit.ready = false;
        kit.timer = 18;
        kit.mesh.visible = false;
        this.audio.pickup();
        this.message = "Trousse +40";
        this.msgT = 1.3;
        this.emitSoon = true;
      }
    }

    for (const npc of this.npcs) this.tickNpc(npc, dt);
    this.separate();
    for (const npc of this.npcs) {
      if (npc.state === "dead") {
        const k = Math.min(1, npc.deadT / 0.45);
        npc.group.position.set(npc.x, -0.22 * k, npc.z);
        npc.group.rotation.order = "YXZ";
        npc.group.rotation.y = npc.yaw + Math.PI;
        npc.group.rotation.x = k * 1.2;
        npc.bar.visible = false;
        continue;
      }
      const placed = resolveCircle(npc.x, npc.z, 0.36, this.colliders);
      npc.x = placed.x;
      npc.z = placed.z;
      npc.group.position.set(npc.x, 0, npc.z);
      npc.group.rotation.order = "YXZ";
      npc.group.rotation.y = npc.yaw + Math.PI;
      npc.group.rotation.x = 0;
      if (npc.kind === "hostile") npc.bar.scale.x = clamp(npc.hp / npc.maxHp, 0.05, 1);
      const moving = npc.state === "patrol" || npc.state === "chase" || npc.state === "flee";
      if (npc.mixer) {
        const gait = moving && npc.run ? "run" : "idle";
        if (npc.gait !== gait) {
          const prev = npc.gait === "run" ? npc.run : npc.idle;
          const next = gait === "run" ? npc.run : npc.idle;
          prev?.fadeOut(0.12);
          next?.reset().fadeIn(0.12).play();
          npc.gait = gait;
        }
        npc.mixer.update(dt);
      } else {
        const swing = Math.sin(npc.phase) * (moving ? 0.75 : 0.12);
        npc.legs[0].rotation.x = swing;
        npc.legs[1].rotation.x = -swing;
        npc.arms[0].rotation.x = -swing * 0.55;
        npc.arms[1].rotation.x = swing * 0.45;
      }
      npc.cloth.emissiveIntensity = npc.flash;
      npc.flash = Math.max(0, npc.flash - dt * 3.2);
    }
    this.checkWave(dt);
  }

  private tryFire(edge: boolean) {
    const index = this.weaponIndex;
    const weapon = WEAPONS[index];
    if (this.cooldown > 0) return;
    if (this.mags[index] <= 0) {
      if (edge) {
        this.audio.empty();
        if (this.reserves[index] > 0) this.startReload();
      }
      return;
    }
    this.cooldown = 60 / weapon.rpm;
    this.mags[index] -= 1;
    this.bloom = Math.min(1, this.bloom + (weapon.auto ? 0.16 : 0.28));
    this.pitch = clamp(this.pitch + weapon.recoil * 0.55, -1.35, 1.35);
    this.yaw += (Math.random() - 0.5) * weapon.recoil * 0.45;
    this.visualRecoil = Math.min(0.14, this.visualRecoil + weapon.recoil);
    this.shake = Math.min(0.045, this.shake + weapon.recoil * 0.7);
    this.muzzle = 0.045;
    this.audio.gun(weapon.id);
    this.alert(34);

    const basis = aimBasis(this.yaw, this.pitch);
    const spread = weapon.spread * (1 + this.bloom * (weapon.auto ? 1.6 : 0.4));
    for (let p = 0; p < weapon.pellets; p++) {
      const su = (Math.random() - 0.5) * spread * 2;
      const sv = (Math.random() - 0.5) * spread * 2;
      const dir = norm3(basis.fx + basis.rx * su + basis.ux * sv, basis.fy + basis.ry * su + basis.uy * sv, basis.fz + basis.rz * su + basis.uz * sv);
      this.castShot(this.x + dir.x * 0.35, 1.6 + dir.y * 0.35, this.z + dir.z * 0.35, dir.x, dir.y, dir.z, null, true, weapon.damage);
    }
    if (this.mags[index] === 0 && this.reserves[index] > 0) this.startReload();
  }

  private castShot(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    ignore: number | null,
    byPlayer: boolean,
    damage: number,
  ) {
    const range = 75;
    let wallT = nearestBox(ox, oy, oz, dx, dy, dz, this.colliders, range);
    if (dy < -1e-4) {
      const groundT = (0 - oy) / dy;
      if (groundT > 0.02 && groundT < range && (wallT === null || groundT < wallT)) wallT = groundT;
    }
    const npcHit = this.rayNpcs(ox, oy, oz, dx, dy, dz, wallT ?? range, ignore);
    const hitNpc = npcHit && (wallT === null || npcHit.t < wallT) ? npcHit : null;
    const endT = hitNpc ? hitNpc.t : (wallT ?? 18);
    this.spawnTracer(ox, oy, oz, ox + dx * endT, oy + dy * endT, oz + dz * endT, byPlayer ? 0xf0d2a0 : 0xff6a4a);
    if (hitNpc) {
      const dealt = damage * (byPlayer && hitNpc.head ? 1.75 : 1);
      this.damageNpc(hitNpc.npc, dealt, byPlayer);
    }
  }

  private rayNpcs(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxT: number,
    ignore: number | null,
  ) {
    let best: { npc: Npc; t: number; head: boolean } | null = null;
    for (const npc of this.npcs) {
      if (npc.state === "dead" || npc.id === ignore) continue;
      const head = raySphere(ox, oy, oz, dx, dy, dz, npc.x, 1.66, npc.z, 0.2);
      const body = raySphere(ox, oy, oz, dx, dy, dz, npc.x, 1.15, npc.z, 0.46);
      let t: number | null = null;
      let isHead = false;
      if (head !== null && head < maxT) {
        t = head;
        isHead = true;
      }
      if (body !== null && body < maxT && (t === null || body < t)) {
        t = body;
        isHead = false;
      }
      if (t !== null && (!best || t < best.t)) best = { npc, t, head: isHead };
    }
    return best;
  }

  private damageNpc(npc: Npc, amount: number, byPlayer: boolean) {
    if (npc.state === "dead") return;
    npc.hp -= amount;
    npc.flash = 1;
    if (npc.kind === "hostile") {
      npc.see = 3;
      if (npc.state !== "attack") npc.state = "chase";
    } else {
      npc.see = 4;
      npc.state = "flee";
    }
    if (npc.hp > 0) {
      if (byPlayer) {
        this.hitMarker = 1;
        this.audio.hit();
        this.emitSoon = true;
      }
      return;
    }
    npc.hp = 0;
    npc.state = "dead";
    npc.deadT = 0;
    this.audio.down();
    if (byPlayer) {
      if (npc.kind === "hostile") {
        this.score += 100;
        this.message = "Hostile à terre";
        const cap = WEAPONS[this.weaponIndex].reserve;
        this.reserves[this.weaponIndex] = Math.min(cap, this.reserves[this.weaponIndex] + (this.weaponIndex === 2 ? 2 : 10));
      } else {
        this.score = Math.max(0, this.score - 250);
        this.message = "Civil abattu — malus";
      }
      this.msgT = 1.35;
      this.noteBest();
      this.hitMarker = 1;
      this.emitSoon = true;
    }
  }

  private alert(radius: number) {
    for (const npc of this.npcs) {
      if (npc.state === "dead") continue;
      const dist = Math.hypot(npc.x - this.x, npc.z - this.z);
      if (dist > radius) continue;
      if (npc.kind === "hostile") {
        npc.see = 3;
        if (npc.state === "patrol") npc.state = "chase";
      } else {
        npc.see = 3.5;
        npc.state = "flee";
      }
    }
  }

  private tickNpc(npc: Npc, dt: number) {
    if (npc.state === "dead") {
      npc.deadT += dt;
      return;
    }
    const dx = this.x - npc.x;
    const dz = this.z - npc.z;
    const dist = Math.hypot(dx, dz) || 0.0001;
    const fx = -Math.sin(npc.yaw);
    const fz = -Math.cos(npc.yaw);
    const dot = (dx / dist) * fx + (dz / dist) * fz;
    const see = dist < 32 && dot > 0.34 && losClear(npc.x, npc.z, this.x, this.z, this.los);
    if (npc.kind === "hostile") {
      if (see) {
        npc.see = 2.6;
        npc.state = dist < 15 ? "attack" : "chase";
      } else if (npc.see > 0) {
        npc.see -= dt;
        if (npc.see <= 0) npc.state = "patrol";
      }
      if (npc.state === "attack") {
        this.faceToward(npc, this.x, this.z, dt, 6);
        const rx = Math.cos(npc.yaw);
        const rz = -Math.sin(npc.yaw);
        npc.x += rx * Math.sin(npc.phase * 0.7) * 1.5 * dt;
        npc.z += rz * Math.sin(npc.phase * 0.7) * 1.5 * dt;
        npc.phase += dt;
        if (dist > 18) npc.state = "chase";
        if (dist < 4.5) {
          npc.x -= fx * 2.4 * dt;
          npc.z -= fz * 2.4 * dt;
        }
        this.enemyShoot(npc, dt, dist);
      } else if (npc.state === "chase") {
        if (see) this.steer(npc, this.x, this.z, dt, 3.55);
        else this.steerGraph(npc, this.x, this.z, dt, 3.3);
        npc.phase += dt * 8;
      } else {
        this.steerPatrol(npc, dt, 1.65);
      }
    } else if (see || npc.see > 0 || dist < 8) {
      if (see || dist < 8) npc.see = 3.2;
      npc.see -= dt;
      npc.state = "flee";
      this.steer(npc, npc.x - (dx / dist) * 10, npc.z - (dz / dist) * 10, dt, 3.7);
      npc.phase += dt * 9;
    } else {
      npc.state = "patrol";
      this.steerPatrol(npc, dt, 1.35);
    }
  }

  private enemyShoot(npc: Npc, dt: number, dist: number) {
    npc.cd -= dt;
    if (npc.cd > 0 || dist > 24) return;
    if (!losClear(npc.x, npc.z, this.x, this.z, this.los)) return;
    npc.cd = 0.95 + Math.random() * 0.55;
    const ox = npc.x;
    const oy = 1.45;
    const oz = npc.z;
    let dx = this.x - ox;
    let dy = 1.25 - oy;
    let dz = this.z - oz;
    dx += (Math.random() - 0.5) * 0.55;
    dy += (Math.random() - 0.5) * 0.28;
    dz += (Math.random() - 0.5) * 0.55;
    const dir = norm3(dx, dy, dz);
    const wallT = nearestBox(ox, oy, oz, dir.x, dir.y, dir.z, this.colliders, 40);
    const playerT = raySphere(ox, oy, oz, dir.x, dir.y, dir.z, this.x, 1.2, this.z, 0.48);
    const npcHit = this.rayNpcs(ox, oy, oz, dir.x, dir.y, dir.z, wallT ?? 40, npc.id);
    let end = wallT ?? 16;
    if (playerT !== null && playerT < end && (!npcHit || playerT < npcHit.t)) {
      if (this.invuln <= 0) this.hurt(7 + this.wave * 0.35);
      end = playerT;
    } else if (npcHit && npcHit.t < end) {
      this.damageNpc(npcHit.npc, 18, false);
      end = npcHit.t;
    }
    this.spawnTracer(ox, oy, oz, ox + dir.x * end, oy + dir.y * end, oz + dir.z * end, 0xff6a4a);
    this.audio.gun("vesper", true);
  }

  private hurt(amount: number) {
    if (this.mode !== "play" || this.invuln > 0) return;
    this.health -= amount;
    this.invuln = 0.32;
    this.damageFlash = 1;
    this.shake = Math.min(0.055, this.shake + 0.028);
    this.audio.hurt();
    this.emitSoon = true;
    if (this.health > 0) return;
    this.health = 0;
    this.mode = "dead";
    this.mouseFire = false;
    this.touchFire = false;
    this.message = "À terre";
    this.msgT = 6;
    this.noteBest();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private faceToward(npc: Npc, tx: number, tz: number, dt: number, rate: number) {
    const desired = Math.atan2(-(tx - npc.x), -(tz - npc.z));
    const diff = wrapPi(desired - npc.yaw);
    const step = rate * dt;
    if (Math.abs(diff) <= step) npc.yaw = desired;
    else npc.yaw += Math.sign(diff) * step;
  }

  private steer(npc: Npc, tx: number, tz: number, dt: number, speed: number) {
    const dx = tx - npc.x;
    const dz = tz - npc.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.7) return true;
    const desired = Math.atan2(-dx, -dz);
    const diff = wrapPi(desired - npc.yaw);
    const step = 4.4 * dt;
    if (Math.abs(diff) <= step) npc.yaw = desired;
    else npc.yaw += Math.sign(diff) * step;
    const align = Math.max(0.22, Math.cos(diff));
    npc.x += -Math.sin(npc.yaw) * speed * align * dt;
    npc.z += -Math.cos(npc.yaw) * speed * align * dt;
    return false;
  }

  private steerGraph(npc: Npc, tx: number, tz: number, dt: number, speed: number) {
    const node = this.nav[npc.node];
    if (!node) return;
    if (!this.steer(npc, node.x, node.z, dt, speed)) return;
    let best = -1;
    let bestD = (node.x - tx) ** 2 + (node.z - tz) ** 2;
    for (const link of node.links) {
      const next = this.nav[link];
      if (!next) continue;
      const d = (next.x - tx) ** 2 + (next.z - tz) ** 2;
      if (d < bestD - 1) {
        bestD = d;
        best = link;
      }
    }
    if (best >= 0) {
      npc.prev = npc.node;
      npc.node = best;
    }
  }

  private steerPatrol(npc: Npc, dt: number, speed: number) {
    const node = this.nav[npc.node];
    if (!node) return;
    npc.phase += dt * 7;
    if (!this.steer(npc, node.x, node.z, dt, speed)) return;
    if (node.links.length === 0) return;
    let next = node.links[(Math.random() * node.links.length) | 0];
    if (node.links.length > 1 && next === npc.prev) {
      next = node.links[(node.links.indexOf(next) + 1) % node.links.length];
    }
    npc.prev = npc.node;
    npc.node = next;
  }

  private separate() {
    const living = this.npcs.filter((npc) => npc.state !== "dead");
    for (let i = 0; i < living.length; i++) {
      const a = living[i];
      let pdx = a.x - this.x;
      let pdz = a.z - this.z;
      let pd = Math.hypot(pdx, pdz);
      if (pd < 0.9) {
        if (pd < 0.001) {
          pdx = 1;
          pdz = 0;
          pd = 1;
        }
        a.x += (pdx / pd) * (0.9 - pd);
        a.z += (pdz / pd) * (0.9 - pd);
      }
      for (let j = i + 1; j < living.length; j++) {
        const b = living[j];
        let dx = a.x - b.x;
        let dz = a.z - b.z;
        let d = Math.hypot(dx, dz);
        if (d >= 0.82) continue;
        if (d < 0.001) {
          dx = 0.02;
          dz = 0;
          d = 0.02;
        }
        const push = (0.82 - d) / 2 / d;
        a.x += dx * push;
        a.z += dz * push;
        b.x -= dx * push;
        b.z -= dz * push;
      }
    }
  }

  private checkWave(dt: number) {
    if (this.mode !== "play") return;
    if (this.alive("hostile") > 0) return;
    if (!this.cleared) {
      this.cleared = true;
      this.between = 3.3;
      this.score += 200;
      this.health = Math.min(100, this.health + 18);
      this.message = "Secteur nettoyé";
      this.msgT = 2.2;
      this.noteBest();
      this.audio.wave();
      this.emitSoon = true;
    }
    this.between -= dt;
    if (this.between > 0) return;
    this.wave += 1;
    this.cleared = false;
    this.reap();
    this.spawnWave();
    this.invuln = Math.max(this.invuln, 1.1);
    this.message = `Vague ${this.wave}`;
    this.msgT = 2;
    this.emitSoon = true;
  }

  private reap() {
    for (let i = this.npcs.length - 1; i >= 0; i--) {
      const npc = this.npcs[i];
      if (npc.kind === "hostile" && npc.state === "dead") {
        this.scene.remove(npc.group);
        npc.cloth.dispose();
        this.npcs.splice(i, 1);
      }
    }
  }

  private startReload() {
    const weapon = WEAPONS[this.weaponIndex];
    if (this.reloading > 0) return;
    if (this.mags[this.weaponIndex] >= weapon.mag) return;
    if (this.reserves[this.weaponIndex] <= 0) return;
    this.reloading = weapon.reload;
    this.reloadDur = weapon.reload;
    this.audio.reload();
  }

  private switchTo(index: number) {
    if (index === this.weaponIndex) return;
    this.weaponIndex = index;
    this.reloading = 0;
    this.cooldown = 0.18;
    this.emitSoon = true;
  }

  private noteBest() {
    if (this.score <= this.best) return;
    this.best = this.score;
    try {
      localStorage.setItem("port-cendre-best", String(this.best));
    } catch {
      /* ignore quota / private mode */
    }
  }

  private tracerPool: { line: THREE.Line; life: number }[] = [];
  private tracerI = 0;

  private spawnTracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number) {
    if (this.tracerPool.length < 18) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      this.scene.add(line);
      this.tracerPool.push({ line, life: 0 });
    }
    const slot = this.tracerPool[this.tracerI];
    this.tracerI = (this.tracerI + 1) % this.tracerPool.length;
    const pos = slot.line.geometry.getAttribute("position") as THREE.BufferAttribute;
    pos.setXYZ(0, x0, y0, z0);
    pos.setXYZ(1, x1, y1, z1);
    pos.needsUpdate = true;
    slot.line.visible = true;
    slot.life = 0.07;
    (slot.line.material as THREE.LineBasicMaterial).color.setHex(color);
    (slot.line.material as THREE.LineBasicMaterial).opacity = 0.9;
  }

  private renderFrame(dt: number) {
    this.clock += dt;
    this.shakeT += dt;
    for (const slot of this.tracerPool) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      const mat = slot.line.material as THREE.LineBasicMaterial;
      mat.opacity = Math.max(0, slot.life / 0.07);
      slot.line.visible = slot.life > 0;
    }
    const drops = this.rain.array as Float32Array;
    const px = this.mode === "menu" ? 0 : this.x;
    const pz = this.mode === "menu" ? 0 : this.z;
    for (let i = 0; i < drops.length; i += 3) {
      drops[i + 1] -= dt * (16 + (i % 7));
      if (drops[i + 1] < 0 || Math.abs(drops[i] - px) > 26 || Math.abs(drops[i + 2] - pz) > 26) {
        drops[i] = px + (Math.random() - 0.5) * 42;
        drops[i + 1] = 8 + Math.random() * 10;
        drops[i + 2] = pz + (Math.random() - 0.5) * 42;
      }
    }
    this.rain.needsUpdate = true;

    for (const kit of this.medkits) {
      if (!kit.mesh.visible) continue;
      kit.mesh.rotation.y += dt * 1.4;
      kit.mesh.position.y = 0.72 + Math.sin(this.clock * 2.2 + kit.x) * 0.06;
    }

    if (this.mode === "menu") {
      this.attr += dt * 0.08;
      this.camera.position.set(Math.sin(this.attr) * 24, 8.5 + Math.sin(this.attr * 0.6) * 1.4, Math.cos(this.attr) * 18 + 8);
      this.camera.lookAt(0, 2.2, -8);
    } else if (this.riding) {
      const fx = -Math.sin(this.carYaw);
      const fz = -Math.cos(this.carYaw);
      const desiredX = this.carX - fx * 8.4;
      const desiredY = 3.15;
      const desiredZ = this.carZ - fz * 8.4;
      const k = Math.min(1, dt * 5.5);
      this.camera.position.x += (desiredX - this.camera.position.x) * k;
      this.camera.position.y += (desiredY - this.camera.position.y) * k;
      this.camera.position.z += (desiredZ - this.camera.position.z) * k;
      this.camera.lookAt(this.carX + fx * 3.2, 1.05, this.carZ + fz * 3.2);
      const targetFov = Math.abs(this.carSpeed) > 10 ? 78 : 68;
      if (Math.abs(this.camera.fov - targetFov) > 0.05) {
        this.camera.fov = approach(this.camera.fov, targetFov, dt * 20);
        this.camera.updateProjectionMatrix();
      }
    } else {
      const speed = Math.hypot(this.vx, this.vz);
      const bob = Math.sin(this.bob) * Math.min(1, speed / 4) * 0.04;
      const sx = Math.sin(this.shakeT * 42) * this.shake;
      const sy = Math.cos(this.shakeT * 37) * this.shake;
      this.camera.position.set(this.x + sx, 1.64 + bob + sy, this.z);
      const kick = this.mode === "dead" ? -0.45 : 0;
      this.euler.set(this.pitch + this.visualRecoil + kick, this.yaw, sx * 0.4, "YXZ");
      this.camera.quaternion.setFromEuler(this.euler);
      const targetFov = speed > 6.4 ? 84 : 78;
      if (Math.abs(this.camera.fov - targetFov) > 0.05) {
        this.camera.fov = approach(this.camera.fov, targetFov, dt * 28);
        this.camera.updateProjectionMatrix();
      }
    }

    const weapon = this.weaponIndex;
    const showGun = this.mode !== "menu" && !this.riding;
    for (let i = 0; i < this.guns.length; i++) this.guns[i].visible = i === weapon && showGun;
    for (let i = 0; i < this.flashes.length; i++) {
      this.flashes[i].visible = i === weapon && this.muzzle > 0 && this.mode === "play" && !this.riding;
    }
    this.swayX += (clamp(this.lookDx * 0.012, -1, 1) - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (clamp(this.lookDy * 0.012, -1, 1) - this.swayY) * Math.min(1, dt * 10);
    this.lookDx = 0;
    this.lookDy = 0;
    const walk = Math.sin(this.bob);
    const reloadDip = this.reloading > 0 ? Math.sin((1 - this.reloading / this.reloadDur) * Math.PI) * 0.35 : 0;
    this.gunRoot.position.set(this.swayX * 0.045 + walk * 0.008, this.swayY * 0.03 + Math.abs(walk) * -0.012, 0);
    this.gunRoot.rotation.set(this.visualRecoil * 1.5 + reloadDip, this.swayX * 0.2, this.swayX * -0.12);
    const flash = this.flashes[weapon];
    const gun = this.guns[weapon];
    this.muzzleLight.position.set(gun.position.x + flash.position.x, gun.position.y + flash.position.y, gun.position.z + flash.position.z);
    this.muzzleLight.intensity = this.muzzle > 0 && this.mode === "play" ? 3.5 : 0;

    for (const npc of this.npcs) {
      if (npc.state === "dead" || npc.kind !== "hostile") continue;
      npc.group.updateMatrixWorld();
      npc.bar.lookAt(this.camera.position);
    }

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.mode !== "menu" && !this.riding) {
      this.renderer.clearDepth();
      this.renderer.render(this.viewScene, this.viewCamera);
    }
  }

  private pushHud() {
    const weapon = WEAPONS[this.weaponIndex];
    const blips: HudSnapshot["blips"] = [];
    let hostiles = 0;
    let civils = 0;
    for (const npc of this.npcs) {
      if (npc.state === "dead") continue;
      if (npc.kind === "hostile") hostiles += 1;
      else civils += 1;
      blips.push({ x: npc.x, z: npc.z, k: npc.kind === "hostile" ? "h" : "c" });
    }
    for (const kit of this.medkits) {
      if (kit.ready) blips.push({ x: kit.x, z: kit.z, k: "m" });
    }
    this.onHud({
      ready: true,
      mode: this.mode,
      health: this.health,
      mag: this.mags[this.weaponIndex],
      magSize: weapon.mag,
      reserve: this.reserves[this.weaponIndex],
      weapon: weapon.name,
      weaponIndex: this.weaponIndex,
      score: this.score,
      best: this.best,
      wave: this.wave,
      hostiles,
      civils,
      hit: this.hitMarker,
      damage: this.damageFlash,
      message: this.message,
      reloading: this.reloading > 0 ? 1 - this.reloading / this.reloadDur : 0,
      spread: Math.min(1, weapon.spread * 8 + this.bloom * 0.5),
      px: this.x,
      pz: this.z,
      pyaw: this.yaw,
      blips,
      muted: this.audio.muted,
      locked: this.locked,
      coarse: this.usesHandset(),
      riding: this.riding && this.mode === "play",
      kmh: Math.round(Math.abs(this.riding ? this.carSpeed : 0) * 3.6),
      nearCar: !this.riding && this.mode === "play" && Math.hypot(this.x - this.carX, this.z - this.carZ) < 3.4,
    });
  }

  private resize() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width < 2 || height < 2) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.viewCamera.aspect = width / height;
    this.viewCamera.updateProjectionMatrix();
  }

  private onKeyDown = (event: KeyboardEvent) => {
    this.liveKeys.add(event.code);
    if (event.code.startsWith("Arrow") || event.code === "Space") event.preventDefault();
    if (this.mode === "pause" && event.code === "Escape") {
      this.resume();
      return;
    }
    if (this.mode !== "play") return;
    if (event.repeat) return;
    if (event.code === "KeyR" && !this.riding) this.startReload();
    if (event.code === "Digit1" && !this.riding) this.switchTo(0);
    if (event.code === "Digit2" && !this.riding) this.switchTo(1);
    if (event.code === "Digit3" && !this.riding) this.switchTo(2);
    if (event.code === "KeyF") this.toggleVehicle();
    if (event.code === "Escape" && !this.locked) this.pause();
    if (event.code === "KeyM") this.toggleMute();
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.liveKeys.delete(event.code);
  };

  private onBlur = () => {
    this.liveKeys.clear();
    this.mouseFire = false;
    this.pedalGas = false;
    this.pedalBrake = false;
  };

  private onLock = () => {
    const locked = document.pointerLockElement === this.canvas;
    const was = this.locked;
    this.locked = locked;
    if (was && !locked && this.mode === "play" && !this.usesHandset()) this.pause();
    this.emitSoon = true;
  };

  private usesHandset() {
    return this.coarse || window.matchMedia("(max-width: 900px)").matches;
  }

  private onMouseMove = (event: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas || this.mode !== "play") return;
    this.addLook(event.movementX, event.movementY);
  };

  private onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || this.mode !== "play" || !this.locked) return;
    this.mouseFire = true;
  };

  private onMouseUp = (event: MouseEvent) => {
    if (event.button !== 0) return;
    this.mouseFire = false;
  };

  private onPointerDown = (event: PointerEvent) => {
    if (this.mode !== "play" || this.locked) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    this.dragging = true;
    this.dragX = event.clientX;
    this.dragY = event.clientY;
    this.dragMoved = 0;
    this.canvas.setPointerCapture?.(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent) => {
    if (!this.dragging || this.locked || this.mode !== "play") return;
    const dx = event.clientX - this.dragX;
    const dy = event.clientY - this.dragY;
    this.dragX = event.clientX;
    this.dragY = event.clientY;
    this.dragMoved += Math.abs(dx) + Math.abs(dy);
    this.addLook(dx, dy);
  };

  private onPointerUp = () => {
    if (this.dragging && this.mode === "play" && !this.locked && this.dragMoved < 8) this.tapFire = true;
    this.dragging = false;
  };
}

