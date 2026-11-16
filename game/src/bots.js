// The enemy team: five bots with roles, waypoint routes, sight, hearing and a
// defuse job. They move on the waypoint graph, hold angles, peek when they hear
// a shot, and shoot back with accuracy that falls off with distance and motion.
// No per-frame allocation in the hot path: one raycaster, pooled tracers, reused vectors.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const BOT_HP = 100;
const SIGHT_RANGE = 30;
const SIGHT_FOV = 1.15; // half-angle in radians (~132 deg total)
const HEAR_RANGE = 18;
const DEFUSE_TIME = 5;
const BOT_RADIUS = 0.34;

const ROLES = ['rusher', 'rusher', 'holder', 'holder', 'roamer'];

export function createBots(scene, world, random) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const playerSphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 8, 6),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  scene.add(playerSphere);

  const torsoMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#8a3324'), roughness: 0.65, metalness: 0.1 });
  const headMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#241d1a'), roughness: 0.6, metalness: 0.2 });
  const visorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 1.2 });
  const gunMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#15161a'), roughness: 0.5, metalness: 0.4 });
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeo = new THREE.SphereGeometry(0.155, 12, 10);
  const visorGeo = new THREE.BoxGeometry(0.2, 0.05, 0.05);
  const gunGeo = new THREE.BoxGeometry(0.08, 0.1, 0.55);

  const bots = [];
  const tracers = [];

  function makeTracer() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffc266, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    scene.add(line);
    return { line, life: 0 };
  }

  for (let i = 0; i < 5; i += 1) {
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.position.y = 1.0;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.53;
    head.userData.part = 'head';
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 1.55, 0.13);
    const gun = new THREE.Mesh(gunGeo, gunMat);
    gun.position.set(0.2, 1.05, 0.3);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.62, 0.26), headMat);
    legs.position.y = 0.31;
    group.add(torso, head, visor, gun, legs);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);
    const bot = {
      id: i,
      role: ROLES[i],
      group,
      torso,
      head,
      hp: BOT_HP,
      alive: true,
      node: 5 + (i % 3),
      cameFrom: -1,
      state: 'route',
      stateTime: 0,
      yaw: 0,
      speed: ROLES[i] === 'rusher' ? 3.9 : 3.1,
      reaction: 0,
      shootCooldown: 0,
      seePlayer: false,
      lastSeen: new THREE.Vector3(),
      investigate: null,
      defuseProgress: 0,
      fall: 0,
      thinkAt: random() * 0.15,
      holdAt: 0,
      flashAt: 0,
      stuckTime: 0,
      lastX: 0,
      lastZ: 0,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    bots.push(bot);
    tracers.push(makeTracer());
  }

  function reset(spawns) {
    for (let i = 0; i < bots.length; i += 1) {
      const bot = bots[i];
      bot.hp = BOT_HP;
      bot.alive = true;
      bot.group.position.copy(spawns[i % spawns.length]);
      bot.group.position.y = 0;
      bot.group.rotation.set(0, 0, 0);
      bot.yaw = 0; // face south, toward the player spawn
      bot.group.rotation.y = bot.yaw;
      bot.node = nearestNode(spawns[i % spawns.length].x, spawns[i % spawns.length].z);
      bot.cameFrom = -1;
      bot.state = bot.role === 'holder' ? 'hold' : 'route';
      bot.stateTime = 0;
      bot.seePlayer = false;
      bot.defuseProgress = 0;
      bot.fall = 0;
      bot.investigate = null;
      bot.thinkAt = random() * 0.15;
      bot.holdAt = 0;
    }
  }

  function lineOfSight(a, b) {
    dir.subVectors(b, a);
    const dist = dir.length();
    if (dist < 0.001) return true;
    dir.multiplyScalar(1 / dist);
    raycaster.set(a, dir);
    raycaster.far = dist;
    return raycaster.intersectObjects(world.shootables, false).length === 0;
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < world.waypoints.length; i += 1) {
      const w = world.waypoints[i];
      const d = (w.x - x) * (w.x - x) + (w.z - z) * (w.z - z);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  function pickNext(bot, goal) {
    const w = world.waypoints[bot.node];
    let best = -1;
    let bestScore = Infinity;
    for (const link of w.links) {
      if (link === bot.cameFrom && w.links.length > 1) continue;
      const lw = world.waypoints[link];
      const d = goal ? (lw.x - goal.x) * (lw.x - goal.x) + (lw.z - goal.z) * (lw.z - goal.z) : random();
      const score = d + random() * 4;
      if (score < bestScore) {
        bestScore = score;
        best = link;
      }
    }
    if (best === -1) best = w.links[0];
    bot.cameFrom = bot.node;
    bot.node = best;
  }

  function blocked(x, z, y) {
    tmp.set(x, y, z);
    for (const c of world.colliders) {
      if (c.min.x - BOT_RADIUS < x && x < c.max.x + BOT_RADIUS
        && c.min.y < y + 1.7 && y + 0.05 < c.max.y
        && c.min.z - BOT_RADIUS < z && z < c.max.z + BOT_RADIUS) return true;
    }
    return false;
  }

  function moveToward(bot, tx, tz, dt, speed) {
    const p = bot.group.position;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const stepLen = Math.min(dist, speed * dt);
    const nx = p.x + (dx / dist) * stepLen;
    const nz = p.z + (dz / dist) * stepLen;
    const targetYaw = Math.atan2(dx, dz);
    let dyaw = targetYaw - bot.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    bot.yaw += Math.max(-6 * dt, Math.min(6 * dt, dyaw));
    bot.group.rotation.y = bot.yaw;
    if (!blocked(nx, p.z, p.y)) p.x = nx;
    if (!blocked(p.x, nz, p.y)) p.z = nz;
    return dist < 0.9;
  }

  function damage(bot, amount) {
    if (!bot.alive) return false;
    bot.hp -= amount;
    if (bot.hp <= 0) {
      bot.hp = 0;
      bot.alive = false;
      bot.fall = 0;
      bot.state = 'dead';
      return true;
    }
    if (bot.hp < 30 && bot.state !== 'retreat') {
      bot.state = 'retreat';
      bot.stateTime = 0;
    }
    return false;
  }

  function hearShot(pos) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      const d = bot.group.position.distanceTo(pos);
      if (d < HEAR_RANGE && bot.state !== 'engage' && bot.state !== 'defuse') {
        bot.investigate = pos.clone();
        if (bot.state === 'hold' || bot.state === 'route') bot.state = 'investigate';
      }
    }
  }

  function fireAtPlayer(bot, ctx, dt) {
    bot.shootCooldown -= dt;
    if (bot.shootCooldown > 0) return;
    const p = bot.group.position;
    const dist = p.distanceTo(ctx.playerPos);
    bot.shootCooldown = 0.16 + random() * 0.1;
    const moving = Math.hypot(ctx.playerVel.x, ctx.playerVel.z);
    let chance = 0.45 - dist * 0.013 - moving * 0.035 - (ctx.playerCrouching ? 0.06 : 0);
    chance = Math.max(0.06, Math.min(0.45, chance));
    const hit = random() < chance;
    const tracer = tracers[bot.id];
    const pos = tracer.line.geometry.attributes.position;
    from.set(p.x, p.y + 1.35, p.z);
    pos.setXYZ(0, from.x, from.y, from.z);
    if (hit) {
      to.set(ctx.playerPos.x, ctx.playerPos.y + 1.15, ctx.playerPos.z);
      const dmg = Math.round((8 + random() * 5) * Math.max(0.6, 1 - dist * 0.012));
      ctx.onBotShot(bot, dmg);
    } else {
      to.set(
        ctx.playerPos.x + (random() * 2 - 1) * 1.6,
        ctx.playerPos.y + 0.6 + random() * 1.4,
        ctx.playerPos.z + (random() * 2 - 1) * 1.6,
      );
    }
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    tracer.line.material.opacity = 0.85;
    tracer.life = 0.09;
    bot.flashAt = 0.06;
    ctx.onBotFired(bot, dist);
  }

  function step(dt, ctx) {
    const time = ctx.time;
    for (const bot of bots) {
      if (!bot.alive) {
        if (bot.fall < 1) {
          bot.fall = Math.min(1, bot.fall + dt / 0.45);
          bot.group.rotation.x = -bot.fall * 1.5;
          bot.group.position.y = -bot.fall * 0.1;
        }
        continue;
      }
      bot.stateTime += dt;
      const p = bot.group.position;
      // Death fall reset
      bot.group.rotation.x = 0;

      // --- senses, staggered at ~7 Hz per bot ---
      bot.thinkAt -= dt;
      if (bot.thinkAt <= 0) {
        bot.thinkAt = 0.15;
        from.set(p.x, p.y + 1.5, p.z);
        to.set(ctx.playerPos.x, ctx.playerPos.y + 1.3, ctx.playerPos.z);
        const dist = from.distanceTo(to);
        let sees = false;
        if (ctx.playerAlive && dist < SIGHT_RANGE) {
          dir.subVectors(to, from).normalize();
          const facing = new THREE.Vector3(Math.sin(bot.yaw), 0, Math.cos(bot.yaw));
          if (dir.dot(facing) > Math.cos(SIGHT_FOV) || dist < 4) {
            sees = lineOfSight(from, to);
          }
        }
        if (sees) {
          bot.lastSeen.copy(ctx.playerPos);
          if (!bot.seePlayer) bot.reaction = 0.25 + random() * 0.3;
          bot.seePlayer = true;
        } else {
          bot.seePlayer = false;
        }
      }

      // --- state transitions ---
      if (ctx.bombPlanted && bot.state !== 'defuse' && bot.state !== 'dead') {
        const dBomb = p.distanceTo(ctx.bombPos);
        if (dBomb < 26) {
          bot.state = 'defuse';
          bot.stateTime = 0;
        }
      }
      if (bot.state === 'defuse' && !ctx.bombPlanted) {
        bot.state = 'route';
        bot.defuseProgress = 0;
      }
      if (bot.seePlayer && bot.state !== 'engage' && bot.state !== 'retreat') {
        bot.state = 'engage';
        bot.stateTime = 0;
      }
      if (!bot.seePlayer && bot.state === 'engage') {
        bot.state = bot.role === 'holder' ? 'hold' : 'route';
        bot.stateTime = 0;
      }
      if (bot.state === 'retreat' && bot.stateTime > 3) {
        bot.state = 'route';
        bot.stateTime = 0;
      }
      if (bot.state === 'investigate' && bot.investigate && p.distanceTo(bot.investigate) < 1.2) {
        bot.investigate = null;
        bot.state = 'hold';
        bot.stateTime = 0;
        bot.holdAt = 0;
      }

      // --- behaviour ---
      if (bot.state === 'engage') {
        // Face the player, strafe sideways, shoot after the reaction delay.
        const dx = ctx.playerPos.x - p.x;
        const dz = ctx.playerPos.z - p.z;
        const targetYaw = Math.atan2(dx, dz);
        let dyaw = targetYaw - bot.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        bot.yaw += Math.max(-8 * dt, Math.min(8 * dt, dyaw));
        bot.group.rotation.y = bot.yaw;
        const strafe = Math.sin(time * 1.3 + bot.id * 2.1) * 1.6;
        const sx = Math.cos(bot.yaw) * strafe;
        const sz = -Math.sin(bot.yaw) * strafe;
        if (!blocked(p.x + sx * dt, p.z, p.y)) p.x += sx * dt;
        if (!blocked(p.x, p.z + sz * dt, p.y)) p.z += sz * dt;
        bot.reaction -= dt;
        if (bot.reaction <= 0 && ctx.playerAlive) fireAtPlayer(bot, ctx, dt);
      } else if (bot.state === 'defuse') {
        const dBomb = Math.hypot(ctx.bombPos.x - p.x, ctx.bombPos.z - p.z);
        if (dBomb > 2.2) {
          moveToward(bot, ctx.bombPos.x, ctx.bombPos.z, dt, bot.speed * 1.15);
          bot.defuseProgress = 0;
        } else {
          bot.defuseProgress += dt;
          const dx = ctx.bombPos.x - p.x;
          const dz = ctx.bombPos.z - p.z;
          bot.yaw = Math.atan2(dx, dz);
          bot.group.rotation.y = bot.yaw;
          if (bot.defuseProgress >= DEFUSE_TIME) ctx.onDefused(bot);
        }
      } else if (bot.state === 'retreat') {
        const goal = ctx.playerPos;
        const w = world.waypoints[bot.node];
        let best = bot.node;
        let bestD = -1;
        for (const link of w.links) {
          const lw = world.waypoints[link];
          const d = (lw.x - goal.x) * (lw.x - goal.x) + (lw.z - goal.z) * (lw.z - goal.z);
          if (d > bestD) {
            bestD = d;
            best = link;
          }
        }
        bot.cameFrom = bot.node;
        bot.node = best;
        bot.state = 'route';
        bot.stateTime = 0;
      } else if (bot.state === 'investigate' && bot.investigate) {
        moveToward(bot, bot.investigate.x, bot.investigate.z, dt, bot.speed);
      } else if (bot.state === 'hold') {
        bot.holdAt += dt;
        // Scan: slow yaw sweep across the lane.
        bot.yaw += Math.sin(time * 0.5 + bot.id * 1.7) * 0.35 * dt;
        bot.group.rotation.y = bot.yaw;
        if (bot.holdAt > 6 + bot.id) {
          bot.holdAt = 0;
          bot.state = 'route';
          bot.stateTime = 0;
        }
      } else {
        // route: walk the graph toward the objective (a site, or the last seen player).
        const w = world.waypoints[bot.node];
        const goal = bot.role === 'holder'
          ? world.waypoints[bot.id % 2 === 0 ? 1 : 9]
          : (bot.seePlayer ? { x: ctx.playerPos.x, z: ctx.playerPos.z } : world.waypoints[bot.id % 2 === 0 ? 1 : 9]);
        const beforeX = p.x;
        const beforeZ = p.z;
        if (moveToward(bot, w.x, w.z, dt, bot.speed)) {
          pickNext(bot, goal);
          bot.stuckTime = 0;
        } else if (Math.hypot(p.x - beforeX, p.z - beforeZ) < bot.speed * dt * 0.25) {
          // Pinned against a wall: give up on this leg and take another link.
          bot.stuckTime += dt;
          if (bot.stuckTime > 1.2) {
            bot.stuckTime = 0;
            pickNext(bot, goal);
          }
        } else {
          bot.stuckTime = 0;
        }
      }

      // Tracer fade.
      const tracer = tracers[bot.id];
      if (tracer.life > 0) {
        tracer.life -= dt;
        tracer.line.material.opacity = Math.max(0, tracer.life / 0.09) * 0.85;
      }
      if (bot.flashAt > 0) bot.flashAt -= dt;
    }
    // Player hit sphere follows the player for bot raycasts.
    playerSphere.position.set(ctx.playerPos.x, ctx.playerPos.y + 1.15, ctx.playerPos.z);
  }

  return {
    bots,
    reset,
    step,
    damage,
    hearShot,
    aliveCount() {
      return bots.filter((b) => b.alive).length;
    },
    maxDefuseProgress() {
      let max = 0;
      for (const b of bots) if (b.defuseProgress > max) max = b.defuseProgress;
      return max;
    },
    nearestBotTo(pos) {
      let best = null;
      let bestD = Infinity;
      for (const b of bots) {
        if (!b.alive) continue;
        const d = b.group.position.distanceTo(pos);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      return best;
    },
  };
}
