// Effects and sound, both pooled so the hot loop allocates nothing: tracers that
// fade, impact sparks, the grenade's explosion ring, and a tiny WebAudio synth for
// shots, hits, reloads and the blast. No audio files, no network — oscillators only,
// created on the first user gesture and guarded so headless runs never throw.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACERS = 24;
const SPARKS = 40;

export function createFx(scene) {
  const tracerMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9 });
  const tracers = [];
  for (let i = 0; i < TRACERS; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, tracerMaterial.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;

  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
  const sparkMaterial = new THREE.PointsMaterial({ color: new THREE.Color(PALETTE.site), size: 0.09, transparent: true, opacity: 0 });
  const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
  sparks.frustumCulled = false;
  scene.add(sparks);
  const sparkVel = new Float32Array(SPARKS * 3);
  const sparkPos = sparkGeometry.attributes.position.array;
  let sparkLife = 0;

  const ringGeometry = new THREE.RingGeometry(0.4, 0.55, 32);
  const ringMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeometry, ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  let ringLife = 0;
  const blastLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 18, 1.6);
  scene.add(blastLight);

  let audio = null;
  function ensureAudio() {
    // Only ever created from unlockAudio, which runs on a user gesture: creating
    // the context from a sound call would warn in headless runs and before play.
    if (audio) return audio;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      audio = { ctx: new Ctx(), master: null };
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = 0.14;
      audio.master.connect(audio.ctx.destination);
    } catch {
      audio = null;
    }
    return audio;
  }

  function tone(freq, dur, type, slide) {
    const a = audio;
    if (!a) return;
    try {
      if (a.ctx.state === 'suspended') void a.ctx.resume();
      const osc = a.ctx.createOscillator();
      const gain = a.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, a.ctx.currentTime);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), a.ctx.currentTime + dur);
      gain.gain.setValueAtTime(0.9, a.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, a.ctx.currentTime + dur);
      osc.connect(gain);
      gain.connect(a.master);
      osc.start();
      osc.stop(a.ctx.currentTime + dur);
    } catch { /* sound is decoration; never break the game */ }
  }

  function noise(dur) {
    const a = audio;
    if (!a) return;
    try {
      if (a.ctx.state === 'suspended') void a.ctx.resume();
      const len = Math.floor(a.ctx.sampleRate * dur);
      const buffer = a.ctx.createBuffer(1, len, a.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = a.ctx.createBufferSource();
      src.buffer = buffer;
      const gain = a.ctx.createGain();
      gain.gain.value = 0.8;
      src.connect(gain);
      gain.connect(a.master);
      src.start();
    } catch { /* ignore */ }
  }

  return {
    unlockAudio() {
      ensureAudio();
    },
    shot() {
      noise(0.09);
      tone(180, 0.07, 'square', 60);
    },
    enemyShot() {
      noise(0.07);
    },
    hit() {
      tone(1200, 0.05, 'sine');
    },
    kill() {
      tone(1200, 0.06, 'sine');
      setTimeout(() => tone(1800, 0.08, 'sine'), 60);
    },
    reload() {
      tone(500, 0.05, 'square', 300);
    },
    explosion() {
      noise(0.5);
      tone(90, 0.5, 'sine', 30);
    },
    plantBeep() {
      tone(880, 0.08, 'sine');
    },
    tracer(from, to) {
      const slot = tracers[tracerIndex];
      tracerIndex = (tracerIndex + 1) % TRACERS;
      const pos = slot.line.geometry.attributes.position.array;
      pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
      pos[3] = to.x; pos[4] = to.y; pos[5] = to.z;
      slot.line.geometry.attributes.position.needsUpdate = true;
      slot.line.visible = true;
      slot.line.material.opacity = 0.9;
      slot.life = 0.09;
    },
    sparksAt(point) {
      for (let i = 0; i < SPARKS; i += 1) {
        sparkPos[i * 3] = point.x;
        sparkPos[i * 3 + 1] = point.y;
        sparkPos[i * 3 + 2] = point.z;
        sparkVel[i * 3] = (Math.random() * 2 - 1) * 3;
        sparkVel[i * 3 + 1] = Math.random() * 3;
        sparkVel[i * 3 + 2] = (Math.random() * 2 - 1) * 3;
      }
      sparkGeometry.attributes.position.needsUpdate = true;
      sparkLife = 0.3;
      sparkMaterial.opacity = 1;
    },
    explosionAt(point) {
      ring.position.set(point.x, point.y + 0.1, point.z);
      ring.scale.set(1, 1, 1);
      ring.visible = true;
      ringLife = 0.5;
      blastLight.position.copy(point);
      blastLight.position.y += 1;
      blastLight.intensity = 60;
    },
    step(dt) {
      for (const slot of tracers) {
        if (slot.life <= 0) continue;
        slot.life -= dt;
        slot.line.material.opacity = Math.max(0, slot.life / 0.09) * 0.9;
        if (slot.life <= 0) slot.line.visible = false;
      }
      if (sparkLife > 0) {
        sparkLife -= dt;
        for (let i = 0; i < SPARKS; i += 1) {
          sparkPos[i * 3] += sparkVel[i * 3] * dt;
          sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
          sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
          sparkVel[i * 3 + 1] -= 9 * dt;
        }
        sparkGeometry.attributes.position.needsUpdate = true;
        sparkMaterial.opacity = Math.max(0, sparkLife / 0.3);
      }
      if (ringLife > 0) {
        ringLife -= dt;
        const t = 1 - ringLife / 0.5;
        ring.scale.set(1 + t * 14, 1 + t * 14, 1);
        ringMaterial.opacity = Math.max(0, 1 - t);
        blastLight.intensity = Math.max(0, (1 - t) * 60);
        if (ringLife <= 0) ring.visible = false;
      }
    },
  };
}
