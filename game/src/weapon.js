// The armoury: one sidearm every player owns and three primaries to buy. Each weapon
// owns its numbers — magazine, damage, fire rate, reload and spread — and a view model
// built from boxes. It never touches the ray or the damage; main.js owns those.
// Spread grows with movement and with sustained fire (bloom), so stopping to aim pays.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: { name: 'P9 Sidearm', price: 0, mag: 12, reserve: 48, gap: 0.16, reload: 1.2, damage: 26, auto: false, spreadStill: 0.004, spreadMove: 0.03, barrel: 0.22, kick: 0.045 },
  rifle: { name: 'VK-7 Repeater', price: 1200, mag: 30, reserve: 90, gap: 0.096, reload: 1.9, damage: 34, auto: true, spreadStill: 0.0022, spreadMove: 0.028, barrel: 0.42, kick: 0.055 },
  smg: { name: 'Hornet-9', price: 800, mag: 24, reserve: 96, gap: 0.062, reload: 1.5, damage: 22, auto: true, spreadStill: 0.004, spreadMove: 0.034, barrel: 0.3, kick: 0.038 },
  marksman: { name: 'Longshot', price: 2200, mag: 5, reserve: 15, gap: 0.9, reload: 2.6, damage: 90, auto: false, spreadStill: 0.0008, spreadMove: 0.05, barrel: 0.62, kick: 0.11 },
};

const BLOOM_PER_SHOT = 0.004;
const BLOOM_MAX = 0.03;
const BLOOM_DECAY = 0.05;

function slotState(def) {
  return { def, mag: def.mag, reserve: def.reserve, cooldown: 0, reloadLeft: 0 };
}

export function createWeapon(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });

  const model = new THREE.Group();
  model.position.set(0.26, -0.24, -0.5);
  model.scale.setScalar(0.75);
  camera.add(model);
  let modelParts = [];

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.18),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.26, -0.22, -1.0);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.26, -0.2, -0.7);
  camera.add(flashLight);

  const state = {
    primary: slotState(WEAPONS.rifle),
    sidearm: slotState(WEAPONS.pistol),
    active: 'primary',
    flash: 0,
    kick: 0,
    bloom: 0,
  };

  function buildModel() {
    for (const part of modelParts) model.remove(part);
    modelParts = [];
    const def = state[state.active].def;
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, def.barrel), grip);
    barrel.position.set(0, 0.025, -0.21 - def.barrel / 2);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.3);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.08), accent);
    sight.position.set(0, 0.075, -0.05);
    model.add(receiver, barrel, stock, sight);
    modelParts = [receiver, barrel, stock, sight];
  }
  buildModel();

  function active() {
    return state[state.active];
  }

  function step(dt) {
    for (const slot of [state.primary, state.sidearm]) {
      slot.cooldown = Math.max(0, slot.cooldown - dt);
      if (slot.reloadLeft > 0) {
        slot.reloadLeft = Math.max(0, slot.reloadLeft - dt);
        if (slot.reloadLeft === 0) {
          const need = slot.def.mag - slot.mag;
          const take = Math.min(need, slot.reserve);
          slot.mag += take;
          slot.reserve -= take;
        }
      }
    }
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bloom = Math.max(0, state.bloom - BLOOM_DECAY * dt);
    const reloading = active().reloadLeft > 0;
    model.position.z = -0.5 + state.kick;
    model.rotation.x = state.kick * 2.2 - (reloading ? 0.55 * Math.min(1, (active().def.reload - active().reloadLeft) * 2) : 0);
    flash.visible = state.flash > 0;
    flash.rotation.z = (Math.random() - 0.5) * 0.6;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
  }

  return {
    state,
    step,
    activeDef() {
      return active().def;
    },
    activeName() {
      return active().def.name;
    },
    mag() { return active().mag; },
    reserve() { return active().reserve; },
    ready() {
      const slot = active();
      return slot.mag > 0 && slot.cooldown === 0 && slot.reloadLeft === 0;
    },
    isAuto() {
      return active().def.auto;
    },
    pullTrigger() {
      const slot = active();
      slot.cooldown = slot.def.gap;
      state.flash = 0.06;
      state.kick = slot.def.kick;
      state.bloom = Math.min(BLOOM_MAX, state.bloom + BLOOM_PER_SHOT);
    },
    takeRound() {
      const slot = active();
      if (slot.mag <= 0) return false;
      slot.mag -= 1;
      return true;
    },
    reload() {
      const slot = active();
      if (slot.reloadLeft > 0 || slot.mag === slot.def.mag || slot.reserve === 0) return;
      slot.reloadLeft = slot.def.reload;
    },
    spread(speed) {
      const slot = active();
      return slot.def.spreadStill + Math.min(1, speed / 5.2) * slot.def.spreadMove + state.bloom;
    },
    switchTo(which) {
      if (state.active === which) return;
      if (which === 'primary' && !state.primary) return;
      state.active = which;
      buildModel();
    },
    hasPrimary() {
      return state.primary !== null;
    },
    setPrimary(key) {
      state.primary = slotState(WEAPONS[key]);
      state.active = 'primary';
      buildModel();
    },
    refill() {
      for (const slot of [state.primary, state.sidearm]) {
        if (!slot) continue;
        slot.mag = slot.def.mag;
        slot.reserve = slot.def.reserve;
        slot.cooldown = 0;
        slot.reloadLeft = 0;
      }
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
    },
  };
}
