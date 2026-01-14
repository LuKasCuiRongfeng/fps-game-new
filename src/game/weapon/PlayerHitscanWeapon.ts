import * as THREE from 'three';
import type { UniformNode } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { Enemy } from '../enemy/Enemy';
import type { GameServices } from '../core/services/GameServices';
import type { ParticleSimulation } from '../core/gpu/GpuSimulationFacade';
import { PhysicsSystem } from '../core/PhysicsSystem';
import { BulletTrailBatch } from './BulletTrailBatch';
import { WeaponFactory } from './WeaponFactory';
import { IPlayerWeapon, RangedWeaponDefinition, WeaponContext } from './WeaponTypes';
import type { GameEventBus } from '../core/events/GameEventBus';
import { getUserData } from '../types/GameUserData';

export class PlayerHitscanWeapon implements IPlayerWeapon {
    public readonly id: RangedWeaponDefinition['id'];
    public readonly category = 'ranged' as const;

    private def: RangedWeaponDefinition;

    private camera: THREE.Camera;
    private services: GameServices;
    private events: GameEventBus;
    private mesh: THREE.Mesh;
    private raycaster: THREE.Raycaster;
    private v2Zero = new THREE.Vector2(0, 0);

    private raycastObjects: THREE.Object3D[] = [];
    private intersects: THREE.Intersection[] = [];
    private physicsCandidates: THREE.Object3D[] = [];

    private appendRaycastTargetsInto(root: THREE.Object3D, out: THREE.Object3D[]) {
        if (!root.visible) return;

        // Fast path: mesh
        if (root instanceof THREE.Mesh) {
            out.push(root);
            return;
        }

        // Cache per object: static world and enemy rigs are stable.
        const ud = getUserData(root);
        const cached = ud._hitscanTargets;
        if (cached) {
            for (const t of cached) {
                if (t.visible) out.push(t);
            }
            return;
        }

        const targets: THREE.Object3D[] = [];
        root.traverse((obj) => {
            if (!(obj instanceof THREE.Mesh)) return;
            if (!obj.visible) return;
            const userData = getUserData(obj);
            if (userData.noRaycast) return;
            if (userData.isWayPoint) return;
            if (userData.isDust) return;
            if (userData.isSkybox) return;
            if (userData.isWeatherParticle) return;
            if (userData.isEffect) return;
            if (userData.isBulletTrail) return;
            if (userData.isGrenade) return;
            targets.push(obj);
        });

        // Persist cache
        ud._hitscanTargets = targets;
        for (const t of targets) out.push(t);
    }

    private findEnemyFromObject(obj: THREE.Object3D | null): Enemy | null {
        let cur: THREE.Object3D | null = obj;
        while (cur) {
            const ud = getUserData(cur);
            if (ud.isEnemy && ud.entity) return ud.entity;
            cur = cur.parent;
        }
        return null;
    }

    private tmpSphereCenter = new THREE.Vector3();

    private raySphereIntersect(
        rayOrigin: THREE.Vector3,
        rayDirection: THREE.Vector3,
        sphereCenter: THREE.Vector3,
        sphereRadius: number
    ): number | null {
        // Solve |o + d*t - c|^2 = r^2 for smallest positive t.
        // Assumes rayDirection is normalized.
        const ox = rayOrigin.x - sphereCenter.x;
        const oy = rayOrigin.y - sphereCenter.y;
        const oz = rayOrigin.z - sphereCenter.z;

        const b = ox * rayDirection.x + oy * rayDirection.y + oz * rayDirection.z;
        const c = ox * ox + oy * oy + oz * oz - sphereRadius * sphereRadius;
        const disc = b * b - c;
        if (disc < 0) return null;

        const sqrtDisc = Math.sqrt(disc);
        const t1 = -b - sqrtDisc;
        if (t1 > 0.0001) return t1;

        const t2 = -b + sqrtDisc;
        if (t2 > 0.0001) return t2;
        return null;
    }

    private tmpCurrentPos = new THREE.Vector3();
    private tmpRayOrigin = new THREE.Vector3();
    private tmpRayDirection = new THREE.Vector3();
    private tmpStep = new THREE.Vector3();
    private tmpMuzzlePos = new THREE.Vector3();
    private tmpTrailEnd = new THREE.Vector3();
    private tmpHitPoint = new THREE.Vector3();
    private tmpGroundHitPoint = new THREE.Vector3();
    private tmpHitNormal = new THREE.Vector3(0, 1, 0);
    private tmpUp = new THREE.Vector3(0, 1, 0);
    private tmpBloodDir = new THREE.Vector3();

    private flashMesh: THREE.Mesh | null = null;
    private flashIntensity: UniformNode<number>;

    private recoilOffset: THREE.Vector3 = new THREE.Vector3();
    private swayOffset: THREE.Vector3 = new THREE.Vector3();

    private readonly bulletTrails = BulletTrailBatch.get();

    private scene: THREE.Scene | null = null;

    private particleSystem: ParticleSimulation | null = null;
    private enemies: Enemy[] = [];
    private physicsSystem: PhysicsSystem | null = null;

    private muzzlePoint: THREE.Object3D;

    private triggerHeld = false;
    private fireCooldown = 0;

    // muzzle flash fade (avoid setTimeout per shot)
    private flashTimeRemaining = 0;
    private readonly flashDuration = 0.06;

    // aiming
    private isAiming: boolean = false;
    private aimProgress: number = 0;

    private onGetGroundHeight: ((x: number, z: number) => number) | null = null;

    private hipPosition: THREE.Vector3;
    private adsPosition: THREE.Vector3;

    constructor(camera: THREE.Camera, def: RangedWeaponDefinition, services: GameServices, events: GameEventBus) {
        this.camera = camera;
        this.def = def;
        this.id = def.id;
        this.services = services;
        this.events = events;

        this.raycaster = new THREE.Raycaster();
        // When three-mesh-bvh is enabled, this stops traversal after the first hit.
        this.raycaster.firstHitOnly = true;
        this.raycaster.near = 0;
        this.raycaster.far = def.range;
        this.flashIntensity = uniform(0);

        const assets = WeaponFactory.createPlayerWeaponMesh(def.id);
        this.mesh = assets.mesh;
        this.muzzlePoint = assets.muzzlePoint;
        this.camera.add(this.mesh);

        if (def.muzzleFlash) {
            this.flashMesh = WeaponFactory.createMuzzleFlash(this.flashIntensity);
            this.mesh.add(this.flashMesh);
        }

        // Prewarm small effect pools to avoid first-shot hitch.

        // 默认位置：沿用旧 WeaponConfig 的感受
        this.hipPosition = assets.hipPosition;
        this.adsPosition = assets.adsPosition;

        this.hide();
    }

    public setGroundHeightCallback(callback: (x: number, z: number) => number) {
        this.onGetGroundHeight = callback;
    }

    public setParticleSystem(system: ParticleSimulation) {
        this.particleSystem = system;
    }

    public setEnemies(enemies: Enemy[]) {
        this.enemies = enemies;
    }

    public setPhysicsSystem(sys: PhysicsSystem) {
        this.physicsSystem = sys;
    }

    public show(): void {
        this.mesh.visible = true;
    }

    public hide(): void {
        this.mesh.visible = false;
        if (this.flashMesh) this.flashMesh.visible = false;
    }

    public onTriggerDown(ctx: WeaponContext): void {
        this.scene = ctx.scene;
        this.triggerHeld = true;
        // 立即尝试开火
        this.tryFire();
    }

    public onTriggerUp(): void {
        this.triggerHeld = false;
    }

    public startAiming(): void {
        if (!this.def.supportsAiming) return;
        this.isAiming = true;
    }

    public stopAiming(): void {
        this.isAiming = false;
    }

    public getAimProgress(): number {
        return this.aimProgress;
    }

    public update(delta: number): void {
        // Drive GPU trail lifetime.
        this.bulletTrails.setTimeSeconds(performance.now() * 0.001);

        // fire loop
        if (this.fireCooldown > 0) this.fireCooldown -= delta;
        if (this.triggerHeld && this.def.canAutoFire) {
            this.tryFire();
        }

        // aim interpolate
        const target = this.isAiming ? 1 : 0;
        this.aimProgress = THREE.MathUtils.lerp(this.aimProgress, target, delta * 8.0);
        if (Math.abs(this.aimProgress - target) < 0.001) this.aimProgress = target;

        // sway/recoil
        const t = performance.now() * 0.001;
        const swayMultiplier = 1 - this.aimProgress * 0.8;
        this.swayOffset.x = Math.sin(t * 1.5) * 0.003 * swayMultiplier;
        this.swayOffset.y = Math.sin(t * 2) * 0.002 * swayMultiplier;

        // recoil recover
        this.recoilOffset.z = THREE.MathUtils.lerp(this.recoilOffset.z, 0, delta * 5.0);
        this.recoilOffset.y = THREE.MathUtils.lerp(this.recoilOffset.y, 0, delta * 4.0);

        this.tmpCurrentPos.lerpVectors(this.hipPosition, this.adsPosition, this.aimProgress);
        this.mesh.position.x = this.tmpCurrentPos.x + this.swayOffset.x;
        this.mesh.position.y = this.tmpCurrentPos.y + this.swayOffset.y + this.recoilOffset.y;
        this.mesh.position.z = this.tmpCurrentPos.z + this.recoilOffset.z;

        // muzzle flash fade
        if (this.flashMesh && this.flashMesh.visible) {
            this.flashTimeRemaining = Math.max(0, this.flashTimeRemaining - delta);
            const p = this.flashDuration > 0 ? (this.flashTimeRemaining / this.flashDuration) : 0;
            this.flashIntensity.value = p;
            if (this.flashTimeRemaining <= 0.0001) {
                this.flashIntensity.value = 0;
                this.flashMesh.visible = false;
            }
        }

    }

    private tryFire() {
        if (this.fireCooldown > 0) return;
        if (!this.scene) return;

        const state = this.services.state.getState();
        if (this.def.usesAmmo && state.ammo < this.def.ammoPerShot) return;

        this.fireCooldown = 1 / Math.max(0.01, this.def.fireRate);

        if (this.def.usesAmmo) {
            this.events.emit({ type: 'state:updateAmmo', delta: -this.def.ammoPerShot });
        }

        // sound
        if (this.def.id === 'sniper' && this.isAiming) this.events.emit({ type: 'sound:play', sound: 'sniperShoot' });
        else this.events.emit({ type: 'sound:play', sound: 'shoot' });

        // muzzle flash
        if (this.flashMesh) this.showMuzzleFlash();

        // recoil
        this.applyRecoil();

        // raycast
        this.raycaster.setFromCamera(this.v2Zero, this.camera);
        // Clamp far so we don't traverse beyond weapon range.
        this.raycaster.far = this.def.range;

        const raycastObjects = this.raycastObjects;
        raycastObjects.length = 0;
        for (const enemy of this.enemies) {
            if (!enemy.isDead) this.appendRaycastTargetsInto(enemy.mesh, raycastObjects);
        }

        if (this.physicsSystem) {
            const candidates = this.physicsSystem.getRaycastCandidatesInto(
                this.raycaster.ray.origin,
                this.raycaster.ray.direction,
                this.def.range,
                this.physicsCandidates,
            );
            for (const obj of candidates) this.appendRaycastTargetsInto(obj, raycastObjects);
        } else {
            for (const child of this.scene.children) {
                const ud = getUserData(child);
                if (ud.isGround) continue;
                if (ud.isDust) continue;
                if (ud.isSkybox) continue;
                if (ud.isWeatherParticle) continue;
                if (ud.isEffect) continue;
                if (ud.isBulletTrail) continue;
                if (ud.isGrenade) continue;
                this.appendRaycastTargetsInto(child, raycastObjects);
            }
        }

        const intersects = this.intersects;
        intersects.length = 0;
        // Raycast against a flat mesh list; no recursive traversal.
        this.raycaster.intersectObjects(raycastObjects, false, intersects);

        const rayOrigin = this.tmpRayOrigin.copy(this.raycaster.ray.origin);
        const rayDirection = this.tmpRayDirection.copy(this.raycaster.ray.direction).normalize();

        let hitPoint: THREE.Vector3 | null = null;
        let hitNormal: THREE.Vector3 | null = null;
        let hitObject: THREE.Object3D | null = null;

        for (const intersect of intersects) {
            const obj = intersect.object;

            const ud = getUserData(obj);
            if (ud.isGround) continue;
            if (ud.isSkybox) continue;
            if (ud.isEnemyWeapon) continue;

            // skip self
            let shouldSkip = false;
            let parent: THREE.Object3D | null = obj;
            while (parent) {
                if (parent === this.mesh) {
                    shouldSkip = true;
                    break;
                }
                const pud = getUserData(parent);
                if (pud.isBulletTrail || pud.isGrenade) {
                    shouldSkip = true;
                    break;
                }
                parent = parent.parent;
            }
            if (shouldSkip) continue;

            hitPoint = this.tmpHitPoint.copy(intersect.point);
            this.tmpHitNormal.copy(intersect.face?.normal ?? this.tmpUp);
            hitNormal = this.tmpHitNormal;
            hitNormal.transformDirection(obj.matrixWorld);
            hitObject = obj;
            break;
        }

        const rayHitDist = hitPoint ? rayOrigin.distanceTo(hitPoint) : Number.POSITIVE_INFINITY;

        // Fast enemy hit test for far enemies rendered as GPU impostors:
        // CPU raycaster can't intersect shader-driven instance transforms.
        let enemySphereHitEnemy: Enemy | null = null;
        let enemySphereHitDist = Number.POSITIVE_INFINITY;
        let enemySphereHitPoint: THREE.Vector3 | null = null;
        let enemySphereHitNormal: THREE.Vector3 | null = null;

        const enemyHitRadius = 0.65;
        const enemyHitYOffset = 0.8;
        for (const enemy of this.enemies) {
            if (enemy.isDead) continue;
            if (enemy.mesh.visible) continue;

            const center = this.tmpSphereCenter.set(
                enemy.mesh.position.x,
                enemy.mesh.position.y + enemyHitYOffset,
                enemy.mesh.position.z
            );

            const t = this.raySphereIntersect(rayOrigin, rayDirection, center, enemyHitRadius);
            if (t === null) continue;
            if (t > this.def.range) continue;

            if (t < enemySphereHitDist) {
                enemySphereHitDist = t;
                enemySphereHitEnemy = enemy;
                enemySphereHitPoint = this.tmpHitPoint.copy(rayOrigin).addScaledVector(rayDirection, t);
                enemySphereHitNormal = this.tmpHitNormal.copy(enemySphereHitPoint).sub(center).normalize();
            }
        }

        // ground raymarch (optional)
        let groundHitDist = Number.POSITIVE_INFINITY;
        let groundHitPoint: THREE.Vector3 | null = null;
        if (this.onGetGroundHeight && rayDirection.y < -0.0001) {
            const maxDist = Math.min(120, this.def.range);
            // Keep it cheap.
            const stepSize = 2.0;
            const currentPos = this.tmpCurrentPos.copy(rayOrigin);
            this.tmpStep.copy(rayDirection).multiplyScalar(stepSize);
            let dist = 0;
            while (dist < maxDist) {
                currentPos.add(this.tmpStep);
                dist += stepSize;
                const terrainHeight = this.onGetGroundHeight(currentPos.x, currentPos.z);
                if (currentPos.y < terrainHeight) {
                    groundHitDist = dist;
                    groundHitPoint = this.tmpGroundHitPoint.copy(rayOrigin).addScaledVector(rayDirection, dist);
                    break;
                }
            }
        }

        // Choose closest among mesh hit, enemy sphere hit, and terrain hit.
        let enemy: Enemy | null = null;
        if (enemySphereHitEnemy && enemySphereHitDist < rayHitDist && enemySphereHitDist < groundHitDist) {
            enemy = enemySphereHitEnemy;
            hitPoint = enemySphereHitPoint;
            hitNormal = enemySphereHitNormal;
            hitObject = null;
        } else if (groundHitPoint && groundHitDist < rayHitDist) {
            hitPoint = groundHitPoint;
            hitNormal = this.tmpUp;
            hitObject = null;
        }

        if (hitPoint) {
            if (!enemy) enemy = hitObject ? this.findEnemyFromObject(hitObject) : null;
            if (enemy) {
                const damage = this.isAiming && this.def.aimDamage ? this.def.aimDamage : this.def.damage;
                enemy.takeDamage(damage);
                this.events.emit({ type: 'sound:play', sound: 'hit' });

                const bloodDirection = this.tmpBloodDir.copy(rayDirection).negate().add(hitNormal ?? this.tmpUp).normalize();
                if (this.particleSystem) {
                    this.particleSystem.emitBlood(hitPoint, bloodDirection, 10);
                }
            } else {
                if (this.particleSystem) {
                    if (!hitObject) {
                        // Ground raymarch hit
                        this.particleSystem.emitDust(hitPoint, hitNormal ?? this.tmpUp, 12);
                    } else {
                        const ud = getUserData(hitObject);
                        if (ud.isTree) this.particleSystem.emitDebris(hitPoint, hitNormal ?? this.tmpUp, 14);
                        else if (ud.isGrass) this.particleSystem.emitDust(hitPoint, hitNormal ?? this.tmpUp, 10);
                        else if (ud.isRock) this.particleSystem.emitSparks(hitPoint, hitNormal ?? this.tmpUp, 10);
                        else this.particleSystem.emitSparks(hitPoint, hitNormal ?? this.tmpUp, 8);
                    }
                }
            }
        }

        // trail
        if (this.def.bulletTrail) {
            const muzzlePos = this.getMuzzleWorldPosition(this.tmpMuzzlePos);
            const trailEnd = this.tmpTrailEnd;
            if (hitPoint) trailEnd.copy(hitPoint);
            else trailEnd.copy(muzzlePos).addScaledVector(rayDirection, this.def.range);
            this.createBulletTrail(muzzlePos, trailEnd);
        }

        // muzzle particles
        if (this.particleSystem && this.def.muzzleFlash) {
            const muzzlePos = this.getMuzzleWorldPosition(this.tmpMuzzlePos);
            this.particleSystem.emitMuzzleFlash(muzzlePos, rayDirection);
        }
    }

    private getMuzzleWorldPosition(out: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
        this.camera.updateMatrixWorld(true);
        this.muzzlePoint.getWorldPosition(out);
        return out;
    }

    private showMuzzleFlash() {
        if (!this.flashMesh) return;
        this.flashMesh.visible = true;
        this.flashTimeRemaining = this.flashDuration;
        this.flashIntensity.value = 1;
        this.flashMesh.rotation.z = Math.random() * Math.PI * 2;
    }

    private applyRecoil() {
        // weapon-specific recoil: snipers kick more, pistols less
        let amount = 0.045;
        if (this.def.id === 'sniper') amount = 0.08;
        if (this.def.id === 'pistol') amount = 0.035;
        if (this.def.id === 'smg') amount = 0.03;

        this.recoilOffset.z += amount;
        this.recoilOffset.y += amount * 0.3;
        this.recoilOffset.z = Math.min(this.recoilOffset.z, 0.18);
        this.recoilOffset.y = Math.min(this.recoilOffset.y, 0.06);
    }

    private createBulletTrail(start: THREE.Vector3, end: THREE.Vector3) {
        if (!this.scene) return;
        this.bulletTrails.ensureInScene(this.scene);
        this.bulletTrails.emit(start, end);
    }

    public dispose(): void {
        this.camera.remove(this.mesh);
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();

        if (this.flashMesh) {
            this.flashMesh.geometry.dispose();
            (this.flashMesh.material as THREE.Material).dispose();
        }

    }
}
