/**
 * Weapon - 使用 TSL 增强的武器系统
 * 包含枪口火焰、弹道轨迹、命中特效等
 */
import * as THREE from 'three';
import type { UniformNode } from 'three/webgpu';
import { 
    uniform
} from 'three/tsl';
import { Enemy } from '../enemy/Enemy';
import type { GameServices } from '../core/services/GameServices';
import { getDefaultGameServices } from '../core/services/GameServices';
import type { ParticleSimulation } from '../core/gpu/GpuSimulationFacade';
import { WeaponConfig, EffectConfig, EnemyConfig } from '../core/GameConfig';
import { PhysicsSystem } from '../core/PhysicsSystem';
import { BulletTrailBatch } from './BulletTrailBatch';
import { WeaponFactory } from './WeaponFactory';
import { getUserData } from '../types/GameUserData';

export class Weapon {
    private camera: THREE.Camera;
    private mesh: THREE.Mesh;
    private raycaster: THREE.Raycaster;

    private readonly services: GameServices;

    private readonly zeroNDC = new THREE.Vector2(0, 0);
    private raycastObjects: THREE.Object3D[] = [];
    private raycastIntersects: THREE.Intersection[] = [];
    private tmpRayOrigin = new THREE.Vector3();
    private tmpRayDirection = new THREE.Vector3();
    private tmpRaymarchPos = new THREE.Vector3();
    private tmpBinaryPos = new THREE.Vector3();

    private findEnemyFromObject(obj: THREE.Object3D | null): Enemy | null {
        let cur: THREE.Object3D | null = obj;
        while (cur) {
            const ud = getUserData(cur);
            if (ud.isEnemy && ud.entity) return ud.entity;
            cur = cur.parent;
        }
        return null;
    }
    private tmpGroundHitPoint = new THREE.Vector3();
    private tmpCurrentPos = new THREE.Vector3();
    private tmpMuzzleWorldPos = new THREE.Vector3();
    private tmpHitPoint = new THREE.Vector3();
    private tmpHitNormal = new THREE.Vector3();
    private readonly tmpUp = new THREE.Vector3(0, 1, 0);
    private tmpBloodDirection = new THREE.Vector3();
    private tmpTrailEnd = new THREE.Vector3();
    
    // 枪口火焰
    private flashMesh: THREE.Mesh;
    private flashIntensity: UniformNode<number>;  // TSL uniform
    
    // 武器动画状态
    private recoilOffset: THREE.Vector3 = new THREE.Vector3();
    private swayOffset: THREE.Vector3 = new THREE.Vector3();
    private isRecoiling: boolean = false;
    
    // 弹道轨迹 (GPU Instanced)
    private readonly bulletTrails = BulletTrailBatch.get();
    private scene: THREE.Scene | null = null;
    
    // GPU 粒子系统引用
    private particleSystem: ParticleSimulation | null = null;
    
    private enemies: Enemy[] = [];
    private physicsSystem: PhysicsSystem | null = null;

    private physicsCandidates: THREE.Object3D[] = [];
    
    // 枪口位置辅助点 (用于获取世界坐标)
    private muzzlePoint: THREE.Object3D;
    
    // 瞄准状态
    private isAiming: boolean = false;
    private aimProgress: number = 0;  // 0 = 腻射, 1 = 完全瞄准
    private readonly aimSpeed: number = WeaponConfig.aim.speed;  // 瞄准过渡速度
    
    // 当前射击是否为狙击模式
    private isAimingShot: boolean = false;
    
    // 武器位置
    private readonly hipPosition = new THREE.Vector3(
        WeaponConfig.aim.hipPosition.x, 
        WeaponConfig.aim.hipPosition.y, 
        WeaponConfig.aim.hipPosition.z
    );
    private readonly adsPosition = new THREE.Vector3(
        WeaponConfig.aim.adsPosition.x, 
        WeaponConfig.aim.adsPosition.y, 
        WeaponConfig.aim.adsPosition.z
    );
    
    // 倍镜组件
    private scopeMesh!: THREE.Group;
    
    // 地形高度回调
    private onGetGroundHeight: ((x: number, z: number) => number) | null = null;

    constructor(camera: THREE.Camera, services: GameServices = getDefaultGameServices()) {
        this.camera = camera;
        this.services = services;
        this.raycaster = new THREE.Raycaster();

        // When three-mesh-bvh is enabled, this stops traversal after the first hit.
        this.raycaster.firstHitOnly = true;
        this.raycaster.near = 0;
        
        // TSL Uniforms
        this.flashIntensity = uniform(0);

        // 创建武器 (使用工厂模式)
        const assets = WeaponFactory.createWeaponMesh();
        this.mesh = assets.mesh;
        this.scopeMesh = assets.scopeMesh;
        this.muzzlePoint = assets.muzzlePoint;
        
        this.camera.add(this.mesh);
        
        // 创建枪口火焰
        this.flashMesh = WeaponFactory.createMuzzleFlash(this.flashIntensity);
        this.mesh.add(this.flashMesh);
    }

    /**
     * 设置地形高度回调
     */
    public setGroundHeightCallback(callback: (x: number, z: number) => number) {
        this.onGetGroundHeight = callback;
    }

    /**
     * 设置 GPU 粒子系统引用
     */
    public setParticleSystem(system: ParticleSimulation) {
        this.particleSystem = system;
    }

    public setEnemies(enemies: Enemy[]) {
        this.enemies = enemies;
    }

    public setPhysicsSystem(sys: PhysicsSystem) {
        this.physicsSystem = sys;
    }
    
    /**
     * 显示武器
     */
    public show(): void {
        this.mesh.visible = true;
    }
    
    /**
     * 隐藏武器
     */
    public hide(): void {
        this.mesh.visible = false;
        this.flashMesh.visible = false;
    }
    
    /**
     * 开始瞄准 (ADS - Aim Down Sights)
     */
    public startAiming() {
        this.isAiming = true;
    }
    
    /**
     * 结束瞄准
     */
    public stopAiming() {
        this.isAiming = false;
    }
    
    /**
     * 获取瞄准进度 (0-1)
     */
    public getAimProgress(): number {
        return this.aimProgress;
    }
    
    /**
     * 是否正在瞄准
     */
    public getIsAiming(): boolean {
        return this.isAiming;
    }
    
    /**
     * 获取枪口世界坐标
     */
    public getMuzzleWorldPosition(): THREE.Vector3;
    public getMuzzleWorldPosition(out: THREE.Vector3): THREE.Vector3;
    public getMuzzleWorldPosition(out?: THREE.Vector3): THREE.Vector3 {
        // 确保整个层级的矩阵已更新 (相机 -> 武器 -> 枪口)
        this.camera.updateMatrixWorld(true);

        const worldPos = out ?? new THREE.Vector3();
        this.muzzlePoint.getWorldPosition(worldPos);
        return worldPos;
    }

    /**
     * 射击
     */
    public shoot(scene: THREE.Scene, isAiming: boolean = false) {
        this.scene = scene;
        this.isAimingShot = isAiming;  // 保存瞄准状态用于伤害计算
        
        const gameState = this.services.state;
        if (gameState.getState().ammo <= 0) return;

        gameState.updateAmmo(-1);
        
        // 根据是否瞄准播放不同的枪声
        if (isAiming) {
            this.services.sound.playSniperShoot();
        } else {
            this.services.sound.playShoot();
        }

        // 枪口火焰
        this.showMuzzleFlash();
        
        // 后座力
        this.applyRecoil();

        // 射线检测
        this.raycaster.setFromCamera(this.zeroNDC, this.camera);
        // Clamp far so we don't traverse beyond weapon range.
        this.raycaster.far = WeaponConfig.gun.range || 500;

        // 获取射线起点和方向用于弹道
        const rayOrigin = this.tmpRayOrigin.copy(this.raycaster.ray.origin);
        const rayDirection = this.tmpRayDirection.copy(this.raycaster.ray.direction).normalize();

        // 1) Enemy precise hit (few meshes, ok to Raycast)
        const raycastObjects = this.raycastObjects;
        raycastObjects.length = 0;
        if (this.enemies.length > 0) {
            for (const enemy of this.enemies) {
                if (!enemy.isDead) raycastObjects.push(enemy.mesh);
            }
        }

        this.raycastIntersects.length = 0;
        if (raycastObjects.length > 0) {
            this.raycaster.intersectObjects(raycastObjects, true, this.raycastIntersects);
        }
        const intersects = this.raycastIntersects;

        // 2) Static geometry hit via PhysicsSystem AABB raycast (fast; avoids InstancedMesh per-instance raycast).
        const maxDistance = WeaponConfig.gun.range || 500;
        const envHit = this.physicsSystem?.raycastStaticColliders(rayOrigin, rayDirection, maxDistance) ?? null;

        let hitPoint: THREE.Vector3 | null = null;
        let hitNormal: THREE.Vector3 | null = null;
        let hitEnemy: Enemy | null = null;
        let hitObject: THREE.Object3D | null = null;

        // 1. 先检测敌人碰撞
        for (const intersect of intersects) {
            const obj = intersect.object as THREE.Mesh;

            // 双重检查
            const ud = getUserData(obj);
            if (ud.isGround) continue;
            if (ud.isSkybox) continue;
            if (ud.isEnemyWeapon) continue;
            
            // 跳过武器本身
            let shouldSkip = false;
            let parent: THREE.Object3D | null = obj;
            while (parent) {
                if (parent === this.mesh) {
                    shouldSkip = true;
                    break;
                }
                // 检查是否是弹道轨迹/手榴弹
                const pud = getUserData(parent);
                if (pud.isBulletTrail || pud.isGrenade) {
                    shouldSkip = true;
                    break;
                }
                parent = parent.parent;
            }
            if (shouldSkip) continue;

            hitPoint = this.tmpHitPoint.copy(intersect.point);
            hitNormal = this.tmpHitNormal.copy(intersect.face?.normal ?? this.tmpUp);
            
            // 法线转世界坐标
            if (intersect.face && obj.matrixWorld) {
                hitNormal.transformDirection(obj.matrixWorld);
            }
            
            hitObject = obj;
            
            // 找到最近的一个有效物体就停止
            break;
        }

        // 1b) If environment AABB hit is closer than enemy hit, prefer it
        if (envHit) {
            const enemyDist = hitPoint ? hitPoint.distanceTo(rayOrigin) : Infinity;
            if (envHit.distance < enemyDist) {
                hitPoint = this.tmpHitPoint.copy(envHit.point);
                hitNormal = this.tmpHitNormal.copy(envHit.normal);
                hitObject = envHit.object;
                hitEnemy = null;
            }
        }
        
        // 2. 检测地面碰撞 (Raymarching)
        // 如果没有击中物体，或者击中物体的距离比地面远（虽然一般地面在最下面，但可能有遮挡关系）
        // 简单起见，只在没有击中物体，或者物体距离较远时检查地面
        
        let groundHitPoint: THREE.Vector3 | null = null;
        if (this.onGetGroundHeight) {
            // max distance 100m (clamp to the closest existing hit so we don't march past an obstacle)
            const maxDist = Math.min(100, hitPoint ? rayOrigin.distanceTo(hitPoint) : 100);
            // 步长 1.0m (精度要求不高，主要为了性能)
            const stepSize = 1.0; 
            
            let dist = 0;
            const currentPos = this.tmpRaymarchPos;
            
            // 粗略步进
            while (dist < maxDist) {
                dist += stepSize;

                currentPos.copy(rayOrigin).addScaledVector(rayDirection, dist);
                
                const terrainHeight = this.onGetGroundHeight(currentPos.x, currentPos.z);
                
                // 如果射线点到了地面下方
                if (currentPos.y < terrainHeight) {
                    // 发生了碰撞，进行一次二分精细查找
                    // 回退一步
                    let low = dist - stepSize;
                    let high = dist;
                    for(let i=0; i<4; i++) { // 4次迭代足够精确
                        const mid = (low + high) / 2;
                        const p = this.tmpBinaryPos.copy(rayOrigin).addScaledVector(rayDirection, mid);
                        const h = this.onGetGroundHeight(p.x, p.z);
                        if (p.y < h) {
                            high = mid; // 还在地下，往回缩
                        } else {
                            low = mid; // 在地上，往前
                        }
                    }
                    
                    const hitDist = (low + high) / 2;
                    groundHitPoint = this.tmpGroundHitPoint.copy(rayOrigin).addScaledVector(rayDirection, hitDist);
                    
                    // 检查是否比物体碰撞点更近
                    if (hitPoint) {
                        const distToObj = rayOrigin.distanceTo(hitPoint);
                        if (hitDist < distToObj) {
                            // 地面更近，覆盖物体结果
                            hitPoint.copy(groundHitPoint);
                            // 地面法线比较复杂，这里简单模拟向上的法线，或者通过采样周围点计算
                            // 简单起见：向上，稍微带点随机扰动模拟粗糙
                            hitNormal = this.tmpHitNormal.copy(this.tmpUp);
                            hitObject = null; // 标记为非物体命中
                            hitEnemy = null;
                        }
                    } else {
                        // 之前没命中物体，现在命中了地面
                        hitPoint = this.tmpHitPoint.copy(groundHitPoint);
                        hitNormal = this.tmpHitNormal.copy(this.tmpUp);
                        hitObject = null;
                    }
                    
                    break; // 退出 Raymarching
                }
            }
        }

        // 处理命中结果
        if (hitPoint) {
            
            // 命中敌人
            if (hitObject) {
                hitEnemy = this.findEnemyFromObject(hitObject);
            }

            if (hitEnemy) {
                // ... (原有逻辑)
                const damage = this.isAimingShot ? WeaponConfig.gun.sniperDamage : WeaponConfig.gun.damage;
                hitEnemy.takeDamage(damage);
                this.services.sound.playHit();
                
                if (hitEnemy.isDead) {
                    this.services.state.updateScore(EnemyConfig.rewards.score);
                }
                
                // 计算血液飞溅方向
                const bloodDirection = this.tmpBloodDirection.copy(rayDirection).negate().add(hitNormal!).normalize();
                
                // 粒子特效
                if (this.particleSystem) {
                    this.particleSystem.emitBlood(hitPoint, bloodDirection, EffectConfig.blood.particleCount);
                    // ... 更多粒子
                }
            } else {
                // 命中环境 (地面或障碍物)
                if (this.particleSystem) {
                    const surface = hitObject ? getUserData(hitObject) : null;

                    if (!hitObject) {
                        // Ground raymarch hit
                        this.particleSystem.emitDust(hitPoint, hitNormal!, 14);
                    } else if (surface?.isTree) {
                        this.particleSystem.emitDebris(hitPoint, hitNormal!, 14);
                    } else if (surface?.isGrass) {
                        this.particleSystem.emitDust(hitPoint, hitNormal!, 12);
                    } else if (surface?.isRock) {
                        this.particleSystem.emitSparks(hitPoint, hitNormal!, EffectConfig.spark.particleCount);
                    } else {
                        // Generic hard surface
                        this.particleSystem.emitSparks(hitPoint, hitNormal!, Math.max(6, Math.floor(EffectConfig.spark.particleCount * 0.75)));
                    }
                }
            }
        }

        // 获取枪口世界坐标作为弹道起点
        const muzzlePos = this.getMuzzleWorldPosition(this.tmpMuzzleWorldPos);
        
        // 创建弹道轨迹
        // ... (原有逻辑)
        const trailEnd = this.tmpTrailEnd;
        if (hitPoint) {
            trailEnd.copy(hitPoint);
        } else {
            trailEnd.copy(muzzlePos).addScaledVector(rayDirection, WeaponConfig.gun.range);
        }

        this.createBulletTrail(muzzlePos, trailEnd);
        
        // 枪口火焰粒子
        if (this.particleSystem) {
            this.particleSystem.emitMuzzleFlash(muzzlePos, rayDirection);
        }
    }

    /**
     * 显示枪口火焰
     */
    private showMuzzleFlash() {
        this.flashMesh.visible = true;
        this.flashIntensity.value = 1;
        
        // 随机旋转
        this.flashMesh.rotation.z = Math.random() * Math.PI * 2;
        
        // 淡出
        const fadeOut = () => {
            const intensity = this.flashIntensity.value as number;
            const next = intensity * 0.7;
            this.flashIntensity.value = next;
            if (next > 0.01) {
                requestAnimationFrame(fadeOut);
            } else {
                this.flashIntensity.value = 0;
                this.flashMesh.visible = false;
            }
        };
        
        setTimeout(fadeOut, 16);
    }

    /**
     * 应用后座力
     */
    private applyRecoil() {
        const recoilAmount = WeaponConfig.gun.recoil.amount;
        
        // 累加后坐力 (允许连发时叠加)
        // Z轴是向后的 (从屏幕向外)，所以加正值
        this.recoilOffset.z += recoilAmount;
        // Y轴是向上的枪口跳动
        this.recoilOffset.y += recoilAmount * 0.3;
        
        // 限制最大后坐力
        this.recoilOffset.z = Math.min(this.recoilOffset.z, 0.15);
        this.recoilOffset.y = Math.min(this.recoilOffset.y, 0.05);
    }

    /**
     * 创建弹道轨迹
     */
    private createBulletTrail(start: THREE.Vector3, end: THREE.Vector3) {
        if (!this.scene) return;
        this.bulletTrails.ensureInScene(this.scene);
        this.bulletTrails.emit(start, end);
    }

    /**
     * 更新武器动画
     */
    public update(delta: number) {
        // Drive GPU trail lifetime.
        this.bulletTrails.setTimeSeconds(performance.now() * 0.001);

        const t = performance.now() * 0.001;
        
        // 更新瞄准进度 (平滑过渡)
        const targetProgress = this.isAiming ? 1 : 0;
        this.aimProgress = THREE.MathUtils.lerp(
            this.aimProgress, 
            targetProgress, 
            delta * this.aimSpeed
        );
        
        // 限制瞄准进度范围
        if (Math.abs(this.aimProgress - targetProgress) < 0.001) {
            this.aimProgress = targetProgress;
        }
        
        // 计算当前武器位置 (在腻射和瞄准位置之间插值)
        const currentPos = this.tmpCurrentPos.lerpVectors(
            this.hipPosition,
            this.adsPosition,
            this.aimProgress
        );
        
        // 武器摇摆 (瞄准时减少摇摆)
        const swayMultiplier = 1 - this.aimProgress * 0.8;  // 瞄准时只有20%摇摆
        this.swayOffset.x = Math.sin(t * 1.5) * 0.003 * swayMultiplier;
        this.swayOffset.y = Math.sin(t * 2) * 0.002 * swayMultiplier;
        
        // 处理后坐力恢复
        this.recoilOffset.z = THREE.MathUtils.lerp(this.recoilOffset.z, 0, delta * WeaponConfig.gun.recoil.recovery);
        this.recoilOffset.y = THREE.MathUtils.lerp(this.recoilOffset.y, 0, delta * WeaponConfig.gun.recoil.recovery * 0.8);
        
        // 最终更新武器位置
        // Base Position (Hip/ADS) + Sway + Recoil
        this.mesh.position.x = currentPos.x + this.swayOffset.x;
        this.mesh.position.y = currentPos.y + this.swayOffset.y + this.recoilOffset.y;
        this.mesh.position.z = currentPos.z + this.recoilOffset.z;
        
    }

    public dispose() {
        this.camera.remove(this.mesh);
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
        
        this.flashMesh.geometry.dispose();
        (this.flashMesh.material as THREE.Material).dispose();
    }
}

/**
 * 弹道轨迹类 - 使用 TSL 增强的子弹轨迹
 * 使用圆柱体网格实现更好的视觉效果
 */
