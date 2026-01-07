/**
 * Enemy - 使用 TSL 材质优化的敌人类
 * 结合 GPU Compute 进行高性能更新
 */
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { uniform, time, sin, cos, vec3, mix, float, smoothstep, uv } from 'three/tsl';
import { SoundManager } from './SoundManager';
import { Pathfinding } from './Pathfinding';
import { EnemyConfig, EnemyType, EnemyTypesConfig } from './GameConfig';
import { PhysicsSystem } from './PhysicsSystem';
import { EnemyFactory } from './enemy/EnemyFactory';

export class Enemy {
    public mesh: THREE.Group;
    public type: EnemyType;
    private config: any; // 当前类型的配置

    private speed: number;
    private health: number;
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
    private headDetails!: THREE.Group; // LOD 优化: 头部细节组
    
    // 武器系统
    private weapon!: THREE.Group;
    private muzzleFlash!: THREE.Mesh;
    private muzzlePoint!: THREE.Object3D;
    
    // 射击参数
    private fireRate: number;
    private fireTimer: number = 0;
    private fireRange: number;
    private fireDamage: number;
    private accuracy: number;
    private engageRange: number;
    private muzzleFlashDuration: number = EnemyConfig.attack.muzzleFlashDuration;
    private muzzleFlashTimer: number = 0;
    
    // 射击状态 (供外部读取)
    public lastShotHit: boolean = false;
    public lastShotDirection: THREE.Vector3 = new THREE.Vector3();
    
    // 视线检测优化
    private visibilityCheckTimer: number = 0;
    private isPlayerVisible: boolean = false;
    private readonly VISIBILITY_CHECK_INTERVAL: number = 0.25; // 每秒检测4次
    
    // 射击姿态
    private isAiming: boolean = false;
    private aimProgress: number = 0;           // 0 = 放下, 1 = 完全抬起
    private aimSpeed: number;
    private aimHoldTime: number = 0;           // 瞄准保持时间
    private aimHoldDuration: number = EnemyConfig.ai.aimHoldDuration;
    private targetAimDirection: THREE.Vector3 = new THREE.Vector3();  // 瞄准方向
    
    // 地形高度回调
    public onGetGroundHeight: ((x: number, z: number) => number) | null = null;
    
    // 物理系统引用
    private physicsSystem: PhysicsSystem | null = null;
    


    constructor(position: THREE.Vector3, type: EnemyType = 'soldier') {
        this.type = type;
        this.config = EnemyTypesConfig[type];

        // 初始化属性
        this.speed = this.config.speed;
        this.health = this.config.health;
        
        this.fireRate = this.config.attack.fireRate;
        this.fireRange = this.config.attack.range;
        this.fireDamage = this.config.attack.damage;
        this.accuracy = this.config.attack.accuracy;
        this.engageRange = this.config.attack.engageRange;
        this.aimSpeed = this.config.ai.aimSpeed;

        // TSL Uniforms
        this.hitStrength = uniform(0);
        this.dissolveAmount = uniform(0);
        
        // 创建人形敌人 (使用工厂模式)
        const assets = EnemyFactory.createHumanoidEnemy(this.type, this.hitStrength);
        this.mesh = assets.group;
        this.body = assets.body;
        this.head = assets.head;
        this.leftArm = assets.leftArm;
        this.rightArm = assets.rightArm;
        this.leftLeg = assets.leftLeg;
        this.rightLeg = assets.rightLeg;
        this.eyes = assets.eyes;
        this.headDetails = assets.headDetails;
        this.weapon = assets.weapon;
        this.muzzlePoint = assets.muzzlePoint;
        this.muzzleFlash = assets.muzzleFlash;
        
        this.mesh.position.copy(position);
        this.mesh.position.y = 0;
        this.originalY = 0;
        
        // 设置实体引用
        this.mesh.userData = { isEnemy: true, entity: this };
        this.mesh.traverse((child) => {
            if (child.userData && child.userData.isEnemy) {
                child.userData.entity = this;
            }
        });

        // 应用缩放
        if (this.config.scale !== 1) {
            this.mesh.scale.setScalar(this.config.scale);
        }
    }

    public setPhysicsSystem(system: PhysicsSystem) {
        this.physicsSystem = system;
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
        
        // 性能优化: LOD 处理
        // 如果距离较远，隐藏细节部件
        if (distanceToPlayer > 30) {
             this.headDetails.visible = false;
        } else {
             this.headDetails.visible = true;
        }
        
        // 射击逻辑
        this.fireTimer += delta;
        
        // 更新瞄准保持计时
        if (this.aimHoldTime > 0) {
            this.aimHoldTime -= delta;
            if (this.aimHoldTime <= 0) {
                this.isAiming = false;
            }
        }
        
        // 优化视线检测频率
        this.visibilityCheckTimer -= delta;
        if (this.visibilityCheckTimer <= 0) {
             this.visibilityCheckTimer = this.VISIBILITY_CHECK_INTERVAL + Math.random() * 0.1; // 随机化避免尖峰
             
             // 只有在攻击距离内才检测视线
             if (distanceToPlayer <= this.engageRange) {
                 this.isPlayerVisible = this.canSeePlayer(playerPosition);
             } else {
                 this.isPlayerVisible = false;
             }
        }
        
        // 检查是否应该瞄准/射击
        if (this.isPlayerVisible) {
            // 计算瞄准方向
            this.targetAimDirection.subVectors(playerPosition, this.mesh.position);
            this.targetAimDirection.y = playerPosition.y + 0.8 - (this.mesh.position.y + 1.3); // 瞄准玩家躯干
            this.targetAimDirection.normalize();
            
            // 开始瞄准
            this.isAiming = true;
            this.aimHoldTime = this.aimHoldDuration;
            
            // 射击 (需要瞄准到一定程度才能射击)
            if (this.fireTimer >= 1 / this.fireRate && this.aimProgress > 0.7) {
                // 这里不需要再次传递 obstacles，因为 fireAtPlayer 不需要做碰撞检测 (基于概率)
                const shotResult = this.fireAtPlayer(playerPosition);
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
        
        // 确保不低于地面 (修正起伏地形上的位置)
        // 允许少许误差，但不能低于地面太多
        if (this.mesh.position.y < targetGroundY) {
            this.mesh.position.y = targetGroundY;
        }

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
     * 优化：使用 PhysicsSystem 网格遍历，避免检测全场景
     */
    private canSeePlayer(playerPosition: THREE.Vector3): boolean {
        const eyePosition = this.mesh.position.clone();
        eyePosition.y += 1.7; // 眼睛高度
        
        const direction = new THREE.Vector3().subVectors(playerPosition, eyePosition);
        const distance = direction.length();
        direction.normalize();
        
        const raycaster = new THREE.Raycaster(eyePosition, direction, 0, distance);
        
        // 1. 使用 PhysicsSystem 获取候选物体 (Broad Phase)
        // 如果没有 PhysicsSystem，则无法检测遮挡 (默认可见)
        if (!this.physicsSystem) return true;
        
        const candidates = this.physicsSystem.getRaycastCandidates(eyePosition, direction, distance);
        
        // 2. 精确检测 (Raycast)
        // 不需要过滤 blockedObjects，因为 PhysicsSystem 只包含静态障碍物
        const intersects = raycaster.intersectObjects(candidates, true);
        
        // 如果没有障碍物遮挡，可以看到玩家
        return intersects.length === 0;
    }
    
    /**
     * 向玩家射击
     */
    private fireAtPlayer(playerPosition: THREE.Vector3): { hit: boolean; damage: number } {
        // 显示枪口闪光
        this.muzzleFlash.visible = true;
        this.muzzleFlashTimer = this.muzzleFlashDuration;
        
        // 播放射击音效
        SoundManager.getInstance().playShoot();
        
        // 计算射击方向 (带散布)
        // 优化: 不强制更新整个矩阵树，接受一帧的延迟或使用上一帧的矩阵
        // this.mesh.updateMatrixWorld(true);
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
        if (this.onGetGroundHeight) {
            groundY = this.onGetGroundHeight(position.x, position.z);
        }
        
        const checkRadius = EnemyConfig.collision.radius;
        const feetY = position.y - EnemyConfig.collision.height;
        
        // 优化：优先使用物理系统
        if (this.physicsSystem) {
            const nearbyEntries = this.physicsSystem.getNearbyObjects(position, 5.0);
            for (const entry of nearbyEntries) {
                // box 已经是世界坐标
                 if (position.x >= entry.box.min.x - checkRadius &&
                    position.x <= entry.box.max.x + checkRadius &&
                    position.z >= entry.box.min.z - checkRadius &&
                    position.z <= entry.box.max.z + checkRadius) {
                    
                    if (entry.box.max.y > groundY && entry.box.max.y <= feetY + EnemyConfig.collision.maxStepHeight) {
                        groundY = entry.box.max.y;
                    }
                }
            }
            return groundY;
        }

        // 降级：遍历所有障碍物
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

        // 优化：优先使用物理系统 (Spatial Grid)
        if (this.physicsSystem) {
            const nearbyEntries = this.physicsSystem.getNearbyObjects(position, 5.0);
            for (const entry of nearbyEntries) {
                // entry.box 已经是世界坐标 AABB
                if (enemyBox.intersectsBox(entry.box)) {
                    // 如果是楼梯，检查是否可以跨越
                    if (entry.object.userData.isStair) {
                        const enemyFeetY = position.y - EnemyConfig.collision.height;
                        const stepHeight = entry.box.max.y - enemyFeetY;
                        if (stepHeight > 0 && stepHeight <= maxStepHeight) {
                            continue;
                        }
                    }
                    return entry.box;
                }
            }
            return null;
        }

        // 降级：遍历所有障碍物 (性能较差)
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
