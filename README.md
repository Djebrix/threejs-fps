# EMBERLINE

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Djebrix/threejs-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Djebrix/threejs-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

EMBERLINE is a round-based tactical FPS in the style Counter-Strike made famous, built on three.js 0.187.0: one player against a five-bot crew in a foundry yard with three lanes and two bomb sites. First to 5 rounds takes the yard. Built by an AI agent for make.fun's "Make the best three.js tactical FPS" bounty, $1,000 in USDC.

## Run it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome.

## The game

- **Map** — an original foundry yard, 40 × 30 m: west, mid and east lanes joined by two cross-passages, crates for cover, a furnace landmark, and an elevated platform reached by steps. Two bomb sites, A (west) and B (east), marked in amber.
- **Rounds** — first to 5 (max 9). A round is won by eliminating the enemy team, detonating the planted charge, or surviving the defuse; the defenders win on time or a defuse. 100 s round timer, 10 s buy phase.
- **Objective** — carry the charge, hold E on a site to plant (~3 s), then defend it for 35 s while the crew tries to defuse (5 s channel).
- **Economy** — win $3000, loss $1900 plus a loss-streak bonus, kill $300, plant $300. Buy menu (B) between rounds: five weapons, frag grenades, kevlar.
- **Gunplay** — hitscan raycasts with headshot hitboxes (4× damage), recoil and spread that grow with movement and fire rate, acceleration-based movement, crouch, jump, step-up, AABB collision, reload and reserve ammo.
- **Bots** — five bots in rusher, holder and roamer roles. They route on a waypoint graph, hold angles, patrol, react to sight (FOV + line of sight) and sound (gunshots draw them in), strafe while firing, retreat at low HP, and converge to defuse a planted charge.
- **Sound** — WebAudio-synthesised only: gunshots, reloads, hits, plant beeps, explosions, round stingers. No audio files, no network.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look / fire |
| R | Reload |
| Ctrl | Crouch |
| Space | Jump |
| E (hold) | Plant the charge on site |
| B | Buy menu (buy phase) |
| G | Throw frag grenade |
| 1–5 | Weapons · 6 grenade · 7 kevlar (buy phase) |

## Layout

- `game/index.html` — the page, HUD and the one import map for three.js
- `game/src/main.js` — boot, fixed 60 Hz simulation, rounds, bomb, shooting
- `game/src/world.js` — the foundry map, colliders, sites, waypoints
- `game/src/player.js` — movement, collision, step-up, health and armour
- `game/src/weapon.js` — weapon definitions, view models, grenades
- `game/src/bots.js` — bot AI: routes, sight, hearing, defuse
- `game/src/economy.js` — money, buy menu, rewards
- `game/src/hud.js` — the DOM HUD and buy menu
- `game/src/input.js` — keyboard, mouse, pointer lock
- `game/src/audio.js` — synthesised WebAudio effects
- `game/src/palette.js` — the look plan (dark slate + amber)
- `main.ts` — hands the game in: copies game/ and screenshots/ to /output and writes dossier.json
- `serve.ts` — local static server for play-testing

---

<sub>Entered on [make.fun](https://make.fun/?ref=djebrix&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
