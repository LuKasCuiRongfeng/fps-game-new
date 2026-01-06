/**
 * Enemy - 使用 TSL 材质优化的敌人类
 * 结合 GPU Compute 进行高性能更新
 */
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { uniform, time, sin, cos, vec3, mix, float, smoothstep, uv } from 'three/tsl';
import { SoundManager } from './SoundManager';
import { Pathfinding } from './Pathfinding';
import { EnemyConfig } from './GameConfig';

export class Enemy {
    public mesh: THREE.Group;
    private speed: number = EnemyConfig.speed;
    private health: number = EnemyConfig.health;
    public isDead: boolean = false;
    
    // TSL Uniforms (使用 any 类型绕过 WebGPU 类型问题)
    private hitStrength: any;
    private dissolveAmount: any;
    
    // Pathfinding
    private currentPath: THREE.Vector3[] = [];
    private pathUpdateTimer: number = 0;
    private pathUpdateInterval: number = EnemyConfig.ai.pathUpdateInterval;
    
    // GPU Index (用于 GPU Compute 系统)
    public gpuIndex: number = -1;

    // 动画状态
    private walkCycle: number = 0;
    private originalY: number = 1;
    
    // 平滑转向
    private currentRotation: number = 0;  // 当前朝向角度
    private targetRotation: number = 0;   // 目标朝向角度
    private readonly rotationSpeed: number = EnemyConfig.rotationSpeed;  // 转向速度
    
    // 身体部件引用 (用于动画)
    private body!: THREE.Mesh;
    private head!: THREE.Mesh;
    private leftArm!: THREE.Group;
    private rightArm!: THREE.Group;
    private leftLeg!: THREE.Group;
    private rightLeg!: THREE.Group;
    private eyes!: THREE.Mesh;
    
    // 武器系统
    private weapon!: THREE.Group;
    private muzzleFlash!: THREE.Mesh;
    private muzzlePoint!: THREE.Object3D;
    
    // 射击参数
    private fireRate: number = EnemyConfig.attack.fireRate;
    private fireTimer: number = 0;
    private fireRange: number = EnemyConfig.attack.range;
    private fireDamage: number = EnemyConfig.attack.damage;
    private accuracy: number = EnemyConfig.attack.accuracy;
    private engageRange: number = EnemyConfig.attack.engageRange;
    private muzzleFlashDuration: number = EnemyConfig.attack.muzzleFlashDuration;
    private muzzleFlashTimer: number = 0;
    
    // 射击状态 (供外部读取)
    public lastShotHit: boolean = false;
    public lastShotDirection: THREE.Vector3 = new THREE.Vector3();
    
    // 射击姿态
    private isAiming: boolean = false;
    private aimProgress: number = 0;           // 0 = 放下, 1 = 完全抬起
    private aimSpeed: number = EnemyConfig.ai.aimSpeed;
    private aimHoldTime: number = 0;           // 瞄准保持时间
    private aimHoldDuration: number = EnemyConfig.ai.aimHoldDuration;
    private targetAimDirection: THREE.Vector3 = new THREE.Vector3();  // 瞄准方向

    constructor(position: THREE.Vector3) {
        // TSL Uniforms
        this.hitStrength = uniform(0);
        this.dissolveAmount = uniform(0);
        
        // 创建人形敌人
        this.mesh = this.createHumanoidEnemy();
        this.mesh.position.copy(position);
        this.mesh.position.y = 0;
        this.originalY = 0;
        
        this.mesh.userData = { isEnemy: true, entity: this };
    }

    /**
     * 创建人形敌人模型
     */
    private createHumanoidEnemy(): THREE.Group {
        const group = new THREE.Group();
        
        // 材质
        const bodyMaterial = this.createBodyMaterial();
        const headMaterial = this.createHeadMaterial();
        const eyeMaterial = this.createEyeMaterial();
        const armorMaterial = this.createArmorMaterial();
        
        // ========== 身体 (躯干) ==========
        const torsoGeo = new THREE.BoxGeometry(0.6, 0.8, 0.35);
        this.body = new THREE.Mesh(torsoGeo, armorMaterial);
        this.body.position.y = 1.2;
        this.body.castShadow = true;
        group.add(this.body);
        
        // 腹部
        const abdomenGeo = new THREE.BoxGeometry(0.5, 0.3, 0.3);
        const abdomen = new THREE.Mesh(abdomenGeo, bodyMaterial);
        abdomen.position.y = 0.7;
        abdomen.castShadow = true;
        group.add(abdomen);
        
        // 肩甲
        const shoulderGeo = new THREE.BoxGeometry(0.25, 0.15, 0.25);
        const leftShoulder = new THREE.Mesh(shoulderGeo, armorMaterial);
        leftShoulder.position.set(-0.45, 1.45, 0);
        leftShoulder.rotation.z = -0.2;
        leftShoulder.castShadow = true;
        group.add(leftShoulder);
        
        const rightShoulder = new THREE.Mesh(shoulderGeo, armorMaterial);
        rightShoulder.position.set(0.45, 1.45, 0);
        rightShoulder.rotation.z = 0.2;
        rightShoulder.castShadow = true;
        group.add(rightShoulder);
        
        // ========== 头部 ==========
        const headGroup = new THREE.Group();
        headGroup.position.y = 1.75;
        
        // 头部主体 (略扁的球体)
        const headGeo = new THREE.SphereGeometry(0.22, 12, 10);
        this.head = new THREE.Mesh(headGeo, headMaterial);
        this.head.scale.set(1, 1.1, 1);
        this.head.castShadow = true;
        headGroup.add(this.head);
        
        // 头盔/面罩
        const helmetGeo = new THREE.SphereGeometry(0.24, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6);
        const helmet = new THREE.Mesh(helmetGeo, armorMaterial);
        helmet.position.y = 0.05;
        helmet.castShadow = true;
        headGroup.add(helmet);
        
        // 眼睛 (发光)
        const eyeGeo = new THREE.SphereGeometry(0.04, 8, 6);
        this.eyes = new THREE.Mesh(eyeGeo, eyeMaterial);
        
        const leftEye = this.eyes.clone();
        leftEye.position.set(-0.08, 0, 0.18);
        headGroup.add(leftEye);
        
        const rightEye = this.eyes.clone();
        rightEye.position.set(0.08, 0, 0.18);
        headGroup.add(rightEye);
        
        // 面部护甲条
        const visorGeo = new THREE.BoxGeometry(0.3, 0.04, 0.08);
        const visor = new THREE.Mesh(visorGeo, armorMaterial);
        visor.position.set(0, -0.05, 0.18);
        headGroup.add(visor);
        
        group.add(headGroup);
        
        // ========== 手臂 ==========
        // 左臂
        this.leftArm = this.createArm(bodyMaterial, armorMaterial);
        this.leftArm.position.set(-0.45, 1.3, 0);
        group.add(this.leftArm);
        
        // 右臂
        this.rightArm = this.createArm(bodyMaterial, armorMaterial);
        this.rightArm.position.set(0.45, 1.3, 0);
        group.add(this.rightArm);
        
        // ========== 武器 ==========
        this.weapon = this.createWeapon();
        // 武器附着在右手上
        this.rightArm.add(this.weapon);
        this.weapon.position.set(0, -0.65, 0.2);
        this.weapon.rotation.x = -Math.PI / 2;
        
        // ========== 腿部 ==========
        // 左腿
        this.leftLeg = this.createLeg(bodyMaterial, armorMaterial);
        this.leftLeg.position.set(-0.15, 0.55, 0);
        group.add(this.leftLeg);
        
        // 右腿
        this.rightLeg = this.createLeg(bodyMaterial, armorMaterial);
        this.rightLeg.position.set(0.15, 0.55, 0);
        group.add(this.rightLeg);
        
        // 设置所有子对象的 userData
        group.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.userData = { isEnemy: true, entity: this };
                child.receiveShadow = true;
            }
        });
        
        return group;
    }
    
    /**
     * 创建手臂
     */
    private createArm(bodyMaterial: THREE.Material, armorMaterial: THREE.Material): THREE.Group {
        const arm = new THREE.Group();
        
        // 上臂
        const upperArmGeo = new THREE.CapsuleGeometry(0.08, 0.25, 4, 8);
        const upperArm = new THREE.Mesh(upperArmGeo, bodyMaterial);
        upperArm.position.y = -0.2;
        upperArm.castShadow = true;
        arm.add(upperArm);
        
        // 护臂
        const bracerGeo = new THREE.CylinderGeometry(0.09, 0.1, 0.15, 8);
        const bracer = new THREE.Mesh(bracerGeo, armorMaterial);
        bracer.position.y = -0.2;
        bracer.castShadow = true;
        arm.add(bracer);
        
        // 前臂
        const forearmGeo = new THREE.CapsuleGeometry(0.06, 0.22, 4, 8);
        const forearm = new THREE.Mesh(forearmGeo, bodyMaterial);
        forearm.position.y = -0.5;
        forearm.castShadow = true;
        arm.add(forearm);
        
        // 手
        const handGeo = new THREE.SphereGeometry(0.06, 6, 6);
        const hand = new THREE.Mesh(handGeo, bodyMaterial);
        hand.position.y = -0.7;
        hand.castShadow = true;
        arm.add(hand);
        
        return arm;
    }
    
    /**
     * 创建腿部
     */
    private createLeg(bodyMaterial: THREE.Material, armorMaterial: THREE.Material): THREE.Group {
        const leg = new THREE.Group();
        
        // 大腿
        const thighGeo = new THREE.CapsuleGeometry(0.1, 0.28, 4, 8);
        const thigh = new THREE.Mesh(thighGeo, bodyMaterial);
        thigh.position.y = -0.2;
        thigh.castShadow = true;
        leg.add(thigh);
        
        // 大腿护甲
        const thighArmorGeo = new THREE.CylinderGeometry(0.11, 0.12, 0.2, 8);
        const thighArmor = new THREE.Mesh(thighArmorGeo, armorMaterial);
        thighArmor.position.y = -0.15;
        thighArmor.castShadow = true;
        leg.add(thighArmor);
        
        // 小腿
        const shinGeo = new THREE.CapsuleGeometry(0.07, 0.3, 4, 8);
        const shin = new THREE.Mesh(shinGeo, bodyMaterial);
        shin.position.y = -0.55;
        shin.castShadow = true;
        leg.add(shin);
        
        // 小腿护甲
        const shinArmorGeo = new THREE.BoxGeometry(0.1, 0.25, 0.12);
        const shinArmor = new THREE.Mesh(shinArmorGeo, armorMaterial);
        shinArmor.position.set(0, -0.5, 0.04);
        shinArmor.castShadow = true;
        leg.add(shinArmor);
        
        // 靴子
        const bootGeo = new THREE.BoxGeometry(0.12, 0.1, 0.2);
        const boot = new THREE.Mesh(bootGeo, armorMaterial);
        boot.position.set(0, -0.8, 0.03);
        boot.castShadow = true;
        leg.add(boot);
        
        return leg;
    }
    
    /**
     * 创建敌人武器 - 突击步枪
     */
    private createWeapon(): THREE.Group {
        const weapon = new THREE.Group();
        
        const gunMaterial = this.createGunMaterial();
        const metalMaterial = this.createGunMetalMaterial();
        
        // 枪身主体
        const bodyGeo = new THREE.BoxGeometry(0.06, 0.08, 0.5);
        const body = new THREE.Mesh(bodyGeo, gunMaterial);
        body.position.z = 0.1;
        weapon.add(body);
        
        // 枪管
        const barrelGeo = new THREE.CylinderGeometry(0.015, 0.018, 0.35, 8);
        const barrel = new THREE.Mesh(barrelGeo, metalMaterial);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.z = 0.5;
        weapon.add(barrel);
        
        // 弹匣
        const magGeo = new THREE.BoxGeometry(0.04, 0.15, 0.06);
        const mag = new THREE.Mesh(magGeo, gunMaterial);
        mag.position.set(0, -0.1, 0.05);
        weapon.add(mag);
        
        // 枪托
        const stockGeo = new THREE.BoxGeometry(0.05, 0.06, 0.15);
        const stock = new THREE.Mesh(stockGeo, gunMaterial);
        stock.position.z = -0.2;
        weapon.add(stock);
        
        // 握把
        const gripGeo = new THREE.BoxGeometry(0.04, 0.1, 0.04);
        const grip = new THREE.Mesh(gripGeo, gunMaterial);
        grip.position.set(0, -0.08, 0);
        grip.rotation.x = 0.2;
        weapon.add(grip);
        
        // 瞄准镜
        const scopeGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.08, 8);
        const scope = new THREE.Mesh(scopeGeo, metalMaterial);
        scope.rotation.x = Math.PI / 2;
        scope.position.set(0, 0.06, 0.15);
        weapon.add(scope);
        
        // 枪口闪光 (初始隐藏)
        this.muzzleFlash = this.createMuzzleFlash();
        this.muzzleFlash.position.z = 0.7;
        this.muzzleFlash.visible = false;
        weapon.add(this.muzzleFlash);
        
        // 枪口位置点 (用于计算射击方向)
        this.muzzlePoint = new THREE.Object3D();
        this.muzzlePoint.position.z = 0.7;
        weapon.add(this.muzzlePoint);
        
        // 设置所有子对象
        weapon.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.userData = { isEnemyWeapon: true };
            }
        });
        
        return weapon;
    }
    
    /**
     * 枪械材质 - 黑色塑料/聚合物
     */
    private createGunMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.6,
            metalness: 0.2
        });
        
        const baseColor = vec3(0.08, 0.08, 0.1);
        material.colorNode = baseColor;
        
        return material;
    }
    
    /**
     * 枪械金属材质
     */
    private createGunMetalMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.3,
            metalness: 0.9
        });
        
        const metalColor = vec3(0.2, 0.2, 0.22);
        material.colorNode = metalColor;
        
        return material;
    }
    
    /**
     * 创建枪口闪光
     */
    private createMuzzleFlash(): THREE.Mesh {
        const flashMaterial = new MeshStandardNodeMaterial({
            transparent: true,
            depthWrite: false
        });
        
        const t = time;
        const flashColor = vec3(1.0, 0.8, 0.3);
        const pulse = sin(t.mul(50)).mul(0.3).add(0.7);
        
        flashMaterial.colorNode = flashColor;
        flashMaterial.emissiveNode = flashColor.mul(pulse).mul(3);
        flashMaterial.opacityNode = float(0.9);
        
        const flashGeo = new THREE.SphereGeometry(0.08, 8, 6);
        const flash = new THREE.Mesh(flashGeo, flashMaterial);
        flash.scale.set(1, 1, 2);
        
        return flash;
    }
    
    /**
     * 身体材质 - 深色紧身衣
     */
    private createBodyMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.7,
            metalness: 0.1
        });
        
        const t = time;
        
        // 深灰蓝色基础
        const baseColor = vec3(0.15, 0.18, 0.25);
        const darkColor = vec3(0.08, 0.1, 0.15);
        
        // 受击闪烁 - 白色
        const hitColor = vec3(1, 1, 1);
        const finalColor = mix(baseColor, hitColor, this.hitStrength);
        
        material.colorNode = finalColor;
        
        return material;
    }
    
    /**
     * 头部材质
     */
    private createHeadMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.6,
            metalness: 0.2
        });
        
        // 灰绿色皮肤 (异星人感)
        const skinColor = vec3(0.35, 0.4, 0.38);
        const hitColor = vec3(1, 1, 1);
        const finalColor = mix(skinColor, hitColor, this.hitStrength);
        
        material.colorNode = finalColor;
        
        return material;
    }
    
    /**
     * 眼睛材质 - 发光黄眼
     */
    private createEyeMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.2,
            metalness: 0.5
        });
        
        const t = time;
        
        // 黄色发光眼睛 (更易区分)
        const eyeColor = vec3(1.0, 0.8, 0.1);
        
        // 脉动
        const pulse = sin(t.mul(4)).mul(0.2).add(0.8);
        
        material.colorNode = eyeColor.mul(pulse);
        material.emissiveNode = eyeColor.mul(pulse).mul(2);
        
        return material;
    }
    
    /**
     * 护甲材质 - 金属质感深蓝/黑色装甲
     */
    private createArmorMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.35,
            metalness: 0.85
        });
        
        const t = time;
        
        // 深蓝色装甲
        const armorColor = vec3(0.08, 0.12, 0.25);
        const darkArmor = vec3(0.02, 0.04, 0.1);
        const highlightArmor = vec3(0.15, 0.25, 0.5);
        
        // 脉动效果
        const pulse = sin(t.mul(3)).mul(0.1).add(0.9);
        const pulsedColor = mix(armorColor, highlightArmor, pulse.sub(0.9).mul(2));
        
        // 受击效果 - 白色闪烁
        const hitColor = vec3(1, 1, 1);
        const finalColor = mix(pulsedColor, hitColor, this.hitStrength);
        
        material.colorNode = finalColor;
        
        // 自发光效果 - 淡蓝色
        const emissiveColor = vec3(0.05, 0.1, 0.2);
        material.emissiveNode = mix(emissiveColor.mul(pulse), vec3(0.8, 0.9, 1.0), this.hitStrength);
        
        // 受击时更亮
        material.metalnessNode = mix(float(0.85), float(1.0), this.hitStrength);
        
        return material;
    }

    public update(
        playerPosition: THREE.Vector3, 
        delta: number, 
        obstacles: THREE.Object3D[], 
        pathfinding: Pathfinding
    ): { fired: boolean; hit: boolean; damage: number } {
        const result = { fired: false, hit: false, damage: 0 };
        
        if (this.isDead) {
            // 死亡溶解动画
            this.dissolveAmount.value = Math.min(1, this.dissolveAmount.value + delta * 2);
            return result;
        }
        
        // 更新枪口闪光计时器
        if (this.muzzleFlashTimer > 0) {
            this.muzzleFlashTimer -= delta;
            if (this.muzzleFlashTimer <= 0) {
                this.muzzleFlash.visible = false;
            }
        }

        // 计算到玩家的距离和方向
        const toPlayer = new THREE.Vector3().subVectors(playerPosition, this.mesh.position);
        const distanceToPlayer = toPlayer.length();
        toPlayer.normalize();
        
        // 射击逻辑
        this.fireTimer += delta;
        
        // 更新瞄准保持计时
        if (this.aimHoldTime > 0) {
            this.aimHoldTime -= delta;
            if (this.aimHoldTime <= 0) {
                this.isAiming = false;
            }
        }
        
        // 检查是否应该瞄准/射击
        if (distanceToPlayer <= this.engageRange && this.canSeePlayer(playerPosition, obstacles)) {
            // 计算瞄准方向
            this.targetAimDirection.subVectors(playerPosition, this.mesh.position);
            this.targetAimDirection.y = playerPosition.y + 0.8 - (this.mesh.position.y + 1.3); // 瞄准玩家躯干
            this.targetAimDirection.normalize();
            
            // 开始瞄准
            this.isAiming = true;
            this.aimHoldTime = this.aimHoldDuration;
            
            // 射击 (需要瞄准到一定程度才能射击)
            if (this.fireTimer >= 1 / this.fireRate && this.aimProgress > 0.7) {
                const shotResult = this.fireAtPlayer(playerPosition, obstacles);
                result.fired = true;
                result.hit = shotResult.hit;
                result.damage = shotResult.damage;
                this.fireTimer = 0;
            }
        }

        // 行走动画
        this.walkCycle += delta * this.speed * 2;
        this.updateWalkAnimation();
        
        // 更新路径
        this.pathUpdateTimer += delta;
        if (this.pathUpdateTimer >= this.pathUpdateInterval) {
            this.pathUpdateTimer = 0;
            this.currentPath = pathfinding.findPath(this.mesh.position, playerPosition);
        }

        let targetPos = playerPosition;
        
        // 跟随路径
        if (this.currentPath.length > 0) {
            const nextPoint = this.currentPath[0];
            const dist = new THREE.Vector2(this.mesh.position.x, this.mesh.position.z)
                .distanceTo(new THREE.Vector2(nextPoint.x, nextPoint.z));
                
            if (dist < 0.5) {
                this.currentPath.shift();
                if (this.currentPath.length > 0) {
                    targetPos = this.currentPath[0];
                }
            } else {
                targetPos = nextPoint;
            }
        }

        // 移动计算
        const direction = new THREE.Vector3()
            .subVectors(targetPos, this.mesh.position);
        direction.y = 0;
        direction.normalize();

        const moveDistance = this.speed * delta;

        // X 轴移动
        const nextPosX = this.mesh.position.clone();
        nextPosX.x += direction.x * moveDistance;
        
        let collisionBox = this.checkCollisions(nextPosX, obstacles, false);
        if (!collisionBox) {
            this.mesh.position.x = nextPosX.x;
        } else {
            this.handleObstacle(collisionBox, direction.x * moveDistance, 0);
        }

        // Z 轴移动
        const nextPosZ = this.mesh.position.clone();
        nextPosZ.z += direction.z * moveDistance;
        
        collisionBox = this.checkCollisions(nextPosZ, obstacles, false);
        if (!collisionBox) {
            this.mesh.position.z = nextPosZ.z;
        } else {
            this.handleObstacle(collisionBox, 0, direction.z * moveDistance);
        }

        // 检查脚下的地面/楼梯高度
        const targetGroundY = this.findGroundHeight(this.mesh.position, obstacles);
        
        // 平滑调整高度（用于上下楼梯）
        const heightDiff = targetGroundY - this.mesh.position.y;
        if (Math.abs(heightDiff) > 0.01) {
            // 上楼梯时快速调整，下楼梯时受重力影响
            if (heightDiff > 0) {
                // 上楼梯 - 快速抬升
                this.mesh.position.y += Math.min(heightDiff, 8 * delta);
            } else {
                // 下楼梯/重力 - 正常下降
                this.mesh.position.y += Math.max(heightDiff, -9.8 * delta);
            }
        }
        
        // 确保不低于地面
        this.mesh.position.y = Math.max(0, this.mesh.position.y);

        // 计算目标朝向
        if (this.isAiming) {
            // 瞄准时朝向玩家
            const toPlayerDir = new THREE.Vector3().subVectors(playerPosition, this.mesh.position);
            toPlayerDir.y = 0;
            if (toPlayerDir.lengthSq() > 0.001) {
                this.targetRotation = Math.atan2(toPlayerDir.x, toPlayerDir.z);
            }
        } else if (direction.lengthSq() > 0.001) {
            // 非瞄准时朝向移动方向
            this.targetRotation = Math.atan2(direction.x, direction.z);
        }
        
        // 平滑转向 - 计算最短旋转距离
        let rotationDiff = this.targetRotation - this.currentRotation;
        
        // 角度归一化到 -PI 到 PI
        while (rotationDiff > Math.PI) rotationDiff -= Math.PI * 2;
        while (rotationDiff < -Math.PI) rotationDiff += Math.PI * 2;
        
        // 平滑插值转向
        this.currentRotation += rotationDiff * Math.min(1, this.rotationSpeed * delta);
        
        // 角度归一化
        while (this.currentRotation > Math.PI) this.currentRotation -= Math.PI * 2;
        while (this.currentRotation < -Math.PI) this.currentRotation += Math.PI * 2;
        
        // 应用旋转
        this.mesh.rotation.y = this.currentRotation;
        
        return result;
    }
    
    /**
     * 检查是否能看到玩家 (视线检测)
     */
    private canSeePlayer(playerPosition: THREE.Vector3, obstacles: THREE.Object3D[]): boolean {
        const eyePosition = this.mesh.position.clone();
        eyePosition.y += 1.7; // 眼睛高度
        
        const direction = new THREE.Vector3().subVectors(playerPosition, eyePosition);
        const distance = direction.length();
        direction.normalize();
        
        const raycaster = new THREE.Raycaster(eyePosition, direction, 0, distance);
        
        // 过滤可遮挡的障碍物
        const blockingObjects = obstacles.filter(obj => {
            return obj instanceof THREE.Mesh && 
                   !obj.userData.isEnemy && 
                   !obj.userData.isGround &&
                   !obj.userData.isWayPoint &&
                   !obj.userData.isDust;
        });
        
        const intersects = raycaster.intersectObjects(blockingObjects, true);
        
        // 如果没有障碍物遮挡，可以看到玩家
        return intersects.length === 0;
    }
    
    /**
     * 向玩家射击
     */
    private fireAtPlayer(playerPosition: THREE.Vector3, obstacles: THREE.Object3D[]): { hit: boolean; damage: number } {
        // 显示枪口闪光
        this.muzzleFlash.visible = true;
        this.muzzleFlashTimer = this.muzzleFlashDuration;
        
        // 播放射击音效
        SoundManager.getInstance().playShoot();
        
        // 计算射击方向 (带散布)
        // 确保矩阵更新，获取正确的枪口世界坐标
        this.mesh.updateMatrixWorld(true);
        const muzzleWorldPos = new THREE.Vector3();
        this.muzzlePoint.getWorldPosition(muzzleWorldPos);
        
        // 玩家躯干位置 (稍微降低目标点)
        const targetPos = playerPosition.clone();
        targetPos.y += EnemyConfig.collision.targetHeightOffset; // 瞄准躯干
        
        const direction = new THREE.Vector3().subVectors(targetPos, muzzleWorldPos);
        direction.normalize();
        
        // 保存射击方向 (供外部使用，如弹道效果)
        this.lastShotDirection.copy(direction);
        
        // 命中判定 (基于准确度)
        const hitRoll = Math.random();
        const distanceToPlayer = this.mesh.position.distanceTo(playerPosition);
        
        // 距离影响命中率
        const distanceFactor = Math.max(0.5, 1 - (distanceToPlayer / this.fireRange) * 0.3);
        const effectiveAccuracy = this.accuracy * distanceFactor;
        
        if (hitRoll <= effectiveAccuracy) {
            this.lastShotHit = true;
            return { hit: true, damage: this.fireDamage };
        } else {
            this.lastShotHit = false;
            return { hit: false, damage: 0 };
        }
    }
    
    /**
     * 获取枪口世界坐标 (供外部使用绘制弹道)
     */
    public getMuzzleWorldPosition(): THREE.Vector3 {
        // 确保矩阵已更新
        this.mesh.updateMatrixWorld(true);
        
        const pos = new THREE.Vector3();
        this.muzzlePoint.getWorldPosition(pos);
        return pos;
    }
    
    /**
     * 更新行走和射击动画
     */
    private updateWalkAnimation() {
        const cycle = this.walkCycle;
        
        // 更新瞄准进度
        if (this.isAiming) {
            this.aimProgress = Math.min(1, this.aimProgress + this.aimSpeed * 0.016);
        } else {
            this.aimProgress = Math.max(0, this.aimProgress - this.aimSpeed * 0.5 * 0.016);
        }
        
        // 身体上下弹跳 (瞄准时减少)
        const bobAmount = Math.sin(cycle * 2) * 0.03 * (1 - this.aimProgress * 0.7);
        this.body.position.y = 1.2 + bobAmount;
        
        // 身体左右摇摆 (瞄准时减少)
        const swayAmount = Math.sin(cycle) * 0.03 * (1 - this.aimProgress * 0.8);
        this.body.rotation.z = swayAmount;
        
        // ========== 手臂动画 ==========
        // 行走时的手臂摆动
        const walkArmSwing = Math.sin(cycle) * 0.5 * (1 - this.aimProgress);
        
        // 瞄准时的手臂姿态
        // 计算抬枪角度 (基于目标方向)
        let aimPitch = 0;
        if (this.aimProgress > 0) {
            // 计算垂直瞄准角度
            aimPitch = Math.asin(Math.max(-0.5, Math.min(0.5, this.targetAimDirection.y)));
        }
        
        // 右臂 (持枪手) - 抬起瞄准
        const rightArmBaseX = -Math.PI / 2 - 0.3; // 抬枪基础角度 (向前平举)
        const rightArmAimX = rightArmBaseX + aimPitch * 0.5; // 加上俯仰调整
        this.rightArm.rotation.x = walkArmSwing * (1 - this.aimProgress) + rightArmAimX * this.aimProgress;
        this.rightArm.rotation.z = -0.1 * (1 - this.aimProgress) + (-0.3) * this.aimProgress; // 手臂内收
        this.rightArm.rotation.y = 0.2 * this.aimProgress; // 手臂向前
        
        // 左臂 - 辅助握枪
        const leftArmBaseX = -Math.PI / 2 - 0.1; // 辅助手抬起角度
        this.leftArm.rotation.x = walkArmSwing + (leftArmBaseX - walkArmSwing) * this.aimProgress;
        this.leftArm.rotation.z = 0.1 * (1 - this.aimProgress) + 0.4 * this.aimProgress; // 手臂外展握护木
        this.leftArm.rotation.y = -0.3 * this.aimProgress; // 向前伸
        
        // 腿部摆动 (瞄准时减少)
        const legSwing = Math.sin(cycle) * 0.6 * (1 - this.aimProgress * 0.5);
        this.leftLeg.rotation.x = -legSwing;
        this.rightLeg.rotation.x = legSwing;
    }

    /**
     * 找到指定位置下方的地面高度
     */
    private findGroundHeight(position: THREE.Vector3, obstacles: THREE.Object3D[]): number {
        let groundY = 0; // 默认地面高度
        const checkRadius = EnemyConfig.collision.radius;
        
        for (const object of obstacles) {
            if (object.userData.isGround) continue;
            if (object.userData.isWayPoint) continue;
            
            const objectBox = new THREE.Box3().setFromObject(object);
            
            // 检查是否在该物体的XZ范围内
            if (position.x >= objectBox.min.x - checkRadius &&
                position.x <= objectBox.max.x + checkRadius &&
                position.z >= objectBox.min.z - checkRadius &&
                position.z <= objectBox.max.z + checkRadius) {
                
                // 如果物体顶部在敌人脚下附近（可以站上去）
                const feetY = position.y - EnemyConfig.collision.height;
                if (objectBox.max.y > groundY && objectBox.max.y <= feetY + EnemyConfig.collision.maxStepHeight) {
                    groundY = objectBox.max.y;
                }
            }
        }
        
        return groundY;
    }

    private handleObstacle(obstacleBox: THREE.Box3, dx: number, dz: number) {
        const enemyFeetY = this.mesh.position.y - EnemyConfig.collision.height;
        const obstacleTopY = obstacleBox.max.y;
        const stepHeight = obstacleTopY - enemyFeetY;

        if (stepHeight > 0 && stepHeight <= EnemyConfig.collision.maxStepHeight * 3) {
            this.mesh.position.y = obstacleTopY + EnemyConfig.collision.height + 0.01;
            
            const len = Math.sqrt(dx * dx + dz * dz);
            if (len > 0.0001) {
                const scale = 0.3 / len;
                this.mesh.position.x += dx + (dx * scale);
                this.mesh.position.z += dz + (dz * scale);
            } else {
                this.mesh.position.x += dx;
                this.mesh.position.z += dz;
            }
        }
    }

    private checkCollisions(
        position: THREE.Vector3, 
        obstacles: THREE.Object3D[], 
        isGroundCheck: boolean = false
    ): THREE.Box3 | null {
        const enemyRadius = EnemyConfig.collision.radius;
        const enemyBox = new THREE.Box3();
        const skinWidth = isGroundCheck ? 0.0 : EnemyConfig.collision.skinWidth;
        const maxStepHeight = EnemyConfig.collision.maxStepHeight;

        enemyBox.min.set(
            position.x - enemyRadius, 
            position.y - EnemyConfig.collision.height + skinWidth, 
            position.z - enemyRadius
        );
        enemyBox.max.set(
            position.x + enemyRadius, 
            position.y + EnemyConfig.collision.height, 
            position.z + enemyRadius
        );

        for (const object of obstacles) {
            if (object.userData.isGround) continue;
            if (object.userData.isWayPoint) continue;

            const objectBox = new THREE.Box3().setFromObject(object);
            if (enemyBox.intersectsBox(objectBox)) {
                // 如果是楼梯，检查是否可以跨越
                if (object.userData.isStair) {
                    const enemyFeetY = position.y - EnemyConfig.collision.height;
                    const stepHeight = objectBox.max.y - enemyFeetY;
                    
                    // 如果台阶高度可跨越，不视为碰撞，让敌人可以走上去
                    if (stepHeight > 0 && stepHeight <= maxStepHeight) {
                        continue; // 跳过这个碰撞，允许敌人走上去
                    }
                }
                return objectBox;
            }
        }
        return null;
    }

    public takeDamage(amount: number) {
        if (this.isDead) return;

        this.health -= amount;
        
        // 受击闪烁 - 使用 TSL uniform
        this.hitStrength.value = 1;
        
        // 击退效果
        const knockback = new THREE.Vector3(
            (Math.random() - 0.5) * 0.3,
            0.1,
            (Math.random() - 0.5) * 0.3
        );
        this.mesh.position.add(knockback);

        // 延迟恢复
        setTimeout(() => {
            if (!this.isDead) {
                // 渐变恢复
                const fadeOut = () => {
                    if (this.hitStrength.value > 0.01) {
                        this.hitStrength.value *= 0.8;
                        requestAnimationFrame(fadeOut);
                    } else {
                        this.hitStrength.value = 0;
                    }
                };
                fadeOut();
            }
        }, 80);

        if (this.health <= 0) {
            this.die();
        }
    }

    private die() {
        this.isDead = true;
        this.hitStrength.value = 0.5; // 死亡时保持一定亮度
        SoundManager.getInstance().playEnemyDeath();
        
        // 死亡动画 - 缩小消失
        const shrinkAnimation = () => {
            if (this.mesh.scale.x > 0.01) {
                this.mesh.scale.multiplyScalar(0.92);
                this.mesh.position.y -= 0.02;
                this.mesh.rotation.y += 0.1;
                requestAnimationFrame(shrinkAnimation);
            } else {
                this.mesh.visible = false;
            }
        };
        shrinkAnimation();
    }

    public dispose() {
        // 遍历所有子对象并销毁几何体和材质
        this.mesh.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (child.geometry) {
                    child.geometry.dispose();
                }
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
