import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { BLOCKS, type BlockStyle } from "@/game/layout";

export type ModelKit = {
  cars: Record<string, THREE.Group>;
  buildings: Record<string, THREE.Object3D>;
  actor: THREE.Object3D | null;
  clips: { idle: THREE.AnimationClip | null; run: THREE.AnimationClip | null };
};

const CARS = ["sedan-sports", "sedan", "taxi", "police", "van", "suv", "hatchback-sports"];
const BUILDINGS = [
  "building-a",
  "building-c",
  "building-e",
  "building-skyscraper-a",
  "building-skyscraper-c",
  "low-detail-building-a",
  "low-detail-building-d",
  "low-detail-building-g",
];

const STYLE: Record<BlockStyle, string[]> = {
  warehouse: ["building-e", "building-c"],
  tower: ["building-skyscraper-c", "building-skyscraper-a"],
  shop: ["building-a", "building-c"],
  kiosk: ["low-detail-building-d", "low-detail-building-g", "low-detail-building-a"],
};

function primaryMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!found && mesh.isMesh) found = mesh;
  });
  return found;
}

export async function loadModels(): Promise<ModelKit> {
  const gltf = new GLTFLoader();
  const cars: Record<string, THREE.Group> = {};
  const buildings: Record<string, THREE.Object3D> = {};
  await Promise.all([
    ...CARS.map(async (name) => {
      const file = await gltf.loadAsync(`/models/cars/${name}.glb`);
      cars[name] = file.scene;
    }),
    ...BUILDINGS.map(async (name) => {
      const file = await gltf.loadAsync(`/models/city/${name}.glb`);
      buildings[name] = file.scene;
    }),
  ]);

  let actor: THREE.Object3D | null = null;
  let idle: THREE.AnimationClip | null = null;
  let run: THREE.AnimationClip | null = null;
  try {
    const fbx = new FBXLoader();
    const tex = new THREE.TextureLoader();
    const [body, skin, idleFile, runFile] = await Promise.all([
      fbx.loadAsync("/models/characters/characterMedium.fbx"),
      tex.loadAsync("/models/characters/survivorMaleB.png"),
      fbx.loadAsync("/models/characters/idle.fbx"),
      fbx.loadAsync("/models/characters/run.fbx"),
    ]);
    skin.colorSpace = THREE.SRGBColorSpace;
    body.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = new THREE.MeshStandardMaterial({ map: skin, roughness: 0.72, metalness: 0.02 });
    });
    const box = new THREE.Box3().setFromObject(body);
    const height = Math.max(0.01, box.max.y - box.min.y);
    const scale = 1.78 / height;
    body.scale.setScalar(scale);
    body.position.y = -box.min.y * scale;
    actor = body;
    idle = idleFile.animations[0] ?? null;
    run = runFile.animations[0] ?? null;
  } catch (err) {
    console.warn("personnage 3D ignoré", err);
  }

  return { cars, buildings, actor, clips: { idle, run } };
}

function fitCar(model: THREE.Object3D, length: number) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = length / Math.max(size.x, size.z, 0.01);
  model.scale.setScalar(s);
  const lifted = new THREE.Box3().setFromObject(model);
  model.position.y -= lifted.min.y;
}

export function applyCityModels(scene: THREE.Scene, kit: ModelKit) {
  scene.traverse((obj) => {
    if (obj.userData.prop === "block" || obj.userData.prop === "windows" || obj.userData.prop === "parked") {
      obj.visible = false;
    }
  });

  const buckets = new Map<string, THREE.Matrix4[]>();
  const dummy = new THREE.Object3D();
  BLOCKS.forEach((block, index) => {
    const name = STYLE[block.style][index % STYLE[block.style].length];
    const root = kit.buildings[name];
    if (!root) return;
    const mesh = primaryMesh(root);
    if (!mesh) return;
    root.updateWorldMatrix(true, true);
    const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
    if (size.x < 0.05 || size.y < 0.05 || size.z < 0.05) return;
    let s = Math.min(4.2, Math.max(2.2, 3.3 / size.y));
    let nx = 1;
    let nz = 1;
    let ny = 1;
    const pack = () => {
      nx = Math.max(1, Math.round((block.hw * 2) / (size.x * s)));
      nz = Math.max(1, Math.round((block.hd * 2) / (size.z * s)));
      ny = Math.max(1, Math.round(block.h / (size.y * s)));
      while (nx * nz * ny > 6 && ny > 1) ny -= 1;
      while (nx * nz * ny > 6 && nx > 1) nx -= 1;
      while (nx * nz * ny > 6 && nz > 1) nz -= 1;
      const limit = Math.min(
        (block.hw * 2) / (nx * size.x),
        (block.hd * 2) / (nz * size.z),
        block.h / (ny * size.y),
      );
      if (s > limit) s = limit;
    };
    pack();
    const fw = size.x * s;
    const fd = size.z * s;
    const fh = size.y * s;
    const list = buckets.get(name) ?? [];
    buckets.set(name, list);
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
          dummy.position.set(
            block.x - (nx * fw) / 2 + fw * (ix + 0.5),
            iy * fh,
            block.z - (nz * fd) / 2 + fd * (iz + 0.5),
          );
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(s);
          dummy.updateMatrix();
          dummy.matrix.multiply(mesh.matrixWorld);
          list.push(dummy.matrix.clone());
        }
      }
    }
  });

  for (const [name, matrices] of buckets) {
    const mesh = primaryMesh(kit.buildings[name]);
    if (!mesh || matrices.length === 0) continue;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const inst = new THREE.InstancedMesh(mesh.geometry, material, matrices.length);
    matrices.forEach((matrix, i) => inst.setMatrixAt(i, matrix));
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    scene.add(inst);
  }

  const parked: THREE.Object3D[] = [];
  scene.traverse((obj) => {
    if (obj.userData.prop === "parked") parked.push(obj);
  });
  const files = ["taxi", "police", "van", "suv", "hatchback-sports", "sedan"];
  parked.forEach((spot, index) => {
    const src = kit.cars[files[index % files.length]];
    if (!src) return;
    const model = src.clone(true);
    fitCar(model, 4.05);
    const holder = new THREE.Group();
    holder.position.copy(spot.position);
    holder.rotation.copy(spot.rotation);
    holder.add(model);
    scene.add(holder);
  });
}
