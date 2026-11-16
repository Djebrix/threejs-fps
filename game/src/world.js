// EMBERLINE's map: a foundry yard, 40 x 30 m, three lanes split by two long walls
// with cross-passages, two bomb sites at the north end, crates for cover and one
// elevated platform reached by steps. Every box is a collider and stops bullets.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoints the bots route on: [x, z, neighbours...]. Lanes run north-south;
// the two cross-passages at z=-4 and z=+6 join them.
const WAYPOINTS = [
  [-16, -13, 1, 2],
  [-13, -11, 0, 2],
  [-13, -4, 0, 1, 3, 6],
  [-13, 4, 2, 4, 7],
  [-13, 12, 3],
  [-4, -8.5, 6],
  [0, -4, 2, 5, 7, 10],
  [0, 6, 3, 6, 8, 11],
  [0, 12, 7],
  [13, -11, 10],
  [13, -4, 6, 9, 11],
  [13, 4, 7, 10, 12],
  [13, 12, 11],
];

export const SITES = {
  A: { name: 'A', center: new THREE.Vector3(-15.5, 0, -11), radius: 3.2 },
  B: { name: 'B', center: new THREE.Vector3(15.5, 0, -11), radius: 3.2 },
};

export const PLAYER_SPAWN = new THREE.Vector3(0, 0, 11.5);
export const BOT_SPAWNS = [
  new THREE.Vector3(-8, 0, -13),
  new THREE.Vector3(-5, 0, -13),
  new THREE.Vector3(5, 0, -13),
  new THREE.Vector3(8, 0, -13),
  new THREE.Vector3(12, 0, -13),
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: name === 'hairline' ? 0.25 : 0.03,
    });
  }
  const glow = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent),
    emissive: new THREE.Color(PALETTE.accent),
    emissiveIntensity: 1.6,
    roughness: 0.4,
  });
  const teal = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#2a4a4d'),
    emissive: new THREE.Color('#1d3a3d'),
    emissiveIntensity: 0.7,
    roughness: 0.6,
    metalness: 0.2,
  });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material] || material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function trim(width, height, depth, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }

  // Floor and outer walls: 40 x 30 m, 5 m high.
  box(40.6, 0.4, 30.6, 0, -0.2, 0, 'canvas');
  box(0.4, 5, 30.6, -20.2, 2.5, 0, 'surface');
  box(0.4, 5, 30.6, 20.2, 2.5, 0, 'surface');
  box(40.6, 5, 0.4, 0, 2.5, -15.2, 'surface');
  box(40.6, 5, 0.4, 0, 2.5, 15.2, 'surface');

  // Lane walls at x=-7 and x=+7, with cross-passages at z in [-6,-2] and [4,8].
  for (const wx of [-7, 7]) {
    box(0.5, 4.2, 9, wx, 2.1, -10.5, 'surface'); // north segment z -15..-6
    box(0.5, 4.2, 6, wx, 2.1, 1, 'surface'); // middle segment z -2..4
    box(0.5, 4.2, 7, wx, 2.1, 11.5, 'surface'); // south segment z 8..15
    // Amber edge trims on the wall tops so lanes read at a glance.
    trim(0.56, 0.08, 9, wx, 4.24, -10.5, glow);
    trim(0.56, 0.08, 6, wx, 4.24, 1, glow);
    trim(0.56, 0.08, 7, wx, 4.24, 11.5, glow);
  }

  // Site markers: painted floor plates and low corner blocks at A (west) and B (east).
  for (const sx of [-15.5, 15.5]) {
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(5.4, 0.06, 5.4),
      new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a2c14'), roughness: 0.9 }),
    );
    plate.position.set(sx, 0.03, -11);
    plate.receiveShadow = true;
    group.add(plate);
    trim(5.4, 0.1, 0.18, sx, 0.08, -13.7, glow);
    trim(5.4, 0.1, 0.18, sx, 0.08, -8.3, glow);
    trim(0.18, 0.1, 5.4, sx - 2.7, 0.08, -11, glow);
    trim(0.18, 0.1, 5.4, sx + 2.7, 0.08, -11, glow);
    box(1.4, 1.0, 1.4, sx - 1.6, 0.5, -13.2, 'hairline');
    box(1.4, 1.0, 1.4, sx + 1.6, 0.5, -13.2, 'hairline');
  }

  // Cover crates: staggered blocks in each lane, sized to crouch behind or hide behind.
  const crates = [
    [-13, 1.1, 1.2, -8.5, 1.2], [-13, 0.8, 1.0, 0.5, 1.1], [-13, 1.3, 1.4, 8.0, 1.2],
    [0, 1.2, 1.2, -8.0, 1.1], [0, 1.0, 1.0, 1.5, 1.2], [0, 1.4, 1.0, 9.5, 1.3],
    [13, 1.1, 1.2, -8.5, 1.2], [13, 0.8, 1.0, 0.5, 1.1], [13, 1.3, 1.4, 8.0, 1.2],
    [-3.4, 1.0, 2.2, -4.0, 1.0], [3.4, 1.0, 2.2, 6.0, 1.0],
    [-16.5, 1.2, 1.2, -4.0, 1.4], [16.5, 1.2, 1.2, -4.0, 1.4],
    [-10, 2.2, 1.2, -11.5, 2.6], [10, 2.2, 1.2, -11.5, 2.6],
  ];
  for (const [x, w, d, z, h] of crates) box(w, h, d, x, h / 2, z, 'hairline');

  // Furnace block south-centre: the big landmark, with a teal-hot door.
  box(5, 3.4, 2.4, 0, 1.7, 13.2, 'surface');
  trim(2.2, 1.6, 0.12, 0, 1.1, 11.96, teal);
  trim(5.1, 0.12, 2.5, 0, 3.46, 13.2, glow);

  // Elevated platform at mid-north (0,-11), top 1.6 m, reached by two steps.
  box(6, 1.6, 3.6, 0, 0.8, -11.5, 'surface');
  box(6, 0.55, 1.0, 0, 0.275, -9.2, 'hairline');
  box(6, 1.1, 1.0, 0, 0.55, -10.2, 'hairline');
  trim(6.1, 0.08, 3.7, 0, 1.64, -11.5, glow);

  // Pipes along the north wall and a gantry beam across mid, visual only.
  const pipeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#4a4438'), roughness: 0.5, metalness: 0.5 });
  for (const pz of [-14.6, -14.2]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 38, 10), pipeMat);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(0, 4.4 + (pz + 14.6) * 0.4, pz);
    group.add(pipe);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(40, 0.5, 0.5), pipeMat);
  beam.position.set(0, 4.6, 2);
  group.add(beam);

  // A few scattered barrels for silhouette variety.
  const barrelMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5a3a1a'), roughness: 0.7, metalness: 0.3 });
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 12);
  for (const [bx, bz] of [[-17.5, 6], [17.5, -1], [-4.5, 12.5], [9.5, -13.5]]) {
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(bx, 0.55, bz);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    group.add(barrel);
    colliders.push(new THREE.Box3().setFromObject(barrel));
    shootables.push(barrel);
  }

  // Light: low amber sun through the yard, cool teal fill, fog for depth.
  const sky = new THREE.HemisphereLight(new THREE.Color('#4a5560'), new THREE.Color(PALETTE.canvas), 1.5);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color('#ffb84d'), 3.2);
  key.position.set(12, 16, 10);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -24;
  key.shadow.camera.right = 24;
  key.shadow.camera.top = 20;
  key.shadow.camera.bottom = -20;
  key.shadow.camera.far = 60;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#4d7a80'), 0.9);
  fill.position.set(-10, 10, 12);
  scene.add(fill);
  const siteLightA = new THREE.PointLight(new THREE.Color(PALETTE.accent), 12, 12);
  siteLightA.position.set(-15.5, 3.2, -11);
  scene.add(siteLightA);
  const siteLightB = new THREE.PointLight(new THREE.Color(PALETTE.accent), 12, 12);
  siteLightB.position.set(15.5, 3.2, -11);
  scene.add(siteLightB);

  return {
    colliders,
    shootables,
    group,
    waypoints: WAYPOINTS.map(([x, z, ...links]) => ({ x, z, links })),
    sites: SITES,
  };
}
