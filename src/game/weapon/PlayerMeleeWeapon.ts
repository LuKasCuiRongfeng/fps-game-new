import * as THREE from 'three';
import { uniform } from 'three/tsl';
import { Enemy } from '../enemy/Enemy';
import { SoundManager } from '../core/SoundManager';
import { GameStateService } from '../core/GameState';
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

    private lastSwingTime = 0;

    // Charge-to-throw (knife/scythe)
    private isCharging = false;
    private chargeElapsed = 0;
    private chargeMin = 0.28;
    private chargeMax = 0.9;
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
              grassMeshes: THREE.InstancedMesh[];
              prevPos: THREE.Vector3;
          }
        | null = null;

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
            this.chargeElapsed = Math.min(this.chargeMax, this.chargeElapsed + delta);
            // UI progress is aligned with "throw-ready" threshold:
            // 0 until reaching chargeMin, then 0..1 over [chargeMin, chargeMax].
            const p = this.chargeElapsed < this.chargeMin
                ? 0
                : Math.min(1, (this.chargeElapsed - this.chargeMin) / (this.chargeMax - this.chargeMin));
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

        if (this.chargeElapsed >= this.chargeMin) {
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
        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        this.raycaster.far = this.def.range;

        // 1) Combat targets: enemies + trees. This avoids the common case where the
        // ground is the closest hit and prevents chopping.
        const combatTargets: THREE.Object3D[] = [];
        for (const enemy of this.enemies) {
            if (!enemy.isDead && enemy.mesh.visible) combatTargets.push(enemy.mesh);
        }
        for (const child of ctx.scene.children) {
            if ((child as any).isInstancedMesh && child.userData?.isTree) {
                combatTargets.push(child);
            }
            if ((child as any).isInstancedMesh && child.userData?.isGrass) {
                combatTargets.push(child);
            }
        }

        const combatHits = this.raycaster.intersectObjects(combatTargets, true);

        // 2) Environment targets: for sparks/feedback when nothing combat-relevant is hit.
        const envTargets: THREE.Object3D[] = [];
        for (const child of ctx.scene.children) {
            if (child.userData?.isSkybox) continue;
            if (child.userData?.isWeatherParticle) continue;
            if (child.userData?.isEffect) continue;
            if (child.userData?.isBulletTrail) continue;
            envTargets.push(child);
        }
        const envHits = this.raycaster.intersectObjects(envTargets, true);

        const firstEnvHit = envHits.length > 0 ? envHits[0] : null;

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
        if (firstEnvHit) {
            const { hitPoint, hitNormal } = toHitInfo(firstEnvHit);
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
        pos.y = pos.y - 50;
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
        pos.y = pos.y - 20;
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

        // Per-weapon feel
        if (this.def.id === 'knife') {
            this.swingDuration = 0.24;
            this.swingHitTime = 0.42;
        } else if (this.def.id === 'scythe') {
            this.swingDuration = 0.36;
            this.swingHitTime = 0.5;
        } else {
            // axe
            this.swingDuration = 0.42;
            this.swingHitTime = 0.5;
        }
    }

    private startThrow(ctx: WeaponContext, chargeSeconds: number) {
        if (!this.scene) this.scene = ctx.scene;
        if (!this.scene) return;
        if (this.thrown) return;

        const now = performance.now() / 1000;
        this.lastSwingTime = now;

        const id = this.def.id === 'scythe' ? 'scythe' : 'knife';

        // Create thrown mesh by cloning the viewmodel mesh (cheap & consistent)
        const thrownMesh = this.mesh.clone(true);
        thrownMesh.visible = true;
        // Ensure it's not parented to camera
        thrownMesh.parent?.remove(thrownMesh);

        // World start
        const camPos = new THREE.Vector3();
        const camDir = new THREE.Vector3();
        this.camera.getWorldPosition(camPos);
        this.camera.getWorldDirection(camDir);

        const start = camPos.clone().add(camDir.clone().multiplyScalar(0.6));
        thrownMesh.position.copy(start);
        thrownMesh.quaternion.copy(this.camera.quaternion);

        // Add to scene
        ctx.scene.add(thrownMesh);

        // Params from charge
        const chargeP = Math.min(1, Math.max(0, (chargeSeconds - this.chargeMin) / (this.chargeMax - this.chargeMin)));
        const outDist = id === 'scythe' ? 10 + chargeP * 14 : 8 + chargeP * 10;
        const total = id === 'scythe' ? 1.15 : 0.95;
        const outTime = id === 'scythe' ? 0.62 : 0.56;

        const baseDamage = id === 'scythe' ? 55 : 40;
        const bonusDamage = id === 'scythe' ? 45 : 35;
        const damage = baseDamage + bonusDamage * chargeP;

        const grassMeshes: THREE.InstancedMesh[] = [];
        if (id === 'scythe') {
            for (const child of ctx.scene.children) {
                if ((child as any).isInstancedMesh && child.userData?.isGrass) grassMeshes.push(child as THREE.InstancedMesh);
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
            dir: camDir.normalize(),
            outDist,
            damage,
            hitEnemies: new Set<Enemy>(),
            grassMeshes,
            prevPos: start.clone(),
        };

        // Hide viewmodel while thrown
        this.hide();
    }

    private updateThrown(delta: number) {
        const t = this.thrown;
        if (!t) return;

        t.elapsed += delta;
        const p = Math.min(1, t.elapsed / t.total);

        // Determine target return position (follow player)
        const camPos = new THREE.Vector3();
        this.camera.getWorldPosition(camPos);
        const returnPos = camPos.clone().add(t.dir.clone().multiplyScalar(0.35));

        let nextPos: THREE.Vector3;
        if (t.elapsed <= t.outTime) {
            const op = t.elapsed / t.outTime;
            // outward arc with slight sideways curve
            const side = new THREE.Vector3().crossVectors(t.dir, new THREE.Vector3(0, 1, 0)).normalize();
            const curve = Math.sin(op * Math.PI) * (t.id === 'scythe' ? 1.2 : 0.9);
            nextPos = t.start
                .clone()
                .add(t.dir.clone().multiplyScalar(t.outDist * op))
                .add(side.multiplyScalar(curve));
        } else {
            const ip = (t.elapsed - t.outTime) / (t.total - t.outTime);
            nextPos = t.mesh.position.clone().lerp(returnPos, Math.min(1, ip * 1.25));
        }

        // Spin
        t.mesh.rotation.x += delta * 10;
        t.mesh.rotation.z += delta * 16;

        // Enemy collision (distance-based)
        const radius = t.id === 'scythe' ? 1.3 : 1.0;
        for (const enemy of this.enemies) {
            if (enemy.isDead) continue;
            if (t.hitEnemies.has(enemy)) continue;
            const ep = new THREE.Vector3();
            enemy.mesh.getWorldPosition(ep);
            if (ep.distanceTo(nextPos) <= radius) {
                t.hitEnemies.add(enemy);
                enemy.takeDamage(t.damage);
                SoundManager.getInstance().playHit();
                if (this.particleSystem) {
                    const dir = new THREE.Vector3().subVectors(ep, nextPos).normalize();
                    this.particleSystem.emitBlood(ep, dir, 10);
                }
                this.createHitEffect(ep, new THREE.Vector3(0, 1, 0), 'blood');
            }
        }

        // Grass collision (ray segment)
        if (t.id === 'scythe' && t.grassMeshes.length > 0) {
            const seg = new THREE.Vector3().subVectors(nextPos, t.prevPos);
            const len = seg.length();
            if (len > 0.0001) {
                this.raycaster.set(t.prevPos, seg.normalize());
                this.raycaster.far = len;
                const hits = this.raycaster.intersectObjects(t.grassMeshes, false);
                if (hits.length > 0) {
                    const h = hits[0];
                    if (h.instanceId !== undefined && h.instanceId !== null) {
                        this.cutGrassInstance(h.object as THREE.InstancedMesh, h.instanceId);
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
}
