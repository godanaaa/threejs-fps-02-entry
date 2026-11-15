// The bots: three Ember teammates and four Ash defenders. Each one is a body with a
// team-coloured torso, a gun and a ground ring, driven by a small state machine:
// route along the waypoint graph, hold a position and scan, engage what it sees,
// and play the objective — the Ember carrier plants, the Ash defenders defuse.
// Vision is a real raycast against the map; hearing is gunfire inside 25 m.
// Bots never decide damage themselves: they call hooks.onShot and main.js resolves
// the ray, so a bullet and its tracer always agree.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createBotBody } from './player.js';
import { MAP, WAYPOINTS } from './world.js';

const HEALTH = 100;
const WALK_SPEED = 3.4;
const RUSH_SPEED = 4.6;
const SIGHT_RANGE = 46;
const HEAR_RANGE = 25;
const SCAN_INTERVAL = 0.15;
const REACTION_MIN = 0.35;
const REACTION_MAX = 0.6;
const BURST_MIN = 3;
const BURST_MAX = 5;
const SHOT_GAP = 0.13;
const PAUSE_MIN = 0.6;
const PAUSE_MAX = 1.1;
const AIM_SPREAD = 0.03;
const PLANT_SECONDS = 3;
const DEFUSE_SECONDS = 5;
const BOMB_TIMER = 35;

const NAMES = {
  ember: ['Vex', 'Mara', 'Kip'],
  ash: ['Rook', 'Sable', 'Fenn', 'Odo'],
};
const HOLD_NODES = { ash: [12, 11, 9, 16] };
const SITE_NODES = [11, 12, 13];

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();

export function createBots(scene, world, random, hooks) {
  const adjacency = WAYPOINTS.nodes.map(() => []);
  for (const [a, b] of WAYPOINTS.edges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < WAYPOINTS.nodes.length; i += 1) {
      const [nx, nz] = WAYPOINTS.nodes[i];
      const d = (nx - x) * (nx - x) + (nz - z) * (nz - z);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function route(fromNode, toNode) {
    if (fromNode === toNode) return [toNode];
    const prev = new Array(WAYPOINTS.nodes.length).fill(-1);
    const queue = [fromNode];
    prev[fromNode] = fromNode;
    while (queue.length) {
      const node = queue.shift();
      for (const next of adjacency[node]) {
        if (prev[next] !== -1) continue;
        prev[next] = node;
        if (next === toNode) {
          const path = [toNode];
          let at = toNode;
          while (at !== fromNode) { at = prev[at]; path.unshift(at); }
          return path;
        }
        queue.push(next);
      }
    }
    return [toNode];
  }

  const teamMaterial = {
    ember: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.6, metalness: 0.05 }),
    ash: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.foe), roughness: 0.6, metalness: 0.05 }),
  };
  const headMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.1 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const legGeometry = new THREE.BoxGeometry(0.16, 0.52, 0.16);
  const torsoGeometry = new THREE.BoxGeometry(0.52, 0.62, 0.3);
  const headGeometry = new THREE.SphereGeometry(0.16, 14, 10);
  const gunGeometry = new THREE.BoxGeometry(0.06, 0.09, 0.55);
  const bombGeometry = new THREE.BoxGeometry(0.3, 0.22, 0.18);
  const bombMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.site), roughness: 0.4, emissive: new THREE.Color(PALETTE.site), emissiveIntensity: 0.35 });

  const raycaster = new THREE.Raycaster();
  raycaster.far = SIGHT_RANGE;
  const bots = [];
  const hitMeshes = [];
  let scanPhase = 0;

  function makeBot(team, index, spawn) {
    const group = new THREE.Group();
    const legL = new THREE.Mesh(legGeometry, darkMaterial);
    legL.position.set(-0.12, 0.26, 0);
    const legR = new THREE.Mesh(legGeometry, darkMaterial);
    legR.position.set(0.12, 0.26, 0);
    const torso = new THREE.Mesh(torsoGeometry, teamMaterial[team]);
    torso.position.y = 0.98;
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1.52;
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.34), teamMaterial[team]);
    cap.position.y = 1.62;
    const gun = new THREE.Mesh(gunGeometry, darkMaterial);
    gun.position.set(0.2, 1.12, -0.25);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 24),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(team === 'ember' ? PALETTE.accent : PALETTE.foe), transparent: true, opacity: 0.4, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    group.add(legL, legR, torso, head, cap, gun, ring);
    group.traverse((mesh) => { if (mesh.isMesh) { mesh.castShadow = true; } });
    scene.add(group);

    const body = createBotBody(world.colliders, spawn.x, spawn.z);
    const bot = {
      team,
      name: NAMES[team][index],
      body,
      group,
      torso,
      head,
      health: HEALTH,
      armor: false,
      alive: true,
      yaw: spawn.yaw,
      state: 'route',
      route: [],
      routeIndex: 0,
      holdNode: -1,
      target: null,
      lastSeen: new THREE.Vector3(),
      lastSeenAt: -99,
      reactAt: 0,
      burstLeft: 0,
      shotTimer: 0,
      pauseTimer: 0,
      scanTimer: random() * SCAN_INTERVAL,
      strafeDir: 1,
      strafeTimer: 0,
      stuckTimer: 0,
      lastX: spawn.x,
      lastZ: spawn.z,
      plantProgress: 0,
      defuseProgress: 0,
      carryingBomb: false,
      fall: 0,
      speed: WALK_SPEED,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    hitMeshes.push(torso, head);
    const bombMesh = new THREE.Mesh(bombGeometry, bombMaterial);
    bombMesh.position.set(0, 1.05, 0.22);
    bombMesh.visible = false;
    group.add(bombMesh);
    bot.bombMesh = bombMesh;
    bots.push(bot);
    return bot;
  }

  for (let i = 0; i < 3; i += 1) makeBot('ember', i, MAP.attackerSpawns[i + 1]);
  for (let i = 0; i < 4; i += 1) makeBot('ash', i, MAP.defenderSpawns[i]);

  function setRoute(bot, toNode) {
    const from = nearestNode(bot.body.state.position.x, bot.body.state.position.z);
    bot.route = route(from, toNode);
    bot.routeIndex = 0;
    bot.state = 'route';
  }

  function atSite(bot) {
    const p = bot.body.state.position;
    return Math.abs(p.x - MAP.site.x) <= MAP.site.halfX && Math.abs(p.z - MAP.site.z) <= MAP.site.halfZ;
  }

  function eyeOf(bot, out) {
    out.set(bot.body.state.position.x, bot.body.state.position.y + 1.55, bot.body.state.position.z);
    return out;
  }

  function canSee(bot, enemy) {
    _from.copy(eyeOf(bot, _eye));
    const ep = enemy.position;
    _to.set(ep.x, ep.y + 1.1, ep.z);
    _dir.copy(_to).sub(_from);
    const dist = _dir.length();
    if (dist > SIGHT_RANGE) return false;
    _dir.multiplyScalar(1 / dist);
    raycaster.set(_from, _dir);
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    return !hit || hit.distance > dist - 0.2;
  }

  function scan(bot, enemies, time, dt) {
    bot.scanTimer -= dt;
    if (bot.scanTimer > 0) return;
    bot.scanTimer = SCAN_INTERVAL + random() * 0.05;
    let best = null;
    let bestD = Infinity;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.position.x - bot.body.state.position.x;
      const dz = enemy.position.z - bot.body.state.position.z;
      const d = dx * dx + dz * dz;
      if (d > SIGHT_RANGE * SIGHT_RANGE) continue;
      if (d < bestD && canSee(bot, enemy)) { best = enemy; bestD = d; }
    }
    if (best) {
      if (bot.target !== best) bot.reactAt = time + REACTION_MIN + random() * (REACTION_MAX - REACTION_MIN);
      bot.target = best;
      bot.lastSeen.set(best.position.x, best.position.y, best.position.z);
      bot.lastSeenAt = time;
    } else if (bot.target && time - bot.lastSeenAt > 1.2) {
      bot.target = null;
    }
  }

  function fireBurst(bot, time) {
    if (bot.burstLeft > 0) {
      bot.shotTimer -= SHOT_GAP;
      if (bot.shotTimer > 0) return;
      bot.shotTimer = SHOT_GAP;
      bot.burstLeft -= 1;
      const t = bot.target;
      eyeOf(bot, _from);
      _to.set(t.position.x, t.position.y + 1.1, t.position.z);
      _dir.copy(_to).sub(_from).normalize();
      _dir.x += (random() * 2 - 1) * AIM_SPREAD;
      _dir.y += (random() * 2 - 1) * AIM_SPREAD;
      _dir.z += (random() * 2 - 1) * AIM_SPREAD;
      _dir.normalize();
      hooks.onShot(bot, _from, _dir);
      if (bot.burstLeft === 0) bot.pauseTimer = PAUSE_MIN + random() * (PAUSE_MAX - PAUSE_MIN);
    } else {
      bot.pauseTimer -= SHOT_GAP;
      if (bot.pauseTimer <= 0) bot.burstLeft = BURST_MIN + Math.floor(random() * (BURST_MAX - BURST_MIN + 1));
    }
  }

  function faceTarget(bot, dt, target) {
    const dx = target.x - bot.body.state.position.x;
    const dz = target.z - bot.body.state.position.z;
    const want = Math.atan2(-dx, -dz);
    let diff = want - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.yaw += Math.max(-3.2 * dt, Math.min(3.2 * dt, diff));
  }

  function stepBot(bot, dt, time, ctx) {
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.group.rotation.x = -bot.fall * 1.45;
      return;
    }
    const enemies = ctx.enemiesOf(bot.team);
    scan(bot, enemies, time, dt);

    // Stuck detection: no progress for 2 s while routing.
    const p = bot.body.state.position;
    const moved = Math.hypot(p.x - bot.lastX, p.z - bot.lastZ);
    if (bot.state === 'route' && moved < 0.05) {
      bot.stuckTimer += dt;
      if (bot.stuckTimer > 2) {
        bot.stuckTimer = 0;
        setRoute(bot, Math.floor(random() * WAYPOINTS.nodes.length));
      }
    } else bot.stuckTimer = 0;
    bot.lastX = p.x;
    bot.lastZ = p.z;

    const engaging = bot.target && time >= bot.reactAt;
    let wishX = 0;
    let wishZ = 0;
    let speed = WALK_SPEED;

    if (bot.state === 'plant') {
      bot.plantProgress += dt;
      if (bot.plantProgress >= PLANT_SECONDS) {
        bot.state = 'hold';
        bot.plantProgress = 0;
        hooks.onPlanted(bot);
      }
    } else if (bot.state === 'defuse') {
      bot.defuseProgress += dt;
      if (bot.defuseProgress >= DEFUSE_SECONDS) {
        bot.state = 'hold';
        bot.defuseProgress = 0;
        hooks.onDefused(bot);
      }
    } else if (engaging) {
      faceTarget(bot, dt, bot.lastSeen);
      bot.strafeTimer -= dt;
      if (bot.strafeTimer <= 0) {
        bot.strafeTimer = 0.9 + random() * 1.1;
        bot.strafeDir = random() < 0.5 ? -1 : 1;
      }
      const fx = Math.sin(bot.yaw);
      const fz = Math.cos(bot.yaw);
      wishX = fz * bot.strafeDir * 0.7;
      wishZ = -fx * bot.strafeDir * 0.7;
      speed = 1.6;
      fireBurst(bot, time);
    } else if (bot.state === 'route') {
      const node = bot.route[bot.routeIndex];
      if (node === undefined) {
        bot.state = 'hold';
      } else {
        const [nx, nz] = WAYPOINTS.nodes[node];
        const dx = nx - p.x;
        const dz = nz - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.6) {
          bot.routeIndex += 1;
          if (bot.routeIndex >= bot.route.length) {
            bot.state = 'hold';
            bot.holdNode = node;
          }
        } else {
          wishX = dx / d;
          wishZ = dz / d;
          faceTarget(bot, dt, { x: nx, z: nz });
          if (bot.team === 'ash' && ctx.bombPlanted) speed = RUSH_SPEED;
        }
      }
    } else if (bot.state === 'hold') {
      // Scan the lane: slow yaw sweep, and answer the objective.
      if (bot.team === 'ember' && bot.carryingBomb && atSite(bot) && !ctx.bombPlanted) {
        bot.state = 'plant';
        bot.plantProgress = 0;
      } else if (bot.team === 'ash' && ctx.bombPlanted && ctx.bombPosition) {
        const bp = ctx.bombPosition;
        const d = Math.hypot(bp.x - p.x, bp.z - p.z);
        if (d < 2) {
          bot.state = 'defuse';
          bot.defuseProgress = 0;
        } else {
          setRoute(bot, nearestNode(bp.x, bp.z));
        }
      } else if (bot.team === 'ember' && ctx.bombDropped && !ctx.bombPlanted) {
        const bp = ctx.bombPosition;
        const d = Math.hypot(bp.x - p.x, bp.z - p.z);
        if (d < 1.2) hooks.onBombPickup(bot);
        else setRoute(bot, nearestNode(bp.x, bp.z));
      } else {
        bot.yaw += Math.sin(time * 0.7 + bot.holdNode) * dt * 0.5;
      }
    }

    bot.body.move(dt, wishX, wishZ, speed);
    bot.group.position.copy(p);
    bot.group.rotation.y = bot.yaw;
    bot.group.rotation.x = 0;
  }

  function damage(bot, amount, part) {
    if (!bot.alive) return false;
    let dealt = amount * (part === 'head' ? 2 : 1);
    if (bot.armor) dealt *= 0.5;
    bot.health -= dealt;
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.fall = 0;
    bot.target = null;
    if (bot.carryingBomb) {
      bot.carryingBomb = false;
      bot.bombMesh.visible = false;
      hooks.onCarrierDown(bot.body.state.position);
    }
    return true;
  }

  function alert(position, radius) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      const p = bot.body.state.position;
      const d = Math.hypot(p.x - position.x, p.z - position.z);
      if (d < radius) {
        bot.lastSeen.set(position.x, position.y, position.z);
        bot.lastSeenAt = 0;
        if (bot.state === 'hold') setRoute(bot, nearestNode(position.x, position.z));
      }
    }
  }

  function spawnRound(roles) {
    let emberIndex = 0;
    let ashIndex = 0;
    for (const bot of bots) {
      const spawn = bot.team === 'ember' ? MAP.attackerSpawns[emberIndex + 1] : MAP.defenderSpawns[ashIndex];
      if (bot.team === 'ember') emberIndex += 1;
      else ashIndex += 1;
      bot.body.state.position.set(spawn.x, 0, spawn.z);
      bot.body.state.velocity.set(0, 0, 0);
      bot.yaw = spawn.yaw;
      bot.health = HEALTH;
      bot.armor = roles.armor[bot.team] || false;
      bot.alive = true;
      bot.fall = 0;
      bot.target = null;
      bot.route = [];
      bot.routeIndex = 0;
      bot.plantProgress = 0;
      bot.defuseProgress = 0;
      bot.carryingBomb = false;
      bot.bombMesh.visible = false;
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.position.set(spawn.x, 0, spawn.z);
      bot.group.visible = true;
      if (bot.team === 'ember') {
        const carrier = bot.name === roles.carrier;
        bot.carryingBomb = carrier;
        bot.bombMesh.visible = carrier;
        setRoute(bot, SITE_NODES[Math.floor(random() * SITE_NODES.length)]);
      } else {
        bot.holdNode = HOLD_NODES.ash[ashIndex - 1];
        setRoute(bot, bot.holdNode);
      }
    }
  }

  return {
    bots,
    hitMeshes,
    step(dt, time, ctx) {
      scanPhase += 1;
      for (const bot of bots) stepBot(bot, dt, time, ctx);
    },
    damage,
    alert,
    spawnRound,
    aliveCount(team) {
      let n = 0;
      for (const bot of bots) if (bot.team === team && bot.alive) n += 1;
      return n;
    },
    atSite,
    bombTimerSeconds: BOMB_TIMER,
    plantSeconds: PLANT_SECONDS,
    defuseSeconds: DEFUSE_SECONDS,
  };
}
