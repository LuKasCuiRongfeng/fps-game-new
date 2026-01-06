/**
 * Grenade - 手榴弹系统
 * 包含投掷动画、物理模拟和爆炸效果
 */
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { 
    uniform, time, sin, cos, vec3, mix, float, 
    uv, smoothstep
} from 'three/tsl';
import { GPUParticleSystem } from './shaders/GPUParticles';
import { ExplosionManager } from './ExplosionEffect';
import { SoundManager } from './SoundManager';
import { GameStateService } from './GameState';
import { WeaponConfig } from './GameConfig';

export class Grenade {
    public mesh: THREE.Group;
    public isExploded: boolean = false;
    public isActive: boolean = true;
    
    // 物理属性
    private velocity: THREE.Vector3;
    private angularVelocity: THREE.Vector3;
    private gravity: number = WeaponConfig.grenade.physics.gravity;
    private bounceFactor: number = WeaponConfig.grenade.physics.bounceFactor;
    private friction: number = WeaponConfig.grenade.physics.friction;
    
    // 定时器
    private fuseTime: number = WeaponConfig.grenade.fuseTime;
    private currentTime: number = 0;
    
    // 爆炸参数
    private explosionRadius: number = WeaponConfig.grenade.explosionRadius;
    private explosionDamage: number = WeaponConfig.grenade.explosionDamage;
    
    // 粒子系统引用 (用于少量碎片)
    private particleSystem: GPUParticleSystem | null = null;
    
    // 爆炸特效管理器
    private explosionManager: ExplosionManager | null = null;
    
    // 场景和碰撞对象
    private scene: THREE.Scene;
    private collisionObjects: THREE.Object3D[];
    
    // 敌人引用 (用于伤害计算)
    private enemies: any[] = [];
    
    // 玩家位置引用
    private playerPosition: THREE.Vector3;

    constructor(
        position: THREE.Vector3, 
        direction: THREE.Vector3, 
        throwStrength: number,
        scene: THREE.Scene,
        collisionObjects: THREE.Object3D[],
        playerPosition: THREE.Vector3
    ) {
        this.scene = scene;
        this.collisionObjects = collisionObjects;
        this.playerPosition = playerPosition;
        
        // 创建手榴弹模型
        this.mesh = this.createGrenadeMesh();
        this.mesh.position.copy(position);
        
        // 设置初始速度 (投掷方向 + 向上的抛物线)
        this.velocity = direction.clone().normalize().multiplyScalar(throwStrength);
        this.velocity.y += throwStrength * 0.5;  // 向上的初始速度
        
        // 随机旋转速度
        this.angularVelocity = new THREE.Vector3(
            (Math.random() - 0.5) * 15,
            (Math.random() - 0.5) * 15,
            (Math.random() - 0.5) * 15
        );
        
        scene.add(this.mesh);
    }
    
    /**
     * 设置粒子系统
     */
    public setParticleSystem(ps: GPUParticleSystem) {
        this.particleSystem = ps;
    }
    
    /**
     * 设置爆炸特效管理器
     */
    public setExplosionManager(em: ExplosionManager) {
        this.explosionManager = em;
    }
    
    /**
     * 设置敌人列表 (用于爆炸伤害)
     */
    public setEnemies(enemies: any[]) {
        this.enemies = enemies;
    }

    /**
     * 创建手榴弹网格
     */
    private createGrenadeMesh(): THREE.Group {
        const group = new THREE.Group();
        group.userData = { isGrenade: true };
        
        // 手榴弹主体 - 椭圆形
        const bodyGeo = new THREE.SphereGeometry(0.06, 12, 8);
        bodyGeo.scale(1, 1.4, 1);
        const bodyMaterial = this.createGrenadeMaterial();
        const body = new THREE.Mesh(bodyGeo, bodyMaterial);
        group.add(body);
        
        // 顶部圆环
        const ringGeo = new THREE.TorusGeometry(0.025, 0.008, 8, 16);
        const ringMaterial = new MeshStandardNodeMaterial({
            roughness: 0.3,
            metalness: 0.9
        });
        ringMaterial.colorNode = vec3(0.75, 0.75, 0.78);
        const ring = new THREE.Mesh(ringGeo, ringMaterial);
        ring.position.y = 0.1;
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
        
        // 保险销
        const pinGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.04, 6);
        const pinMaterial = new MeshStandardNodeMaterial({
            roughness: 0.25,
            metalness: 0.85
        });
        pinMaterial.colorNode = vec3(0.8, 0.8, 0.82);
        const pin = new THREE.Mesh(pinGeo, pinMaterial);
        pin.position.set(0.03, 0.1, 0);
        pin.rotation.z = Math.PI / 4;
        group.add(pin);
        
        // 手柄/击发装置
        const handleGeo = new THREE.BoxGeometry(0.015, 0.08, 0.025);
        const handleMaterial = new MeshStandardNodeMaterial({
            roughness: 0.4,
            metalness: 0.7
        });
        handleMaterial.colorNode = vec3(0.3, 0.32, 0.28);
        const handle = new THREE.Mesh(handleGeo, handleMaterial);
        handle.position.set(0.045, 0.03, 0);
        group.add(handle);
        
        return group;
    }

    /**
     * 手榴弹材质 - 军绿色金属质感
     */
    private createGrenadeMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.65,
            metalness: 0.3
        });
        
        const uvCoord = uv();
        
        // 军绿色基底
        const baseGreen = vec3(0.25, 0.30, 0.18);
        
        // 添加一些纹理变化
        const noise = sin(uvCoord.x.mul(50)).mul(sin(uvCoord.y.mul(50))).mul(0.02);
        
        // 横向凹槽
        const grooves = smoothstep(float(0.48), float(0.52), 
            sin(uvCoord.y.mul(40)).abs()
        ).mul(0.05);
        
        const finalColor = baseGreen.add(noise).sub(grooves);
        material.colorNode = finalColor;
        
        return material;
    }

    /**
     * 更新手榴弹
     */
    public update(delta: number): void {
        if (!this.isActive || this.isExploded) return;
        
        // 更新计时器
        this.currentTime += delta;
        
        // 检查是否应该爆炸
        if (this.currentTime >= this.fuseTime) {
            this.explode();
            return;
        }
        
        // 应用重力
        this.velocity.y += this.gravity * delta;
        
        // 应用阻力
        this.velocity.x *= this.friction;
        this.velocity.z *= this.friction;
        
        // 保存旧位置
        const oldPosition = this.mesh.position.clone();
        
        // 更新位置
        this.mesh.position.add(this.velocity.clone().multiplyScalar(delta));
        
        // 更新旋转
        this.mesh.rotation.x += this.angularVelocity.x * delta;
        this.mesh.rotation.y += this.angularVelocity.y * delta;
        this.mesh.rotation.z += this.angularVelocity.z * delta;
        
        // 地面碰撞检测
        const grenadeRadius = WeaponConfig.grenade.radius;
        if (this.mesh.position.y < grenadeRadius) {
            this.mesh.position.y = grenadeRadius;
            this.velocity.y = -this.velocity.y * this.bounceFactor;
            this.velocity.x *= WeaponConfig.grenade.physics.groundFriction;
            this.velocity.z *= WeaponConfig.grenade.physics.groundFriction;
            this.angularVelocity.multiplyScalar(WeaponConfig.grenade.physics.bounceAngularDamping);
            
            // 播放弹跳音效
            if (Math.abs(this.velocity.y) > 1) {
                SoundManager.getInstance().playHitImpact();
            }
        }
        
        // 障碍物碰撞检测
        this.checkObstacleCollision(oldPosition);
    }
    
    /**
     * 检测与障碍物的碰撞
     */
    private checkObstacleCollision(oldPosition: THREE.Vector3): void {
        const grenadeBox = new THREE.Box3();
        const radius = WeaponConfig.grenade.radius;
        grenadeBox.min.set(
            this.mesh.position.x - radius,
            this.mesh.position.y - radius,
            this.mesh.position.z - radius
        );
        grenadeBox.max.set(
            this.mesh.position.x + radius,
            this.mesh.position.y + radius,
            this.mesh.position.z + radius
        );
        
        for (const obj of this.collisionObjects) {
            const objBox = new THREE.Box3().setFromObject(obj);
            if (grenadeBox.intersectsBox(objBox)) {
                // 简单反弹
                this.mesh.position.copy(oldPosition);
                
                // 计算反弹方向 (简化处理)
                const center = new THREE.Vector3();
                objBox.getCenter(center);
                const bounceDir = this.mesh.position.clone().sub(center).normalize();
                
                const speed = this.velocity.length();
                this.velocity.copy(bounceDir).multiplyScalar(speed * this.bounceFactor);
                this.angularVelocity.multiplyScalar(0.5);
                
                // 播放碰撞音效
                if (speed > 2) {
                    SoundManager.getInstance().playHitImpact();
                }
                
                break;
            }
        }
    }

    /**
     * 爆炸
     */
    public explode(): void {
        if (this.isExploded) return;
        this.isExploded = true;
        this.isActive = false;
        
        const explosionPosition = this.mesh.position.clone();
        
        // 播放爆炸音效
        SoundManager.getInstance().playExplosion();
        
        // 使用高效的爆炸特效管理器
        if (this.explosionManager) {
            this.explosionManager.createExplosion(explosionPosition, 2.5);
        }
        
        // 只发射少量碎片粒子 (可选)
        if (this.particleSystem) {
            // 少量快速碎片
            this.particleSystem.emit({
                type: 'debris',
                position: explosionPosition,
                direction: new THREE.Vector3(0, 0.8, 0),
                spread: Math.PI,
                speed: { min: 15, max: 30 },
                lifetime: { min: 0.3, max: 0.8 },
                size: { start: 0.04, end: 0.02 },
                color: { 
                    start: new THREE.Color(0.4, 0.35, 0.3), 
                    end: new THREE.Color(0.2, 0.18, 0.15) 
                },
                gravity: -35,
                drag: 0.95,
                count: 8
            });
        }
        
        // 计算对敌人的伤害 (异步延迟执行避免卡顿)
        setTimeout(() => {
            this.applyExplosionDamage(explosionPosition);
            this.applyPlayerDamage(explosionPosition);
        }, 0);
        
        // 移除手榴弹模型
        this.scene.remove(this.mesh);
    }
    
    /**
     * 对敌人应用爆炸伤害
     */
    private applyExplosionDamage(explosionPosition: THREE.Vector3): void {
        for (const enemy of this.enemies) {
            if (enemy.isDead) continue;
            
            const distance = enemy.mesh.position.distanceTo(explosionPosition);
            if (distance < this.explosionRadius) {
                // 伤害随距离衰减
                const damageFactor = 1 - (distance / this.explosionRadius);
                const damage = Math.floor(this.explosionDamage * damageFactor * damageFactor);
                
                if (damage > 0) {
                    enemy.takeDamage(damage, explosionPosition);
                }
            }
        }
    }
    
    /**
     * 对玩家应用爆炸伤害 (自伤)
     */
    private applyPlayerDamage(explosionPosition: THREE.Vector3): void {
        const distance = this.playerPosition.distanceTo(explosionPosition);
        if (distance < this.explosionRadius) {
            // 伤害随距离衰减
            const damageFactor = 1 - (distance / this.explosionRadius);
            const damage = Math.floor(this.explosionDamage * damageFactor * 0.5);  // 自伤减半
            
            if (damage > 0) {
                GameStateService.getInstance().updateHealth(-damage);
            }
        }
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        this.mesh.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            }
        });
        this.scene.remove(this.mesh);
    }
}

/**
 * 手榴弹手部模型 - 用于投掷动画
 */
export class GrenadeHand {
    public mesh: THREE.Group;
    private camera: THREE.Camera;
    
    // 动画状态
    private isAnimating: boolean = false;
    private animationProgress: number = 0;
    private animationSpeed: number = 4.0;
    
    // 位置
    private restPosition = new THREE.Vector3(0.4, -0.4, -0.5);
    private throwPosition = new THREE.Vector3(0.2, 0.1, -0.3);
    
    // 回调
    private onThrowComplete: (() => void) | null = null;

    constructor(camera: THREE.Camera) {
        this.camera = camera;
        this.mesh = this.createHandWithGrenade();
        this.mesh.visible = false;
        camera.add(this.mesh);
    }
    
    /**
     * 创建持有手榴弹的手部模型
     */
    private createHandWithGrenade(): THREE.Group {
        const group = new THREE.Group();
        
        // 简单的手部模型
        const handGeo = new THREE.BoxGeometry(0.08, 0.12, 0.15);
        const handMaterial = new MeshStandardNodeMaterial({
            roughness: 0.8,
            metalness: 0.1
        });
        handMaterial.colorNode = vec3(0.85, 0.7, 0.6);  // 皮肤色
        const hand = new THREE.Mesh(handGeo, handMaterial);
        group.add(hand);
        
        // 手指
        const fingerGeo = new THREE.BoxGeometry(0.02, 0.08, 0.02);
        for (let i = 0; i < 4; i++) {
            const finger = new THREE.Mesh(fingerGeo, handMaterial);
            finger.position.set(-0.03 + i * 0.025, 0.08, 0);
            finger.rotation.x = -0.3;
            group.add(finger);
        }
        
        // 手榴弹 (简化版)
        const grenadeBody = new THREE.SphereGeometry(0.045, 8, 6);
        grenadeBody.scale(1, 1.3, 1);
        const grenadeMaterial = new MeshStandardNodeMaterial({
            roughness: 0.6,
            metalness: 0.3
        });
        grenadeMaterial.colorNode = vec3(0.25, 0.30, 0.18);
        const grenade = new THREE.Mesh(grenadeBody, grenadeMaterial);
        grenade.position.set(0, 0.12, 0);
        group.add(grenade);
        
        group.position.copy(this.restPosition);
        
        return group;
    }
    
    /**
     * 显示手部
     */
    public show(): void {
        this.mesh.visible = true;
        this.mesh.position.copy(this.restPosition);
        this.animationProgress = 0;
        this.isAnimating = false;
    }
    
    /**
     * 隐藏手部
     */
    public hide(): void {
        this.mesh.visible = false;
    }
    
    /**
     * 开始投掷动画
     */
    public startThrow(onComplete: () => void): void {
        if (this.isAnimating) return;
        
        this.isAnimating = true;
        this.animationProgress = 0;
        this.onThrowComplete = onComplete;
    }
    
    /**
     * 更新动画
     */
    public update(delta: number): void {
        if (!this.isAnimating) return;
        
        this.animationProgress += delta * this.animationSpeed;
        
        if (this.animationProgress < 0.5) {
            // 向后拉手 (准备投掷)
            const t = this.animationProgress * 2;
            this.mesh.position.lerpVectors(this.restPosition, this.throwPosition, t);
            this.mesh.rotation.x = -t * 0.5;
        } else if (this.animationProgress < 1.0) {
            // 向前投掷
            const t = (this.animationProgress - 0.5) * 2;
            const throwEndPos = new THREE.Vector3(0.3, -0.2, -0.8);
            this.mesh.position.lerpVectors(this.throwPosition, throwEndPos, t);
            this.mesh.rotation.x = -0.5 + t * 1.0;
            
            // 在投掷动作中间触发实际投掷
            if (this.animationProgress >= 0.7 && this.onThrowComplete) {
                const callback = this.onThrowComplete;
                this.onThrowComplete = null;
                callback();
            }
        } else {
            // 动画结束，恢复到休息位置
            this.isAnimating = false;
            this.mesh.position.copy(this.restPosition);
            this.mesh.rotation.x = 0;
        }
    }
    
    /**
     * 是否正在动画中
     */
    public isPlaying(): boolean {
        return this.isAnimating;
    }
    
    /**
     * 清理资源
     */
    public dispose(): void {
        this.camera.remove(this.mesh);
        this.mesh.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            }
        });
    }
}
