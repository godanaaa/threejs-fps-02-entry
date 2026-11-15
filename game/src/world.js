// Ember Yard: a dusk scrapyard the attackers cross from the south gate to the Furnace
// bombsite in the north. Three lanes — Scrap Lane west, Crusher Alley mid, Tank Row
// east — joined by a cross connector, with crates, containers and tanks for cover.
// Every box is a collider for bodies and a surface a bullet stops on. Waypoints are
// the graph the bots route on; node 0 is the attacker spawn, node 19 the defender side.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const MAP = {
  halfX: 20,
  halfZ: 15,
  site: { x: 3, z: -11, halfX: 4, halfZ: 2.5 },
  attackerSpawns: [
    { x: 0, z: 12.5, yaw: 0 },
    { x: -2.5, z: 12.5, yaw: 0.3 },
    { x: 2.5, z: 12.5, yaw: -0.3 },
    { x: 0, z: 13.8, yaw: 0 },
  ],
  defenderSpawns: [
    { x: -4, z: -13, yaw: Math.PI },
    { x: 4, z: -13, yaw: Math.PI },
    { x: -1.5, z: -12.4, yaw: Math.PI },
    { x: 1.5, z: -13.8, yaw: Math.PI },
  ],
};

// Waypoint nodes [x, z]; edges are index pairs. Bots BFS this graph.
export const WAYPOINTS = {
  nodes: [
    [0, 12], [-6, 12], [6, 12], [-14, 8], [-14, 0], [-14, -8], [-10, -11],
    [0, 6], [0, 0], [-3, -4], [3, -4], [-2, -11], [4, -11], [8, -11],
    [14, 8], [14, 0], [14, -8], [10, -11], [-4, -13], [4, -13], [-7, 0], [7, 0],
  ],
  edges: [
    [0, 1], [0, 2], [0, 7], [1, 3], [1, 7], [2, 7], [2, 14], [3, 4], [4, 5],
    [4, 20], [5, 6], [6, 11], [7, 8], [8, 9], [8, 10], [8, 20], [8, 21],
    [9, 11], [10, 12], [11, 12], [11, 18], [12, 13], [12, 19], [13, 17],
    [14, 15], [15, 16], [15, 21], [16, 17], [17, 13], [18, 19],
  ],
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'site' ? 0.55 : 0.92,
      metalness: name === 'steel' ? 0.45 : 0.03,
    });
  }
  const glowSite = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.site), transparent: true, opacity: 0.55 });
  const glowAccent = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
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

  function flat(width, depth, x, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.06, depth), material);
    mesh.position.set(x, 0.03, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  // Floor and perimeter: 40 x 30 m yard, 5 m walls, open sky.
  box(40.4, 0.4, 30.4, 0, -0.2, 0, 'surface');
  box(0.4, 5, 30.4, -20.2, 2.5, 0, 'surface');
  box(0.4, 5, 30.4, 20.2, 2.5, 0, 'surface');
  box(40.4, 5, 0.4, 0, 2.5, -15.2, 'surface');
  box(40.4, 5, 0.4, 0, 2.5, 15.2, 'surface');

  // The Furnace: the bombsite's heart, north wall, with a chimney and a glow.
  box(5, 3.6, 1.6, -4, 1.8, -14.2, 'hairline');
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 6.5, 12), materials.steel);
  chimney.position.set(-5.5, 3.2, -14.2);
  chimney.castShadow = true;
  group.add(chimney);
  colliders.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(-5.5, 3.2, -14.2), new THREE.Vector3(1.6, 6.5, 1.6)));
  shootables.push(chimney);
  // Painted site square on the floor, plus the low platform attackers jump onto.
  flat(8, 5, MAP.site.x, MAP.site.z, glowSite);
  box(4, 0.5, 3, 6.5, 0.25, -10, 'surface');
  box(0.18, 0.5, 5, -1.2, 0.25, -11, 'accent', false);
  box(8, 0.18, 0.18, 3, 0.5, -8.4, 'accent', false);

  // Crusher Alley: the mid block that splits the centre lane.
  box(6, 3, 4, 0, 1.5, -2, 'steel');
  box(1.2, 1.1, 1.2, -4.4, 0.55, 0.5, 'hairline');
  box(1.2, 1.1, 1.2, 4.4, 0.55, 0.5, 'hairline');
  box(2.4, 0.9, 1.2, -2.4, 0.45, 5.4, 'hairline');
  box(2.4, 0.9, 1.2, 2.4, 0.45, 5.4, 'hairline');

  // Scrap Lane (west): crates and a wall segment with a gap to peek through.
  box(1.6, 1.6, 1.6, -14, 0.8, 8, 'hairline');
  box(1.6, 0.9, 1.6, -14, 0.45, 0, 'hairline');
  box(1.6, 1.6, 1.6, -14, 0.8, -8, 'hairline');
  box(1.2, 3.4, 0.6, -10, 1.7, 4, 'surface');
  box(1.2, 3.4, 0.6, -10, 1.7, -4, 'surface');
  box(2.2, 1.1, 1.2, -6, 0.55, -6, 'hairline');
  box(1.6, 0.7, 1.6, -7.6, 0.35, -11.5, 'hairline');

  // Tank Row (east): two long containers and the fuel tanks.
  box(2.4, 2.6, 6, 14, 1.3, 6, 'steel');
  box(2.4, 2.6, 6, 14, 1.3, -6, 'steel');
  box(2.2, 1.1, 1.2, 6, 0.55, -6, 'hairline');
  box(1.6, 0.7, 1.6, 7.6, 0.35, -11.5, 'hairline');
  for (const [tx, tz] of [[17, -12], [-17, -12]]) {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 2.6, 16), materials.steel);
    tank.position.set(tx, 1.3, tz);
    tank.castShadow = true;
    tank.receiveShadow = true;
    group.add(tank);
    colliders.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(tx, 1.3, tz), new THREE.Vector3(2.5, 2.6, 2.5)));
    shootables.push(tank);
  }

  // Lamp posts: warm pools of light down each lane.
  for (const [lx, lz] of [[-14, 4], [14, 4], [0, -8]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.6, 8), materials.hairline);
    pole.position.set(lx, 1.8, lz);
    group.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.24), glowAccent);
    lamp.position.set(lx, 3.65, lz);
    group.add(lamp);
  }

  // Light: a low dusk sun from the west, a cool sky fill, and the furnace glow at the site.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.muted), new THREE.Color(PALETTE.canvas), 1.35);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb37a'), 3.1);
  sun.position.set(-18, 10, 12);
  sun.target.position.set(4, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.steel), 0.5);
  fill.position.set(12, 9, -10);
  scene.add(fill);
  const furnace = new THREE.PointLight(new THREE.Color(PALETTE.accent), 26, 16, 1.8);
  furnace.position.set(-3, 2.2, -12.5);
  scene.add(furnace);

  return { colliders, shootables, group };
}
