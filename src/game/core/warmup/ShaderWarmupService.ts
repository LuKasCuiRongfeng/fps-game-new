import * as THREE from "three";
// @ts-ignore - WebGPU types not fully available
import { PostProcessing, WebGPURenderer } from "three/webgpu";

import { Enemy } from "../../enemy/Enemy";
import { Pickup } from "../../entities/PickupTSL";
import { Grenade } from "../../entities/GrenadeTSL";
import { EnemyType, EnemyTypesConfig } from "../GameConfig";
import { GameEventBus } from "../events/GameEventBus";
import type { WeaponId } from "../../weapon/WeaponTypes";
import { BulletTrail, HitEffect } from "../../weapon/WeaponEffects";
import type { Level } from "../../level/Level";
import type { PhysicsSystem } from "../PhysicsSystem";
import type { EnemySystem } from "../../systems/EnemySystem";
import type { UniformManager } from "../../shaders/TSLMaterials";
import type { GpuSimulationFacade } from "../gpu/GpuSimulationFacade";
import type { PlayerController } from "../../player/PlayerController";
import type { WarmupOptions } from "./WarmupConfig";

export type ProgressCallback = (progress: number, desc: string) => void;

type WebGPUCompileAsync = (scene: THREE.Scene, camera: THREE.Camera) => Promise<unknown>;
type WebGPUCompile = (scene: THREE.Scene, camera: THREE.Camera) => unknown;

export async function runShaderWarmup(params: {
    renderer: WebGPURenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    playerController: PlayerController;
    level: Level;
    physicsSystem: PhysicsSystem;
    enemySystem: EnemySystem;
    uniformManager: UniformManager;
    simulation: GpuSimulationFacade;
    postProcessing: PostProcessing;
    updateProgress: ProgressCallback;
    options?: Partial<WarmupOptions>;
}): Promise<void> {
    const {
        renderer,
        scene,
        camera,
        playerController,
        level,
        physicsSystem,
        enemySystem,
        uniformManager,
        simulation,
        postProcessing,
        updateProgress,
        options,
    } = params;

    const gpuCompute = simulation.enemies;
    const particleSystem = simulation.particles;

    const resolved: WarmupOptions = {
        enabled: true,
        yawSteps: 16,
        pitches: [0, -0.45, 0.45],
        minFov: 120,
        minFar: 2000,
        doCompileViews: true,
        doNoCullRender: true,
        doRenderViews: true,
        warmupDelta: 0.016,
        warmupHealth: 100,
        ...(options ?? {}),
    };

    if (!resolved.enabled) return;

    updateProgress(92, "i18n:loading.stage.dummy");

    // IMPORTANT: dummy entities must be inside the camera frustum during warmup.
    // If they are underground/out of view, compileAsync won't compile their pipelines.
    const dummyAnchor = new THREE.Vector3(camera.position.x, camera.position.y, camera.position.z);

    let weaponWarmupVisible = false;

    // 1. Dummy enemies (warm up: type x weapon combinations)
    const warmupEnemies: Enemy[] = [];
    const warmupTypes = Object.keys(EnemyTypesConfig) as EnemyType[];
    const warmupWeapons: WeaponId[] = ["rifle", "smg", "shotgun", "sniper", "pistol"];

    const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const gridCols = warmupWeapons.length;
    const gridRows = warmupTypes.length;
    const colSpacing = 2.0;
    const rowSpacing = 2.6;
    const gridCenterOffset = (gridCols - 1) * 0.5;

    const base = dummyAnchor.clone().addScaledVector(camForward, 8);

    for (let r = 0; r < gridRows; r++) {
        for (let c = 0; c < gridCols; c++) {
            const type = warmupTypes[r];
            const weaponId = warmupWeapons[c];
            const pos = base
                .clone()
                .addScaledVector(camRight, (c - gridCenterOffset) * colSpacing)
                .addScaledVector(camForward, -r * rowSpacing);

            const enemy = new Enemy(pos, type, weaponId);
            enemy.onGetGroundHeight = (x, z) => level.getTerrainHeight(x, z);
            enemy.setPhysicsSystem(physicsSystem);
            scene.add(enemy.mesh);
            warmupEnemies.push(enemy);
        }
    }

    // 2. Dummy pickups (two types)
    const warmupEvents = new GameEventBus();
    const dummyPickupHealth = new Pickup(
        "health",
        new THREE.Vector3(dummyAnchor.x - 2.0, dummyAnchor.y, dummyAnchor.z - 3.0),
        warmupEvents
    );
    scene.add(dummyPickupHealth.mesh);

    const dummyPickupAmmo = new Pickup(
        "ammo",
        new THREE.Vector3(dummyAnchor.x - 3.2, dummyAnchor.y, dummyAnchor.z - 3.0),
        warmupEvents
    );
    scene.add(dummyPickupAmmo.mesh);

    // 3. Dummy grenade
    const dummyGrenade = new Grenade(
        new THREE.Vector3(dummyAnchor.x + 3.0, dummyAnchor.y, dummyAnchor.z - 3.0),
        new THREE.Vector3(0, 1, 0),
        0,
        scene,
        [],
        dummyAnchor,
        warmupEvents
    );

    // Force matrices updated so they are considered renderable
    for (const e of warmupEnemies) {
        e.mesh.updateMatrixWorld(true);
    }
    dummyPickupHealth.mesh.updateMatrixWorld(true);
    dummyPickupAmmo.mesh.updateMatrixWorld(true);

    // 4. Dummy trail + hit effects so first-shot isn't compiling/uploading
    const dummyTrail = new BulletTrail();
    dummyTrail.init(
        new THREE.Vector3(dummyAnchor.x, dummyAnchor.y + 1.2, dummyAnchor.z - 1.2),
        new THREE.Vector3(dummyAnchor.x, dummyAnchor.y + 1.2, dummyAnchor.z - 6.5)
    );
    dummyTrail.mesh.visible = true;
    scene.add(dummyTrail.mesh);

    const dummyHit = new HitEffect();
    dummyHit.init(
        new THREE.Vector3(dummyAnchor.x + 0.8, dummyAnchor.y + 1.1, dummyAnchor.z - 5.0),
        new THREE.Vector3(0, 1, 0),
        "spark"
    );
    scene.add(dummyHit.group);

    dummyTrail.mesh.updateMatrixWorld(true);
    dummyHit.group.updateMatrixWorld(true);

    // 5. Warm up particle emit paths (first muzzle flash / hit)
    try {
        const forward = new THREE.Vector3(0, 0, -1);
        const p = new THREE.Vector3(dummyAnchor.x, dummyAnchor.y + 1.2, dummyAnchor.z - 3.5);
        particleSystem.emitMuzzleFlash(p, forward);
        particleSystem.emitSparks(p, new THREE.Vector3(0, 1, 0), 6);
        particleSystem.emitBlood(p, forward, 6);
        particleSystem.update(resolved.warmupDelta);
    } catch {
        // ignore
    }

    updateProgress(95, "i18n:loading.stage.shaderWarmup");

    const cleanupDummies = () => {
        // Cleanup dummy entities (idempotent best-effort)
        for (const enemy of warmupEnemies) {
            try {
                scene.remove(enemy.mesh);
                enemySystem.recycle(enemy);
            } catch {
                // ignore
            }
        }

        try {
            scene.remove(dummyPickupHealth.mesh);
            scene.remove(dummyPickupAmmo.mesh);
            scene.remove(dummyGrenade.mesh);
            scene.remove(dummyTrail.mesh);
            scene.remove(dummyHit.group);

            dummyPickupHealth.dispose();
            dummyPickupAmmo.dispose();
            dummyGrenade.dispose();
            dummyTrail.dispose();
            dummyHit.dispose();
        } catch {
            // ignore
        }

        if (weaponWarmupVisible) {
            try {
                playerController.endWeaponWarmupVisible();
            } catch {
                // ignore
            }
            weaponWarmupVisible = false;
        }
    };

    try {
        const compileAsync = (renderer as any).compileAsync as WebGPUCompileAsync | undefined;
        const compile = (renderer as any).compile as WebGPUCompile | undefined;

        // Force-compile scene materials to avoid first-look hitches.
        if (compileAsync && resolved.doCompileViews) {
            const originalQuaternion = camera.quaternion.clone();
            const originalPosition = camera.position.clone();

            // Also warm up weapon viewmodel pipelines (switch/fire can otherwise hitch on first use).
            playerController.beginWeaponWarmupVisible();
            weaponWarmupVisible = true;

            scene.updateMatrixWorld(true);

            // Previous warmup only sampled 4 yaw angles. With ~75° FOV this leaves blind gaps.
            // We widen FOV temporarily and sample more yaw steps.
            const originalFov = camera.fov;
            const originalFar = camera.far;

            camera.fov = Math.max(originalFov, resolved.minFov);
            camera.far = Math.max(originalFar, resolved.minFar);
            camera.updateProjectionMatrix();

            const yawSteps = Math.max(1, resolved.yawSteps);
            const angles: number[] = [];
            for (let i = 0; i < yawSteps; i++) {
                angles.push((i / yawSteps) * Math.PI * 2);
            }

            const pitches = resolved.pitches.length ? resolved.pitches : [0];

            for (const angle of angles) {
                for (const pitch of pitches) {
                    camera.setRotationFromEuler(new THREE.Euler(pitch, angle, 0, "YXZ"));
                    camera.updateMatrixWorld();

                    await compileAsync(scene, camera);
                }
            }

            camera.position.copy(originalPosition);
            camera.quaternion.copy(originalQuaternion);
            camera.updateMatrixWorld();

            // Render warmup: force postprocessing + shadow pipelines.
            if (resolved.doNoCullRender) {
                updateProgress(96, "i18n:loading.stage.gpuWarmup");
                const noCullObjects: THREE.Object3D[] = [];
                const noCullPrevFlags: boolean[] = [];
                scene.traverse((obj) => {
                    if (!obj) return;
                    // @ts-ignore - runtime property
                    if (typeof (obj as any).frustumCulled === "boolean") {
                        noCullObjects.push(obj);
                        // @ts-ignore
                        noCullPrevFlags.push((obj as any).frustumCulled);
                        // @ts-ignore
                        (obj as any).frustumCulled = false;
                    }
                });

                try {
                    camera.setRotationFromEuler(new THREE.Euler(0, 0, 0, "YXZ"));
                    camera.updateMatrixWorld();
                    uniformManager.update(resolved.warmupDelta, camera.position, resolved.warmupHealth);
                    gpuCompute.updateEnemies(resolved.warmupDelta, camera.position);
                    particleSystem.update(resolved.warmupDelta);
                    await postProcessing.render();
                    await new Promise((resolve) => setTimeout(resolve, 0));
                } finally {
                    for (let i = 0; i < noCullObjects.length; i++) {
                        // @ts-ignore
                        (noCullObjects[i] as any).frustumCulled = noCullPrevFlags[i];
                    }
                }
            }

            if (resolved.doRenderViews) {
                updateProgress(97, "i18n:loading.stage.renderWarmup");
                for (const angle of angles) {
                    for (const pitch of pitches) {
                        camera.setRotationFromEuler(new THREE.Euler(pitch, angle, 0, "YXZ"));
                        camera.updateMatrixWorld();

                        uniformManager.update(resolved.warmupDelta, camera.position, resolved.warmupHealth);
                        gpuCompute.updateEnemies(resolved.warmupDelta, camera.position);
                        particleSystem.update(resolved.warmupDelta);

                        await postProcessing.render();
                        await new Promise((resolve) => setTimeout(resolve, 0));
                    }
                }
            }

            camera.fov = originalFov;
            camera.far = originalFar;
            camera.updateProjectionMatrix();

            camera.position.copy(originalPosition);
            camera.quaternion.copy(originalQuaternion);
            camera.updateMatrixWorld();
        } else {
            // @ts-ignore - Fallback/Compat
            if (compile) await compile(scene, camera);
        }
    } catch (e) {
        console.warn("Shader pre-compilation failed:", e);
    } finally {
        cleanupDummies();
    }
}
