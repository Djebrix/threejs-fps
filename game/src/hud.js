// The DOM HUD: crosshair, hit marker, ammo, health, timer, score, money, kill
// feed, bomb status, buy menu and the overlay panels. It never touches the
// simulation; main.js pushes numbers in and reads callbacks out. DOM writes are
// cached so a steady value costs no layout work.
import { WEAPONS, GRENADE_PRICE, ARMOR_PRICE } from './economy.js';

const OVERLAY_COPY = {
  start: {
    title: 'EMBERLINE',
    copy: 'Foundry yard, three lanes, two sites. Plant the charge at A or B, or wipe the crew. First to 5 rounds takes the yard.',
    action: 'Click to play',
  },
  paused: {
    title: 'EMBERLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  roundEnd: {
    title: '',
    copy: '',
    action: 'Next round',
  },
  matchEnd: {
    title: '',
    copy: '',
    action: 'Play again',
  },
};

export function createHud(callbacks) {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammo = $('ammo');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const healthValue = $('health-value');
  const healthBar = $('health-bar');
  const armorValue = $('armor-value');
  const timerValue = $('timer-value');
  const scoreValue = $('score-value');
  const moneyValue = $('money-value');
  const aliveValue = $('alive-value');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const bombStatus = $('bomb-status');
  const bombText = $('bomb-text');
  const bombBar = $('bomb-bar');
  const plantPrompt = $('plant-prompt');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const buyGrid = $('buy-grid');
  const hint = $('hint');

  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastHealth = -1;
  let lastArmor = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastMoney = -1;
  let lastAlive = '';
  let lastBomb = '';
  let hitTimer = 0;
  let bannerTimer = 0;

  function buildBuyMenu() {
    buyGrid.innerHTML = '';
    for (const def of Object.values(WEAPONS)) {
      const row = document.createElement('div');
      row.className = 'buy-row';
      row.dataset.weapon = def.id;
      row.innerHTML = `<span class="buy-key">${def.key}</span><span class="buy-name">${def.name}</span><span class="buy-stat">${def.damage} dmg · ${def.mag} mag</span><span class="buy-price">$${def.price}</span>`;
      row.addEventListener('click', () => callbacks.onBuyWeapon(def.id));
      buyGrid.appendChild(row);
    }
    const grenade = document.createElement('div');
    grenade.className = 'buy-row';
    grenade.dataset.item = 'grenade';
    grenade.innerHTML = `<span class="buy-key">6</span><span class="buy-name">Frag Grenade</span><span class="buy-stat">AoE burst · G to throw</span><span class="buy-price">$${GRENADE_PRICE}</span>`;
    grenade.addEventListener('click', () => callbacks.onBuyGrenade());
    buyGrid.appendChild(grenade);
    const armor = document.createElement('div');
    armor.className = 'buy-row';
    armor.dataset.item = 'armor';
    armor.innerHTML = `<span class="buy-key">7</span><span class="buy-name">Kevlar Vest</span><span class="buy-stat">100 armour</span><span class="buy-price">$${ARMOR_PRICE}</span>`;
    armor.addEventListener('click', () => callbacks.onBuyArmor());
    buyGrid.appendChild(armor);
  }
  buildBuyMenu();

  return {
    setAmmo(mag, reserve, weapon) {
      if (mag === lastMag && reserve === lastReserve && weapon === lastWeapon) return;
      lastMag = mag;
      lastReserve = reserve;
      lastWeapon = weapon;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = weapon;
      ammo.classList.toggle('empty', mag === 0);
    },
    setHealth(health, armor) {
      if (health === lastHealth && armor === lastArmor) return;
      lastHealth = health;
      lastArmor = armor;
      healthValue.textContent = String(health);
      healthBar.style.width = `${health}%`;
      healthBar.classList.toggle('low', health <= 30);
      armorValue.textContent = armor > 0 ? `🛡 ${armor}` : '';
    },
    setTimer(seconds, phase) {
      const text = phase === 'buy' ? `BUY ${Math.ceil(seconds)}` : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
      if (text === lastTimer) return;
      lastTimer = text;
      timerValue.textContent = text;
      timerValue.classList.toggle('buy-phase', phase === 'buy');
    },
    setScore(won, lost, round) {
      const text = `${won} — ${lost}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreValue.textContent = `${text} · R${round}`;
    },
    setMoney(money) {
      if (money === lastMoney) return;
      lastMoney = money;
      moneyValue.textContent = `$${money}`;
      buyMoney.textContent = `$${money}`;
    },
    setAlive(playerAlive, botsAlive) {
      const text = `${playerAlive ? 1 : 0} v ${botsAlive}`;
      if (text === lastAlive) return;
      lastAlive = text;
      aliveValue.textContent = text;
    },
    setCrosshairGap(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    feed(text, good) {
      const line = document.createElement('div');
      line.className = `feed-line${good ? ' good' : ''}`;
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
    },
    showBanner(titleText, subText, holdMs = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner.hidden = true; }, holdMs);
    },
    hideBanner() {
      banner.hidden = true;
    },
    setBomb(state, seconds, defuseProgress) {
      // state: 'none' | 'carried' | 'planted' | 'planting' | 'defusing'
      const key = `${state}|${Math.ceil(seconds)}|${Math.round(defuseProgress * 20)}`;
      if (key === lastBomb) return;
      lastBomb = key;
      if (state === 'none') {
        bombStatus.hidden = true;
        plantPrompt.hidden = true;
        return;
      }
      bombStatus.hidden = false;
      if (state === 'carried') {
        bombText.textContent = 'CHARGE READY — plant at A or B (hold E)';
        bombBar.style.width = '100%';
        bombBar.classList.remove('danger');
      } else if (state === 'planting') {
        bombText.textContent = `PLANTING… ${Math.ceil(seconds)}s`;
        bombBar.style.width = `${Math.max(0, Math.min(100, (1 - seconds / 3) * 100))}%`;
        bombBar.classList.remove('danger');
      } else if (state === 'planted') {
        bombText.textContent = `CHARGE PLANTED — ${Math.ceil(seconds)}s to detonation`;
        bombBar.style.width = `${Math.max(0, Math.min(100, (seconds / 35) * 100))}%`;
        bombBar.classList.toggle('danger', seconds < 10);
      } else if (state === 'defusing') {
        bombText.textContent = `ENEMY DEFUSING — ${Math.ceil(defuseProgress)}s left`;
        bombBar.style.width = `${Math.max(0, Math.min(100, (1 - defuseProgress / 5) * 100))}%`;
        bombBar.classList.add('danger');
      }
      plantPrompt.hidden = state !== 'carried';
    },
    showBuyMenu(open, owned, money) {
      buyMenu.hidden = !open;
      for (const row of buyGrid.children) {
        const id = row.dataset.weapon;
        if (id) {
          const def = WEAPONS[id];
          row.classList.toggle('owned', owned.has(id));
          row.classList.toggle('cant', !owned.has(id) && money < def.price);
        }
      }
    },
    setHint(text) {
      hint.textContent = text;
    },
    showOverlay(mode, titleText, copyText, actionText) {
      const text = OVERLAY_COPY[mode];
      title.textContent = titleText ?? text.title;
      copy.textContent = copyText ?? text.copy;
      play.textContent = actionText ?? text.action;
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
