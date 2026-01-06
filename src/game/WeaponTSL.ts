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
    private scene: THREE.Scene | null = null;
    
    // 命中特效
    private hitEffects: HitEffect[] = [];
    
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
        const intersects = this.raycaster.intersectObjects(scene.children, true);

        // 获取射线起点和方向用于弹道
        const rayOrigin = this.raycaster.ray.origin.clone();
        const rayDirection = this.raycaster.ray.direction.clone();

        let hitPoint: THREE.Vector3 | null = null;
        let hitNormal: THREE.Vector3 | null = null;
        let hitEnemy: Enemy | null = null;

        for (const intersect of intersects) {
            const obj = intersect.object as THREE.Mesh;

            if (obj.userData.isGround) continue;
            if (obj.userData.isDust) continue;
            if (obj.userData.isSkybox) continue;
            if (obj.userData.isEnemyWeapon) continue;
            if (obj.userData.isWeatherParticle) continue;
            
            // 跳过武器本身、弹道轨迹、手榴弹等
            let shouldSkip = false;
            let parent: THREE.Object3D | null = obj;
            while (parent) {
                if (parent === this.mesh) {
                    shouldSkip = true;
                    break;
                }
                // 检查是否是弹道轨迹的一部分
                if (parent.userData.isBulletTrail) {
                    shouldSkip = true;
                    break;
                }
                // 检查是否是手榴弹
                if (parent.userData.isGrenade) {
                    shouldSkip = true;
                    break;
                }
                parent = parent.parent;
            }
            if (shouldSkip) continue;

            hitPoint = intersect.point.clone();
            hitNormal = intersect.face?.normal?.clone() || new THREE.Vector3(0, 1, 0);
            
            // 将法线从局部坐标转换到世界坐标
            if (intersect.face && obj.matrixWorld) {
                hitNormal.transformDirection(obj.matrixWorld);
            }

            // 命中敌人
            if (obj.userData.isEnemy && obj.userData.entity) {
                hitEnemy = obj.userData.entity as Enemy;
                // 根据是否狙击模式使用不同伤害
                const damage = this.isAimingShot ? WeaponConfig.gun.sniperDamage : WeaponConfig.gun.damage;
                hitEnemy.takeDamage(damage);
                SoundManager.getInstance().playHit();
                
                if (hitEnemy.isDead) {
                    GameStateService.getInstance().updateScore(EnemyConfig.rewards.score);
                }
                
                // 计算血液飞溅方向 (从击中点向外)
                const bloodDirection = rayDirection.clone().negate().add(hitNormal).normalize();
                
                // 使用 GPU 粒子系统发射血液
                if (this.particleSystem) {
                    // 主血液飞溅 - 沿击中方向
                    this.particleSystem.emitBlood(hitPoint, bloodDirection, EffectConfig.blood.particleCount);
                    
                    // 额外血液 - 更分散的飞溅
                    const sideDir1 = new THREE.Vector3().crossVectors(bloodDirection, THREE.Object3D.DEFAULT_UP).normalize();
                    const sideDir2 = new THREE.Vector3().crossVectors(bloodDirection, sideDir1).normalize();
                    this.particleSystem.emitBlood(hitPoint, sideDir1.add(bloodDirection).normalize(), EffectConfig.blood.sideParticleCount);
                    this.particleSystem.emitBlood(hitPoint, sideDir2.add(bloodDirection).normalize(), EffectConfig.blood.sideParticleCount);
                }
                
                // CPU 端简单粒子作为补充
                this.createHitEffect(hitPoint, hitNormal, 'blood');
            } else {
                // 火花特效
                if (this.particleSystem) {
                    this.particleSystem.emitSparks(hitPoint, hitNormal, EffectConfig.spark.particleCount);
                }
                this.createHitEffect(hitPoint, hitNormal, 'spark');
            }
            
            break;
        }

        // 获取枪口世界坐标作为弹道起点
        const muzzlePos = this.getMuzzleWorldPosition();
        
        // 创建弹道轨迹 - 从枪口沿着射线方向
        // 注意：射线是从相机中心发出的，弹道应该从枪口射向同一目标点
        let trailEnd: THREE.Vector3;
        
        if (hitPoint) {
            // 有命中点时，弹道终点就是命中点
            trailEnd = hitPoint.clone();
        } else {
            // 没有命中时，计算从枪口沿射线方向的终点
            // 使用相机方向而非枪口到某点的方向，确保弹道朝向正确
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
        if (this.isRecoiling) return;
        this.isRecoiling = true;
        
        const recoilAmount = WeaponConfig.gun.recoil.amount;
        const originalPos = this.mesh.position.clone();
        
        // 后座力动画
        const animate = () => {
            this.recoilOffset.z = THREE.MathUtils.lerp(this.recoilOffset.z, 0, 0.2);
            this.recoilOffset.y = THREE.MathUtils.lerp(this.recoilOffset.y, 0, 0.15);
            
            this.mesh.position.copy(originalPos).add(this.recoilOffset);
            
            if (Math.abs(this.recoilOffset.z) > 0.001 || Math.abs(this.recoilOffset.y) > 0.001) {
                requestAnimationFrame(animate);
            } else {
                this.recoilOffset.set(0, 0, 0);
                this.mesh.position.copy(originalPos);
                this.isRecoiling = false;
            }
        };
        
        // 初始后座力
        this.recoilOffset.z = recoilAmount;
        this.recoilOffset.y = recoilAmount * 0.3;
        animate();
    }

    /**
     * 创建弹道轨迹
     */
    private createBulletTrail(start: THREE.Vector3, end: THREE.Vector3) {
        if (!this.scene) return;
        
        const trail = new BulletTrail(start, end);
        this.scene.add(trail.mesh);
        this.bulletTrails.push(trail);
    }

    /**
     * 创建命中特效
     */
    private createHitEffect(position: THREE.Vector3, normal: THREE.Vector3, type: 'spark' | 'blood') {
        if (!this.scene) return;
        
        const effect = new HitEffect(position, normal, type);
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
        
        if (!this.isRecoiling) {
            this.mesh.position.x = currentPos.x + this.swayOffset.x;
            this.mesh.position.y = currentPos.y + this.swayOffset.y;
            this.mesh.position.z = currentPos.z;
        }
        
        // 更新弹道轨迹
        for (let i = this.bulletTrails.length - 1; i >= 0; i--) {
            const trail = this.bulletTrails[i];
            trail.update(delta);
            
            if (trail.isDead) {
                if (this.scene) {
                    this.scene.remove(trail.mesh);
                }
                trail.dispose();
                this.bulletTrails.splice(i, 1);
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
                effect.dispose();
                this.hitEffects.splice(i, 1);
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
    }
}

/**
 * 弹道轨迹类 - 使用 TSL 增强的子弹轨迹
 * 使用圆柱体网格实现更好的视觉效果
 */
class BulletTrail {
    public mesh: THREE.Group;
    public isDead: boolean = false;
    private lifetime: number = 0;
    private maxLifetime: number = 0.15;
    private trailOpacity: ReturnType<typeof uniform>;
    private trailLength: number;
    private startPos: THREE.Vector3;
    private endPos: THREE.Vector3;
    private mainTrail: THREE.Mesh;
    private glowTrail: THREE.Mesh;

    constructor(start: THREE.Vector3, end: THREE.Vector3) {
        this.startPos = start.clone();
        this.endPos = end.clone();
        this.trailOpacity = uniform(1.0);
        
        this.mesh = new THREE.Group();
        this.mesh.userData = { isBulletTrail: true };
        
        // 计算轨迹方向和长度
        const direction = new THREE.Vector3().subVectors(end, start);
        this.trailLength = Math.max(0.1, direction.length()); // 确保长度不为0
        
        // 如果长度太短，不创建轨迹
        if (direction.length() < 0.01) {
            this.mainTrail = new THREE.Mesh();
            this.glowTrail = new THREE.Mesh();
            this.isDead = true;
            return;
        }
        
        direction.normalize();
        
        // 创建主轨迹 (细线)
        this.mainTrail = this.createMainTrail(direction);
        this.mesh.add(this.mainTrail);
        
        // 创建发光轨迹 (粗线，半透明)
        this.glowTrail = this.createGlowTrail(direction);
        this.mesh.add(this.glowTrail);
        
        // 设置位置到中点
        const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
        this.mesh.position.copy(midpoint);
        
        // 计算旋转 - 将Y轴旋转到目标方向
        const defaultDir = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion();
        
        // 处理方向接近平行或反平行的情况
        const dot = defaultDir.dot(direction);
        if (Math.abs(dot) > 0.9999) {
            // 几乎平行，使用简单旋转
            if (dot < 0) {
                // 反方向，旋转180度
                quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
            }
            // 如果是同方向，quaternion保持默认（不旋转）
        } else {
            quaternion.setFromUnitVectors(defaultDir, direction);
        }
        
        this.mesh.quaternion.copy(quaternion);
    }

    /**
     * 创建主弹道线 - TSL 材质
     */
    private createMainTrail(direction: THREE.Vector3): THREE.Mesh {
        // 使用细长的圆柱体
        const geometry = new THREE.CylinderGeometry(0.003, 0.003, this.trailLength, 4, 1);
        
        const material = new MeshBasicNodeMaterial();
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.side = THREE.DoubleSide;
        
        const opacity = this.trailOpacity;
        const t = time;
        
        // 核心颜色 - 亮黄白色
        const coreColor = vec3(1.0, 0.95, 0.7);
        
        // 添加微小的闪烁
        const flicker = sin(t.mul(200)).mul(0.1).add(0.9);
        
        material.colorNode = coreColor.mul(flicker);
        material.opacityNode = opacity;
        
        return new THREE.Mesh(geometry, material);
    }

    /**
     * 创建发光轨迹 - 更宽的发光效果
     */
    private createGlowTrail(direction: THREE.Vector3): THREE.Mesh {
        // 稍宽的发光效果
        const geometry = new THREE.CylinderGeometry(0.015, 0.008, this.trailLength, 6, 1);
        
        const material = new MeshBasicNodeMaterial();
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.side = THREE.DoubleSide;
        
        const opacity = this.trailOpacity;
        const t = time;
        const uvCoord = uv();
        
        // 从头到尾的渐变 (子弹头亮，尾部暗)
        const gradient = smoothstep(float(0), float(0.3), uvCoord.y);
        
        // 发光颜色 - 橙黄色
        const glowColor = vec3(1.0, 0.6, 0.15);
        
        // 径向衰减 (边缘更透明)
        const radialFade = smoothstep(float(0.5), float(0.2), abs(uvCoord.x.sub(0.5)));
        
        material.colorNode = glowColor.mul(gradient);
        material.opacityNode = opacity.mul(0.6).mul(radialFade);
        
        return new THREE.Mesh(geometry, material);
    }

    public update(delta: number) {
        this.lifetime += delta;
        
        const progress = this.lifetime / this.maxLifetime;
        
        // 快速淡出
        const fadeOut = 1 - Math.pow(progress, 0.5);
        this.trailOpacity.value = fadeOut;
        
        // 轨迹收缩效果 (从尾部开始消失)
        const shrinkProgress = Math.min(progress * 2, 1);
        const newLength = this.trailLength * (1 - shrinkProgress * 0.8);
        
        // 更新几何体缩放
        this.mainTrail.scale.y = Math.max(0.1, 1 - shrinkProgress * 0.9);
        this.glowTrail.scale.y = Math.max(0.1, 1 - shrinkProgress * 0.9);
        
        if (this.lifetime >= this.maxLifetime) {
            this.isDead = true;
        }
    }

    public dispose() {
        this.mainTrail.geometry.dispose();
        (this.mainTrail.material as THREE.Material).dispose();
        this.glowTrail.geometry.dispose();
        (this.glowTrail.material as THREE.Material).dispose();
    }
}

/**
 * 命中特效类
 */
class HitEffect {
    public group: THREE.Group;
    public isDead: boolean = false;
    private lifetime: number = 0;
    private maxLifetime: number = 0.3;
    private particles: THREE.Mesh[] = [];

    constructor(position: THREE.Vector3, normal: THREE.Vector3, type: 'spark' | 'blood') {
        this.group = new THREE.Group();
        this.group.position.copy(position);
        
        // 创建粒子
        const particleCount = type === 'spark' ? 8 : 5;
        const color = type === 'spark' ? 0xffaa33 : 0xcc0000;
        
        for (let i = 0; i < particleCount; i++) {
            const geo = new THREE.SphereGeometry(0.02, 4, 4);
            const mat = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 1
            });
            
            const particle = new THREE.Mesh(geo, mat);
            
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
            
            this.particles.push(particle);
            this.group.add(particle);
        }
    }

    public update(delta: number) {
        this.lifetime += delta;
        
        const progress = this.lifetime / this.maxLifetime;
        
        // 更新粒子
        this.particles.forEach(particle => {
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
        }
    }

    public dispose() {
        this.particles.forEach(particle => {
            particle.geometry.dispose();
            (particle.material as THREE.Material).dispose();
        });
    }
}
