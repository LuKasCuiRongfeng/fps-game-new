# Copilot instructions (fps-game)

## Big picture
- This repo is a Tauri desktop app: **Vite + React (UI)** + **three.js WebGPU/TSL game runtime** + **Rust (Tauri commands/resources)**.
- The game is intentionally **GPU-first** (compute + TSL shaders) and does **not** implement compatibility fallbacks. See [README.md](../README.md).

## Developer workflows
- Frontend dev (Vite): `pnpm dev` (port `1420`). Config in [vite.config.ts](../vite.config.ts).
- Tauri dev shell: `pnpm tauri dev` (or `npm run tauri dev`). Tauri will run `pnpm dev` automatically via [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json).
- Production build: `pnpm tauri build` (runs `pnpm build` -> `tsc && vite build`).
- Lint: `pnpm lint` (eslint v9 flat config in [eslint.config.js](../eslint.config.js)).
- Local “temporary data service”: `cd server; npm i; node index.js` (Express + static `server/public`, port `12345`). See [server/index.js](../server/index.js).

## Key architecture (where to look)
- React composition root: [src/App.tsx](../src/App.tsx)
  - Creates a single `Game` instance, wires loading/progress UI, and subscribes to game state via `services.state.subscribe(...)`.
- Game composition root: [src/game/core/Game.ts](../src/game/core/Game.ts)
  - Uses an explicit **init pipeline** (step-by-step) with progress callbacks: [src/game/core/init/InitPipeline.ts](../src/game/core/init/InitPipeline.ts) and [src/game/core/init/GameInitSteps.ts](../src/game/core/init/GameInitSteps.ts).
  - Builds a `GameRuntime` incrementally (builder pattern) to avoid `null as any` during async init.
- “Systems” update model: [src/game/core/engine/SystemManager.ts](../src/game/core/engine/SystemManager.ts)
  - Add new per-frame logic as a `System` and register it via the composition layer.
  - Default ordering is defined as explicit phases in [src/game/core/composition/SystemGraphFactory.ts](../src/game/core/composition/SystemGraphFactory.ts) (preSim → sim → postSim → render).

## GPU/TSL conventions (project-specific)
- Prefer GPU compute + GPU-driven rendering paths when adding features.
  - Compute/particles façade: [src/game/core/gpu/GpuSimulationFacade.ts](../src/game/core/gpu/GpuSimulationFacade.ts)
  - Shader entry exports: [src/game/shaders/index.ts](../src/game/shaders/index.ts)
- Shader warmup is a first-class performance feature.
  - If you add new materials/pipelines that might hitch on first use, extend warmup logic in [src/game/core/warmup/ShaderWarmupService.ts](../src/game/core/warmup/ShaderWarmupService.ts).

## Config & tuning
- Gameplay parameters live in one place and are referenced broadly:
  - [src/game/core/GameConfig.ts](../src/game/core/GameConfig.ts) (player, weapons, enemies, effects, audio, etc.).
- Loading stage strings are i18n keys; keep them in sync when adding/removing init steps:
  - [src/i18n.ts](../src/i18n.ts) (e.g. `i18n:loading.stage.*`).

## Tauri integration (Rust ↔ TS)
- Rust command surface is in [src-tauri/src/lib.rs](../src-tauri/src/lib.rs).
  - Example: `load_audio_asset` reads bytes from `src-tauri/resources/audio` in dev and from bundled resources in prod.
- Frontend calls into Rust via `invoke(...)`:
  - Audio loader usage is in [src/game/core/SoundManager.ts](../src/game/core/SoundManager.ts).
- Static assets intended for the app bundle should go under `src-tauri/resources/` and be listed in [src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json) `bundle.resources`.

## When changing/adding gameplay features
- Prefer adding a new `System` (under `src/game/systems/`) and wiring it into the phase graph via `createAndRegisterSystemGraph(...)`.
- Prefer extending initialization via the init pipeline (keep progress reporting) rather than doing heavy work in constructors.
