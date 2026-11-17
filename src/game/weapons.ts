import * as THREE from "three";

export type WeaponId = "vesper" | "rafale" | "brise";

export type WeaponDef = {
  id: WeaponId;
  name: string;
  mag: number;
  reserve: number;
  rpm: number;
  auto: boolean;
  pellets: number;
  spread: number;
  damage: number;
  recoil: number;
  reload: number;
};

export const WEAPONS: WeaponDef[] = [
  {
    id: "vesper",
    name: "Vesper",
    mag: 12,
    reserve: 60,
    rpm: 360,
    auto: false,
    pellets: 1,
    spread: 0.012,
    damage: 27,
    recoil: 0.02,
    reload: 1.15,
  },
  {
    id: "rafale",
    name: "Rafale",
    mag: 32,
    reserve: 128,
    rpm: 740,
    auto: true,
    pellets: 1,
    spread: 0.038,
    damage: 12,
    recoil: 0.01,
    reload: 1.65,
  },
  {
    id: "brise",
    name: "Brise",
    mag: 6,
    reserve: 24,
    rpm: 75,
    auto: false,
    pellets: 7,
    spread: 0.1,
    damage: 15,
    recoil: 0.042,
    reload: 2.05,
  },
];

function addBox(
  parent: THREE.Object3D,
  mat: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
}

function addBarrel(parent: THREE.Object3D, mat: THREE.Material, r: number, len: number, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y, z);
  parent.add(mesh);
}

function addFlash(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), mat);
  mesh.position.set(x, y, z);
  mesh.visible = false;
  parent.add(mesh);
  return mesh;
}

export function createGuns() {
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2f35, metalness: 0.86, roughness: 0.28 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x14171a, metalness: 0.45, roughness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6d4c32, roughness: 0.74, metalness: 0.04 });
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffe2b0,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });

  const root = new THREE.Group();

  const pistol = new THREE.Group();
  pistol.position.set(0.28, -0.26, -0.5);
  addBox(pistol, metal, 0.07, 0.09, 0.22, 0, 0.02, -0.02);
  addBox(pistol, dark, 0.078, 0.055, 0.16, 0, 0.075, -0.05);
  addBox(pistol, metal, 0.055, 0.15, 0.07, 0, -0.09, 0.05);
  addBarrel(pistol, dark, 0.013, 0.15, 0, 0.08, -0.2);
  const f1 = addFlash(pistol, flashMat, 0, 0.08, -0.3);

  const smg = new THREE.Group();
  smg.position.set(0.24, -0.24, -0.42);
  addBox(smg, metal, 0.08, 0.11, 0.4, 0, 0.02, -0.06);
  addBox(smg, dark, 0.055, 0.18, 0.07, 0, -0.12, 0.02);
  addBox(smg, metal, 0.05, 0.07, 0.16, 0, 0.05, 0.18);
  addBarrel(smg, dark, 0.012, 0.2, 0, 0.07, -0.32);
  const f2 = addFlash(smg, flashMat, 0, 0.07, -0.44);
  smg.visible = false;

  const shot = new THREE.Group();
  shot.position.set(0.3, -0.28, -0.38);
  addBox(shot, wood, 0.075, 0.08, 0.36, 0, 0, 0.04);
  addBox(shot, dark, 0.09, 0.07, 0.18, 0, 0.05, -0.1);
  addBarrel(shot, dark, 0.015, 0.28, 0.02, 0.08, -0.2);
  addBarrel(shot, dark, 0.015, 0.28, -0.02, 0.08, -0.2);
  addBox(shot, wood, 0.06, 0.14, 0.08, 0, -0.1, 0.1);
  const f3 = addFlash(shot, flashMat, 0, 0.08, -0.38);
  shot.visible = false;

  root.add(pistol, smg, shot);
  return { root, guns: [pistol, smg, shot], flashes: [f1, f2, f3] };
}
