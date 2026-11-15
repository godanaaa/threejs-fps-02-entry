// Ember Yard: boot and the one loop. A fixed 60 Hz simulation feeding a render at the
// display's rate; rendering, input and the DOM never touch the simulation's numbers
// except through the one state object below. ?shot=start|play|buy|end with &seed=N
// sets up a deterministic frame for a capture, renders it twice, then freezes it
// and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, MAP } from './world.js';
import { createInput } from './input.js';
import { createPlayer, createColliderTest } from './player.js';
import { createWeapon } from './weapon.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createEconomy, BUY_ITEMS, REWARDS } from './economy.js';
import { createFx } from './fx.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const CARRIER_ROTATION = ['Vex', 'Mara', 'Kip'];
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const fx = createFx(scene);
const hud = createHud();
const economy = createEconomy();
const player = createPlayer(world.colliders, MAP.attackerSpawns[0]);
const weapon = createWeapon(camera);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const overlaps = createColliderTest(world.colliders);

// The one state object: everything the loop reads or writes about the match lives here.
const state = {
  health: 100,
  alive: true,
  score: 0,
  kills: 0,
  deaths: 0,
  started: false,
  matchOver: false,
  carryingBomb: false,
  plantProgress: 0,
  time: 0,
  grenades: [],
};
const body = player.state;
const playerTarget = { position: body.position, alive: true, isPlayer: true };
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _point = new THREE.Vector3();
const _to = new THREE.Vector3();

const bots = createBots(scene, world, random, {
  onShot(bot, from, dir) {
    resolveBotShot(bot, from, dir);
    fx.enemyShot();
  },
  onCarrierDown(position) {
    rounds.dropBomb(position);
    hud.killFeed(`Charge dropped at the yard`);
  },
  onPlanted(bot) {
    rounds.plantAt(bot.body.state.position.clone());
    hud.banner('CHARGE PLANTED', 'Ash must defuse it before the fuse runs out', 3000);
    fx.plantBeep();
  },
  onDefused() {
    rounds.defuse();
  },
  onBombPickup(bot) {
    bot.carryingBomb = true;
    bot.bombMesh.visible = true;
    rounds.state.bomb.status = 'carried';
    rounds.state.bomb.carrier = bot.name;
  },
});

const rounds = createRounds(scene, {
  onMatchStart() {
    state.matchOver = false;
  },
  onRoundStart(round) {
    respawnAll(round);
    hud.setScore(rounds.state.wins, round);
    hud.banner(`ROUND ${round}`, round === 1 ? 'Plant the charge at the Furnace — first to 5' : '', 2600);
    if (!shot) openBuyMenu();
  },
  onPhaseChange() {
    hud.hideBuyMenu();
    if (!shot) hud.banner('GO', 'Plant the charge at the Furnace', 1400);
  },
  onBombPlanted() {
    hud.killFeed('Charge planted at the Furnace');
  },
  onBombDropped() {},
  onBombDetonated(position) {
    fx.explosionAt(position);
    fx.explosion();
    hud.banner('CHARGE DETONATED', 'Ember takes the round', 3000);
  },
  onBombDefused() {
    hud.banner('CHARGE DEFUSED', 'Ash holds the yard', 3000);
  },
  onRoundEnd(winner, reason, wins, round) {
    const won = winner === 'ember';
    economy.roundEnd(won);
    hud.setScore(wins, round);
    hud.banner(won ? 'EMBER WINS THE ROUND' : 'ASH WINS THE ROUND', reason, 0);
    hud.hideBuyMenu();
    if (state.carryingBomb) {
      state.carryingBomb = false;
      rounds.takeBombFromPlayer(body.position);
    }
  },
  onNextRound(next) {
    rounds.startRound(next, CARRIER_ROTATION[(next - 1) % CARRIER_ROTATION.length]);
  },
  onMatchEnd(winner, wins) {
    state.matchOver = true;
    hud.showOverlay('end', { winner, wins, score: state.score });
    if (document.pointerLockElement) document.exitPointerLock();
  },
});

function respawnAll(round) {
  player.respawn(MAP.attackerSpawns[0]);
  state.health = 100;
  state.alive = true;
  playerTarget.alive = true;
  state.carryingBomb = false;
  state.plantProgress = 0;
  state.grenades = [];
  weapon.refill();
  bots.spawnRound({
    armor: { ember: false, ash: round >= 3 },
    carrier: CARRIER_ROTATION[(round - 1) % CARRIER_ROTATION.length],
  });
  hud.setHealth(state.health, economy.state.armor);
  hud.setAmmo(weapon.mag(), weapon.reserve(), weapon.activeName(), economy.state.grenades);
  hud.setMoney(economy.state.money);
  hud.setTeams(bots.aliveCount('ember') + 1, bots.aliveCount('ash'));
}

function enemiesOf(team) {
  if (team === 'ember') {
    return bots.bots.filter((b) => b.team === 'ash' && b.alive).map((b) => ({ position: b.body.state.position, alive: true, isPlayer: false, ref: b }));
  }
  const list = bots.bots.filter((b) => b.team === 'ember' && b.alive).map((b) => ({ position: b.body.state.position, alive: true, isPlayer: false, ref: b }));
  if (state.alive) list.push(playerTarget);
  return list;
}

function botContext() {
  const bomb = rounds.state.bomb;
  return {
    enemiesOf,
    bombPlanted: bomb.status === 'planted',
    bombDropped: bomb.status === 'dropped',
    bombPosition: bomb.status === 'planted' || bomb.status === 'dropped' ? bomb.position : null,
  };
}

function playerHitTest(from, dir, maxDist) {
  // Ray against a sphere at the player's chest: bots have no mesh to hit.
  _to.set(body.position.x, body.position.y + 1.1, body.position.z);
  const ox = _to.x - from.x;
  const oy = _to.y - from.y;
  const oz = _to.z - from.z;
  const t = ox * dir.x + oy * dir.y + oz * dir.z;
  if (t < 0 || t > maxDist) return -1;
  const dx = ox - dir.x * t;
  const dy = oy - dir.y * t;
  const dz = oz - dir.z * t;
  const d2 = dx * dx + dy * dy + dz * dz;
  return d2 < 0.45 * 0.45 ? t : -1;
}

function resolveBotShot(bot, from, dir) {
  scene.updateMatrixWorld(true);
  raycaster.set(from, dir);
  const targets = world.shootables.concat(bots.hitMeshes);
  const hit = raycaster.intersectObjects(targets, false)[0];
  const wallDist = hit ? hit.distance : 90;
  let end = _point.copy(from).addScaledVector(dir, wallDist);
  const playerT = state.alive ? playerHitTest(from, dir, wallDist) : -1;
  if (playerT >= 0) {
    end = _point.copy(from).addScaledVector(dir, playerT);
    damagePlayer(26, bot);
  } else if (hit && hit.object.userData.bot && hit.object.userData.bot.team !== bot.team) {
    const victim = hit.object.userData.bot;
    const killed = bots.damage(victim, 26, hit.object.userData.part);
    if (killed) hud.killFeed(`${bot.name} ▸ ${victim.name}`);
  } else if (hit) {
    fx.sparksAt(hit.point);
  }
  fx.tracer(from, end);
}

function damagePlayer(amount, source) {
  if (!state.alive) return;
  let dealt = economy.state.armor ? amount * 0.5 : amount;
  state.health -= dealt;
  hud.damageFlash();
  hud.setHealth(state.health, economy.state.armor);
  if (state.health <= 0) {
    state.health = 0;
    state.alive = false;
    playerTarget.alive = false;
    state.deaths += 1;
    if (source) hud.killFeed(`${source.name} ▸ You`);
    hud.banner('YOU ARE DOWN', 'Wait for the next round', 0);
    if (state.carryingBomb) {
      state.carryingBomb = false;
      rounds.takeBombFromPlayer(body.position);
    }
  }
}

function shoot(spread) {
  if (!weapon.takeRound()) return false;
  camera.getWorldDirection(_dir);
  _dir.x += (random() * 2 - 1) * spread;
  _dir.y += (random() * 2 - 1) * spread;
  _dir.z += (random() * 2 - 1) * spread;
  _dir.normalize();
  _origin.copy(camera.position);
  scene.updateMatrixWorld(true);
  raycaster.set(_origin, _dir);
  const targets = world.shootables.concat(bots.hitMeshes);
  const hit = raycaster.intersectObjects(targets, false)[0];
  let end = _point.copy(_origin).addScaledVector(_dir, hit ? hit.distance : 60);
  if (hit && hit.object.userData.bot) {
    const victim = hit.object.userData.bot;
    if (victim.team === 'ash') {
      const killed = bots.damage(victim, weapon.activeDef().damage, hit.object.userData.part);
      state.score += killed ? 100 : 10;
      if (killed) {
        state.kills += 1;
        economy.earn(REWARDS.kill);
        hud.killFeed(`You ▸ ${victim.name}${hit.object.userData.part === 'head' ? ' (headshot)' : ''}`);
        fx.kill();
      } else {
        fx.hit();
      }
      hud.setScore(rounds.state.wins, rounds.state.round);
      hud.setMoney(economy.state.money);
      hud.hitMarker(killed, 90);
    } else {
      fx.sparksAt(hit.point);
    }
  } else if (hit) {
    fx.sparksAt(hit.point);
  }
  fx.tracer(_origin, end);
  fx.shot();
  weapon.pullTrigger();
  player.recoil(weapon.activeDef().kick * 0.16 + random() * 0.004, (random() * 2 - 1) * 0.004);
  bots.alert(body.position, 25);
  hud.setAmmo(weapon.mag(), weapon.reserve(), weapon.activeName(), economy.state.grenades);
  return true;
}

function throwGrenade() {
  if (economy.state.grenades <= 0 || rounds.state.phase !== 'live') return;
  economy.state.grenades -= 1;
  camera.getWorldDirection(_dir);
  state.grenades.push({
    pos: _origin.copy(camera.position).addScaledVector(_dir, 0.5).clone(),
    vel: _dir.clone().multiplyScalar(14).add(new THREE.Vector3(0, 3.5, 0)).add(body.velocity || new THREE.Vector3()),
    fuse: 1.4,
  });
  hud.setAmmo(weapon.mag(), weapon.reserve(), weapon.activeName(), economy.state.grenades);
}

function stepGrenades(dt) {
  for (let i = state.grenades.length - 1; i >= 0; i -= 1) {
    const g = state.grenades[i];
    g.fuse -= dt;
    g.vel.y -= 12 * dt;
    g.pos.addScaledVector(g.vel, dt);
    if (g.pos.y < 0.12) {
      g.pos.y = 0.12;
      g.vel.y *= -0.45;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
    }
    const hit = overlaps(g.pos.x, g.pos.y, g.pos.z, 0.24, 0);
    if (hit) {
      g.pos.addScaledVector(g.vel, -dt);
      g.vel.x *= -0.45;
      g.vel.z *= -0.45;
      g.vel.y *= 0.5;
    }
    if (g.fuse <= 0) {
      explode(g.pos);
      state.grenades.splice(i, 1);
    }
  }
}

function explode(pos) {
  fx.explosionAt(pos);
  fx.explosion();
  bots.alert(pos, 30);
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = Math.hypot(bot.body.state.position.x - pos.x, bot.body.state.position.z - pos.z);
    if (d < 6) {
      const killed = bots.damage(bot, Math.round(120 - (100 * d) / 6), 'torso');
      if (killed && bot.team === 'ash') {
        state.score += 100;
        state.kills += 1;
        economy.earn(REWARDS.kill);
        hud.killFeed(`You ▸ ${bot.name} (frag)`);
      } else if (killed) {
        hud.killFeed(`${bot.name} caught the blast`);
      }
    }
  }
  const pd = Math.hypot(body.position.x - pos.x, body.position.z - pos.z);
  if (pd < 6 && state.alive) damagePlayer(Math.round(120 - (100 * pd) / 6), null);
}

function openBuyMenu() {
  if (rounds.state.phase !== 'buy') return;
  hud.showBuyMenu(economy.state.money);
  if (document.pointerLockElement) document.exitPointerLock();
}

function closeBuyMenu() {
  hud.hideBuyMenu();
  if (state.started && !state.matchOver && !shot) input.requestLock();
}

function buyIndex(index) {
  const item = BUY_ITEMS[index];
  if (!item || rounds.state.phase !== 'buy') return;
  const bought = economy.buy(item);
  if (!bought) return;
  if (item.kind === 'primary') weapon.setPrimary(item.key);
  if (item.kind === 'armor') hud.setHealth(state.health, true);
  hud.setMoney(economy.state.money);
  hud.setAmmo(weapon.mag(), weapon.reserve(), weapon.activeName(), economy.state.grenades);
  hud.showBuyMenu(economy.state.money);
}

hud.onBuy(buyIndex);
hud.onCloseBuyMenu(closeBuyMenu);

hud.onPlay(() => {
  if (shot) return;
  fx.unlockAudio();
  if (state.matchOver) {
    economy.reset();
    state.score = 0;
    state.kills = 0;
    state.deaths = 0;
    rounds.startMatch();
    hud.hideOverlay();
    // The buy menu is open now; its close button re-locks the pointer.
  } else if (!state.started) {
    state.started = true;
    rounds.startMatch();
    hud.hideOverlay();
  } else {
    input.requestLock();
  }
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    state.started = true;
    hud.hideOverlay();
  } else if (!state.matchOver && state.started && !hud.buyMenuOpen()) {
    hud.showOverlay('paused', state.score);
  }
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function step(dt) {
  state.time += dt;
  const keys = input.state.keys;
  const pressed = input.state.pressed;
  if (state.alive && rounds.state.phase === 'live') player.step(dt, keys);
  weapon.step(dt);
  if (rounds.state.phase === 'live') {
    bots.step(dt, state.time, botContext());
    stepGrenades(dt);
  }
  rounds.step(dt, {
    aliveEmber: bots.aliveCount('ember') + (state.alive ? 1 : 0),
    aliveAsh: bots.aliveCount('ash'),
  });
  fx.step(dt);

  // Bomb: pick up a dropped charge, plant the one you carry.
  const bomb = rounds.state.bomb;
  if (bomb.status === 'dropped' && state.alive) {
    const d = Math.hypot(bomb.position.x - body.position.x, bomb.position.z - body.position.z);
    if (d < 1.2) {
      rounds.giveBombToPlayer();
      state.carryingBomb = true;
      hud.banner('YOU HAVE THE CHARGE', 'Plant it at the Furnace — hold E', 2600);
    }
  }
  if (state.carryingBomb && state.alive && rounds.state.phase === 'live') {
    if (keys.has('KeyE') && rounds.playerAtSite(body.position)) {
      state.plantProgress += dt;
      hud.showObjective('PLANTING THE CHARGE', state.plantProgress / 3);
      if (state.plantProgress >= 3) {
        state.plantProgress = 0;
        state.carryingBomb = false;
        hud.hideObjective();
        rounds.plantAt(body.position.clone());
        economy.earn(REWARDS.plant);
        hud.setMoney(economy.state.money);
        hud.banner('CHARGE PLANTED', 'Defend it — 35 seconds', 3000);
        fx.plantBeep();
      }
    } else {
      state.plantProgress = Math.max(0, state.plantProgress - dt * 2);
      if (state.plantProgress === 0) hud.hideObjective();
    }
  }

  // One-tap keys, drained every step. Digits buy while the menu is open, and
  // switch weapons while playing.
  if (pressed.has('KeyR')) weapon.reload();
  if (pressed.has('Digit1')) {
    if (hud.buyMenuOpen()) buyIndex(0);
    else weapon.switchTo('primary');
  }
  if (pressed.has('Digit2')) {
    if (hud.buyMenuOpen()) buyIndex(1);
    else weapon.switchTo('sidearm');
  }
  if (pressed.has('Digit3') && hud.buyMenuOpen()) buyIndex(2);
  if (pressed.has('Digit4') && hud.buyMenuOpen()) buyIndex(3);
  if (pressed.has('Digit5') && hud.buyMenuOpen()) buyIndex(4);
  if (pressed.has('KeyG')) throwGrenade();
  if (pressed.has('KeyB')) {
    if (hud.buyMenuOpen()) closeBuyMenu();
    else if (rounds.state.phase === 'buy') openBuyMenu();
  }
  pressed.clear();

  hud.setTeams(bots.aliveCount('ember') + (state.alive ? 1 : 0), bots.aliveCount('ash'));
  const bombLive = rounds.state.bomb.status === 'planted';
  hud.setTimer(
    bombLive ? rounds.state.bomb.fuse : rounds.state.timer,
    rounds.state.phase,
    bombLive ? 'CHARGE PLANTED' : rounds.state.phase === 'buy' ? 'BUY PHASE' : rounds.state.phase === 'ended' ? 'ROUND OVER' : 'LIVE',
  );
  hud.setScore(rounds.state.wins, rounds.state.round);
  hud.setCrosshair(6 + weapon.spread(player.groundSpeed()) * 900);
}

let accumulator = 0;
let lastTime = performance.now();
let frozen = false;
let prevFiring = false;

function tick(dt) {
  const look = input.takeLook();
  player.look(look.x, look.y);
  const firing = input.state.firing && state.alive && rounds.state.phase === 'live';
  if (firing && weapon.ready() && (weapon.isAuto() || !prevFiring)) {
    shoot(shot ? 0 : weapon.spread(player.groundSpeed()));
  }
  prevFiring = firing;
  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < 5) {
    step(FIXED_STEP);
    accumulator -= FIXED_STEP;
    steps += 1;
  }
  if (accumulator > FIXED_STEP * 5) accumulator = 0;
  syncCamera();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) tick(dt);
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  state.started = true;
  economy.reset();
  if (name === 'start') {
    player.respawn(MAP.attackerSpawns[0]);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -10));
    hud.showOverlay('start', 0);
  } else if (name === 'buy') {
    rounds.startMatch();
    settle(10);
    player.respawn(MAP.attackerSpawns[0]);
    aimAt(new THREE.Vector3(0, 1.5, -10));
    hud.showBuyMenu(economy.state.money);
  } else if (name === 'play') {
    rounds.startMatch();
    rounds.beginLive();
    settle(10);
    const foe = bots.bots.find((b) => b.team === 'ash');
    foe.body.state.position.set(-6, 0, -2);
    foe.group.position.set(-6, 0, -2);
    foe.state = 'hold';
    foe.route = [];
    player.respawn({ x: -4, z: 6, yaw: 0 });
    settle(12);
    aimAt(new THREE.Vector3(-6, 1.1, -2));
    shoot(0);
    settle(2);
  } else if (name === 'end') {
    rounds.startMatch();
    rounds.beginLive();
    settle(10);
    const foe = bots.bots.find((b) => b.team === 'ash');
    foe.body.state.position.set(6, 0, -2);
    foe.group.position.set(6, 0, -2);
    foe.state = 'hold';
    player.respawn({ x: 4, z: 6, yaw: 0 });
    aimAt(new THREE.Vector3(6, 1.1, -2));
    shoot(0);
    settle(2);
    shoot(0);
    settle(2);
    shoot(0);
    rounds.state.wins.ember = 3;
    rounds.state.wins.ash = 2;
    rounds.state.round = 6;
    hud.setScore(rounds.state.wins, 6);
    hud.banner('EMBER WINS THE ROUND', 'Ash team eliminated', 0);
    settle(30);
  }
  hud.setHealth(state.health, economy.state.armor);
  hud.setAmmo(weapon.mag(), weapon.reserve(), weapon.activeName(), economy.state.grenades);
  hud.setMoney(economy.state.money);
  hud.setScore(rounds.state.wins, rounds.state.round);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
hud.setHealth(100, false);
hud.setAmmo(weapon.mag(), weapon.reserve(), weapon.activeName(), 0);
hud.setMoney(economy.state.money);
hud.setScore({ ember: 0, ash: 0 }, 1);
hud.setTeams(4, 4);
// Debug/testing handle: lets an automated play-test read the match state and drive
// the fixed-step simulation (tick) without waiting on the display's frame rate.
window.__ember = { state, rounds, bots, economy, weapon, player, input, tick, settle };
if (shot) runShot(shot);
else requestAnimationFrame(frame);
