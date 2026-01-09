import * as THREE from 'three';
import { uniform } from 'three/tsl';
import { Enemy } from '../enemy/Enemy';
import { GameStateService } from '../core/GameState';
import { SoundManager } from '../core/SoundManager';
import { GPUParticleSystem } from '../shaders/GPUParticles';
import { PhysicsSystem } from '../core/PhysicsSystem';
import { BulletTrail, HitEffect } from './WeaponEffects';
import { WeaponFactory } from './WeaponFactory';
import { IPlayerWeapon, RangedWeaponDefinition, WeaponContext } from './WeaponTypes';

export class PlayerHitscanWeapon implements IPlayerWeapon {
    public readonly id: RangedWeaponDefinition['id'];
    public readonly category = 'ranged' as const;

    private def: RangedWeaponDefinition;

    private camera: THREE.Camera;
    private mesh: THREE.Mesh;
    private raycaster: THREE.Raycaster;
    private v2Zero = new THREE.Vector2(0, 0);

    private raycastObjects: THREE.Object3D[] = [];
    private intersects: THREE.Intersection[] = [];
    private physicsCandidates: THREE.Object3D[] = [];

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
    private flashIntensity: any;

    private recoilOffset: THREE.Vector3 = new THREE.Vector3();
    private swayOffset: THREE.Vector3 = new THREE.Vector3();

    private bulletTrails: BulletTrail[] = [];
    private bulletTrailPool: BulletTrail[] = [];

    private hitEffects: HitEffect[] = [];
    private hitEffectPool: HitEffect[] = [];

    private scene: THREE.Scene | null = null;

    private particleSystem: GPUParticleSystem | null = null;
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

    constructor(camera: THREE.Camera, def: RangedWeaponDefinition) {
        this.camera = camera;
        this.def = def;
        this.id = def.id;

        this.raycaster = new THREE.Raycaster();
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
        for (let i = 0; i < 4; i++) this.bulletTrailPool.push(new BulletTrail());
        for (let i = 0; i < 2; i++) this.hitEffectPool.push(new HitEffect());

        // 默认位置：沿用旧 WeaponConfig 的感受
        this.hipPosition = assets.hipPosition;
        this.adsPosition = assets.adsPosition;

        this.hide();
    }

    public setGroundHeightCallback(callback: (x: number, z: number) => number) {
        this.onGetGroundHeight = callback;
    }

    public setParticleSystem(system: GPUParticleSystem) {
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

        // trails
        for (let i = this.bulletTrails.length - 1; i >= 0; i--) {
            const trail = this.bulletTrails[i];
            trail.update(delta);
            if (trail.isDead) {
                if (this.scene) this.scene.remove(trail.mesh);
                this.bulletTrails.splice(i, 1);
                this.bulletTrailPool.push(trail);
            }
        }

        // hit effects
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

    private tryFire() {
        if (this.fireCooldown > 0) return;
        if (!this.scene) return;

        const state = GameStateService.getInstance().getState();
        if (this.def.usesAmmo && state.ammo < this.def.ammoPerShot) return;

        this.fireCooldown = 1 / Math.max(0.01, this.def.fireRate);

        if (this.def.usesAmmo) {
            GameStateService.getInstance().updateAmmo(-this.def.ammoPerShot);
        }

        // sound
        if (this.def.id === 'sniper' && this.isAiming) SoundManager.getInstance().playSniperShoot();
        else SoundManager.getInstance().playShoot();

        // muzzle flash
        if (this.flashMesh) this.showMuzzleFlash();

        // recoil
        this.applyRecoil();

        // raycast
        this.raycaster.setFromCamera(this.v2Zero, this.camera);

        const raycastObjects = this.raycastObjects;
        raycastObjects.length = 0;
        for (const enemy of this.enemies) {
            if (!enemy.isDead && enemy.mesh.visible) raycastObjects.push(enemy.mesh);
        }

        if (this.physicsSystem) {
            const candidates = this.physicsSystem.getRaycastCandidatesInto(
                this.raycaster.ray.origin,
                this.raycaster.ray.direction,
                this.def.range,
                this.physicsCandidates,
            );
            for (const obj of candidates) raycastObjects.push(obj);
        } else {
            for (const child of this.scene.children) {
                if (child.userData?.isGround) continue;
                if (child.userData?.isDust) continue;
                if (child.userData?.isSkybox) continue;
                if (child.userData?.isWeatherParticle) continue;
                if (child.userData?.isEffect) continue;
                if (child.userData?.isBulletTrail) continue;
                if (child.userData?.isGrenade) continue;
                raycastObjects.push(child);
            }
        }

        const intersects = this.intersects;
        intersects.length = 0;
        this.raycaster.intersectObjects(raycastObjects, true, intersects);

        const rayOrigin = this.tmpRayOrigin.copy(this.raycaster.ray.origin);
        const rayDirection = this.tmpRayDirection.copy(this.raycaster.ray.direction).normalize();

        let hitPoint: THREE.Vector3 | null = null;
        let hitNormal: THREE.Vector3 | null = null;
        let hitObject: THREE.Object3D | null = null;

        for (const intersect of intersects) {
            const obj = intersect.object;

            if (obj.userData?.isGround) continue;
            if (obj.userData?.isSkybox) continue;
            if (obj.userData?.isEnemyWeapon) continue;

            // skip self
            let shouldSkip = false;
            let parent: THREE.Object3D | null = obj;
            while (parent) {
                if (parent === this.mesh) {
                    shouldSkip = true;
                    break;
                }
                if (parent.userData?.isBulletTrail || parent.userData?.isGrenade) {
                    shouldSkip = true;
                    break;
                }
                parent = parent.parent;
            }
            if (shouldSkip) continue;

            hitPoint = this.tmpHitPoint.copy(intersect.point);
            this.tmpHitNormal.copy(intersect.face?.normal ?? this.tmpUp);
            hitNormal = this.tmpHitNormal;
            if ((obj as any).matrixWorld) hitNormal.transformDirection((obj as any).matrixWorld);
            hitObject = obj;
            break;
        }

        // ground raymarch (optional)
        if (!hitPoint && this.onGetGroundHeight) {
            const maxDist = Math.min(120, this.def.range);
            const stepSize = 1.0;
            const currentPos = this.tmpCurrentPos.copy(rayOrigin);
            this.tmpStep.copy(rayDirection).multiplyScalar(stepSize);
            let dist = 0;
            while (dist < maxDist) {
                currentPos.add(this.tmpStep);
                dist += stepSize;
                const terrainHeight = this.onGetGroundHeight(currentPos.x, currentPos.z);
                if (currentPos.y < terrainHeight) {
                    hitPoint = this.tmpGroundHitPoint.copy(rayOrigin).addScaledVector(rayDirection, dist);
                    hitNormal = this.tmpUp;
                    hitObject = null;
                    break;
                }
            }
        }

        if (hitPoint) {
            if (hitObject && (hitObject as any).userData?.isEnemy && (hitObject as any).userData?.entity) {
                const enemy = (hitObject as any).userData.entity as Enemy;
                const damage = this.isAiming && this.def.aimDamage ? this.def.aimDamage : this.def.damage;
                enemy.takeDamage(damage);
                SoundManager.getInstance().playHit();

                const bloodDirection = this.tmpBloodDir.copy(rayDirection).negate().add(hitNormal ?? this.tmpUp).normalize();
                if (this.particleSystem) {
                    this.particleSystem.emitBlood(hitPoint, bloodDirection, 10);
                }
                this.createHitEffect(hitPoint, hitNormal ?? this.tmpUp, 'blood');
            } else {
                if (this.particleSystem) {
                    this.particleSystem.emitSparks(hitPoint, hitNormal ?? this.tmpUp, 8);
                }
                this.createHitEffect(hitPoint, hitNormal ?? this.tmpUp, 'spark');
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
        let trail: BulletTrail;
        if (this.bulletTrailPool.length > 0) trail = this.bulletTrailPool.pop()!;
        else trail = new BulletTrail();

        trail.init(start, end);
        if (!trail.isDead) {
            this.scene.add(trail.mesh);
            this.bulletTrails.push(trail);
        } else {
            this.bulletTrailPool.push(trail);
        }
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

    public dispose(): void {
        this.camera.remove(this.mesh);
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();

        if (this.flashMesh) {
            this.flashMesh.geometry.dispose();
            (this.flashMesh.material as THREE.Material).dispose();
        }

        this.bulletTrails.forEach(t => t.dispose());
        this.hitEffects.forEach(e => e.dispose());
        this.bulletTrailPool.forEach(t => t.dispose());
        this.hitEffectPool.forEach(e => e.dispose());
        this.bulletTrails = [];
        this.hitEffects = [];
        this.bulletTrailPool = [];
        this.hitEffectPool = [];
    }
}
