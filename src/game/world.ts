import * as THREE from "three";
import { BLOCKS, type Block } from "@/game/layout";

export type Box3 = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

export type NavNode = { x: number; z: number; links: number[] };

export type Medkit = {
  x: number;
  z: number;
  mesh: THREE.Group;
  ready: boolean;
  timer: number;
};

export type City = {
  colliders: Box3[];
  los: Box3[];
  nav: NavNode[];
  medkits: Medkit[];
  rain: THREE.BufferAttribute;
};

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function resolveCircle(x: number, z: number, r: number, boxes: Box3[]) {
  for (let pass = 0; pass < 3; pass++) {
    for (const b of boxes) {
      const cx = Math.max(b.minX, Math.min(b.maxX, x));
      const cz = Math.max(b.minZ, Math.min(b.maxZ, z));
      let dx = x - cx;
      let dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 < 1e-10) {
        const left = x - b.minX;
        const right = b.maxX - x;
        const north = z - b.minZ;
        const south = b.maxZ - z;
        const m = Math.min(left, right, north, south);
        if (m === left) x = b.minX - r;
        else if (m === right) x = b.maxX + r;
        else if (m === north) z = b.minZ - r;
        else z = b.maxZ + r;
        continue;
      }
      const d = Math.sqrt(d2);
      const pen = r - d;
      x += (dx / d) * pen;
      z += (dz / d) * pen;
    }
  }
  return { x, z };
}

function raySlab(
  o1: number,
  d1: number,
  min1: number,
  max1: number,
  o2: number,
  d2: number,
  min2: number,
  max2: number,
  o3: number,
  d3: number,
  min3: number,
  max3: number,
): number | null {
  let tmin = 0;
  let tmax = 1e9;
  const axes: [number, number, number, number][] = [
    [o1, d1, min1, max1],
    [o2, d2, min2, max2],
    [o3, d3, min3, max3],
  ];
  for (const [o, d, mn, mx] of axes) {
    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return null;
      continue;
    }
    let t1 = (mn - o) / d;
    let t2 = (mx - o) / d;
    if (t1 > t2) {
      const s = t1;
      t1 = t2;
      t2 = s;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return tmin >= 0 ? tmin : tmax;
}

export function nearestBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  boxes: Box3[],
  maxT: number,
) {
  let best: number | null = null;
  for (const b of boxes) {
    const t = raySlab(ox, dx, b.minX, b.maxX, oy, dy, b.minY, b.maxY, oz, dz, b.minZ, b.maxZ);
    if (t !== null && t > 0.02 && t < maxT && (best === null || t < best)) best = t;
  }
  return best;
}

export function raySphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return null;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return null;
  const t = tca - Math.sqrt(r2 - d2);
  return t > 0.02 ? t : null;
}

export function losClear(x0: number, z0: number, x1: number, z1: number, boxes: Box3[]) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 0.08) return true;
  const invx = dx / len;
  const invz = dz / len;
  for (const b of boxes) {
    const t = raySlab(x0, invx, b.minX, b.maxX, 0, 0, -1, 1, z0, invz, b.minZ, b.maxZ);
    if (t !== null && t > 0.15 && t < len - 0.15) return false;
  }
  return true;
}

function overlaps(a: Box3, b: Box3) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

function makeConcrete() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const n = 96 + Math.random() * 36;
    img.data[i * 4] = n;
    img.data[i * 4 + 1] = n + 2;
    img.data[i * 4 + 2] = n + 6;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = "rgba(20,22,26,0.35)";
  ctx.lineWidth = 2;
  for (let y = 32; y < 256; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y + 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeAsphalt() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  const img = ctx.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const n = 34 + Math.random() * 22;
    img.data[i * 4] = n;
    img.data[i * 4 + 1] = n + 2;
    img.data[i * 4 + 2] = n + 4;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(10, 20);
  ctx.lineTo(80, 200);
  ctx.lineTo(210, 80);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(28, 28);
  return tex;
}

function signTexture(label: string, ink: string, glow: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.CanvasTexture(canvas);
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = glow;
  ctx.lineWidth = 8;
  ctx.strokeRect(8, 8, 496, 112);
  ctx.fillStyle = glow;
  ctx.font = "700 68px Oswald, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 256, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function styleColor(style: Block["style"]) {
  if (style === "tower") return 0x9aa3ad;
  if (style === "shop") return 0xb7a898;
  if (style === "kiosk") return 0x8d6f52;
  return 0x7e8791;
}

export function buildCity(scene: THREE.Scene, renderer: THREE.WebGLRenderer): City {
  const rand = mulberry32(0xc0de);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const concrete = makeConcrete();
  concrete.anisotropy = aniso;
  const asphalt = makeAsphalt();
  asphalt.anisotropy = aniso;

  scene.background = new THREE.Color(0x10151c);
  scene.fog = new THREE.FogExp2(0x10151c, 0.016);

  const hemi = new THREE.HemisphereLight(0xb7c4d2, 0x2a2218, 1.15);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xd5e2ef, 1.65);
  moon.position.set(28, 46, 12);
  scene.add(moon);

  const groundMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: asphalt,
    roughness: 0.92,
    metalness: 0.04,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 40),
    new THREE.MeshStandardMaterial({ color: 0x121820, roughness: 0.18, metalness: 0.55 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, -0.35, -68);
  scene.add(water);

  const moonMesh = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 20, 16),
    new THREE.MeshBasicMaterial({ color: 0xe7eef6, fog: false }),
  );
  moonMesh.position.set(26, 32, -48);
  scene.add(moonMesh);

  const colliders: Box3[] = [];
  const los: Box3[] = [];

  const pushBox = (box: Box3, blocksLos: boolean) => {
    colliders.push(box);
    if (blocksLos) los.push(box);
  };

  pushBox({ minX: -52, maxX: 52, minY: 0, maxY: 1.15, minZ: -52, maxZ: -48 }, false);
  pushBox({ minX: -52, maxX: 52, minY: 0, maxY: 4.5, minZ: 48, maxZ: 52 }, true);
  pushBox({ minX: -52, maxX: -48, minY: 0, maxY: 4.5, minZ: -52, maxZ: 52 }, true);
  pushBox({ minX: 48, maxX: 52, minY: 0, maxY: 4.5, minZ: -52, maxZ: 52 }, true);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a414b, roughness: 0.9 });
  const seawall = new THREE.Mesh(new THREE.BoxGeometry(100, 1.15, 1.2), wallMat);
  seawall.position.set(0, 0.57, -49.2);
  scene.add(seawall);
  const southWall = new THREE.Mesh(new THREE.BoxGeometry(100, 4.5, 1.2), wallMat);
  southWall.position.set(0, 2.25, 49.2);
  scene.add(southWall);
  const eastWall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 4.5, 100), wallMat);
  eastWall.position.set(49.2, 2.25, 0);
  scene.add(eastWall);
  const westWall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 4.5, 100), wallMat);
  westWall.position.set(-49.2, 2.25, 0);
  scene.add(westWall);

  const lipMat = new THREE.MeshStandardMaterial({ color: 0x2c323a, roughness: 0.8 });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x1a1e24, roughness: 0.7 });
  const acMat = new THREE.MeshStandardMaterial({ color: 0x5c656e, roughness: 0.55, metalness: 0.3 });
  const warmMat = new THREE.MeshStandardMaterial({
    color: 0xfff1d2,
    emissive: 0xffb15a,
    emissiveIntensity: 1.7,
    roughness: 0.35,
  });
  const coolMat = new THREE.MeshStandardMaterial({
    color: 0xd5e4f2,
    emissive: 0x9ec4de,
    emissiveIntensity: 1.15,
    roughness: 0.4,
  });
  const windowGeo = new THREE.PlaneGeometry(1.15, 1.45);
  const warmMatrices: THREE.Matrix4[] = [];
  const coolMatrices: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();

  const addWindows = (block: Block) => {
    const faces: { rot: number; fixed: "x" | "z"; origin: number; span: number; along: "x" | "z" }[] = [
      { rot: 0, fixed: "z", origin: block.z + block.hd + 0.06, span: block.hw * 2, along: "x" },
      { rot: Math.PI, fixed: "z", origin: block.z - block.hd - 0.06, span: block.hw * 2, along: "x" },
      { rot: Math.PI / 2, fixed: "x", origin: block.x + block.hw + 0.06, span: block.hd * 2, along: "z" },
      { rot: -Math.PI / 2, fixed: "x", origin: block.x - block.hw - 0.06, span: block.hd * 2, along: "z" },
    ];
    for (const face of faces) {
      if (face.span < 3) continue;
      const steps = Math.max(1, Math.floor(face.span / 2.8));
      for (let i = 0; i < steps; i++) {
        const along = -face.span / 2 + (i + 0.5) * (face.span / steps);
        const floors = Math.max(1, Math.floor((block.h - 1.4) / 2.7));
        for (let f = 0; f < floors; f++) {
          const roll = rand();
          if (roll < 0.18) continue;
          const y = 1.7 + f * 2.7;
          if (y > block.h - 0.6) continue;
          dummy.position.set(
            face.along === "x" ? block.x + along : face.origin,
            y,
            face.along === "z" ? block.z + along : face.origin,
          );
          dummy.rotation.set(0, face.rot, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          (roll > 0.72 ? coolMatrices : warmMatrices).push(dummy.matrix.clone());
        }
      }
    }
  };

  for (const block of BLOCKS) {
    const map = concrete.clone();
    map.needsUpdate = true;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(Math.max(1, block.hw / 3), Math.max(1, block.h / 3));
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = aniso;
    const mat = new THREE.MeshStandardMaterial({
      color: styleColor(block.style),
      map,
      roughness: 0.9,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(block.hw * 2, block.h, block.hd * 2), mat);
    mesh.position.set(block.x, block.h / 2, block.z);
    mesh.userData.prop = "block";
    scene.add(mesh);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(block.hw * 2 + 0.35, 0.28, block.hd * 2 + 0.35), lipMat);
    lip.position.set(block.x, block.h + 0.1, block.z);
    lip.userData.prop = "block";
    scene.add(lip);
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.15, 0.08), doorMat);
    door.position.set(block.x, 1.08, block.z + block.hd + 0.05);
    door.userData.prop = "block";
    scene.add(door);
    if (block.style === "tower") {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.55, 0.9), acMat);
      ac.position.set(block.x + block.hw * 0.35, block.h + 0.45, block.z - block.hd * 0.3);
      ac.userData.prop = "block";
      scene.add(ac);
    }
    const box: Box3 = {
      minX: block.x - block.hw,
      maxX: block.x + block.hw,
      minY: 0,
      maxY: block.h,
      minZ: block.z - block.hd,
      maxZ: block.z + block.hd,
    };
    pushBox(box, true);
    addWindows(block);
  }

  const addInstanced = (matrices: THREE.Matrix4[], mat: THREE.Material) => {
    if (matrices.length === 0) return;
    const mesh = new THREE.InstancedMesh(windowGeo, mat, matrices.length);
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData.prop = "windows";
    scene.add(mesh);
  };
  addInstanced(warmMatrices, warmMat);
  addInstanced(coolMatrices, coolMat);

  const tryProp = (box: Box3, blocksLos: boolean, build: () => THREE.Object3D) => {
    if (colliders.some((c) => overlaps(c, box))) return false;
    if (Math.hypot((box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2 - 36) < 5) return false;
    pushBox(box, blocksLos);
    scene.add(build());
    return true;
  };

  const paints = [0x3d4654, 0x6e2e28, 0x1e242c, 0x243044, 0x4a4038].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35 }),
  );
  const glass = new THREE.MeshStandardMaterial({
    color: 0x9bb4c6,
    roughness: 0.15,
    metalness: 0.6,
    emissive: 0x203848,
    emissiveIntensity: 0.3,
  });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8 });

  const cars: [number, number, number][] = [
    [6, 20, 0],
    [-6, 22, 0],
    [7, 6, 1],
    [-8, 8, 0],
    [8, -18, 0],
    [-8, -14, 1],
    [22, 8, 0],
    [-22, 6, 1],
    [4, -22, 0],
    [-18, -20, 0],
  ];
  cars.forEach(([x, z, rot], index) => {
    const hw = rot ? 2.15 : 0.95;
    const hd = rot ? 0.95 : 2.15;
    const box: Box3 = { minX: x - hw, maxX: x + hw, minY: 0, maxY: 1.5, minZ: z - hd, maxZ: z + hd };
    tryProp(box, true, () => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.48, 4.2), paints[index % paints.length]);
      body.position.y = 0.55;
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.42, 1.8), glass);
      cab.position.set(0, 0.95, -0.15);
      g.add(body, cab);
      const wheelGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.18, 8);
      const wheels: [number, number][] = [
        [0.8, 1.3],
        [-0.8, 1.3],
        [0.8, -1.3],
        [-0.8, -1.3],
      ];
      for (const [wx, wz] of wheels) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.rotation.z = Math.PI / 2;
        w.position.set(wx, 0.28, wz);
        g.add(w);
      }
      g.position.set(x, 0, z);
      g.rotation.y = rot ? Math.PI / 2 : 0;
      g.userData.prop = "parked";
      return g;
    });
  });

  const containerColors = [0x8c3d32, 0x2f4a56, 0xc4a15a, 0x3c4650].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.25 }),
  );
  const containers: [number, number, number][] = [
    [-22, -22, 0],
    [10, -22, 1],
    [26, 10, 0],
    [-6, 16, 1],
    [30, -18, 0],
  ];
  containers.forEach(([x, z, rot], index) => {
    const hw = rot ? 3.1 : 1.25;
    const hd = rot ? 1.25 : 3.1;
    const box: Box3 = { minX: x - hw, maxX: x + hw, minY: 0, maxY: 2.5, minZ: z - hd, maxZ: z + hd };
    tryProp(box, true, () => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 6.2), containerColors[index % containerColors.length]);
      mesh.position.set(x, 1.25, z);
      mesh.rotation.y = rot ? Math.PI / 2 : 0;
      return mesh;
    });
  });

  const crateMat = new THREE.MeshStandardMaterial({ color: 0x6a5438, roughness: 0.86 });
  const crateSpots: [number, number][] = [
    [3, 10],
    [4, 12],
    [-4, -6],
    [-3, -4],
    [18, 24],
    [-20, 24],
    [12, -8],
    [-14, 0],
    [2, -10],
  ];
  for (const [x, z] of crateSpots) {
    const box: Box3 = { minX: x - 0.55, maxX: x + 0.55, minY: 0, maxY: 1.1, minZ: z - 0.55, maxZ: z + 0.55 };
    tryProp(box, false, () => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.05, 1.05), crateMat);
      mesh.position.set(x, 0.52, z);
      mesh.rotation.y = rand() * 0.4;
      return mesh;
    });
  }

  const lampMat = new THREE.MeshStandardMaterial({ color: 0x2a3036, roughness: 0.45, metalness: 0.5 });
  const lampGlow = new THREE.MeshStandardMaterial({
    color: 0xffe2b0,
    emissive: 0xe2a04a,
    emissiveIntensity: 1.6,
  });
  const lampSpots: [number, number][] = [
    [0, 12],
    [0, -16],
    [-20, 0],
    [18, -2],
  ];
  lampSpots.forEach(([x, z], index) => {
    if (colliders.some((c) => x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ && c.maxY > 2)) return;
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5.2, 6), lampMat);
    pole.position.y = 2.6;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), lampGlow);
    head.position.y = 5.2;
    g.add(pole, head);
    g.position.set(x, 0, z);
    scene.add(g);
    if (index < 2) {
      const light = new THREE.PointLight(0xe2a04a, 16, 26, 2);
      light.position.set(x, 5.1, z);
      scene.add(light);
    }
  });

  const addSign = (x: number, y: number, z: number, rot: number, label: string, glow: string) => {
    const tex = signTexture(label, "#140e0a", glow);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      emissiveMap: tex,
      emissive: 0xffffff,
      emissiveIntensity: 1.15,
      roughness: 0.42,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rot;
    scene.add(mesh);
  };
  addSign(-26, 6.2, -25.8, 0, "QUAI 7", "#e2a04a");
  addSign(20, 8.4, -24.7, 0, "FRET NORD", "#c44536");
  addSign(-27.9, 8, 16, Math.PI / 2, "CENDRE", "#e2a04a");
  addSign(0, 3.2, 46.5, Math.PI, "PORT-CENDRE", "#e7e1d6");

  const hullMat = new THREE.MeshStandardMaterial({ color: 0x242a30, roughness: 0.7, metalness: 0.2 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 18), hullMat);
  hull.position.set(-16, 0.6, -64);
  scene.add(hull);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(5, 2.2, 5), new THREE.MeshStandardMaterial({ color: 0x3a2a28 }));
  cabin.position.set(-16, 2.6, -60);
  scene.add(cabin);
  const craneMast = new THREE.Mesh(new THREE.BoxGeometry(0.5, 14, 0.5), lampMat);
  craneMast.position.set(22, 7, -60);
  const craneArm = new THREE.Mesh(new THREE.BoxGeometry(16, 0.35, 0.35), lampMat);
  craneArm.position.set(16, 13.6, -60);
  scene.add(craneMast, craneArm);

  const dashGeo = new THREE.BoxGeometry(0.16, 0.02, 1.15);
  const dashMat = new THREE.MeshStandardMaterial({ color: 0xe2a04a, roughness: 0.6, emissive: 0xe2a04a, emissiveIntensity: 0.15 });
  const dashes: THREE.Matrix4[] = [];
  for (let z = -44; z <= 44; z += 4) {
    const blocked = BLOCKS.some((b) => Math.abs(0 - b.x) < b.hw + 0.4 && Math.abs(z - b.z) < b.hd + 0.4);
    if (blocked) continue;
    dummy.position.set(0, 0.03, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    dashes.push(dummy.matrix.clone());
  }
  for (let x = -44; x <= 44; x += 4) {
    const blocked = BLOCKS.some((b) => Math.abs(x - b.x) < b.hw + 0.4 && Math.abs(0 - b.z) < b.hd + 0.4);
    if (blocked) continue;
    dummy.position.set(x, 0.03, 0);
    dummy.rotation.set(0, Math.PI / 2, 0);
    dummy.updateMatrix();
    dashes.push(dummy.matrix.clone());
  }
  if (dashes.length) {
    const mesh = new THREE.InstancedMesh(dashGeo, dashMat, dashes.length);
    dashes.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  }

  const nav: NavNode[] = [];
  const index = new Map<string, number>();
  for (let ix = 0; ix <= 14; ix++) {
    for (let iz = 0; iz <= 14; iz++) {
      const x = -42 + ix * 6;
      const z = -42 + iz * 6;
      const inside = colliders.some(
        (c) => x > c.minX + 0.4 && x < c.maxX - 0.4 && z > c.minZ + 0.4 && z < c.maxZ - 0.4 && c.maxY > 1,
      );
      if (inside) continue;
      index.set(`${ix},${iz}`, nav.length);
      nav.push({ x, z, links: [] });
    }
  }
  const lookup = (ix: number, iz: number) => index.get(`${ix},${iz}`);
  for (let ix = 0; ix <= 14; ix++) {
    for (let iz = 0; iz <= 14; iz++) {
      const self = lookup(ix, iz);
      if (self === undefined) continue;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dz === 0) continue;
          const other = lookup(ix + dx, iz + dz);
          if (other === undefined) continue;
          if (losClear(nav[self].x, nav[self].z, nav[other].x, nav[other].z, los)) nav[self].links.push(other);
        }
      }
    }
  }
  for (let i = 0; i < nav.length; i++) {
    if (nav[i].links.length > 0) continue;
    let best = -1;
    let bestD = 20 * 20;
    for (let j = 0; j < nav.length; j++) {
      if (i === j) continue;
      const d = (nav[i].x - nav[j].x) ** 2 + (nav[i].z - nav[j].z) ** 2;
      if (d < bestD && losClear(nav[i].x, nav[i].z, nav[j].x, nav[j].z, los)) {
        bestD = d;
        best = j;
      }
    }
    if (best >= 0) nav[i].links.push(best);
  }
  if (nav.length === 0) nav.push({ x: 0, z: 36, links: [] });

  const crossMat = new THREE.MeshStandardMaterial({
    color: 0xc44536,
    emissive: 0xc44536,
    emissiveIntensity: 0.45,
    roughness: 0.4,
  });
  const caseMat = new THREE.MeshStandardMaterial({ color: 0xd7d0c4, roughness: 0.5 });
  const medkits: Medkit[] = [];
  const spots: [number, number][] = [
    [0, 18],
    [-20, 4],
    [18, -12],
    [-4, -16],
    [20, 26],
  ];
  for (const [x, z] of spots) {
    const blocked = colliders.some((c) => x > c.minX - 0.8 && x < c.maxX + 0.8 && z > c.minZ - 0.8 && z < c.maxZ + 0.8);
    if (blocked || Math.hypot(x, z - 36) < 6) continue;
    const mesh = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.26, 0.34), caseMat);
    const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.08), crossMat);
    const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.22), crossMat);
    c1.position.y = 0.16;
    c2.position.y = 0.16;
    mesh.add(box, c1, c2);
    mesh.position.set(x, 0.72, z);
    scene.add(mesh);
    medkits.push({ x, z, mesh, ready: true, timer: 0 });
  }

  const rainCount = 520;
  const rainPositions = new Float32Array(rainCount * 3);
  for (let i = 0; i < rainCount; i++) {
    rainPositions[i * 3] = (Math.random() - 0.5) * 44;
    rainPositions[i * 3 + 1] = Math.random() * 14;
    rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 44;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
  const rain = new THREE.Points(
    rainGeo,
    new THREE.PointsMaterial({ color: 0xc5d0dc, size: 0.055, transparent: true, opacity: 0.38, depthWrite: false }),
  );
  rain.frustumCulled = false;
  scene.add(rain);

  const shipLight = new THREE.PointLight(0xc44536, 8, 18, 2);
  shipLight.position.set(-16, 4.2, -60);
  scene.add(shipLight);

  return { colliders, los, nav, medkits, rain: rainGeo.getAttribute("position") as THREE.BufferAttribute };
}
