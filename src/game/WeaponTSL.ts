/**
 * Weapon - 使用 TSL 增强的武器系统
 * 包含枪口火焰、弹道轨迹、命中特效等
 */
import * as THREE from 'three';
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial, SpriteNodeMaterial } from 'three/webgpu';
import { 
    uniform, time, sin, cos, vec3, vec4, mix, float, 
    smoothstep, uv, sub, abs, length, attribute,
    positionLocal, cameraProjectionMatrix, cameraViewMatrix,
    modelWorldMatrix
} from 'three/tsl';
import { Enemy } from './EnemyTSL';
import { GameStateService } from './GameState';
import { SoundManager } from './SoundManager';
import { GPUParticleSystem } from './shaders/GPUParticles';
import { WeaponConfig, EffectConfig, EnemyConfig } from './GameConfig';

export class Weapon {
    private camera: THREE.Camera;
    private mesh: THREE.Mesh;
    private raycaster: THREE.Raycaster;
    
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

    constructor(camera: THREE.Camera) {
        this.camera = camera;
        this.raycaster = new THREE.Raycaster();
        
        // TSL Uniforms
        this.flashIntensity = uniform(0);

        // 创建武器
        this.mesh = this.createWeaponMesh();
        this.camera.add(this.mesh);
        
        // 创建枪口位置辅助点
        this.muzzlePoint = new THREE.Object3D();
        this.muzzlePoint.position.set(0, 0.02, -0.45); // 枪口相对于武器的位置
        this.mesh.add(this.muzzlePoint);
        
        // 创建枪口火焰
        this.flashMesh = this.createMuzzleFlash();
        this.mesh.add(this.flashMesh);
    }

    /**
     * 设置地形高度回调
     */
    public setGroundHeightCallback(callback: (x: number, z: number) => number) {
        this.onGetGroundHeight = callback;
    }

    /**
     * 创建武器网格 - 简单的枪模型
     */
    private createWeaponMesh(): THREE.Mesh {
        // 组合几何体创建枪形
        const bodyGeo = new THREE.BoxGeometry(0.08, 0.12, 0.5);
        const material = this.createWeaponMaterial();
        
        const mesh = new THREE.Mesh(bodyGeo, material);
        mesh.position.set(0.3, -0.25, -0.6);
        mesh.castShadow = true;
        
        // 添加枪管
        const barrelGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.3, 8);
        const barrelMesh = new THREE.Mesh(barrelGeo, material);
        barrelMesh.rotation.x = Math.PI / 2;
        barrelMesh.position.set(0, 0.02, -0.3);
        mesh.add(barrelMesh);
        
        // 添加瞄准器
        const sightGeo = new THREE.BoxGeometry(0.02, 0.04, 0.02);
        const sightMesh = new THREE.Mesh(sightGeo, material);
        sightMesh.position.set(0, 0.08, -0.1);
        mesh.add(sightMesh);
        
        // 添加倍镜
        this.scopeMesh = this.createScope(material);
        mesh.add(this.scopeMesh);
        
        return mesh;
    }
    
    /**
     * 创建倍镜模型 - 红点瞄准镜风格
     */
    private createScope(baseMaterial: MeshStandardNodeMaterial): THREE.Group {
        const scopeGroup = new THREE.Group();
        
        // 倍镜主体 - 圆筒形
        const tubeGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.12, 12);
        const tubeMesh = new THREE.Mesh(tubeGeo, baseMaterial);
        tubeMesh.rotation.x = Math.PI / 2;
        scopeGroup.add(tubeMesh);
        
        // 前镜片框
        const frontRingGeo = new THREE.TorusGeometry(0.025, 0.005, 8, 16);
        const frontRing = new THREE.Mesh(frontRingGeo, baseMaterial);
        frontRing.position.z = -0.06;
        scopeGroup.add(frontRing);
        
        // 后镜片框
        const backRingGeo = new THREE.TorusGeometry(0.022, 0.004, 8, 16);
        const backRing = new THREE.Mesh(backRingGeo, baseMaterial);
        backRing.position.z = 0.06;
        scopeGroup.add(backRing);
        
        // 镜片 - 半透明蓝色镜面
        const lensGeo = new THREE.CircleGeometry(0.022, 16);
        const lensMaterial = this.createLensMaterial();
        const frontLens = new THREE.Mesh(lensGeo, lensMaterial);
        frontLens.position.z = -0.058;
        scopeGroup.add(frontLens);
        
        // 红点照明 (模拟红点瞄准镜内部的红点)
        const redDotGeo = new THREE.CircleGeometry(0.003, 8);
        const redDotMaterial = this.createRedDotMaterial();
        const redDot = new THREE.Mesh(redDotGeo, redDotMaterial);
        redDot.position.z = 0.055;
        redDot.name = 'redDot';
        scopeGroup.add(redDot);
        
        // 倍镜底座/导轨
        const mountGeo = new THREE.BoxGeometry(0.015, 0.02, 0.08);
        const mount = new THREE.Mesh(mountGeo, baseMaterial);
        mount.position.y = -0.032;
        scopeGroup.add(mount);
        
        // 设置倍镜位置 (在枪身上方)
        scopeGroup.position.set(0, 0.095, -0.05);
        
        return scopeGroup;
    }
    
    /**
     * 镜片材质 - TSL 动态反射效果
     */
    private createLensMaterial(): MeshBasicNodeMaterial {
        const material = new MeshBasicNodeMaterial();
        material.transparent = true;
        material.side = THREE.DoubleSide;
        
        const t = time;
        const uvCoord = uv();
        
        // 镜片基础颜色 - 淡蓝色
        const baseColor = vec3(0.3, 0.4, 0.6);
        
        // 径向渐变 (中心透明，边缘有色)
        const center = vec3(0.5, 0.5, 0);
        const dist = length(uvCoord.sub(center.xy));
        const edgeGlow = smoothstep(float(0.2), float(0.5), dist);
        
        // 动态反光效果
        const shimmer = sin(t.mul(2).add(uvCoord.x.mul(10))).mul(0.1).add(0.9);
        
        material.colorNode = baseColor.mul(edgeGlow).mul(shimmer);
        material.opacityNode = mix(float(0.1), float(0.4), edgeGlow);
        
        return material;
    }
    
    /**
     * 红点材质 - 发光的红点
     */
    private createRedDotMaterial(): MeshBasicNodeMaterial {
        const material = new MeshBasicNodeMaterial();
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        
        const t = time;
        const uvCoord = uv();
        
        // 红点颜色
        const redColor = vec3(1.0, 0.1, 0.05);
        
        // 圆形渐变
        const center = vec3(0.5, 0.5, 0);
        const dist = length(uvCoord.sub(center.xy));
        const dotShape = smoothstep(float(0.5), float(0.2), dist);
        
        // 微弱脉动
        const pulse = sin(t.mul(3)).mul(0.15).add(0.85);
        
        material.colorNode = redColor.mul(pulse).mul(1.5);
        material.opacityNode = dotShape.mul(pulse);
        
        return material;
    }

    /**
     * 武器材质 - 金属质感
     */
    private createWeaponMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.25,
            metalness: 0.95
        });

        const uvCoord = uv();
        const t = time;
        
        // ========== 金属刷纹 ==========
        const brushFreq = float(200);
        const brushPattern = sin(uvCoord.x.mul(brushFreq)).mul(0.015);
        
        // ========== 基础颜色 ==========
        const baseColor = vec3(0.15, 0.14, 0.13);
        const highlightColor = vec3(0.25, 0.24, 0.22);
        
        // 高光区域
        const highlight = smoothstep(float(0.3), float(0.7), uvCoord.y);
        const metalColor = mix(baseColor, highlightColor, highlight);
        
        // 添加刷纹
        const finalColor = metalColor.add(brushPattern);
        
        material.colorNode = finalColor;
        
        // ========== 动态反射 ==========
        // 环境光反射
        material.envMapIntensity = 0.8;
        
        // 刷纹处略粗糙
        material.roughnessNode = mix(float(0.2), float(0.35), abs(brushPattern).mul(10));
        
        return material;
    }

    /**
     * 创建枪口火焰
     */
    private createMuzzleFlash(): THREE.Mesh {
        const geometry = new THREE.PlaneGeometry(0.15, 0.15);
        const material = this.createMuzzleFlashMaterial();
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(0, 0.02, -0.45);
        mesh.visible = false;
        
        // 双面渲染
        const mesh2 = mesh.clone();
        mesh2.rotation.y = Math.PI / 2;
        mesh.add(mesh2);
        
        return mesh;
    }

    /**
     * 设置 GPU 粒子系统引用
     */
    public setParticleSystem(system: GPUParticleSystem) {
        this.particleSystem = system;
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
    public getMuzzleWorldPosition(): THREE.Vector3 {
        // 确保整个层级的矩阵已更新 (相机 -> 武器 -> 枪口)
        this.camera.updateMatrixWorld(true);
        
        const worldPos = new THREE.Vector3();
        this.muzzlePoint.getWorldPosition(worldPos);
        return worldPos;
    }

    /**
     * 枪口火焰材质 - 动态火焰效果
     */
    private createMuzzleFlashMaterial(): MeshBasicNodeMaterial {
        const material = new MeshBasicNodeMaterial();
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.side = THREE.DoubleSide;

        const t = time;
        const intensity = this.flashIntensity;
        
        // 火焰颜色渐变
        const innerColor = vec3(1, 1, 0.9); // 白黄色中心
        const outerColor = vec3(1, 0.5, 0.1); // 橙色边缘
        
        // 基于UV的径向渐变
        const uvCoord = uv();
        const center = vec3(0.5, 0.5, 0);
        const dist = length(uvCoord.sub(center.xy));
        
        // 火焰形状
        const flameShape = smoothstep(float(0.5), float(0), dist);
        
        // 闪烁效果
        const flicker = sin(t.mul(100)).mul(0.2).add(0.8);
        
        // 颜色混合
        const fireColor = mix(outerColor, innerColor, smoothstep(float(0.3), float(0), dist));
        
        material.colorNode = fireColor.mul(flameShape).mul(intensity).mul(flicker);
        material.opacityNode = flameShape.mul(intensity);
        
        return material;
    }

    /**
     * 射击
     */
    public shoot(scene: THREE.Scene, isAiming: boolean = false) {
        this.scene = scene;
        this.isAimingShot = isAiming;  // 保存瞄准状态用于伤害计算
        
        const gameState = GameStateService.getInstance();
        if (gameState.getState().ammo <= 0) return;

        gameState.updateAmmo(-1);
        
        // 根据是否瞄准播放不同的枪声
        if (isAiming) {
            SoundManager.getInstance().playSniperShoot();
        } else {
            SoundManager.getInstance().playShoot();
        }

        // 枪口火焰
        this.showMuzzleFlash();
        
        // 后座力
        this.applyRecoil();

        // 射线检测
        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        
        // 性能优化：过滤掉地面，只检测物体
        // 地面检测使用数学方法 (Raymarching)
        const raycastObjects = [];
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

        const intersects = this.raycaster.intersectObjects(raycastObjects, true);

        // 获取射线起点和方向用于弹道
        const rayOrigin = this.raycaster.ray.origin.clone();
        const rayDirection = this.raycaster.ray.direction.clone();
        rayDirection.normalize();

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

            hitPoint = intersect.point.clone();
            hitNormal = intersect.face?.normal?.clone() || new THREE.Vector3(0, 1, 0);
            
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
            
            // 起点
            const currentPos = rayOrigin.clone();
            let dist = 0;
            
            // 粗略步进
            while (dist < maxDist) {
                currentPos.add(rayDirection.clone().multiplyScalar(stepSize));
                dist += stepSize;
                
                const terrainHeight = this.onGetGroundHeight(currentPos.x, currentPos.z);
                
                // 如果射线点到了地面下方
                if (currentPos.y < terrainHeight) {
                    // 发生了碰撞，进行一次二分精细查找
                    // 回退一步
                    let low = dist - stepSize;
                    let high = dist;
                    for(let i=0; i<4; i++) { // 4次迭代足够精确
                        const mid = (low + high) / 2;
                        const p = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(mid));
                        const h = this.onGetGroundHeight(p.x, p.z);
                        if (p.y < h) {
                            high = mid; // 还在地下，往回缩
                        } else {
                            low = mid; // 在地上，往前
                        }
                    }
                    
                    const hitDist = (low + high) / 2;
                    groundHitPoint = rayOrigin.clone().add(rayDirection.clone().multiplyScalar(hitDist));
                    
                    // 检查是否比物体碰撞点更近
                    if (hitPoint) {
                        const distToObj = rayOrigin.distanceTo(hitPoint);
                        if (hitDist < distToObj) {
                            // 地面更近，覆盖物体结果
                            hitPoint = groundHitPoint;
                            // 地面法线比较复杂，这里简单模拟向上的法线，或者通过采样周围点计算
                            // 简单起见：向上，稍微带点随机扰动模拟粗糙
                            hitNormal = new THREE.Vector3(0, 1, 0); 
                            hitObject = null; // 标记为非物体命中
                            hitEnemy = null;
                        }
                    } else {
                        // 之前没命中物体，现在命中了地面
                        hitPoint = groundHitPoint;
                        hitNormal = new THREE.Vector3(0, 1, 0);
                        hitObject = null;
                    }
                    
                    break; // 退出 Raymarching
                }
            }
        }

        // 处理命中结果
        if (hitPoint) {
            
            // 命中敌人
            if (hitObject && hitObject.userData.isEnemy && hitObject.userData.entity) {
                hitEnemy = hitObject.userData.entity as Enemy;
                // ... (原有逻辑)
                const damage = this.isAimingShot ? WeaponConfig.gun.sniperDamage : WeaponConfig.gun.damage;
                hitEnemy.takeDamage(damage);
                SoundManager.getInstance().playHit();
                
                if (hitEnemy.isDead) {
                    GameStateService.getInstance().updateScore(EnemyConfig.rewards.score);
                }
                
                // 计算血液飞溅方向
                const bloodDirection = rayDirection.clone().negate().add(hitNormal!).normalize();
                
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
        const muzzlePos = this.getMuzzleWorldPosition();
        
        // 创建弹道轨迹
        // ... (原有逻辑)
        let trailEnd: THREE.Vector3;
        
        if (hitPoint) {
            trailEnd = hitPoint.clone();
        } else {
            trailEnd = muzzlePos.clone().add(rayDirection.clone().multiplyScalar(WeaponConfig.gun.range));
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
        const currentPos = new THREE.Vector3().lerpVectors(
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
class BulletTrail {
    // 共享几何体 (单位高度 1，中心在原点)
    private static mainGeometry = new THREE.CylinderGeometry(0.003, 0.003, 1, 4, 1);
    private static glowGeometry = new THREE.CylinderGeometry(0.015, 0.008, 1, 6, 1);

    public mesh: THREE.Group;
    public isDead: boolean = false;
    private lifetime: number = 0;
    private maxLifetime: number = 0.15;
    private trailOpacity: ReturnType<typeof uniform>;
    private trailLength: number = 1;

    private mainTrail: THREE.Mesh;
    private glowTrail: THREE.Mesh;

    constructor() {
        this.trailOpacity = uniform(1.0);
        
        this.mesh = new THREE.Group();
        this.mesh.userData = { isBulletTrail: true };
        
        // 创建材质 (每个实例独立，因为 uniforms 是绑定的)
        // 创建主轨迹
        const mainMaterial = this.createMainMaterial();
        this.mainTrail = new THREE.Mesh(BulletTrail.mainGeometry, mainMaterial);
        // 旋转几何体使Y轴朝向Z轴 (Three.js圆柱体默认Y轴朝上)
        // 但这里我们之后统一旋转整个 Group
        this.mesh.add(this.mainTrail);
        
        // 创建发光轨迹
        const glowMaterial = this.createGlowMaterial();
        this.glowTrail = new THREE.Mesh(BulletTrail.glowGeometry, glowMaterial);
        this.mesh.add(this.glowTrail);
        
        // 初始隐藏
        this.mesh.visible = false;
    }

    /**
     * 重置并初始化轨迹 (对象池复用)
     */
    public init(start: THREE.Vector3, end: THREE.Vector3) {
        this.isDead = false;
        this.lifetime = 0;
        this.trailOpacity.value = 1.0;
        this.mesh.visible = true;

        // 计算轨迹方向和长度
        const direction = new THREE.Vector3().subVectors(end, start);
        this.trailLength = Math.max(0.1, direction.length());
        
        // 如果长度太短，隐藏
        if (direction.length() < 0.01) {
            this.mesh.visible = false;
            this.isDead = true;
            return;
        }
        
        // 设置位置到中点
        const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
        this.mesh.position.copy(midpoint);
        
        // 计算旋转
        direction.normalize();
        const defaultDir = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion();
        
        const dot = defaultDir.dot(direction);
        if (Math.abs(dot) > 0.9999) {
            if (dot < 0) quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
        } else {
            quaternion.setFromUnitVectors(defaultDir, direction);
        }
        this.mesh.quaternion.copy(quaternion);

        // 应用缩放 (直接缩放 Mesh)
        this.mainTrail.scale.set(1, this.trailLength, 1);
        this.glowTrail.scale.set(1, this.trailLength, 1);
    }

    private createMainMaterial(): MeshBasicNodeMaterial {
        const material = new MeshBasicNodeMaterial();
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.side = THREE.DoubleSide;
        
        const opacity = this.trailOpacity;
        const t = time;
        const coreColor = vec3(1.0, 0.95, 0.7);
        const flicker = sin(t.mul(200)).mul(0.1).add(0.9);
        
        material.colorNode = coreColor.mul(flicker);
        material.opacityNode = opacity;
        return material;
    }

    private createGlowMaterial(): MeshBasicNodeMaterial {
        const material = new MeshBasicNodeMaterial();
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.side = THREE.DoubleSide;
        
        const opacity = this.trailOpacity;
        const uvCoord = uv();
        const gradient = smoothstep(float(0), float(0.3), uvCoord.y);
        const glowColor = vec3(1.0, 0.6, 0.15);
        const radialFade = smoothstep(float(0.5), float(0.2), abs(uvCoord.x.sub(0.5)));
        
        material.colorNode = glowColor.mul(gradient);
        material.opacityNode = opacity.mul(0.6).mul(radialFade);
        return material;
    }

    public update(delta: number) {
        if (this.isDead) return;

        this.lifetime += delta;
        const progress = this.lifetime / this.maxLifetime;
        
        const fadeOut = 1 - Math.pow(progress, 0.5);
        this.trailOpacity.value = fadeOut;
        
        // 轨迹收缩
        const shrinkProgress = Math.min(progress * 2, 1);
        
        // 更新缩放
        const scaleY = this.trailLength * (1 - shrinkProgress * 0.8);
        const scaleRadial = Math.max(0.1, 1 - shrinkProgress * 0.9);

        // 注意：scale.y 代表长度，scale.x/z 代表粗细
        this.mainTrail.scale.set(scaleRadial, scaleY, scaleRadial);
        this.glowTrail.scale.set(scaleRadial, scaleY, scaleRadial);
        
        if (this.lifetime >= this.maxLifetime) {
            this.isDead = true;
        }
    }

    public dispose() {
        // 静态几何体不需要销毁
        // 只销毁材质
        (this.mainTrail.material as THREE.Material).dispose();
        (this.glowTrail.material as THREE.Material).dispose();
    }
}

/**
 * 命中特效类
 */
class HitEffect {
    // 共享几何体
    private static particleGeometry = new THREE.SphereGeometry(0.02, 4, 4);

    public group: THREE.Group;
    public isDead: boolean = false;
    private lifetime: number = 0;
    private maxLifetime: number = 0.3;
    private particles: THREE.Mesh[] = [];

    constructor() {
        this.group = new THREE.Group();
        this.group.userData = { isEffect: true };
        
        // 预创建最大可能数量的粒子 (比如8个)
        const maxParticles = 8;
        
        // 使用白色基础材质，通过 color 属性修改
        // 为了性能，其实应该共享材质，但为了淡出效果这里每个粒子用了独立的 Material 实例
        // 优化方案：重用 Material 实例，不要在 init 里 new
        
        for (let i = 0; i < maxParticles; i++) {
            const mat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 1
            });
            
            const particle = new THREE.Mesh(HitEffect.particleGeometry, mat);
            particle.visible = false;
            
            this.particles.push(particle);
            this.group.add(particle);
        }
    }

    public init(position: THREE.Vector3, normal: THREE.Vector3, type: 'spark' | 'blood') {
        this.reset();
        this.group.position.copy(position);
        this.group.visible = true;
        
        const particleCount = type === 'spark' ? 8 : 5;
        const color = type === 'spark' ? 0xffaa33 : 0xcc0000;
        
        for (let i = 0; i < particleCount; i++) {
            const particle = this.particles[i];
            particle.visible = true;
            particle.scale.setScalar(1);
            
            // 重置材质
            const mat = particle.material as THREE.MeshBasicMaterial;
            mat.color.setHex(color);
            mat.opacity = 1;
            
            // 随机方向 (偏向法线方向)
            const randomDir = new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2
            ).normalize();
            
            const velocity = normal.clone()
                .multiplyScalar(2 + Math.random() * 2)
                .add(randomDir.multiplyScalar(1 + Math.random()));
            
            particle.userData.velocity = velocity;
            particle.position.set(0, 0, 0); // 相对于 group 原点
        }
        
        // 隐藏多余的粒子
        for (let i = particleCount; i < this.particles.length; i++) {
            this.particles[i].visible = false;
        }
    }
    
    private reset() {
        this.isDead = false;
        this.lifetime = 0;
    }

    public update(delta: number) {
        if (this.isDead) return;

        this.lifetime += delta;
        
        const progress = this.lifetime / this.maxLifetime;
        
        // 更新粒子
        this.particles.forEach(particle => {
            if (!particle.visible) return;
            
            const vel = particle.userData.velocity as THREE.Vector3;
            
            // 应用重力
            vel.y -= 20 * delta;
            
            // 移动
            particle.position.add(vel.clone().multiplyScalar(delta));
            
            // 淡出
            (particle.material as THREE.MeshBasicMaterial).opacity = 1 - progress;
            
            // 缩小
            const scale = 1 - progress * 0.5;
            particle.scale.setScalar(scale);
        });
        
        if (this.lifetime >= this.maxLifetime) {
            this.isDead = true;
            this.group.visible = false;
        }
    }

    public dispose() {
        // 几何体是静态的，不需要 dispose
        this.particles.forEach(particle => {
            (particle.material as THREE.Material).dispose();
        });
    }
}
