// The round: buy phase, live round, and the bomb. Ember attacks the Furnace site;
// Ash defends it. A round ends by elimination, by the charge detonating, by a defuse,
// or by the clock — first team to 5 rounds takes the match. The bomb is one object:
// carried by a bot (or the player), dropped where its carrier falls, planted at the
// site on a 35-second fuse, or defused. Hooks tell main.js what happened.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { MAP } from './world.js';

export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const BOMB_SECONDS = 35;
export const WIN_ROUNDS = 5;

export function createRounds(scene, hooks) {
  const bombGeometry = new THREE.BoxGeometry(0.34, 0.24, 0.2);
  const bombMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.site), roughness: 0.4,
    emissive: new THREE.Color(PALETTE.site), emissiveIntensity: 0.5,
  });
  const bombMesh = new THREE.Mesh(bombGeometry, bombMaterial);
  bombMesh.visible = false;
  bombMesh.castShadow = true;
  scene.add(bombMesh);

  const state = {
    round: 1,
    wins: { ember: 0, ash: 0 },
    phase: 'buy',
    timer: BUY_SECONDS,
    bomb: { status: 'carried', carrier: null, position: new THREE.Vector3(), fuse: BOMB_SECONDS },
    lastReason: '',
    matchWinner: null,
  };

  function setBombDropped(position) {
    state.bomb.status = 'dropped';
    state.bomb.carrier = null;
    state.bomb.position.copy(position);
    state.bomb.position.y = 0.14;
    bombMesh.visible = true;
    bombMesh.position.copy(state.bomb.position);
  }

  function setBombPlanted(position) {
    state.bomb.status = 'planted';
    state.bomb.carrier = null;
    state.bomb.fuse = BOMB_SECONDS;
    state.bomb.position.copy(position);
    state.bomb.position.y = 0.14;
    bombMesh.visible = true;
    bombMesh.position.copy(state.bomb.position);
    hooks.onBombPlanted(state.bomb.position);
  }

  function endRound(winner, reason) {
    if (state.phase === 'ended' || state.phase === 'match') return;
    state.wins[winner] += 1;
    state.lastReason = reason;
    state.phase = 'ended';
    state.timer = 4.5;
    bombMesh.visible = state.bomb.status === 'planted';
    hooks.onRoundEnd(winner, reason, { ...state.wins }, state.round);
  }

  function startRound(round, carrierName) {
    state.round = round;
    state.phase = 'buy';
    state.timer = BUY_SECONDS;
    state.bomb.status = 'carried';
    state.bomb.carrier = carrierName;
    state.bomb.fuse = BOMB_SECONDS;
    bombMesh.visible = false;
    hooks.onRoundStart(round);
  }

  function startMatch() {
    state.round = 1;
    state.wins.ember = 0;
    state.wins.ash = 0;
    state.matchWinner = null;
    state.phase = 'buy';
    state.timer = BUY_SECONDS;
    state.bomb.status = 'carried';
    bombMesh.visible = false;
    hooks.onMatchStart();
    hooks.onRoundStart(1);
  }

  return {
    state,
    startMatch,
    startRound,
    carrierName() {
      return state.bomb.carrier;
    },
    beginLive() {
      if (state.phase !== 'buy') return;
      state.phase = 'live';
      state.timer = ROUND_SECONDS;
      hooks.onPhaseChange('live');
    },
    plantAt(position) {
      if (state.bomb.status !== 'carried' && state.bomb.status !== 'dropped') return;
      setBombPlanted(position);
    },
    defuse() {
      if (state.bomb.status !== 'planted') return;
      state.bomb.status = 'defused';
      bombMesh.visible = false;
      hooks.onBombDefused();
      endRound('ash', 'Charge defused');
    },
    dropBomb(position) {
      if (state.bomb.status !== 'carried') return;
      setBombDropped(position);
      hooks.onBombDropped(position);
    },
    giveBombToPlayer() {
      state.bomb.status = 'carried';
      state.bomb.carrier = 'player';
      bombMesh.visible = false;
    },
    takeBombFromPlayer(position) {
      if (state.bomb.status !== 'carried') return;
      setBombDropped(position);
    },
    playerAtSite(position) {
      return Math.abs(position.x - MAP.site.x) <= MAP.site.halfX && Math.abs(position.z - MAP.site.z) <= MAP.site.halfZ;
    },
    bombPosition() {
      return state.bomb.status === 'planted' || state.bomb.status === 'dropped' ? state.bomb.position : null;
    },
    step(dt, ctx) {
      if (state.phase === 'match') return;
      if (state.phase === 'buy') {
        state.timer -= dt;
        if (state.timer <= 0) this.beginLive();
        return;
      }
      if (state.phase === 'ended') {
        state.timer -= dt;
        if (state.timer <= 0) {
          if (state.wins.ember >= WIN_ROUNDS || state.wins.ash >= WIN_ROUNDS) {
            state.phase = 'match';
            state.matchWinner = state.wins.ember > state.wins.ash ? 'ember' : 'ash';
            hooks.onMatchEnd(state.matchWinner, { ...state.wins });
          } else {
            hooks.onNextRound(state.round + 1);
          }
        }
        return;
      }
      // live
      if (state.bomb.status === 'planted') {
        state.bomb.fuse -= dt;
        if (state.bomb.fuse <= 0) {
          state.bomb.status = 'detonated';
          bombMesh.visible = false;
          hooks.onBombDetonated(state.bomb.position);
          endRound('ember', 'Charge detonated');
          return;
        }
      } else {
        state.timer -= dt;
        if (state.timer <= 0) {
          endRound('ash', 'Time expired — site held');
          return;
        }
      }
      const emberAlive = ctx.aliveEmber;
      const ashAlive = ctx.aliveAsh;
      if (state.bomb.status === 'planted') {
        if (ashAlive === 0) {
          // No defenders left to defuse: the fuse decides the round.
        }
      } else if (emberAlive === 0) {
        endRound('ash', 'Ember team eliminated');
      } else if (ashAlive === 0) {
        endRound('ember', 'Ash team eliminated');
      }
    },
  };
}
