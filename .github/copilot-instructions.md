# Copilot instructions (fps-game)

## Big picture
- Frontend is Vite + React; the 3D game runs in `src/game/**` and is bootstrapped from `src/App.tsx` via `new Game(container, ...)`.
- `Game` (`src/game/core/Game.ts`) is the composition root: it builds renderer/scene/systems through an async init pipeline (`src/game/core/init/InitPipeline.ts`) and then runs the main loop.
- Rendering & simulation target **WebGPU-first**: use `three/webgpu` + TSL (`three/tsl`) and compute shaders when possible (`src/game/shaders/GPUCompute.ts`, `src/game/shaders/GPUParticles.ts`).
- Prefer **GPU-first** implementations: if a feature can be accelerated via TSL node materials or compute shaders, do it on the GPU and avoid CPU equivalents.

## Core runtime structure (how to extend)
- Prefer adding gameplay/engine features as **Systems** and registering them in the system graph rather than wiring logic into `Game`.
  - System ordering is centralized in `src/game/core/composition/SystemGraphFactory.ts` (phases: `preSim` → `sim` → `postSim` → `render`).
  - Use the `extendPhases` hook in `createAndRegisterSystemGraph(...)` to inject new systems without reordering defaults.
- Frame data is passed via a `FrameContext` built each tick (see `fillFrameContext` usage in `src/game/core/Game.ts`); systems should read from `frame` instead of reaching into global state.

## Services, state, and UI wiring
- UI reads game state through `GameServices.state` (singleton `GameStateService` in `src/game/core/GameState.ts`). Keep React updates lightweight; this store already throttles some updates (e.g., charge progress).
- Runtime-tunable settings are persisted in `RuntimeSettingsStore` (`src/game/core/settings/RuntimeSettingsStore.ts`) and pushed into the running game via `game.setRuntimeSettings(...)`.

## GPU/TSL conventions
- All materials must use **WebGPU Node materials** from `three/webgpu` (e.g., `MeshStandardNodeMaterial`, `MeshBasicNodeMaterial`, `SpriteNodeMaterial`). Don’t introduce non-node/legacy materials.
- Prefer procedural materials via TSL node materials in `src/game/shaders/TSLMaterials.ts` (e.g., set `material.colorNode`, `normalNode`, `emissiveNode`).
- For compute, follow the storage-buffer pattern in `src/game/shaders/GPUCompute.ts`:
  - allocate `StorageBufferAttribute` arrays once, update `.needsUpdate` only when CPU writes,
  - drive per-element logic using `instanceIndex`, `storage(...)`, and `Fn(...).compute(count)`.
- WebGPU renderer creation is centralized in `src/game/core/render/RendererFactory.ts` (`WebGPURenderer`); don’t introduce WebGL fallbacks.

## Tauri/Rust integration (assets)
- Static assets live under `src-tauri/resources/**` and are bundled via `src-tauri/tauri.conf.json`.
- Frontend audio loading goes through a Rust command: `invoke('load_audio_asset', { filename })` in `src/game/core/SoundManager.ts`.
  - If you add new audio assets, place them under `src-tauri/resources/audio/` and keep the Rust resolver in `src-tauri/src/lib.rs` working.

## Local dev workflows
- Frontend dev server: `pnpm dev` (Vite on port 1420).
- Build (typecheck + bundle): `pnpm build`.
- Tauri dev/build uses the above via `src-tauri/tauri.conf.json` (`beforeDevCommand`/`beforeBuildCommand`).
- Optional local data server (static files): `node server/index.js` (Express, port 12345, serves `server/public/`).

## Repo-specific patterns to follow
- Treat `GameConfig` (`src/game/core/GameConfig.ts`) as the central place for gameplay constants.
- Keep `Game` lean: add new subsystems via factories under `src/game/core/composition/**` and keep coupling low.
- If a feature needs native performance or secure file access, add a Tauri command in `src-tauri/src/lib.rs` and call it via `@tauri-apps/api/core`.
