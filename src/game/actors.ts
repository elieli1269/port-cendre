import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

const torsoGeo = new THREE.BoxGeometry(0.46, 0.62, 0.26);
const headGeo = new THREE.SphereGeometry(0.16, 10, 8);
const limbGeo = new THREE.BoxGeometry(0.15, 0.7, 0.16);
const armGeo = new THREE.BoxGeometry(0.12, 0.48, 0.12);
const bandGeo = new THREE.BoxGeometry(0.5, 0.08, 0.3);
const gunGeo = new THREE.BoxGeometry(0.07, 0.08, 0.34);
const barGeo = new THREE.PlaneGeometry(0.72, 0.07);

for (const geo of [torsoGeo, headGeo, limbGeo, armGeo, bandGeo, gunGeo, barGeo]) {
  geo.userData.shared = true;
}

const skin = new THREE.MeshStandardMaterial({ color: 0xc4a48a, roughness: 0.72 });
const pants = new THREE.MeshStandardMaterial({ color: 0x1c2128, roughness: 0.86 });
const bandMat = new THREE.MeshStandardMaterial({
  color: 0xe2a04a,
  emissive: 0xe2a04a,
  emissiveIntensity: 0.55,
  roughness: 0.45,
});
const gunMat = new THREE.MeshStandardMaterial({ color: 0x1a1d21, metalness: 0.6, roughness: 0.4 });
const barMat = new THREE.MeshBasicMaterial({ color: 0xc44536 });
const clothHostile = new THREE.MeshStandardMaterial({ color: 0x7a342c, roughness: 0.8 });
const clothCivil = new THREE.MeshStandardMaterial({ color: 0x8d8678, roughness: 0.84 });

for (const mat of [skin, pants, bandMat, gunMat, barMat, clothHostile, clothCivil]) {
  mat.userData.shared = true;
}

export type ActorVisual = {
  group: THREE.Group;
  legs: [THREE.Group, THREE.Group];
  arms: [THREE.Group, THREE.Group];
  bar: THREE.Mesh;
  cloth: THREE.MeshStandardMaterial;
  mixer: THREE.AnimationMixer | null;
  idle: THREE.AnimationAction | null;
  run: THREE.AnimationAction | null;
  gait: "idle" | "run";
};

type ActorTemplate = {
  root: THREE.Object3D;
  idle: THREE.AnimationClip | null;
  run: THREE.AnimationClip | null;
};

let actorTemplate: ActorTemplate | null = null;

export function setActorTemplate(
  root: THREE.Object3D,
  clips: { idle: THREE.AnimationClip | null; run: THREE.AnimationClip | null },
) {
  actorTemplate = { root, idle: clips.idle, run: clips.run };
}

function limb(geo: THREE.BoxGeometry, mat: THREE.Material, yPivot: number) {
  const pivot = new THREE.Group();
  pivot.position.y = yPivot;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -geo.parameters.height / 2;
  pivot.add(mesh);
  return pivot;
}

export function makeActor(kind: "hostile" | "civil"): ActorVisual {
  if (actorTemplate) return makeRigged(kind);
  const group = new THREE.Group();
  const cloth = (kind === "hostile" ? clothHostile : clothCivil).clone();
  cloth.userData.shared = false;
  cloth.emissive = new THREE.Color(0xc44536);
  cloth.emissiveIntensity = 0;

  const torso = new THREE.Mesh(torsoGeo, cloth);
  torso.position.y = 1.15;
  group.add(torso);

  const head = new THREE.Mesh(headGeo, skin);
  head.position.y = 1.66;
  group.add(head);

  const legL = limb(limbGeo, pants, 0.78);
  legL.position.x = -0.12;
  const legR = limb(limbGeo, pants, 0.78);
  legR.position.x = 0.12;
  group.add(legL, legR);

  const armL = limb(armGeo, cloth, 1.38);
  armL.position.x = -0.32;
  const armR = limb(armGeo, cloth, 1.38);
  armR.position.x = 0.32;
  group.add(armL, armR);

  if (kind === "hostile") {
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.set(0, 1.28, 0.02);
    const gun = new THREE.Mesh(gunGeo, gunMat);
    gun.position.set(0.32, 1.05, -0.12);
    group.add(band, gun);
  }

  const bar = new THREE.Mesh(barGeo, barMat);
  bar.position.y = 2.08;
  bar.visible = kind === "hostile";
  group.add(bar);

  return { group, legs: [legL, legR], arms: [armL, armR], bar, cloth, mixer: null, idle: null, run: null, gait: "idle" };
}

const blankLimbs = (): Pick<ActorVisual, "legs" | "arms"> => ({
  legs: [new THREE.Group(), new THREE.Group()],
  arms: [new THREE.Group(), new THREE.Group()],
});

function makeRigged(kind: "hostile" | "civil"): ActorVisual {
  const source = actorTemplate;
  if (!source) return makeActor(kind);
  const group = new THREE.Group();
  const model = cloneSkinned(source.root) as THREE.Object3D;
  let cloth: THREE.MeshStandardMaterial | null = null;
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
    mat.emissive = new THREE.Color(kind === "hostile" ? 0xc44536 : 0x000000);
    mat.emissiveIntensity = 0;
    mesh.material = mat;
    cloth ??= mat;
  });
  group.add(model);
  if (kind === "hostile") {
    const band = new THREE.Mesh(bandGeo, bandMat);
    band.position.set(0, 1.22, 0.18);
    group.add(band);
  }
  const bar = new THREE.Mesh(barGeo, barMat);
  bar.position.y = 2.05;
  bar.visible = kind === "hostile";
  group.add(bar);
  const mixer = new THREE.AnimationMixer(model);
  const idle = source.idle ? mixer.clipAction(source.idle) : null;
  const run = source.run ? mixer.clipAction(source.run) : null;
  idle?.play();
  return {
    group,
    ...blankLimbs(),
    bar,
    cloth: cloth ?? clothCivil.clone(),
    mixer,
    idle,
    run,
    gait: "idle",
  };
}

export function upgradeActor(actor: ActorVisual, kind: "hostile" | "civil") {
  if (!actorTemplate) return;
  const next = makeRigged(kind);
  actor.group.clear();
  for (const child of [...next.group.children]) actor.group.add(child);
  actor.bar = next.bar;
  actor.cloth = next.cloth;
  actor.mixer = next.mixer;
  actor.idle = next.idle;
  actor.run = next.run;
  actor.gait = "idle";
  actor.legs = next.legs;
  actor.arms = next.arms;
}
