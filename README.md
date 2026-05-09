# Quota

> A 2D top-down co-op horror salvage game inspired by *Lethal Company*. Procedurally generated interiors, directional line-of-sight, proximity voice and text chat, and a ship-based hub loop — all in your browser.

[![Status](https://img.shields.io/badge/status-in%20development-yellow)]()
[![Platform](https://img.shields.io/badge/platform-web-blue)]()
[![Stack](https://img.shields.io/badge/stack-React%20%7C%20TS%20%7C%20WebSocket%20%7C%20WebRTC-purple)]()
[![Deploy](https://img.shields.io/badge/deploy-Railway-9333ea)]()

---

## About

**Quota** is a browser-based 2D multiplayer game where a small crew of contractors lands on hostile moons, scavenges scrap from procedurally generated facilities, and tries to make it back to the ship before the lights go out. The goal is to capture the tension, comedy, and chaos of *Lethal Company*'s gameplay loop in a top-down 2D format that runs anywhere a modern browser does.

> ⚠️ This is a fan project inspired by *Lethal Company* (by Zeekerss). It is not affiliated with or endorsed by the original game. All assets and code in this repository are original.

---

## Core Features

### 🌑 Procedurally Generated Facilities
- Each landing produces a fresh layout — corridors, vaults, loot rooms, vents, and dead ends are stitched together from a seeded room/tile graph.
- Scrap distribution, hazards, and entity spawns scale with the moon's difficulty.

### 👁️ Directional Line of Sight
- You only see what's in front of you. A sight cone projects forward from your facing direction, with falloff distance based on light source (flashlight, ship lights, ambient).
- Tiles outside the cone are dimmed or completely hidden until previously seen (fog-of-war memory).
- Peripheral vision exists but is significantly shorter and dimmer than your forward cone.

### 🎙️ Proximity Voice Chat
- WebRTC peer-to-peer audio with volume falloff based on in-game distance.
- Walls and floors muffle audio. Talking too loudly can attract attention.
- Walkie-talkies (purchasable from the ship) let you broadcast across any distance, but with audio degradation.

### 💬 Proximity Text Chat
- A separate text channel that only delivers messages to crewmates within a configurable radius.
- Useful when voice isn't an option but you still want immersion-friendly communication.
- Ship-wide channel available only when you're physically on the ship.

### 🚀 Ship Hub Loop
- Every match starts in the ship lobby. The ship is your safe zone, store, and command center.
- **Ship Console:** change destination moon, review the bestiary, view the day count, and trigger landing.
- **Terminal Store:** purchase tools (flashlights, walkie-talkies, shovels, stun grenades, ladders) using collected credits.
- **Quota Loop:** sell scrap at the company building between expeditions; fail to meet the quota and the run ends.

### 🌍 The First Moon
- The launch build ships with a single hand-crafted moon: **Industrial-class facility with multi-floor interior layouts, exposed ductwork, and flickering fluorescent lighting.** Heavy *Lethal Company* aesthetic inspiration, but original layouts and assets.
- Additional moons are part of the post-launch roadmap.

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Client rendering | React + Vite + HTML5 Canvas | Fast iteration, single-page deploy, full control over per-frame draws |
| Game loop | `requestAnimationFrame` with fixed-timestep accumulator | Deterministic simulation, smooth 60 FPS |
| Language | TypeScript | Shared types between client and server |
| Networking (state) | WebSocket via `ws` on Node/Express | Authoritative server, low-latency state sync |
| Networking (voice) | WebRTC (peer-to-peer mesh, signaled through the server) | Native browser audio, no media server cost |
| Procedural generation | Seeded RNG + room graph + cellular automata for caves | Reproducible runs, easy to debug |
| Hosting | Railway (Docker multi-stage build) | One-command deploy, fits the Pixel Hearts pattern |
| Persistence | In-memory per lobby (no DB for v1) | Simpler; sessions are ephemeral by design |

---

## Repository Structure

```
quota/
├── client/              # React + Vite frontend
│   ├── src/
│   │   ├── game/        # Game loop, renderer, input, FOV
│   │   ├── net/         # WebSocket client, WebRTC signaling
│   │   ├── ui/          # Lobby, terminal, HUD, chat overlay
│   │   └── assets/      # Sprites, audio, tilesets
│   └── vite.config.ts
├── server/              # Node + Express + ws
│   ├── src/
│   │   ├── lobby/       # Lobby, matchmaking, room codes
│   │   ├── world/       # Authoritative game state, tick loop
│   │   ├── procgen/     # Seeded facility generator
│   │   ├── signaling/   # WebRTC signaling relay
│   │   └── index.ts
│   └── tsconfig.json
├── shared/              # Types, constants, protocol enums
│   └── src/
├── Dockerfile           # Multi-stage build for Railway
├── railway.json
└── README.md
```

---

## Getting Started

### Prerequisites
- Node.js 20+
- npm 10+ (or pnpm / yarn if you prefer)
- A modern browser with WebRTC support (Chrome, Edge, Firefox, Opera)

### Local Development

```bash
# Clone
git clone https://github.com/DoperDodge/quota.git
cd quota

# Install workspaces
npm install

# Run client and server in parallel
npm run dev
```

The client will be available at `http://localhost:5173` and the server at `ws://localhost:3001`.

### Build for Production

```bash
npm run build
npm run start
```

---

## Deploying to Railway

This project uses a multi-stage `Dockerfile` so the entire stack (built React client served as static assets by the Express server) ships as a single container.

```bash
# From the project root
railway up
```

Railway will detect the Dockerfile and build automatically. Make sure you set:

| Env Var | Purpose |
|---------|---------|
| `PORT` | Provided by Railway, server binds to this |
| `NODE_ENV` | `production` |
| `MAX_LOBBIES` | Optional cap, defaults to 50 |
| `MAX_PLAYERS_PER_LOBBY` | Defaults to 4 |

---

## How to Play

1. **Open the game URL** and either create a lobby (you'll get a 4-letter code) or join an existing one.
2. **You spawn on the ship.** Walk to the console.
3. **Pick a moon** and hit the launch lever.
4. **Land, scavenge, survive.** Stay in voice range of your crew, watch your sight cone, and don't get cornered.
5. **Return to the ship before the door closes** at end-of-day. Anyone left behind is gone.
6. **Sell scrap, buy gear, repeat.** Hit the quota every cycle or it's game over.

### Default Controls

| Action | Key |
|--------|-----|
| Move | WASD |
| Aim / face direction | Mouse |
| Interact | E |
| Drop item | G |
| Toggle flashlight | F |
| Open inventory | Tab |
| Push-to-talk (proximity voice) | V |
| Open chat | Enter |
| Map / scanner | M |

---

## Architecture Notes

### Authoritative Server, Predicted Client
The server runs the simulation at a fixed tick rate (20 Hz) and is the source of truth for player positions, entity AI, and world state. The client predicts local movement and reconciles with server snapshots to feel responsive on Railway-hosted latency.

### Procedural Generation Pipeline
1. **Seed** is derived from `(moonId, dayNumber, lobbyId)` so all clients can verify consistency.
2. **Room graph** is generated as a connected DAG of room templates.
3. **Tile rasterization** stamps each room's tiles into the world grid.
4. **Hazards & loot** are placed using weighted tables per moon difficulty.
5. **Entity spawn points** are tagged during raster, populated at tick zero.

### Field of View
Implemented via shadowcasting from the player's position, masked by a forward-facing cone. Tiles outside the current frame's visible set fade to a "remembered" dim state if they've ever been seen, otherwise full black.

### Voice Chat
- WebRTC peer-to-peer mesh (works fine for ≤4 players).
- Server acts only as a signaling relay (SDP/ICE exchange).
- Volume per peer is recalculated each tick based on in-world distance and intervening tile attenuation.

### Text Chat
- Messages route through the server.
- The server checks sender↔receiver distance per recipient before delivering.
- Ship-channel messages are gated by an "is on ship" flag.

---

## Roadmap

### v0.1 — MVP (current target)
- [ ] Single moon (industrial facility)
- [ ] 4-player lobbies
- [ ] Procedural interior generation
- [ ] Directional line of sight
- [ ] Proximity text chat
- [ ] Proximity voice chat
- [ ] Ship console: moon select + store
- [ ] Quota loop with day counter
- [ ] One basic monster type
- [ ] Railway deploy

### v0.2 — Combat & Variety
- [ ] 3+ monster types with distinct AI
- [ ] Stun weapons, traps, environmental hazards
- [ ] Walkie-talkies
- [ ] Ship-wide alarms

### v0.3 — More Worlds
- [ ] Two additional moons (forest, ice)
- [ ] Weather effects per moon
- [ ] Bestiary unlocks

### v0.4 — Polish
- [ ] Custom controls / keybinds
- [ ] Spectator mode for dead players
- [ ] Replay export
- [ ] Mobile touch controls

---

## Contributing

This is a personal project, but PRs and issues are welcome. If you're adding a feature:

1. Open an issue first describing what you want to do.
2. Branch from `main` as `feat/your-feature` or `fix/your-bug`.
3. Run `npm run lint` and `npm run typecheck` before pushing.
4. Open a PR — keep it scoped and include a short demo gif if it's a visible change.

---

## Known Issues / Limitations

- WebRTC mesh doesn't scale well past 4–6 peers; expect quality drops in larger lobbies until an SFU is added.
- Procedural generation can occasionally produce isolated rooms; the generator runs a connectivity check and re-rolls when this happens, but it adds load time on rare seeds.
- No persistence — closing the tab loses your run.

---

## Credits & Inspiration

- **Inspired by** *Lethal Company* by Zeekerss. This project is a fan tribute and is not affiliated with the original.
- Built by [@DoperDodge](https://github.com/DoperDodge).
- Stack inspiration from prior project [Pixel Hearts](https://github.com/DoperDodge/Hearts-Multiplayer-Game-2).

---

## License

MIT — see `LICENSE` file. All original code and assets only. Do not redistribute *Lethal Company* assets through this repository.
