// The DOM HUD: health, ammo, money, timer, round score, team counts, kill feed,
// banners, the plant/defuse bar and the buy menu. It never touches the simulation;
// main.js pushes numbers in and reads the play/buy callbacks out. Every setter
// skips a DOM write when the value did not change.
import { BUY_ITEMS } from './economy.js';

const COPY = {
  start: {
    title: 'Ember Yard',
    copy: 'A tactical round shooter in a dusk scrapyard. Plant the charge at the Furnace or clear the Ash team — first to 5 rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'Ember Yard',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  end: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const grenadeCount = $('grenade-count');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const armorRow = $('armor-row');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const timerPhase = $('timer-phase');
  const scoreValue = $('score-value');
  const teamsValue = $('teams-value');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const objective = $('objective');
  const objectiveLabel = $('objective-label');
  const objectiveFill = $('objective-fill');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const damage = $('damage');
  const buyMenu = $('buymenu');
  const buyList = $('buy-list');
  const buyMoney = $('buy-money');
  const buyClose = $('buy-close');
  let hitTimer = 0;
  let bannerTimer = 0;
  let last = {};
  let closeBuyHandler = null;

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  const buyHandlers = new Set();
  BUY_ITEMS.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'buy-item';
    row.innerHTML = `<span class="buy-key">${index + 1}</span><span class="buy-mid"><span class="buy-name"></span><span class="buy-blurb"></span></span><span class="buy-price"></span>`;
    row.querySelector('.buy-name').textContent = item.name;
    row.querySelector('.buy-blurb').textContent = item.blurb;
    row.querySelector('.buy-price').textContent = `$${item.price}`;
    row.addEventListener('click', () => { for (const h of buyHandlers) h(index); });
    buyList.appendChild(row);
  });
  const buyRows = Array.from(buyList.children);

  return {
    setHealth(hp, armor) {
      const pct = Math.max(0, Math.min(100, hp));
      healthFill.style.width = `${pct}%`;
      healthFill.classList.toggle('low', pct <= 30);
      setText(healthValue, 'hp', String(Math.ceil(hp)));
      armorRow.classList.toggle('on', armor > 0);
    },
    setAmmo(mag, reserve, name, grenades) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'res', `/ ${reserve}`);
      setText(weaponName, 'wname', name);
      setText(grenadeCount, 'nades', grenades > 0 ? `◉ ${grenades}` : '');
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setMoney(money) {
      setText(moneyValue, 'money', `$${money}`);
      setText(buyMoney, 'buymoney', `$${money}`);
    },
    setTimer(seconds, phase, bombText) {
      const s = Math.max(0, Math.ceil(seconds));
      setText(timerValue, 'timer', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      setText(timerPhase, 'phase', bombText || phase);
    },
    setScore(wins, round) {
      setText(scoreValue, 'score', `EMBER ${wins.ember} — ${wins.ash} ASH · ROUND ${round}`);
    },
    setTeams(emberAlive, ashAlive) {
      setText(teamsValue, 'teams', `EMBER ${emberAlive} · ASH ${ashAlive}`);
    },
    setCrosshair(spreadPx) {
      crosshair.style.setProperty('--gap', `${spreadPx.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damage.classList.add('on');
      setTimeout(() => damage.classList.remove('on'), 120);
    },
    killFeed(text) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => { if (line.parentNode) line.parentNode.removeChild(line); }, 5000);
    },
    banner(titleText, subText, ms = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText || '';
      banner.classList.remove('hidden');
      clearTimeout(bannerTimer);
      if (ms > 0) bannerTimer = setTimeout(() => banner.classList.add('hidden'), ms);
    },
    hideBanner() {
      banner.classList.add('hidden');
    },
    showObjective(label, progress) {
      objective.classList.remove('hidden');
      objectiveLabel.textContent = label;
      objectiveFill.style.width = `${Math.round(progress * 100)}%`;
    },
    hideObjective() {
      objective.classList.add('hidden');
    },
    showBuyMenu(money) {
      this.setMoney(money);
      BUY_ITEMS.forEach((item, i) => {
        buyRows[i].classList.toggle('poor', money < item.price);
      });
      buyMenu.classList.remove('hidden');
    },
    hideBuyMenu() {
      buyMenu.classList.add('hidden');
    },
    buyMenuOpen() {
      return !buyMenu.classList.contains('hidden');
    },
    onBuy(handler) {
      buyHandlers.add(handler);
    },
    onCloseBuyMenu(handler) {
      closeBuyHandler = handler;
      buyClose.addEventListener('click', () => { if (closeBuyHandler) closeBuyHandler(); });
    },
    showOverlay(mode, data) {
      const text = COPY[mode];
      title.textContent = text.title;
      if (mode === 'end' && data) {
        copy.textContent = `${data.winner === 'ember' ? 'Ember takes the match' : 'Ash takes the match'} — ${data.wins.ember} : ${data.wins.ash}. You scored ${data.score}.`;
      } else {
        copy.textContent = text.copy;
      }
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
