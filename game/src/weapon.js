// Weapons: one view model per gun, a magazine, a reload, and the spread that
// punishes moving and firing fast. The weapon owns its numbers and its ammo;
// main.js owns the ray and the damage. Grenades are thrown here too: a small
// projectile with gravity that bursts on impact or after its fuse.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS } from './economy.js';

const MUZZLE_TIME = 0.06;

function buildViewModel(def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#0e0f11'), roughness: 0.6, metalness: 0.4 });
  const group = new THREE.Group();
  const add = (w, h, d, x, y, z, mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  if (def.kind === 'pistol') {
    add(0.07, 0.12, 0.22, 0, 0, -0.1, body);
    add(0.06, 0.1, 0.07, 0, -0.1, 0.02, grip);
  } else if (def.kind === 'smg') {
    add(0.08, 0.09, 0.34, 0, 0, -0.12, body);
    add(0.04, 0.04, 0.22, 0, 0.02, -0.36, dark);
    add(0.05, 0.16, 0.05, 0, -0.1, -0.05, grip);
  } else if (def.kind === 'dmr') {
    add(0.08, 0.1, 0.5, 0, 0, -0.16, body);
    add(0.035, 0.035, 0.34, 0, 0.03, -0.52, dark);
    add(0.05, 0.06, 0.12, 0, 0.07, -0.2, dark);
    add(0.05, 0.14, 0.05, 0, -0.1, 0.02, grip);
  } else if (def.kind === 'shotgun') {
    add(0.09, 0.1, 0.44, 0, 0, -0.1, body);
    add(0.07, 0.07, 0.4, 0, 0.02, -0.4, dark);
    add(0.06, 0.07, 0.2, 0, -0.02, 0.26, grip);
  } else {
    add(0.09, 0.1, 0.42, 0, 0, -0.12, body);
    add(0.045, 0.045, 0.4, 0, 0.025, -0.5, grip);
    add(0.075, 0.08, 0.22, 0, -0.02, 0.28, grip);
    add(0.05, 0.05, 0.1, 0, 0.06, -0.18, dark);
  }
  group.position.set(0.24, -0.2, -0.42);
  return group;
}

export function createWeapon(camera) {
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    models[def.id] = buildViewModel(def);
    models[def.id].visible = false;
    camera.add(models[def.id]);
  }

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const state = {
    current: 'pistol',
    mag: WEAPONS.pistol.mag,
    reserve: WEAPONS.pistol.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    shotsSinceStill: 0,
  };

  function currentDef() {
    return WEAPONS[state.current];
  }

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.shotsSinceStill = Math.max(0, state.shotsSinceStill - dt * 2.5);
    const model = models[state.current];
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const def = currentDef();
      model.rotation.x = -0.55 * Math.min(1, (def.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    currentDef,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      const def = currentDef();
      state.cooldown = def.fireGap;
      state.flash = MUZZLE_TIME;
      state.kick = def.kind === 'shotgun' ? 0.12 : def.kind === 'dmr' ? 0.1 : 0.055;
      state.shotsSinceStill += 1;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const def = currentDef();
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return false;
      state.reloadLeft = def.reloadTime;
      return true;
    },
    spread(speed, moving) {
      const def = currentDef();
      const move = Math.min(1, speed / 5.2);
      const heat = Math.min(1, state.shotsSinceStill / 6) * 0.012;
      return def.spreadStill + move * def.spreadMove + heat;
    },
    resetHeat() {
      state.shotsSinceStill = 0;
    },
    equip(id, keepAmmo = false) {
      if (!WEAPONS[id]) return false;
      const def = WEAPONS[id];
      models[state.current].visible = false;
      state.current = id;
      models[id].visible = true;
      if (!keepAmmo) {
        state.mag = def.mag;
        state.reserve = def.reserve;
      }
      state.cooldown = 0.25;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.shotsSinceStill = 0;
      return true;
    },
    refillAmmo() {
      const def = currentDef();
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
  };
}

// A thrown frag: gravity arc, fuse or impact burst, area damage with falloff.
export function createGrenades(scene) {
  const live = [];
  const geo = new THREE.SphereGeometry(0.09, 10, 8);
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2e3a2a'), roughness: 0.5, metalness: 0.5 });
  const velocity = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  return {
    throwFrom(origin, direction, power = 13) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(origin);
      mesh.castShadow = true;
      scene.add(mesh);
      velocity.copy(direction).multiplyScalar(power);
      velocity.y += 3.5;
      live.push({ mesh, velocity: velocity.clone(), fuse: 1.6, alive: true });
    },
    // Returns burst positions this step so main.js can apply damage and effects.
    step(dt, colliders) {
      const bursts = [];
      for (const g of live) {
        if (!g.alive) continue;
        g.fuse -= dt;
        g.velocity.y -= 14 * dt;
        g.mesh.position.addScaledVector(g.velocity, dt);
        if (g.mesh.position.y < 0.09) {
          g.mesh.position.y = 0.09;
          g.velocity.y *= -0.35;
          g.velocity.x *= 0.7;
          g.velocity.z *= 0.7;
        }
        let hitWall = false;
        for (const c of colliders) {
          if (c.containsPoint(g.mesh.position)) { hitWall = true; break; }
        }
        if (hitWall || g.fuse <= 0) {
          g.alive = false;
          bursts.push(g.mesh.position.clone());
          scene.remove(g.mesh);
        }
      }
      for (let i = live.length - 1; i >= 0; i -= 1) if (!live[i].alive) live.splice(i, 1);
      return bursts;
    },
    clear() {
      for (const g of live) scene.remove(g.mesh);
      live.length = 0;
    },
    count() {
      return live.length;
    },
    up,
  };
}
