import * as THREE from "three";

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
};

function limb(geo: THREE.BoxGeometry, mat: THREE.Material, yPivot: number) {
  const pivot = new THREE.Group();
  pivot.position.y = yPivot;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -geo.parameters.height / 2;
  pivot.add(mesh);
  return pivot;
}

export function makeActor(kind: "hostile" | "civil"): ActorVisual {
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

  return { group, legs: [legL, legR], arms: [armL, armR], bar, cloth };
}
