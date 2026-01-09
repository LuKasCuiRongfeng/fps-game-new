# Copilot instructions (fps-game)

## Big picture
- Frontend is Vite + React (TS) and renders the game via Three.js WebGPU + TSL nodes.
- Desktop wrapper is Tauri v2 (Rust) in `src-tauri/` (used for native capabilities + bundled resources).
- Optional local data/service dependency lives in `server/index.js` (Express static server on port `12345`).

## Key architecture & flows
- App bootstrap: `src/main.tsx` → `src/App.tsx` creates `new Game(container, onLoaded, onProgress)`.
- Game runtime hub: `src/game/core/Game.ts` owns WebGPURenderer, scene/camera, systems (physics/pathfinding/weather/particles) and runs warmup to avoid first-look hitches.
- UI state is push-based: game systems update `GameStateService` (`src/game/core/GameState.ts`), React HUD subscribes once in `src/App.tsx`.
- Shaders/materials: prefer TSL (`three/tsl`) and WebGPU paths (`three/webgpu`), see `src/game/shaders/*` and post-processing pipeline in `src/game/core/Game.ts`.

## i18n (zh default, en supported)
- i18n setup lives in `src/i18n.ts` and is imported once from `src/main.tsx`.
- UI components use `useTranslation()` and keys like `hud.*`, `gameOver.*`, `loading.*`.
- Loading progress strings are passed as `i18n:<key>` (e.g. `i18n:loading.stage.compute`) so `LoadingScreen` can translate.
- Language is stored in `localStorage['lang']` (`'zh' | 'en'`); quick toggle UI is `src/ui/components/LanguageToggle.tsx`.

## Developer workflows
- Frontend dev: `pnpm dev` (Vite). Tauri dev uses fixed Vite port `1420` (see `vite.config.ts`).
- Build: `npm run build` or `pnpm build` (runs `tsc` then `vite build`).
- Tauri: `pnpm tauri dev` / `pnpm tauri build` (see `src-tauri/tauri.conf.json` for beforeDev/build commands).
- Local server: `cd server && pnpm i && node index.js` (serves `server/public/`).

## Repo-specific conventions
- Keep gameplay/engine code under `src/game/**` and UI under `src/ui/**` (per `README.md`).
- Performance-first: avoid per-frame allocations in hot paths; reuse pools (examples: trail pooling + warmup in `src/game/core/Game.ts`).
- Static/bundled assets go in `src-tauri/resources/**` (audio is under `src-tauri/resources/audio/*`).
- If you need native file/resource access, add a Tauri command in `src-tauri/src/lib.rs` and call it from the frontend via `@tauri-apps/api`.
