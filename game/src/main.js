// EMBERLINE — boot and the one loop: a fixed 60 Hz simulation feeding a render
// at the display's rate. Rounds, the bomb, the economy and the HUD all meet here;
// the modules own their own state. ?shot=start|play|end|plant with &seed=N sets
// up a deterministic frame for a capture, renders it twice, then freezes it and
// sets window.__shotReady. ?selftest=1 drives the game with synthetic input and
// writes its verdict to window.__selftest.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, PLAYER_SPAWN, BOT_SPAWNS } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, createGrenades } from './weapon.js';
import { createBots } from './bots.js';
import { createEconomy, WEAPONS, GRENADE_PRICE, ARMOR_PRICE } from './economy.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const ROUND_TIME = 100;
const BUY_TIME = 10;
const PLANT_TIME = 3;
const BOMB_TIME = 35;
const WIN_ROUNDS = 5;
const MAX_ROUNDS = 9;
const BOT_NAMES = ['RUST', 'SLAG', 'COKE', 'FLUX', 'ASH'];

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const selftest = params.get('selftest') === '1';
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
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 22, 55);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const bots = createBots(scene, world, random);
const weapon = createWeapon(camera);
const grenades = createGrenades(scene);
const audio = createAudio();
const economy = createEconomy();
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const shootables = world.shootables.concat(bots.bots.flatMap((b) => [b.torso, b.head]));
const direction = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();

// The bomb: a charge box with a blinking beacon, placed where the player plants it.
const bombGroup = new THREE.Group();
const bombBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.34, 0.22, 0.24),
  new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c1e22'), roughness: 0.5, metalness: 0.4 }),
);
const bombLight = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 8, 6),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
);
bombLight.position.y = 0.16;
bombGroup.add(bombBox, bombLight);
bombGroup.visible = false;
scene.add(bombGroup);

const hud = createHud({
  onBuyWeapon(id) { buyWeapon(id); },
  onBuyGrenade() { buyGrenade(); },
  onBuyArmor() { buyArmor(); },
});

const body = player.state;
const markerHoldMs = shot ? 4000 : 90;

// One place for match state: phase, round, timer, bomb, scores.
const match = {
  phase: 'menu', // menu | buy | live | roundEnd | matchEnd
  round: 1,
  roundsWon: 0,
  roundsLost: 0,
  timer: BUY_TIME,
  phaseTime: 0,
  bombPlanted: false,
  bombTimer: 0,
  bombSite: null,
  bombPos: new THREE.Vector3(),
  planting: 0,
  beepAt: 0,
  buyOpen: false,
  started: false,
};

let elapsed = 0;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let testLog = [];

function logTest(event, data) {
  testLog.push({ t: Number(elapsed.toFixed(2)), event, ...data });
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

function siteNearPlayer() {
  for (const key of ['A', 'B']) {
    const site = world.sites[key];
    const dx = body.position.x - site.center.x;
    const dz = body.position.z - site.center.z;
    if (Math.hypot(dx, dz) < site.radius) return key;
  }
  return null;
}

function startMatch() {
  match.roundsWon = 0;
  match.roundsLost = 0;
  match.round = 1;
  economy.reset();
  weapon.equip('pistol');
  startRound();
}

function startRound() {
  const survived = body.alive;
  if (!survived) {
    economy.state.owned = new Set(['pistol']);
    economy.state.grenades = 0;
    economy.state.armor = 0;
    weapon.equip('pistol');
  } else if (!economy.state.owned.has(weapon.state.current)) {
    weapon.equip('pistol');
  }
  player.reset(PLAYER_SPAWN, economy.state.armor);
  body.yaw = 0; // face north, up the mid lane
  bots.reset(BOT_SPAWNS);
  grenades.clear();
  match.phase = 'buy';
  match.timer = BUY_TIME;
  match.phaseTime = 0;
  match.bombPlanted = false;
  match.bombTimer = 0;
  match.bombSite = null;
  match.planting = 0;
  match.buyOpen = false;
  bombGroup.visible = false;
  hud.hideBanner();
  hud.showBuyMenu(false, economy.state.owned, economy.state.money);
  hud.setBomb('carried', 0, 0);
  hud.setHint('Buy phase — press B for the buy menu');
  hud.showBanner(`ROUND ${match.round}`, match.roundsWon >= 4 || match.roundsLost >= 4 ? 'Match point' : 'First to 5 rounds', 2200);
  syncCamera();
}

function endRound(won, reason) {
  if (match.phase === 'roundEnd' || match.phase === 'matchEnd') return;
  economy.awardRound(won);
  if (won) match.roundsWon += 1;
  else match.roundsLost += 1;
  match.phase = 'roundEnd';
  match.phaseTime = 0;
  match.timer = 3.5;
  match.buyOpen = false;
  hud.showBuyMenu(false, economy.state.owned, economy.state.money);
  hud.setBomb('none', 0, 0);
  hud.setHint('');
  hud.showBanner(won ? 'ROUND WON' : 'ROUND LOST', reason, 3200);
  if (won) audio.roundWin();
  else audio.roundLose();
  if (document.pointerLockElement) document.exitPointerLock();
  logTest('roundEnd', { won, reason, score: `${match.roundsWon}-${match.roundsLost}` });
}

function endMatch() {
  match.phase = 'matchEnd';
  const won = match.roundsWon > match.roundsLost;
  hud.showOverlay(
    'matchEnd',
    won ? 'YARD TAKEN' : 'YARD LOST',
    won
      ? `You took Emberline ${match.roundsWon}—${match.roundsLost}. The foundry is yours.`
      : `The crew held Emberline ${match.roundsLost}—${match.roundsWon}. Run it back.`,
    'Play again',
  );
  if (document.pointerLockElement) document.exitPointerLock();
}

function buyWeapon(id) {
  if (match.phase !== 'buy') return;
  const def = WEAPONS[id];
  if (!def) return;
  if (economy.state.owned.has(id)) {
    weapon.equip(id);
    audio.buy();
    return;
  }
  if (economy.buyWeapon(id)) {
    weapon.equip(id);
    audio.buy();
    hud.feed(`Bought ${def.name} — $${def.price}`, true);
  } else {
    audio.denied();
  }
  refreshHud();
}

function buyGrenade() {
  if (match.phase !== 'buy') return;
  if (economy.buyGrenade()) {
    audio.buy();
    hud.feed(`Bought frag grenade — $${GRENADE_PRICE}`, true);
  } else audio.denied();
  refreshHud();
}

function buyArmor() {
  if (match.phase !== 'buy') return;
  if (economy.buyArmor()) {
    audio.buy();
    body.armor = 100;
    hud.feed(`Bought kevlar — $${ARMOR_PRICE}`, true);
  } else audio.denied();
  refreshHud();
}

function refreshHud() {
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.currentDef().name);
  hud.setHealth(Math.ceil(body.health), Math.ceil(body.armor));
  hud.setMoney(economy.state.money);
  hud.setScore(match.roundsWon, match.roundsLost, match.round);
  hud.setAlive(body.alive, bots.aliveCount());
}

function shoot() {
  if (!weapon.takeRound()) {
    audio.dry();
    return;
  }
  const def = weapon.currentDef();
  camera.getWorldDirection(direction);
  const spread = weapon.spread(player.groundSpeed());
  let hitAny = false;
  for (let pellet = 0; pellet < def.pellets; pellet += 1) {
    direction.x += (random() * 2 - 1) * spread;
    direction.y += (random() * 2 - 1) * spread;
    direction.z += (random() * 2 - 1) * spread;
    direction.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(camera.position, direction);
    const hit = raycaster.intersectObjects(shootables, false)[0];
    if (!hit) continue;
    const bot = hit.object.userData.bot;
    if (!bot || !bot.alive) continue;
    const isHead = hit.object.userData.part === 'head';
    const killed = bots.damage(bot, def.damage * (isHead ? def.headMult : 1));
    hitAny = true;
    hud.hitMarker(killed, markerHoldMs);
    audio.hit(killed);
    if (killed) {
      economy.awardKill();
      hud.feed(`You eliminated ${BOT_NAMES[bot.id]}${isHead ? ' — HEADSHOT' : ''}`, true);
      logTest('kill', { bot: BOT_NAMES[bot.id], head: isHead });
      if (bots.aliveCount() === 0) {
        endRound(true, 'Enemy team eliminated');
      }
    }
  }
  weapon.pullTrigger();
  audio.shot(def.kind);
  bots.hearShot(body.position);
  player.recoil(0.009 + random() * 0.004 + (def.kind === 'shotgun' ? 0.02 : 0), (random() * 2 - 1) * 0.004);
  refreshHud();
}

function throwGrenade() {
  if (!economy.useGrenade()) {
    audio.denied();
    return;
  }
  camera.getWorldDirection(direction);
  tmpVec.copy(camera.position).addScaledVector(direction, 0.4);
  tmpVec.y -= 0.1;
  grenades.throwFrom(tmpVec, direction);
  audio.shot('smg');
  refreshHud();
}

function explodeGrenade(pos) {
  audio.explosion();
  const flash = new THREE.PointLight(new THREE.Color(PALETTE.accent), 60, 14);
  flash.position.copy(pos).y += 0.6;
  scene.add(flash);
  setTimeout(() => scene.remove(flash), 180);
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = bot.group.position.distanceTo(pos);
    if (d < 6) {
      const killed = bots.damage(bot, Math.round(95 * (1 - d / 7)));
      if (killed) {
        economy.awardKill();
        hud.feed(`You eliminated ${BOT_NAMES[bot.id]} — frag`, true);
        if (bots.aliveCount() === 0) endRound(true, 'Enemy team eliminated');
      }
    }
  }
  const pd = body.position.distanceTo(pos);
  if (pd < 3 && body.alive) {
    player.damage(Math.round(30 * (1 - pd / 4)));
    audio.hurt();
    if (!body.alive) endRound(false, 'Caught by your own frag');
  }
  refreshHud();
}

function step(dt) {
  elapsed += dt;
  if (match.phase === 'buy') {
    match.timer -= dt;
    match.phaseTime += dt;
    if (match.timer <= 0) {
      match.phase = 'live';
      match.timer = ROUND_TIME;
      match.phaseTime = 0;
      hud.showBuyMenu(false, economy.state.owned, economy.state.money);
      match.buyOpen = false;
      hud.setHint('Plant the charge at A or B — hold E on site');
      hud.showBanner('GO', 'Plant at A or B, or eliminate the crew', 1600);
    }
  } else if (match.phase === 'live') {
    match.timer -= dt;
    match.phaseTime += dt;
    if (match.timer <= 0) {
      endRound(false, 'Time expired — defenders hold the sites');
    }
  } else if (match.phase === 'roundEnd') {
    match.timer -= dt;
    if (match.timer <= 0) {
      if (match.roundsWon >= WIN_ROUNDS || match.roundsLost >= WIN_ROUNDS || match.round >= MAX_ROUNDS) {
        endMatch();
      } else {
        match.round += 1;
        startRound();
      }
    }
  }

  const inRound = match.phase === 'buy' || match.phase === 'live';
  if (inRound && body.alive) {
    player.step(dt, input.state.keys);
    // Planting: hold E inside a site while the round is live.
    if (match.phase === 'live' && !match.bombPlanted && input.state.keys.has('KeyE')) {
      const site = siteNearPlayer();
      if (site) {
        match.planting += dt;
        if (match.planting >= PLANT_TIME) {
          match.bombPlanted = true;
          match.bombSite = site;
          match.bombTimer = BOMB_TIME;
          match.bombPos.copy(world.sites[site].center);
          match.planting = 0;
          bombGroup.position.copy(match.bombPos);
          bombGroup.position.y = 0.14;
          bombGroup.visible = true;
          economy.awardPlant();
          audio.plant();
          hud.feed('Charge planted — defend it', true);
          hud.showBanner('CHARGE PLANTED', `Detonation in ${BOMB_TIME}s — hold the site`, 2400);
          logTest('plant', { site });
        }
      } else {
        match.planting = 0;
      }
    } else {
      match.planting = 0;
    }
    if (match.bombPlanted) {
      match.bombTimer -= dt;
      match.beepAt -= dt;
      if (match.beepAt <= 0) {
        match.beepAt = Math.max(0.35, match.bombTimer / 35);
        audio.plantBeep(match.bombTimer < 5);
        bombLight.visible = !bombLight.visible;
      }
      if (match.bombTimer <= 0) {
        bombGroup.visible = false;
        match.bombPlanted = false;
        endRound(true, 'Charge detonated — site destroyed');
      }
    }
  }

  weapon.step(dt);
  if (match.phase === 'live' && body.alive) {
    bots.step(dt, {
      time: elapsed,
      playerPos: body.position,
      playerVel: body.velocity,
      playerAlive: body.alive,
      playerCrouching: body.crouching,
      bombPlanted: match.bombPlanted,
      bombPos: match.bombPos,
      onBotShot(bot, dmg) {
        if (!body.alive) return;
        player.damage(dmg);
        audio.hurt();
        if (!body.alive) endRound(false, `Eliminated by ${BOT_NAMES[bot.id]}`);
        refreshHud();
      },
      onBotFired(bot, dist) {
        audio.enemyShot(dist);
      },
      onDefused(bot) {
        bombGroup.visible = false;
        match.bombPlanted = false;
        endRound(false, `${BOT_NAMES[bot.id]} defused the charge`);
      },
    });
  }
  const bursts = grenades.step(dt, world.colliders);
  for (const pos of bursts) explodeGrenade(pos);

  // HUD: bomb state first, then the numbers.
  if (match.bombPlanted) {
    const defusing = bots.maxDefuseProgress();
    hud.setBomb(defusing > 0 ? 'defusing' : 'planted', match.bombTimer, defusing);
  } else if (match.planting > 0) {
    hud.setBomb('planting', PLANT_TIME - match.planting, 0);
  } else if (match.phase === 'live' || match.phase === 'buy') {
    hud.setBomb('carried', 0, 0);
  } else {
    hud.setBomb('none', 0, 0);
  }
  hud.setTimer(Math.max(0, match.timer), match.phase);
  hud.setCrosshairGap(6 + weapon.spread(player.groundSpeed()) * 700);
  refreshHud();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const keys = input.state.keys;
    if (match.phase === 'live' || match.phase === 'buy') {
      if (input.state.firing && weapon.ready()) shoot();
      if (keys.has('KeyR')) {
        if (weapon.reload()) audio.reload();
      }
      // Weapon select / buy: number keys. In the buy phase a key buys first,
      // then equips; in a live round it only equips what is owned.
      for (const def of Object.values(WEAPONS)) {
        if (keys.has(`Digit${def.key}`)) {
          keys.delete(`Digit${def.key}`);
          if (match.phase === 'buy') buyWeapon(def.id);
          else if (economy.state.owned.has(def.id)) weapon.equip(def.id);
        }
      }
      if (keys.has('Digit6')) {
        keys.delete('Digit6');
        if (match.phase === 'buy') buyGrenade();
      }
      if (keys.has('Digit7')) {
        keys.delete('Digit7');
        if (match.phase === 'buy') buyArmor();
      }
      if (keys.has('KeyG')) {
        keys.delete('KeyG');
        if (match.phase === 'live') throwGrenade();
      }
    }
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
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
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

function runShot(name) {
  hud.hideOverlay();
  match.started = true;
  startMatch();
  if (name === 'start') {
    body.position.set(0, 0, 11.5);
    body.yaw = 0;
    body.pitch = 0;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.6, -11));
    hud.showOverlay('start');
    hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.currentDef().name);
  } else if (name === 'play') {
    match.phase = 'live';
    match.timer = ROUND_TIME;
    body.position.set(0, 0, 6);
    settle(90);
    const target = bots.nearestBotTo(body.position);
    if (target) {
      tmpVec.set(target.group.position.x, target.group.position.y + 1.2, target.group.position.z);
      aimAt(tmpVec);
      shoot();
      settle(6);
      aimAt(tmpVec);
      shoot();
    }
    settle(6);
    hud.hitMarker(true, 60000);
  } else if (name === 'end') {
    match.phase = 'live';
    match.timer = ROUND_TIME;
    body.position.set(-4, 0, 8);
    settle(60);
    for (const bot of bots.bots) bots.damage(bot, 999);
    endRound(true, 'Enemy team eliminated');
    settle(30);
    body.yaw = 0;
    body.pitch = 0;
    syncCamera();
    hud.showBanner('ROUND WON', 'Enemy team eliminated', 60000);
  } else if (name === 'plant') {
    match.phase = 'live';
    match.timer = ROUND_TIME;
    body.position.set(-13.5, 0, -7.5);
    settle(30);
    match.bombPlanted = true;
    match.bombSite = 'A';
    match.bombTimer = 28;
    match.bombPos.copy(world.sites.A.center);
    bombGroup.position.copy(match.bombPos);
    bombGroup.position.y = 0.14;
    bombGroup.visible = true;
    settle(10);
    aimAt(new THREE.Vector3(-15.5, 0.6, -11));
    hud.setBomb('planted', 28, 0);
  }
  refreshHud();
  paintTwiceThenReady();
}

function onLockChange(locked) {
  if (shot || selftest) return;
  if (locked) {
    match.started = true;
    hud.hideOverlay();
    audio.unlock();
    if (match.phase === 'menu') startMatch();
  } else if (match.phase !== 'menu' && match.phase !== 'matchEnd' && match.phase !== 'roundEnd') {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot || selftest) return;
  audio.unlock();
  if (match.phase === 'matchEnd') {
    startMatch();
    input.requestLock();
    return;
  }
  if (match.phase === 'roundEnd') return;
  input.requestLock();
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyB' && (match.phase === 'buy')) {
    match.buyOpen = !match.buyOpen;
    hud.showBuyMenu(match.buyOpen, economy.state.owned, economy.state.money);
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Self-test: drive the game with synthetic input and record the verdict.
function runSelftest() {
  input.enableSynthetic();
  const results = {};
  window.__selftest = results;
  window.__testLog = testLog;
  startMatch();
  logTest('start', { phase: match.phase });
  const botStart = bots.bots.map((b) => b.group.position.clone());
  setTimeout(() => {
    match.phase = 'live';
    match.timer = ROUND_TIME;
    input.press('KeyW');
    input.lookBy(0, 0);
  }, 500);
  setTimeout(() => {
    input.release('KeyW');
  }, 3500);
  setTimeout(() => {
    const moved = bots.bots.some((b, i) => b.group.position.distanceTo(botStart[i]) > 0.5);
    results.botsMoved = moved;
    results.botPositions = bots.bots.map((b) => [Number(b.group.position.x.toFixed(1)), Number(b.group.position.z.toFixed(1)), b.state]);
    const target = bots.bots[0];
    // Put one bot dead ahead in the mid lane so the shot has a clear lane.
    target.group.position.set(0, 0, 2);
    target.state = 'hold';
    target.holdAt = 0;
    {
      tmpVec2.set(target.group.position.x, target.group.position.y + 1.2, target.group.position.z);
      aimAt(tmpVec2);
      const before = target.hp;
      for (let i = 0; i < 3; i += 1) {
        aimAt(tmpVec2);
        shoot();
      }
      results.shotFired = weapon.state.mag < weapon.currentDef().mag;
      results.shotHit = target.hp < before;
      results.hitmarker = document.getElementById('hitmarker').classList.contains('on');
    }
    results.roundLive = match.phase === 'live';
    results.playerPos = [Number(body.position.x.toFixed(1)), Number(body.position.z.toFixed(1))];
  }, 4500);
  setTimeout(() => {
    match.phase = 'buy';
    match.timer = BUY_TIME;
    match.buyOpen = true;
    hud.showBuyMenu(true, economy.state.owned, economy.state.money);
    results.buyMenuOpen = !document.getElementById('buy-menu').hidden;
    buyWeapon('smg');
    results.buySmgDenied = !economy.state.owned.has('smg'); // 800 start money < 1200
    economy.state.money = 5000;
    buyWeapon('rifle');
    results.buyRifle = economy.state.owned.has('rifle') && weapon.state.current === 'rifle';
    results.moneyAfterBuy = economy.state.money;
  }, 6000);
  setTimeout(() => {
    for (const bot of bots.bots) bots.damage(bot, 999);
    results.botsAllDead = bots.aliveCount() === 0;
    endRound(true, 'Enemy team eliminated');
    results.roundEnded = match.phase === 'roundEnd';
    results.score = `${match.roundsWon}-${match.roundsLost}`;
  }, 8000);
  setTimeout(() => {
    match.round = 1;
    match.roundsWon = 0;
    match.roundsLost = 0;
    startRound();
    results.roundRestarted = match.phase === 'buy' && bots.aliveCount() === 5;
    results.botsAliveAfterRestart = bots.aliveCount();
    results.done = true;
    document.title = `SELFTEST ${results.botsMoved && results.shotHit && results.buyMenuOpen && results.roundEnded && results.roundRestarted ? 'PASS' : 'FAIL'}`;
    const out = document.getElementById('selftest-out');
    if (out) out.textContent = JSON.stringify(results, null, 1);
    logTest('selftestDone', results);
  }, 11000);
}

window.addEventListener('error', (event) => {
  const el = document.getElementById('page-errors');
  if (el) el.textContent += `${event.message} @ ${event.filename}:${event.lineno}\n`;
  document.title = `PAGEERROR ${event.message}`;
});

syncCamera();
refreshHud();
if (shot) runShot(shot);
else if (selftest) {
  requestAnimationFrame(frame);
  runSelftest();
} else {
  requestAnimationFrame(frame);
}

// Debug handle for headless verification: state, and forced actions the
// self-test and the developer console can call. Not part of the shipped UI.
window.__ember = {
  match,
  body,
  bots,
  economy,
  weapon,
  killAllBots() {
    for (const bot of bots.bots) bots.damage(bot, 999);
  },
  plantAt(site) {
    match.bombPlanted = true;
    match.bombSite = site;
    match.bombTimer = BOMB_TIME;
    match.bombPos.copy(world.sites[site].center);
    bombGroup.position.copy(match.bombPos);
    bombGroup.position.y = 0.14;
    bombGroup.visible = true;
  },
};
