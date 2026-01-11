/**
 * Weapon - 使用 TSL 增强的武器系统
 * 包含枪口火焰、弹道轨迹、命中特效等
 */
import * as THREE from 'three';
import { 
    uniform
} from 'three/tsl';
import { Enemy } from '../enemy/Enemy';
import type { GameServices } from '../core/services/GameServices';
import { getDefaultGameServices } from '../core/services/GameServices';
import { GPUParticleSystem } from '../shaders/GPUParticles';
import { WeaponConfig, EffectConfig, EnemyConfig } from '../core/GameConfig';
import { PhysicsSystem } from '../core/PhysicsSystem';
import { BulletTrail, HitEffect } from './WeaponEffects';
import { WeaponFactory } from './WeaponFactory';

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
            const ud: any = (cur as any).userData;
            if (ud?.isEnemy && ud?.entity) return ud.entity as Enemy;
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
    private flashIntensity: any;  // TSL uniform
    
    // 武器动画状态
    private recoilOffset: THREE.Vector3 = new THREE.Vector3();
    private swayOffset: THREE.Vector3 = new THREE.Vector3();
    private isRecoiling: boolean = false;
    
    // 弹道轨迹管理
    private bulletTrails: BulletTrail[] = [];
    private bulletTrailPool: BulletTrail[] = [];
    private scene: THREE.Scene | null = null;
    
    // 命中特效
    private hitEffects: HitEffect[] = [];
    private hitEffectPool: HitEffect[] = [];
    
    // GPU 粒子系统引用
    private particleSystem: GPUParticleSystem | null = null;
    
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
    public setParticleSystem(system: GPUParticleSystem) {
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
        
        // 性能优化：过滤掉地面，只检测物体
        // 地面检测使用数学方法 (Raymarching)
        const raycastObjects = this.raycastObjects;
        raycastObjects.length = 0;
        
        // 1. 优先添加动态敌人 (最重要)
        if (this.enemies.length > 0) {
            for (const enemy of this.enemies) {
                if (!enemy.isDead) {
                     raycastObjects.push(enemy.mesh);
                }
            }
        }
        
        // 2. 添加静态物体 (使用 PhysicsSystem DDA 射线检测优化)
        if (this.physicsSystem) {
            // 使用 PhysicsSystem 的 DDA 算法精确定位射线路径上的物体
            // 相比 getNearbyObjects(60m)，这支持超远距离射击且性能更好
            const maxDistance = WeaponConfig.gun.range || 500;
            const candidates = this.physicsSystem.getRaycastCandidatesInto(
                this.raycaster.ray.origin, 
                this.raycaster.ray.direction, 
                maxDistance,
                this.physicsCandidates,
            );
            
            // 添加候选物体到检测列表
            for(const obj of candidates) {
                raycastObjects.push(obj);
            }
        } else {
            // 降级：如果没有物理系统，遍历场景 (性能较差)
            for (const child of scene.children) {
                // 排除地形 IsGround
                if (child.userData.isGround) continue;
                // 排除其他不相关的
                if (child.userData.isDust) continue;
                if (child.userData.isSkybox) continue;
                if (child.userData.isWeatherParticle) continue;
                // 排除枪口火焰等特效
                if (child.userData.isEffect) continue;
                
                raycastObjects.push(child);
            }
        }

        this.raycastIntersects.length = 0;
        this.raycaster.intersectObjects(raycastObjects, true, this.raycastIntersects);
        const intersects = this.raycastIntersects;

        // 获取射线起点和方向用于弹道
        const rayOrigin = this.tmpRayOrigin.copy(this.raycaster.ray.origin);
        const rayDirection = this.tmpRayDirection.copy(this.raycaster.ray.direction).normalize();

        let hitPoint: THREE.Vector3 | null = null;
        let hitNormal: THREE.Vector3 | null = null;
        let hitEnemy: Enemy | null = null;
        let hitObject: THREE.Object3D | null = null;

        // 1. 先检测物体碰撞
        for (const intersect of intersects) {
            const obj = intersect.object as THREE.Mesh;

            // 双重检查
            if (obj.userData.isGround) continue;
            if (obj.userData.isSkybox) continue;
            if (obj.userData.isEnemyWeapon) continue;
            
            // 跳过武器本身
            let shouldSkip = false;
            let parent: THREE.Object3D | null = obj;
            while (parent) {
                if (parent === this.mesh) {
                    shouldSkip = true;
                    break;
                }
                // 检查是否是弹道轨迹/手榴弹
                if (parent.userData.isBulletTrail || parent.userData.isGrenade) {
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
        
        // 2. 检测地面碰撞 (Raymarching)
        // 如果没有击中物体，或者击中物体的距离比地面远（虽然一般地面在最下面，但可能有遮挡关系）
        // 简单起见，只在没有击中物体，或者物体距离较远时检查地面
        
        let groundHitPoint: THREE.Vector3 | null = null;
        if (this.onGetGroundHeight) {
            // max distance 100m
            const maxDist = 100;
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
                
                this.createHitEffect(hitPoint, hitNormal!, 'blood');
            } else {
                // 命中环境 (地面或障碍物)
                // 火花特效
                if (this.particleSystem) {
                    // 如果是地面，可以换成 dust 效果，这里暂时统一用 sparks
                    this.particleSystem.emitSparks(hitPoint, hitNormal!, EffectConfig.spark.particleCount);
                }
                this.createHitEffect(hitPoint, hitNormal!, 'spark');
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
            this.flashIntensity.value *= 0.7;
            if (this.flashIntensity.value > 0.01) {
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
        
        let trail: BulletTrail;
        if (this.bulletTrailPool.length > 0) {
            trail = this.bulletTrailPool.pop()!;
        } else {
            trail = new BulletTrail();
        }
        
        trail.init(start, end);
        
        if (!trail.isDead) {
            this.scene.add(trail.mesh);
            this.bulletTrails.push(trail);
        } else {
            this.bulletTrailPool.push(trail);
        }
    }

    /**
     * 创建命中特效
     */
    private createHitEffect(position: THREE.Vector3, normal: THREE.Vector3, type: 'spark' | 'blood') {
        if (!this.scene) return;
        
        let effect: HitEffect;
        if (this.hitEffectPool.length > 0) {
            effect = this.hitEffectPool.pop()!;
        } else {
            effect = new HitEffect();
        }
        
        effect.init(position, normal, type);
        this.scene.add(effect.group);
        this.hitEffects.push(effect);
    }

    /**
     * 更新武器动画
     */
    public update(delta: number) {
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
        
        // 更新弹道轨迹
        for (let i = this.bulletTrails.length - 1; i >= 0; i--) {
            const trail = this.bulletTrails[i];
            trail.update(delta);
            
            if (trail.isDead) {
                if (this.scene) {
                    this.scene.remove(trail.mesh);
                }
                // 不销毁，放回对象池
                this.bulletTrails.splice(i, 1);
                this.bulletTrailPool.push(trail);
            }
        }
        
        // 更新命中特效
        for (let i = this.hitEffects.length - 1; i >= 0; i--) {
            const effect = this.hitEffects[i];
            effect.update(delta);
            
            if (effect.isDead) {
                if (this.scene) {
                    this.scene.remove(effect.group);
                }
                // 不销毁，放回对象池
                this.hitEffects.splice(i, 1);
                this.hitEffectPool.push(effect);
            }
        }
    }

    public dispose() {
        this.camera.remove(this.mesh);
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
        
        this.flashMesh.geometry.dispose();
        (this.flashMesh.material as THREE.Material).dispose();
        
        // 清理弹道和特效
        this.bulletTrails.forEach(t => t.dispose());
        this.hitEffects.forEach(e => e.dispose());
        
        // 清理对象池
        this.bulletTrailPool.forEach(t => t.dispose());
        this.hitEffectPool.forEach(e => e.dispose());
        
        this.bulletTrails = [];
        this.bulletTrailPool = [];
        this.hitEffects = [];
        this.hitEffectPool = [];
    }
}

/**
 * 弹道轨迹类 - 使用 TSL 增强的子弹轨迹
 * 使用圆柱体网格实现更好的视觉效果
 */
