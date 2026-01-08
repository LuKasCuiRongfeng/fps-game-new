import * as THREE from 'three';
import { uniform } from 'three/tsl';
import { Enemy } from '../enemy/Enemy';
import { SoundManager } from '../core/SoundManager';
import { GameStateService } from '../core/GameState';
import { WeaponConfig } from '../core/GameConfig';
import { GPUParticleSystem } from '../shaders/GPUParticles';
import { HitEffect } from './WeaponEffects';
import { WeaponContext, IPlayerWeapon, MeleeWeaponDefinition } from './WeaponTypes';
import { WeaponFactory } from './WeaponFactory';

export class PlayerMeleeWeapon implements IPlayerWeapon {
    public readonly id: MeleeWeaponDefinition['id'];
    public readonly category = 'melee' as const;

    private camera: THREE.Camera;
    private def: MeleeWeaponDefinition;

    private mesh: THREE.Group;
    private enemies: Enemy[] = [];
    private particleSystem: GPUParticleSystem | null = null;

    private raycaster = new THREE.Raycaster();
    private v2Zero = new THREE.Vector2(0, 0);

    private combatTargets: THREE.Object3D[] = [];
    private envTargets: THREE.Object3D[] = [];
    private combatHits: THREE.Intersection[] = [];
    private envHits: THREE.Intersection[] = [];

    private cachedScene: THREE.Scene | null = null;
    private cachedSceneChildrenLen = -1;
    private cachedSceneStamp = 0;
    private cachedTreesAndGrass: THREE.Object3D[] = [];
    private cachedEnvStatics: THREE.Object3D[] = [];

    private lastSwingTime = 0;

    // Charge-to-throw (knife/scythe)
    private isCharging = false;
    private chargeElapsed = 0;
    private chargeCtx: WeaponContext | null = null;

    private thrown:
        | {
              id: 'knife' | 'scythe';
              mesh: THREE.Object3D;
              scene: THREE.Scene;
              elapsed: number;
              total: number;
              outTime: number;
              start: THREE.Vector3;
              dir: THREE.Vector3;
              outDist: number;
                            damage: number;
              hitEnemies: Set<Enemy>;
                            grassMeshes: Array<{ mesh: THREE.InstancedMesh; center: THREE.Vector3; radius: number }>;
              prevPos: THREE.Vector3;
                            grassCheckAccum: number;
          }
        | null = null;

        // temp objects to reduce per-frame allocations (throw path + collision)
        private tmpCamPos = new THREE.Vector3();
        private tmpReturnPos = new THREE.Vector3();
        private tmpNextPos = new THREE.Vector3();
        private tmpSide = new THREE.Vector3();
        private tmpUp = new THREE.Vector3(0, 1, 0);
        private tmpEnemyPos = new THREE.Vector3();
        private tmpDir = new THREE.Vector3();
        private tmpSeg = new THREE.Vector3();
        private tmpA = new THREE.Vector3();
        private tmpB = new THREE.Vector3();
        private tmpC = new THREE.Vector3();
        private grassCandidates: THREE.InstancedMesh[] = [];
        private tmpMid = new THREE.Vector3();

    // 简易命中特效对象池（复用 WeaponEffects.HitEffect）
    private scene: THREE.Scene | null = null;
    private hitEffects: HitEffect[] = [];
    private hitEffectPool: HitEffect[] = [];

    // 更像人类的近战动作：蓄力 -> 命中 -> 收势
    private isSwinging = false;
    private swingElapsed = 0;
    private swingDuration = 0.35;
    private swingHitTime = 0.45;
    private swingHitApplied = false;
    private pendingContext: WeaponContext | null = null;

    private basePosition = new THREE.Vector3();
    private baseRotation = new THREE.Euler();

    // dummy uniform for factory api compatibility
    private dummyIntensity = uniform(0);

    constructor(camera: THREE.Camera, def: MeleeWeaponDefinition) {
        this.camera = camera;
        this.def = def;
        this.id = def.id;

        const assets = WeaponFactory.createPlayerMeleeMesh(def.id);
        this.mesh = assets;

        // Keep a stable baseline so animation doesn't push the weapon off-screen.
        this.basePosition.copy(this.mesh.position);
        this.baseRotation.copy(this.mesh.rotation);

        // Viewmodel meshes can be culled incorrectly; disable frustum culling.
        this.mesh.traverse((obj) => {
            const anyObj = obj as any;
            if (anyObj.isMesh) anyObj.frustumCulled = false;
        });

        this.camera.add(this.mesh);
        this.hide();
    }

    public setEnemies(enemies: Enemy[]) {
        this.enemies = enemies;
    }

    public setParticleSystem(system: GPUParticleSystem) {
        this.particleSystem = system;
    }

    public show(): void {
        this.mesh.visible = true;
    }

    public hide(): void {
        this.mesh.visible = false;
        // Stop charge UI if switching away
        if (this.isCharging) {
            this.isCharging = false;
            this.chargeElapsed = 0;
            this.chargeCtx = null;
            GameStateService.getInstance().setChargeProgress(0);
        }
    }

    public update(delta: number): void {
        // Charge pose
        if (this.isCharging) {
            const chargeMin = WeaponConfig.melee.chargeThrow.chargeMinSeconds;
            const chargeMax = WeaponConfig.melee.chargeThrow.chargeMaxSeconds;
            this.chargeElapsed = Math.min(chargeMax, this.chargeElapsed + delta);
            // UI progress is aligned with "throw-ready" threshold:
            // 0 until reaching chargeMin, then 0..1 over [chargeMin, chargeMax].
            const p = this.chargeElapsed < chargeMin
                ? 0
                : Math.min(1, (this.chargeElapsed - chargeMin) / (chargeMax - chargeMin));
            GameStateService.getInstance().setChargeProgress(p);
            // Pull back / ready-to-throw pose
            const pos = new THREE.Vector3(0.03, -0.01 + p * 0.02, 0.06 + p * 0.06);
            const rot = new THREE.Vector3(-0.15 - p * 0.25, 0.25 + p * 0.4, 0.12);
            this.mesh.position.copy(this.basePosition).add(pos);
            this.mesh.rotation.set(
                this.baseRotation.x + rot.x,
                this.baseRotation.y + rot.y,
                this.baseRotation.z + rot.z,
            );
        }

        // Thrown weapon boomerang update
        if (this.thrown) {
            this.updateThrown(delta);
        }

        // 更新近战动作
        if (this.isSwinging) {
            this.swingElapsed += delta;
            const t = Math.min(1, this.swingElapsed / this.swingDuration);

            // 在动作的“命中帧”做一次判定（避免按下瞬间就命中）
            if (!this.swingHitApplied && t >= this.swingHitTime) {
                this.swingHitApplied = true;
                if (this.pendingContext) this.performHit(this.pendingContext);
            }

            // Pose
            const pose = this.getSwingPose(t);
            this.mesh.position.copy(this.basePosition).add(pose.pos);
            this.mesh.rotation.set(
                this.baseRotation.x + pose.rot.x,
                this.baseRotation.y + pose.rot.y,
                this.baseRotation.z + pose.rot.z,
            );

            if (t >= 1) {
                this.isSwinging = false;
                this.swingElapsed = 0;
                this.pendingContext = null;

                this.mesh.position.copy(this.basePosition);
                this.mesh.rotation.copy(this.baseRotation);
            }
        }

        // 更新命中特效
        for (let i = this.hitEffects.length - 1; i >= 0; i--) {
            const effect = this.hitEffects[i];
            effect.update(delta);
            if (effect.isDead) {
                if (this.scene) this.scene.remove(effect.group);
                this.hitEffects.splice(i, 1);
                this.hitEffectPool.push(effect);
            }
        }
    }

    public onTriggerDown(ctx: WeaponContext): void {
        this.scene = ctx.scene;

        const now = performance.now() / 1000;

        // Knife + scythe: support charged throw
        if (this.def.id === 'knife' || this.def.id === 'scythe') {
            if (this.thrown) return; // can't charge while thrown
            if (this.isCharging) return;
            if (now - this.lastSwingTime < this.def.swingCooldown) return;

            this.isCharging = true;
            this.chargeElapsed = 0;
            this.chargeCtx = ctx;
            return;
        }

        // Default: immediate melee attack (axe)
        if (now - this.lastSwingTime < this.def.swingCooldown) return;
        this.startSwing(ctx);
    }

    public onTriggerUp(): void {
        if (!this.isCharging) return;
        const ctx = this.chargeCtx;
        this.isCharging = false;
        this.chargeCtx = null;
        GameStateService.getInstance().setChargeProgress(0);

        // Return to baseline (swing/throw will override)
        this.mesh.position.copy(this.basePosition);
        this.mesh.rotation.copy(this.baseRotation);

        if (!ctx) return;

        const now = performance.now() / 1000;
        if (now - this.lastSwingTime < this.def.swingCooldown) return;

        const chargeMin = WeaponConfig.melee.chargeThrow.chargeMinSeconds;
        if (this.chargeElapsed >= chargeMin) {
            this.startThrow(ctx, this.chargeElapsed);
        } else {
            this.startSwing(ctx);
        }
    }

    public startAiming(): void {
        // melee no aiming
    }

    public stopAiming(): void {
        // melee no aiming
    }

    public getAimProgress(): number {
        return 0;
    }

    private performHit(ctx: WeaponContext) {
        // Raycast at impact time
        this.raycaster.setFromCamera(this.v2Zero, this.camera);
        this.raycaster.far = this.def.range;

        // Refresh cached scene lists at a low frequency.
        const now = performance.now();
        if (this.cachedScene !== ctx.scene || this.cachedSceneChildrenLen !== ctx.scene.children.length || now - this.cachedSceneStamp > 500) {
            this.cachedScene = ctx.scene;
            this.cachedSceneChildrenLen = ctx.scene.children.length;
            this.cachedSceneStamp = now;

            this.cachedTreesAndGrass.length = 0;
            this.cachedEnvStatics.length = 0;
            for (const child of ctx.scene.children) {
                if ((child as any).isInstancedMesh && (child.userData?.isTree || child.userData?.isGrass)) {
                    this.cachedTreesAndGrass.push(child);
                    continue;
                }

                // env raycast excludes non-collidable/effects
                if (child.userData?.isSkybox) continue;
                if (child.userData?.isWeatherParticle) continue;
                if (child.userData?.isEffect) continue;
                if (child.userData?.isBulletTrail) continue;
                if (child.userData?.isDust) continue;
                if (child.userData?.isEnemyWeapon) continue;
                this.cachedEnvStatics.push(child);
            }
        }

        // 1) Combat targets: enemies + trees. This avoids the common case where the
        // ground is the closest hit and prevents chopping.
        const combatTargets = this.combatTargets;
        combatTargets.length = 0;
        for (const enemy of this.enemies) {
            if (!enemy.isDead && enemy.mesh.visible) combatTargets.push(enemy.mesh);
        }
        for (const obj of this.cachedTreesAndGrass) combatTargets.push(obj);

        const combatHits = this.combatHits;
        combatHits.length = 0;
        this.raycaster.intersectObjects(combatTargets, true, combatHits);

        const toHitInfo = (hit: THREE.Intersection) => {
            const hitPoint = hit.point.clone();
            const hitNormal = hit.face?.normal?.clone() ?? new THREE.Vector3(0, 1, 0);
            if (hit.object.matrixWorld) hitNormal.transformDirection(hit.object.matrixWorld);
            return { hitPoint, hitNormal };
        };

        // Enemy hit
        for (const hit of combatHits) {
            const obj = hit.object as any;
            if (obj?.userData?.isEnemy && obj?.userData?.entity) {
                const { hitPoint, hitNormal } = toHitInfo(hit);
                const enemy = obj.userData.entity as Enemy;
                enemy.takeDamage(this.def.damage);
                SoundManager.getInstance().playHit();

                if (this.particleSystem) {
                    const dir = this.raycaster.ray.direction.clone().negate().add(hitNormal).normalize();
                    this.particleSystem.emitBlood(hitPoint, dir, 12);
                }
                this.createHitEffect(hitPoint, hitNormal, 'blood');
                return;
            }
        }

        // Axe: chop tree instances
        if (this.def.id === 'axe') {
            for (const hit of combatHits) {
                const instanced = this.findTreeInstancedMesh(hit.object);
                if (instanced && hit.instanceId !== undefined && hit.instanceId !== null) {
                    const { hitPoint, hitNormal } = toHitInfo(hit);
                    this.chopTreeInstance(instanced, hit.instanceId);
                    if (this.particleSystem) {
                        this.particleSystem.emitSparks(hitPoint, hitNormal, 10);
                    }
                    this.createHitEffect(hitPoint, hitNormal, 'spark');
                    return;
                }
            }
        }

        // Scythe: cut grass instances
        if (this.def.id === 'scythe') {
            for (const hit of combatHits) {
                const grass = this.findGrassInstancedMesh(hit.object);
                if (grass && hit.instanceId !== undefined && hit.instanceId !== null) {
                    const { hitPoint, hitNormal } = toHitInfo(hit);
                    this.cutGrassInstance(grass, hit.instanceId);
                    if (this.particleSystem) {
                        this.particleSystem.emitSparks(hitPoint, hitNormal, 6);
                    }
                    this.createHitEffect(hitPoint, hitNormal, 'spark');
                    return;
                }
            }
        }

        // Environment hit
        // 2) Environment targets: only raycast when no combat-relevant hit.
        const envTargets = this.envTargets;
        envTargets.length = 0;
        for (const obj of this.cachedEnvStatics) envTargets.push(obj);

        const envHits = this.envHits;
        envHits.length = 0;
        this.raycaster.intersectObjects(envTargets, true, envHits);

        if (envHits.length > 0) {
            const { hitPoint, hitNormal } = toHitInfo(envHits[0]);
            if (this.particleSystem) {
                this.particleSystem.emitSparks(hitPoint, hitNormal, 8);
            }
            this.createHitEffect(hitPoint, hitNormal, 'spark');
        }
    }

    private getSwingPose(t: number): { pos: THREE.Vector3; rot: THREE.Vector3 } {
        const pos = new THREE.Vector3();
        const rot = new THREE.Vector3();

        // Helpers
        const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
        const smooth = (a: number, b: number, x: number) => {
            const p = clamp01((x - a) / (b - a));
            return p * p * (3 - 2 * p);
        };
        const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

        if (this.def.id === 'knife') {
            // Knife stab: pull back -> thrust -> retract
            const w = smooth(0.0, 0.22, t);
            const s = smooth(0.22, 0.55, t);
            const r = smooth(0.55, 1.0, t);

            // Windup
            const wPos = new THREE.Vector3(0.03, -0.02, 0.05);
            const wRot = new THREE.Vector3(-0.05, 0.35, 0.18);

            // Strike
            const sPos = new THREE.Vector3(-0.01, 0.01, -0.26);
            const sRot = new THREE.Vector3(-0.25, -0.12, -0.08);

            // Blend stages
            const stagePos = wPos.clone().multiplyScalar(1 - s).add(sPos.clone().multiplyScalar(s));
            const stageRot = wRot.clone().multiplyScalar(1 - s).add(sRot.clone().multiplyScalar(s));

            // Apply windup, then strike, then retract
            pos.copy(stagePos).multiplyScalar(lerp(0, 1, w));
            rot.copy(stageRot).multiplyScalar(lerp(0, 1, w));
            pos.multiplyScalar(1 - r);
            rot.multiplyScalar(1 - r);
        } else {
            // Axe chop: raise -> chop down -> recover
            const w = smooth(0.0, 0.28, t);
            const s = smooth(0.28, 0.62, t);
            const r = smooth(0.62, 1.0, t);

            const wPos = new THREE.Vector3(0.06, 0.14, 0.03);
            const wRot = new THREE.Vector3(-0.95, 0.15, 0.55);

            const sPos = new THREE.Vector3(-0.03, -0.10, -0.18);
            const sRot = new THREE.Vector3(0.95, -0.10, -0.85);

            const stagePos = wPos.clone().multiplyScalar(1 - s).add(sPos.clone().multiplyScalar(s));
            const stageRot = wRot.clone().multiplyScalar(1 - s).add(sRot.clone().multiplyScalar(s));

            pos.copy(stagePos).multiplyScalar(lerp(0, 1, w));
            rot.copy(stageRot).multiplyScalar(lerp(0, 1, w));
            pos.multiplyScalar(1 - r);
            rot.multiplyScalar(1 - r);
        }

        return { pos, rot };
    }

    private createHitEffect(position: THREE.Vector3, normal: THREE.Vector3, type: 'spark' | 'blood') {
        if (!this.scene) return;

        let effect: HitEffect;
        if (this.hitEffectPool.length > 0) effect = this.hitEffectPool.pop()!;
        else effect = new HitEffect();

        effect.init(position, normal, type);
        this.scene.add(effect.group);
        this.hitEffects.push(effect);
    }

    private findTreeInstancedMesh(obj: THREE.Object3D): THREE.InstancedMesh | null {
        let current: THREE.Object3D | null = obj;
        while (current) {
            if ((current as any).isInstancedMesh && current.userData?.isTree) {
                return current as THREE.InstancedMesh;
            }
            current = current.parent;
        }
        return null;
    }

    private findGrassInstancedMesh(obj: THREE.Object3D): THREE.InstancedMesh | null {
        let current: THREE.Object3D | null = obj;
        while (current) {
            if ((current as any).isInstancedMesh && current.userData?.isGrass) {
                return current as THREE.InstancedMesh;
            }
            current = current.parent;
        }
        return null;
    }

    private chopTreeInstance(treeMesh: THREE.InstancedMesh, instanceId: number) {
        // 将该实例缩放到0并轻微下沉，达到“砍掉”效果（避免极端坐标导致 InstancedMesh culling 异常）
        const m = new THREE.Matrix4();
        treeMesh.getMatrixAt(instanceId, m);
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        m.decompose(pos, quat, scale);
        pos.y = pos.y - WeaponConfig.melee.environment.choppedTreeSink;
        scale.set(0, 0, 0);
        m.compose(pos, quat, scale);
        treeMesh.setMatrixAt(instanceId, m);
        treeMesh.instanceMatrix.needsUpdate = true;
        treeMesh.computeBoundingSphere();

        // paired leaves mesh
        const paired = treeMesh.userData?.pairedMesh as THREE.InstancedMesh | undefined;
        if (paired) {
            paired.setMatrixAt(instanceId, m);
            paired.instanceMatrix.needsUpdate = true;
            paired.computeBoundingSphere();
        }
    }

    private cutGrassInstance(grassMesh: THREE.InstancedMesh, instanceId: number) {
        const m = new THREE.Matrix4();
        grassMesh.getMatrixAt(instanceId, m);
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        m.decompose(pos, quat, scale);
        pos.y = pos.y - WeaponConfig.melee.environment.cutGrassSink;
        scale.set(0, 0, 0);
        m.compose(pos, quat, scale);
        grassMesh.setMatrixAt(instanceId, m);
        grassMesh.instanceMatrix.needsUpdate = true;
        grassMesh.computeBoundingSphere();
    }

    private startSwing(ctx: WeaponContext) {
        const now = performance.now() / 1000;
        this.lastSwingTime = now;

        this.isSwinging = true;
        this.swingElapsed = 0;
        this.swingHitApplied = false;
        this.pendingContext = ctx;

        // Per-weapon feel (config-driven)
        const id = this.def.id as 'knife' | 'axe' | 'scythe';
        const swing = WeaponConfig.melee.swing[id];
        this.swingDuration = swing.duration;
        this.swingHitTime = swing.hitTime;
    }

    private startThrow(ctx: WeaponContext, chargeSeconds: number) {
        if (!this.scene) this.scene = ctx.scene;
        if (!this.scene) return;
        if (this.thrown) return;

        const now = performance.now() / 1000;
        this.lastSwingTime = now;

        const id = this.def.id === 'scythe' ? 'scythe' : 'knife';
        const chargeGlobal = WeaponConfig.melee.chargeThrow;
        const chargeMin = chargeGlobal.chargeMinSeconds;
        const chargeMax = chargeGlobal.chargeMaxSeconds;
        const throwCfg = chargeGlobal[id];

        // Create thrown mesh by cloning the viewmodel mesh (cheap & consistent)
        const thrownMesh = this.mesh.clone(true);
        thrownMesh.visible = true;
        // Ensure it's not parented to camera
        thrownMesh.parent?.remove(thrownMesh);

        // World start
        this.camera.getWorldPosition(this.tmpCamPos);
        this.camera.getWorldDirection(this.tmpDir);

        const start = this.tmpCamPos.clone().add(this.tmpDir.clone().multiplyScalar(chargeGlobal.throwStartForward));
        thrownMesh.position.copy(start);
        thrownMesh.quaternion.copy(this.camera.quaternion);

        // Add to scene
        ctx.scene.add(thrownMesh);

        // Params from charge
        const chargeP = Math.min(1, Math.max(0, (chargeSeconds - chargeMin) / (chargeMax - chargeMin)));
        const outDist = throwCfg.outDistBase + chargeP * throwCfg.outDistBonus;
        const total = throwCfg.totalTime;
        const outTime = throwCfg.outTime;

        const damage = throwCfg.baseDamage + throwCfg.bonusDamage * chargeP;

        const grassMeshes: Array<{ mesh: THREE.InstancedMesh; center: THREE.Vector3; radius: number }> = [];
        if (id === 'scythe') {
            for (const child of ctx.scene.children) {
                if ((child as any).isInstancedMesh && child.userData?.isGrass) {
                    const mesh = child as THREE.InstancedMesh;
                    // Chunk meshes compute boundingSphere in GrassSystem; keep a safe fallback.
                    if (!mesh.boundingSphere) mesh.computeBoundingSphere();

                    const sphere = mesh.boundingSphere;
                    if (!sphere) continue;

                    // boundingSphere is in local space; apply matrixWorld (mesh is typically identity anyway)
                    const center = sphere.center.clone().applyMatrix4(mesh.matrixWorld);
                    // conservative radius (account for scale)
                    const sx = mesh.scale.x;
                    const sy = mesh.scale.y;
                    const sz = mesh.scale.z;
                    const scaleMax = Math.max(Math.abs(sx), Math.abs(sy), Math.abs(sz));
                    const radius = sphere.radius * scaleMax;

                    grassMeshes.push({ mesh, center, radius });
                }
            }
        }

        this.thrown = {
            id,
            mesh: thrownMesh,
            scene: ctx.scene,
            elapsed: 0,
            total,
            outTime,
            start,
            dir: this.tmpDir.normalize().clone(),
            outDist,
            damage,
            hitEnemies: new Set<Enemy>(),
            grassMeshes,
            prevPos: start.clone(),
            grassCheckAccum: 0,
        };

        // Hide viewmodel while thrown
        this.hide();
    }

    private updateThrown(delta: number) {
        const t = this.thrown;
        if (!t) return;

        const chargeGlobal = WeaponConfig.melee.chargeThrow;
        const throwCfg = chargeGlobal[t.id];

        t.elapsed += delta;
        const p = Math.min(1, t.elapsed / t.total);

        // Determine target return position (follow player)
        this.camera.getWorldPosition(this.tmpCamPos);
        this.tmpReturnPos.copy(this.tmpCamPos).addScaledVector(t.dir, chargeGlobal.returnForward);

        const nextPos = this.tmpNextPos;
        if (t.elapsed <= t.outTime) {
            const op = t.elapsed / t.outTime;
            // outward arc with slight sideways curve
            this.tmpSide.crossVectors(t.dir, this.tmpUp).normalize();
            const curve = Math.sin(op * Math.PI) * throwCfg.sideCurve;
            nextPos.copy(t.start)
                .addScaledVector(t.dir, t.outDist * op)
                .addScaledVector(this.tmpSide, curve);
        } else {
            const ip = (t.elapsed - t.outTime) / (t.total - t.outTime);
            nextPos.copy(t.mesh.position).lerp(this.tmpReturnPos, Math.min(1, ip * chargeGlobal.returnLerpBoost));
        }

        // Spin
        t.mesh.rotation.x += delta * throwCfg.spinX;
        t.mesh.rotation.z += delta * throwCfg.spinZ;

        // Enemy collision (distance-based)
        const radius = throwCfg.hitRadius;
        for (const enemy of this.enemies) {
            if (enemy.isDead) continue;
            if (t.hitEnemies.has(enemy)) continue;
            enemy.mesh.getWorldPosition(this.tmpEnemyPos);
            if (this.tmpEnemyPos.distanceTo(nextPos) <= radius) {
                t.hitEnemies.add(enemy);
                enemy.takeDamage(t.damage);
                SoundManager.getInstance().playHit();
                if (this.particleSystem) {
                    this.tmpDir.subVectors(this.tmpEnemyPos, nextPos).normalize();
                    this.particleSystem.emitBlood(this.tmpEnemyPos, this.tmpDir, 10);
                }
                this.createHitEffect(this.tmpEnemyPos, this.tmpUp, 'blood');
            }
        }

        // Grass collision (ray segment)
        if (t.id === 'scythe' && t.grassMeshes.length > 0) {
            // Interval-based cutting to keep frame time stable
            const interval = WeaponConfig.melee.chargeThrow.scythe.grassCheckInterval;
            t.grassCheckAccum += delta;
            if (t.grassCheckAccum >= interval) {
                t.grassCheckAccum = 0;

                // use segment midpoint as sampling point
                this.tmpMid.copy(t.prevPos).add(nextPos).multiplyScalar(0.5);

                // pick a few nearest candidate chunk meshes (cheap)
                const maxCandidates = WeaponConfig.melee.chargeThrow.scythe.grassMaxCandidateMeshes;
                const pad = WeaponConfig.melee.chargeThrow.scythe.grassCutRadius + 2.0;

                // small selection without sorting entire list
                let picked = 0;
                const bestIdx: number[] = [];
                const bestDist: number[] = [];
                for (let i = 0; i < maxCandidates; i++) {
                    bestIdx[i] = -1;
                    bestDist[i] = Number.POSITIVE_INFINITY;
                }

                for (let i = 0; i < t.grassMeshes.length; i++) {
                    const g = t.grassMeshes[i];
                    const r = g.radius + pad;
                    const d2 = g.center.distanceToSquared(this.tmpMid);
                    if (d2 > r * r) continue;

                    // insert into small best list
                    let slot = -1;
                    for (let s = 0; s < maxCandidates; s++) {
                        if (d2 < bestDist[s]) {
                            slot = s;
                            break;
                        }
                    }
                    if (slot >= 0) {
                        for (let s = maxCandidates - 1; s > slot; s--) {
                            bestDist[s] = bestDist[s - 1];
                            bestIdx[s] = bestIdx[s - 1];
                        }
                        bestDist[slot] = d2;
                        bestIdx[slot] = i;
                    }
                }

                const cutRadius = WeaponConfig.melee.chargeThrow.scythe.grassCutRadius;
                for (let s = 0; s < maxCandidates; s++) {
                    const idx = bestIdx[s];
                    if (idx < 0) continue;
                    const mesh = t.grassMeshes[idx].mesh;
                    if (this.cutGrassNear(mesh, this.tmpMid, cutRadius)) {
                        // only cut one per tick to keep cost bounded
                        break;
                    }
                }
            }
        }

        // Apply movement
        t.prevPos.copy(t.mesh.position);
        t.mesh.position.copy(nextPos);

        // Finish
        if (p >= 1) {
            t.scene.remove(t.mesh);
            this.thrown = null;
            // Re-show viewmodel
            this.show();
            this.mesh.position.copy(this.basePosition);
            this.mesh.rotation.copy(this.baseRotation);
            GameStateService.getInstance().setChargeProgress(0);
        }
    }

    public dispose(): void {
        this.camera.remove(this.mesh);
        this.mesh.traverse((c) => {
            const mesh = c as any;
            if (mesh.geometry) mesh.geometry.dispose?.();
            if (mesh.material) mesh.material.dispose?.();
        });

        this.hitEffects.forEach(e => e.dispose());
        this.hitEffectPool.forEach(e => e.dispose());
        this.hitEffects = [];
        this.hitEffectPool = [];

        if (this.thrown) {
            this.thrown.scene.remove(this.thrown.mesh);
            this.thrown = null;
        }

        void this.dummyIntensity;
    }

    private cutGrassNear(mesh: THREE.InstancedMesh, worldPos: THREE.Vector3, radius: number): boolean {
        const positions = (mesh.userData?.grassPositions as Float32Array | undefined);
        if (!positions || positions.length < 3) return false;

        const r2 = radius * radius;
        let bestId = -1;
        let bestD2 = Number.POSITIVE_INFINITY;

        // world-space positions, so just compare XZ (cheap and good enough)
        const px = worldPos.x;
        const pz = worldPos.z;
        for (let i = 0; i < positions.length; i += 3) {
            const dx = positions[i] - px;
            const dz = positions[i + 2] - pz;
            const d2 = dx * dx + dz * dz;
            if (d2 <= r2 && d2 < bestD2) {
                bestD2 = d2;
                bestId = i / 3;
            }
        }

        if (bestId >= 0) {
            this.cutGrassInstance(mesh, bestId);
            return true;
        }
        return false;
    }
}
