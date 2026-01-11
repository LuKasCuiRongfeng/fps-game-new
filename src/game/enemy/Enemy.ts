/**
 * Enemy - 使用 TSL 材质优化的敌人类
 * 结合 GPU Compute 进行高性能更新
 */
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { uniform, time, sin, cos, vec3, mix, float, smoothstep, uv } from 'three/tsl';
import type { GameServices } from '../core/services/GameServices';
import { getDefaultGameServices } from '../core/services/GameServices';
import { Pathfinding } from '../core/Pathfinding';
import { EnemyConfig, EnemyType, EnemyTypesConfig } from '../core/GameConfig';
import { PhysicsSystem } from '../core/PhysicsSystem';
import { EnemyFactory } from './EnemyFactory';
import type { WeaponId } from '../weapon/WeaponTypes';
import { GameEventBus } from '../core/events/GameEventBus';

export class Enemy {
    public mesh: THREE.Group;
    public type: EnemyType;
    private config: any; // 当前类型的配置

    private speed: number;
    private health: number;
    public isDead: boolean = false;
    public isActive: boolean = true;

    private readonly services: GameServices;
    private readonly events: GameEventBus;
    
    // TSL Uniforms (使用 any 类型绕过 WebGPU 类型问题)
    private hitStrength: any;
    private dissolveAmount: any;
    
    // Pathfinding
    private currentPath: THREE.Vector3[] = [];
    private pathUpdateTimer: number = 0;
    private pathUpdateInterval: number = EnemyConfig.ai.pathUpdateInterval;

    // Stuck detection (avoid "idle" enemies when direct chasing into obstacles)
    private stuckTimer: number = 0;
    private stuckCheckTimer: number = 0;
    private lastStuckCheckPos = new THREE.Vector3();

    // Stair forcing (fallback when player is on a stair platform)
    private forcedStairTimer: number = 0;
    private forcedStairBottom = new THREE.Vector3();
    private forcedStairTop = new THREE.Vector3();
    
    // GPU Index (用于 GPU Compute 系统)
    public gpuIndex: number = -1;

    // Render culling / LOD (do NOT rely on mesh.visible; keep shootability independent)
    private renderCulled: boolean = false;

    // 动画状态
    private walkCycle: number = 0;
    private originalY: number = 1;
    
    // 平滑转向
    private currentRotation: number = 0;  // 当前朝向角度
    private targetRotation: number = 0;   // 目标朝向角度
    private readonly rotationSpeed: number = EnemyConfig.rotationSpeed;  // 转向速度

    // Movement (jump/airborne)
    private verticalVelocity: number = 0;
    private jumpCooldownTimer: number = 0;
    
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
        private weaponId: WeaponId;
    private muzzleFlashDuration: number = EnemyConfig.attack.muzzleFlashDuration;
    private muzzleFlashTimer: number = 0;
    
    // 射击状态 (供外部读取)
    public lastShotHit: boolean = false;
    
        // Reuse objects for raycasting/LOS checks
        private losRaycaster = new THREE.Raycaster();
        private losEye = new THREE.Vector3();
        private losDir = new THREE.Vector3();
        private losCandidates: THREE.Object3D[] = [];
        private losIntersects: THREE.Intersection[] = [];

        private nearbyCollisionEntries: Array<{ box: THREE.Box3; object: THREE.Object3D }> = [];

        private lastCollisionUserData: any | null = null;

        private tmpToPlayer = new THREE.Vector3();
        private tmpMoveDir = new THREE.Vector3();
        private tmpNextPosX = new THREE.Vector3();
        private tmpNextPosZ = new THREE.Vector3();
        private tmpYawDir = new THREE.Vector3();
        private tmpMuzzleWorldPos = new THREE.Vector3();
        private tmpTargetPos = new THREE.Vector3();
        private tmpNavTargetPos = new THREE.Vector3();
        private tmpStairTargetPos = new THREE.Vector3();
        private tmpStairDir = new THREE.Vector3();
        private tmpStairApproach = new THREE.Vector3();
        private tmpStairEntry = new THREE.Vector3();
        private tmpShotDir = new THREE.Vector3();
    public lastShotDirection: THREE.Vector3 = new THREE.Vector3();
    
    // 视线检测优化
    private visibilityCheckTimer: number = 0;
    private isPlayerVisible: boolean = false;
    private readonly VISIBILITY_CHECK_INTERVAL: number = 0.25; // 每秒检测4次

    // LOD / far update throttling
    private currentLodLevel: number = -1;
    private farUpdateAccumulator: number = 0;
    private shadowsDisabled: boolean = false;
    
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

        constructor(
        position: THREE.Vector3,
        type: EnemyType = 'soldier',
        weaponId?: WeaponId,
        services: GameServices = getDefaultGameServices(),
        events: GameEventBus = new GameEventBus(),
    ) {
        this.type = type;
        this.config = EnemyTypesConfig[type];

        this.services = services;
        this.events = events;

            this.weaponId = weaponId ?? ((this.config.weapon as WeaponId) || 'rifle');

        // 初始化属性
        this.speed = this.config.speed;
        this.health = this.config.health;
        
        // 基础参数来自敌人类型配置，再叠加武器差异
        const baseAttack = this.config.attack;
        const weaponScale: Record<string, { dmg: number; range: number; rate: number; acc: number }> = {
            rifle: { dmg: 1.0, range: 1.0, rate: 1.0, acc: 1.0 },
            smg: { dmg: 0.75, range: 0.75, rate: 1.8, acc: 0.9 },
            shotgun: { dmg: 1.6, range: 0.55, rate: 0.75, acc: 0.85 },
            sniper: { dmg: 2.1, range: 1.35, rate: 0.55, acc: 1.1 },
            pistol: { dmg: 0.85, range: 0.65, rate: 1.2, acc: 0.95 },
            bow: { dmg: 1.2, range: 0.7, rate: 0.9, acc: 0.95 },
        };
        const s = weaponScale[this.weaponId] ?? weaponScale.rifle;

        this.fireRate = baseAttack.fireRate * s.rate;
        this.fireRange = baseAttack.range * s.range;
        this.fireDamage = baseAttack.damage * s.dmg;
        this.accuracy = Math.max(0.05, Math.min(0.99, baseAttack.accuracy * s.acc));
        this.engageRange = Math.min(baseAttack.engageRange, this.fireRange);
        this.aimSpeed = this.config.ai.aimSpeed;

        // When three-mesh-bvh is enabled, this stops traversal after the first hit.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.losRaycaster as any).firstHitOnly = true;
        this.losRaycaster.near = 0;

        // TSL Uniforms
        this.hitStrength = uniform(0);
        this.dissolveAmount = uniform(0);
        
        // 创建人形敌人 (使用工厂模式)
        const assets = EnemyFactory.createHumanoidEnemy(this.type, this.hitStrength, this.weaponId);
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

    public getWeaponId(): WeaponId {
        return this.weaponId;
    }

    public getPoolKey(): string {
        return `${this.type}:${this.weaponId}`;
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

        // 计算到玩家的距离和方向 (avoid per-frame allocations)
        this.tmpToPlayer.subVectors(playerPosition, this.mesh.position);
        const distanceToPlayer = this.tmpToPlayer.length();
        if (distanceToPlayer > 0.00001) this.tmpToPlayer.multiplyScalar(1 / distanceToPlayer);

        // LOD / culling: reduce drawcalls and skip expensive AI for distant enemies
        this.applyLOD(distanceToPlayer);
        if (this.renderCulled) {
            // Still advance muzzle flash timer so it doesn't get stuck on.
            if (this.muzzleFlashTimer > 0) {
                this.muzzleFlashTimer -= delta;
                if (this.muzzleFlashTimer <= 0) this.muzzleFlash.visible = false;
            }
            return result;
        }

        // Far enemies: run the heavy AI less frequently (accumulate delta so behavior is time-consistent)
        const farUpdateDistance = EnemyConfig.ai.farUpdateDistance;
        if (distanceToPlayer > farUpdateDistance) {
            this.farUpdateAccumulator += delta;
            const interval = EnemyConfig.ai.farUpdateInterval;
            if (this.farUpdateAccumulator < interval) {
                // Keep lightweight timers moving.
                if (this.muzzleFlashTimer > 0) {
                    this.muzzleFlashTimer -= delta;
                    if (this.muzzleFlashTimer <= 0) this.muzzleFlash.visible = false;
                }
                this.forcedStairTimer = Math.max(0, this.forcedStairTimer - delta);
                return result;
            }

            // Clamp to avoid huge simulation steps.
            delta = Math.min(this.farUpdateAccumulator, 0.1);
            this.farUpdateAccumulator = 0;
        } else {
            this.farUpdateAccumulator = 0;
        }

        // Stuck detection at a low frequency to avoid extra per-frame work.
        // When we aren't making progress, we force a pathfinding update to route around obstacles.
        this.stuckCheckTimer -= delta;
        if (this.stuckCheckTimer <= 0) {
            this.stuckCheckTimer = 0.25 + Math.random() * 0.05;
            const dx = this.mesh.position.x - this.lastStuckCheckPos.x;
            const dz = this.mesh.position.z - this.lastStuckCheckPos.z;
            const moved = Math.sqrt(dx * dx + dz * dz);
            if (moved < 0.15) {
                this.stuckTimer = Math.min(2.0, this.stuckTimer + 0.25);
            } else {
                this.stuckTimer = Math.max(0, this.stuckTimer - 0.5);
            }
            this.lastStuckCheckPos.copy(this.mesh.position);
        }

        this.forcedStairTimer = Math.max(0, this.forcedStairTimer - delta);
        
           // NOTE: visual LOD is handled in applyLOD(distanceToPlayer)
        
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
            // IMPORTANT:
            // `playerPosition` is the camera position (can be high when the player jumps or stands on a tall obstacle).
            // Pathfinding has a stairs heuristic that triggers on vertical distance, so feeding it camera Y can cause
            // enemies to "randomly" head for stairs even when the player is just on a non-navigable box.
            // We instead compute a navigation target Y at the player's XZ: prefer a nearby walkable surface (stairs/platform),
            // otherwise fall back to terrain height.
            // Pathfinding is the heaviest part of enemy AI. Only run it when it matters:
            // - large vertical delta (stairs/elevation)
            // - we appear stuck (direct chase is blocked)
            // - relatively close to the player (routing around dense obstacles)
            const assumedCameraToFeet = 1.6;
            const playerFeetY = playerPosition.y - assumedCameraToFeet;
            const terrainY = this.onGetGroundHeight ? this.onGetGroundHeight(playerPosition.x, playerPosition.z) : 0;
            const approxPlayerNavY = Math.abs(playerFeetY - terrainY) < 1.0 ? terrainY : playerFeetY;
            const verticalDelta = Math.abs(approxPlayerNavY - this.mesh.position.y);

            const needsVerticalNav = verticalDelta > 2.0;
            const isStuck = this.stuckTimer > 0.75;
            const isCloseEnoughForRouting = distanceToPlayer < 80;

            if (needsVerticalNav || isStuck || isCloseEnoughForRouting) {
                const navTarget = this.getNavTargetPosition(playerPosition);
                this.currentPath = pathfinding.findPath(this.mesh.position, navTarget);
            }
        }

        // Jump cooldown
        this.jumpCooldownTimer = Math.max(0, this.jumpCooldownTimer - delta);

        let targetPos = playerPosition;

        // Prefer direct chasing when player is visible and roughly on the same vertical level.
        // This makes enemies feel more "player-like" (jump/step over small props) instead of always hugging A* nodes.
        // Avoid per-frame PhysicsSystem queries here; approximate using terrain + camera-to-feet.
        const assumedCameraToFeet = 1.6;
        const playerFeetY = playerPosition.y - assumedCameraToFeet;
        const terrainY = this.onGetGroundHeight ? this.onGetGroundHeight(playerPosition.x, playerPosition.z) : 0;
        const approxPlayerNavY = Math.abs(playerFeetY - terrainY) < 1.0 ? terrainY : playerFeetY;
        const heightDelta = Math.abs(approxPlayerNavY - this.mesh.position.y);
        const preferDirectChase = this.isPlayerVisible && heightDelta < 1.6;

        // Stair forcing:
        // When the player is on a stair platform (target Y close to a stair top), guide enemies to the entrance.
        // We keep a short-lived cached staircase selection to prevent oscillation and to steer into the stair front.
        const shouldForceStairs = heightDelta > 2.0 && (this.currentPath.length === 0 || this.stuckTimer > 0.75);
        if (shouldForceStairs) {
            const waypoints = pathfinding.getWaypoints();
            if (waypoints.length > 0) {
                const onTopTol = 2.0;
                const enemyPos = this.mesh.position;

                // Only force stairs when the player is actually on a walkable elevated surface (stairs/platform),
                // NOT when standing on a random tall prop.
                const navTargetForStairs = this.getNavTargetPosition(playerPosition);
                const snappedToWalkableSurface = navTargetForStairs.y > terrainY + 0.25;
                if (!snappedToWalkableSurface) {
                    // Player is on terrain or a non-walkable prop: do not force stairs.
                } else {
                    // Refresh cached staircase if none active.
                    if (this.forcedStairTimer <= 0.0001) {
                        let best: { bottom: THREE.Vector3; top: THREE.Vector3 } | null = null;
                        let bestScore = Infinity;

                        // Choose a staircase whose TOP level matches the snapped nav target and whose top is near the player in XZ.
                        const maxTopMatchXZ = 22.0;
                        const maxTopMatchXZ2 = maxTopMatchXZ * maxTopMatchXZ;

                        for (const wp of waypoints) {
                            if (Math.abs(navTargetForStairs.y - wp.top.y) > onTopTol) continue;

                            const dxTop = navTargetForStairs.x - wp.top.x;
                            const dzTop = navTargetForStairs.z - wp.top.z;
                            if (dxTop * dxTop + dzTop * dzTop > maxTopMatchXZ2) continue;

                            const dx = enemyPos.x - wp.bottom.x;
                            const dz = enemyPos.z - wp.bottom.z;
                            const dBottomXZ = dx * dx + dz * dz;
                            if (dBottomXZ < bestScore) {
                                bestScore = dBottomXZ;
                                best = wp;
                            }
                        }

                        if (best) {
                            this.forcedStairBottom.copy(best.bottom);
                            this.forcedStairTop.copy(best.top);
                            this.forcedStairTimer = 2.0;
                        }
                    }

                    if (this.forcedStairTimer > 0.0001) {
                        // Compute stair direction in XZ.
                        this.tmpStairDir.subVectors(this.forcedStairTop, this.forcedStairBottom);
                        this.tmpStairDir.y = 0;
                        const dirLen = this.tmpStairDir.length();
                        if (dirLen > 0.0001) this.tmpStairDir.multiplyScalar(1 / dirLen);

                        // Approach from the front: step back a bit from the entrance along the stair direction.
                        const approachBack = 4.0;
                        const enterForward = 4.0;
                        this.tmpStairApproach.copy(this.forcedStairBottom).addScaledVector(this.tmpStairDir, -approachBack);
                        this.tmpStairEntry.copy(this.forcedStairBottom).addScaledVector(this.tmpStairDir, enterForward);

                        // Distances in XZ.
                        const dxB = enemyPos.x - this.forcedStairBottom.x;
                        const dzB = enemyPos.z - this.forcedStairBottom.z;
                        const distBottomXZ = Math.sqrt(dxB * dxB + dzB * dzB);

                        const enemyBelowTop = enemyPos.y < this.forcedStairTop.y - 1.0;

                        // Stage selection:
                        // 1) Far away: go to the approach point to align with the stair front.
                        // 2) Near: go to the bottom waypoint.
                        // 3) At entrance: push into the stairs to avoid clustering at the sides.
                        // 4) Near top level: aim for top waypoint.
                        if (enemyBelowTop) {
                            if (distBottomXZ > 10.0) {
                                targetPos = this.tmpStairTargetPos.copy(this.tmpStairApproach);
                            } else if (distBottomXZ > 4.0) {
                                targetPos = this.tmpStairTargetPos.copy(this.forcedStairBottom);
                            } else {
                                targetPos = this.tmpStairTargetPos.copy(this.tmpStairEntry);
                            }
                        } else {
                            targetPos = this.tmpStairTargetPos.copy(this.forcedStairTop);
                        }
                    }
                }
            }
        }

        // 跟随路径（当不可直追，或需要处理垂直导航时）
        if (!preferDirectChase && this.currentPath.length > 0) {
            const nextPoint = this.currentPath[0];
            const dx = nextPoint.x - this.mesh.position.x;
            const dz = nextPoint.z - this.mesh.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);

            // Path nodes may be coarse (see Pathfinding cell size), so allow a larger reach distance.
            if (dist < 2.0) {
                this.currentPath.shift();
                if (this.currentPath.length > 0) {
                    targetPos = this.currentPath[0];
                }
            } else {
                targetPos = nextPoint;
            }
        }

        // 移动计算
        const direction = this.tmpMoveDir.subVectors(targetPos, this.mesh.position);
        direction.y = 0;
        direction.normalize();

        const moveDistance = this.speed * delta;

        // X 轴移动
        const nextPosX = this.tmpNextPosX.copy(this.mesh.position);
        nextPosX.x += direction.x * moveDistance;
        
        let collisionBox = this.checkCollisions(nextPosX, obstacles, false);
        if (!collisionBox) {
            this.mesh.position.x = nextPosX.x;
        } else {
            if (!this.tryJumpOverObstacle(collisionBox, direction.x * moveDistance, 0, obstacles)) {
                this.handleObstacle(collisionBox, direction.x * moveDistance, 0);
            }
        }

        // Z 轴移动
        const nextPosZ = this.tmpNextPosZ.copy(this.mesh.position);
        nextPosZ.z += direction.z * moveDistance;
        
        collisionBox = this.checkCollisions(nextPosZ, obstacles, false);
        if (!collisionBox) {
            this.mesh.position.z = nextPosZ.z;
        } else {
            if (!this.tryJumpOverObstacle(collisionBox, 0, direction.z * moveDistance, obstacles)) {
                this.handleObstacle(collisionBox, 0, direction.z * moveDistance);
            }
        }

        // Vertical movement:
        // - When not jumping (verticalVelocity == 0), keep the existing stair/ground smoothing.
        // - When airborne, integrate gravity and land on the highest walkable ground under us.
        if (Math.abs(this.verticalVelocity) < 0.0001) {
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

            if (this.mesh.position.y < targetGroundY) {
                this.mesh.position.y = targetGroundY;
            }
        } else {
            // Airborne physics
            this.verticalVelocity -= EnemyConfig.movement.gravity * delta;
            this.mesh.position.y += this.verticalVelocity * delta;

            const groundY = this.findGroundHeight(this.mesh.position, obstacles);
            if (this.mesh.position.y <= groundY) {
                this.mesh.position.y = groundY;
                this.verticalVelocity = 0;
            }
        }

        // 计算目标朝向
        if (this.isAiming) {
            // 瞄准时朝向玩家
            const toPlayerDir = this.tmpYawDir.subVectors(playerPosition, this.mesh.position);
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

    public isRenderCulled(): boolean {
        return this.renderCulled;
    }

    private applyLOD(distanceToPlayer: number) {
        const renderCullDistance = EnemyConfig.ai.renderCullDistance;
        const limbLodDistance = EnemyConfig.ai.limbLodDistance;
        const shadowDisableDistance = EnemyConfig.ai.shadowDisableDistance;

        let lod = 0;
        if (distanceToPlayer > renderCullDistance) lod = 3;
        else if (distanceToPlayer > limbLodDistance) lod = 2;
        else if (distanceToPlayer > 30) lod = 1;

        if (lod !== this.currentLodLevel) {
            this.currentLodLevel = lod;

            if (lod === 3) {
                this.renderCulled = true;
                this.setFullRigVisible(false);
                return;
            }

            this.renderCulled = false;

            // LOD 1+: hide head details
            this.headDetails.visible = lod <= 0;

            // LOD 2+: keep a decent silhouette (torso+head) but hide limbs/weapon (visual quality > cylinder)
            const showFullRig = lod <= 1;
            if (showFullRig) {
                this.setFullRigVisible(true);
            } else {
                // torso + head only
                this.body.visible = true;
                this.head.visible = true;
                this.eyes.visible = true;
                this.leftArm.visible = false;
                this.rightArm.visible = false;
                this.leftLeg.visible = false;
                this.rightLeg.visible = false;
                this.weapon.visible = false;
                this.muzzleFlash.visible = false;
                this.headDetails.visible = false;
            }
        } else if (lod === 3) {
            // If already culled, keep hidden.
            this.renderCulled = true;
            return;
        }

        // Shadows: toggle at distance threshold (only flip when crossing)
        const shouldDisableShadows = distanceToPlayer > shadowDisableDistance;
        if (shouldDisableShadows !== this.shadowsDisabled) {
            this.shadowsDisabled = shouldDisableShadows;
            const cast = !shouldDisableShadows;
            this.setCastShadowRecursive(this.mesh, cast);
        }
    }

    private setFullRigVisible(visible: boolean) {
        // Keep the root group visible to allow raycasts to still consider this enemy.
        this.body.visible = visible;
        this.head.visible = visible;
        this.eyes.visible = visible;
        this.leftArm.visible = visible;
        this.rightArm.visible = visible;
        this.leftLeg.visible = visible;
        this.rightLeg.visible = visible;
        this.weapon.visible = visible;
        // headDetails handled separately in applyLOD
    }

    private setCastShadowRecursive(root: THREE.Object3D, castShadow: boolean) {
        root.traverse((obj) => {
            const mesh = obj as THREE.Mesh;
            // @ts-ignore
            if (mesh && typeof mesh.castShadow === 'boolean') {
                // @ts-ignore
                mesh.castShadow = castShadow;
            }
        });
    }

    private isGrounded(obstacles: THREE.Object3D[]): boolean {
        if (Math.abs(this.verticalVelocity) >= 0.0001) return false;
        const groundY = this.findGroundHeight(this.mesh.position, obstacles);
        return this.mesh.position.y <= groundY + 0.03;
    }

    private startJump() {
        const g = EnemyConfig.movement.gravity;
        const h = Math.max(0.2, EnemyConfig.movement.jumpHeight);
        // v = sqrt(2gh)
        this.verticalVelocity = Math.sqrt(2 * g * h);
        this.jumpCooldownTimer = EnemyConfig.movement.jumpCooldown;
    }

    /**
     * Attempt to jump onto/over a low obstacle when colliding.
     * Returns true if we initiated a jump and performed a small motion this frame.
     */
    private tryJumpOverObstacle(
        obstacleBox: THREE.Box3,
        dx: number,
        dz: number,
        obstacles: THREE.Object3D[],
    ): boolean {
        // Only jump when grounded and off cooldown.
        if (!this.isGrounded(obstacles)) return false;
        if (this.jumpCooldownTimer > 0) return false;

        // Don't jump on stairs/walkable ground; they should be climbed smoothly.
        const ud = this.lastCollisionUserData;
        if (ud?.isStair || ud?.isGround) return false;

        const enemyFeetY = this.mesh.position.y;
        const obstacleTopY = obstacleBox.max.y;
        const stepHeight = obstacleTopY - enemyFeetY;

        const minJump = EnemyConfig.collision.maxStepHeight + 0.05;
        const maxJump = EnemyConfig.movement.maxJumpObstacleHeight;
        if (stepHeight < minJump || stepHeight > maxJump) return false;

        // Start jump.
        this.startJump();

        // Give a small immediate lift and forward nudge so we don't collide again on the same frame.
        this.mesh.position.y += 0.08;
        const forwardBoost = EnemyConfig.movement.jumpForwardBoost;

        // Try moving slightly forward at the lifted position.
        const testPos = this.tmpNextPosX.copy(this.mesh.position);
        testPos.x += dx * forwardBoost;
        testPos.z += dz * forwardBoost;
        const hit = this.checkCollisions(testPos, obstacles, false);
        if (!hit) {
            this.mesh.position.copy(testPos);
        }

        return true;
    }

    /**
     * Compute a navigation target for pathfinding.
     * Keeps XZ = player XZ, but snaps Y to a walkable surface at that XZ when the player is actually standing on it.
     * This avoids stairs mis-selection when the player is simply elevated (jumping / standing on a tall prop).
     */
    private getNavTargetPosition(playerPosition: THREE.Vector3): THREE.Vector3 {
        const out = this.tmpNavTargetPos.copy(playerPosition);

        // Terrain baseline.
        let terrainY = 0;
        if (this.onGetGroundHeight) {
            terrainY = this.onGetGroundHeight(playerPosition.x, playerPosition.z);
        }
        let navY = terrainY;

        // Approximate camera-to-feet offset (player stand camera height is 1.6m).
        // We only snap to a surface if the player's feet are close to that surface top.
        const assumedCameraToFeet = 1.6;
        const feetY = playerPosition.y - assumedCameraToFeet;

        // Prefer a nearby walkable surface (stairs/platform). We purposely ignore generic props,
        // so standing on an arbitrary tall obstacle doesn't trigger a vertical-navigation plan.
        if (this.physicsSystem) {
            const radius = 3.0;
            const pad = 0.25;
            const nearby = this.physicsSystem.getNearbyObjectsInto(playerPosition, radius, this.nearbyCollisionEntries);
            for (const entry of nearby) {
                const ud = entry.object.userData;
                if (!ud) continue;
                const isWalkableSurface = ud.isGround === true || ud.isStair === true;
                if (!isWalkableSurface) continue;

                // Must be within the surface XZ bounds.
                if (
                    playerPosition.x < entry.box.min.x - pad ||
                    playerPosition.x > entry.box.max.x + pad ||
                    playerPosition.z < entry.box.min.z - pad ||
                    playerPosition.z > entry.box.max.z + pad
                ) {
                    continue;
                }

                const topY = entry.box.max.y;

                // Only treat as the player's surface if feet are near it.
                // (If the player is just near stairs but on the ground, this will be false.)
                if (Math.abs(feetY - topY) > 0.85) continue;

                if (topY > navY) navY = topY;
            }
        }

        out.y = navY;
        return out;
    }
    
    /**
     * 检查是否能看到玩家 (视线检测)
     * 优化：使用 PhysicsSystem 网格遍历，避免检测全场景
     */
    private canSeePlayer(playerPosition: THREE.Vector3): boolean {
        this.losEye.copy(this.mesh.position);
        this.losEye.y += 1.7; // 眼睛高度

        this.losDir.subVectors(playerPosition, this.losEye);
        const distance = this.losDir.length();
        this.losDir.normalize();

        this.losRaycaster.set(this.losEye, this.losDir);
        this.losRaycaster.near = 0;
        this.losRaycaster.far = distance;
        
        // 1. 使用 PhysicsSystem 获取候选物体 (Broad Phase)
        // 如果没有 PhysicsSystem，则无法检测遮挡 (默认可见)
        if (!this.physicsSystem) return true;

        const candidates = this.physicsSystem.getRaycastCandidatesInto(this.losEye, this.losDir, distance, this.losCandidates);
        
        // 2. 精确检测 (Raycast)
        // 不需要过滤 blockedObjects，因为 PhysicsSystem 只包含静态障碍物
        this.losIntersects.length = 0;
        this.losRaycaster.intersectObjects(candidates, true, this.losIntersects);
        
        // 如果没有障碍物遮挡，可以看到玩家
        return this.losIntersects.length === 0;
    }
    
    /**
     * 向玩家射击
     */
    private fireAtPlayer(playerPosition: THREE.Vector3): { hit: boolean; damage: number } {
        // 显示枪口闪光
        this.muzzleFlash.visible = true;
        this.muzzleFlashTimer = this.muzzleFlashDuration;
        
        // 播放射击音效
        this.events.emit({ type: 'sound:play', sound: 'shoot' });
        
        // 计算射击方向 (带散布)
        // 优化: 不强制更新整个矩阵树，接受一帧的延迟或使用上一帧的矩阵
        // this.mesh.updateMatrixWorld(true);
        const muzzleWorldPos = this.tmpMuzzleWorldPos;
        this.muzzlePoint.getWorldPosition(muzzleWorldPos);
        
        // 玩家躯干位置 (稍微降低目标点)
        const targetPos = this.tmpTargetPos.copy(playerPosition);
        targetPos.y += EnemyConfig.collision.targetHeightOffset; // 瞄准躯干
        
        const direction = this.tmpShotDir.subVectors(targetPos, muzzleWorldPos);
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
    public getMuzzleWorldPosition(): THREE.Vector3;
    public getMuzzleWorldPosition(out: THREE.Vector3): THREE.Vector3;
    public getMuzzleWorldPosition(out?: THREE.Vector3): THREE.Vector3 {
        // 确保矩阵已更新
        this.mesh.updateMatrixWorld(true);

        const pos = out ?? new THREE.Vector3();
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
        // Enemy mesh Y is treated as feet (ground contact) height.
        const feetY = position.y;
        
        // 优化：优先使用物理系统
        if (this.physicsSystem) {
            const nearbyEntries = this.physicsSystem.getNearbyObjectsInto(position, 5.0, this.nearbyCollisionEntries);
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
        const enemyFeetY = this.mesh.position.y;
        const obstacleTopY = obstacleBox.max.y;
        const stepHeight = obstacleTopY - enemyFeetY;

        if (stepHeight > 0 && stepHeight <= EnemyConfig.collision.maxStepHeight * 3) {
            // Step up onto the obstacle by raising feet to the obstacle top.
            this.mesh.position.y = obstacleTopY + 0.01;
            
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

        // Enemy mesh Y is feet height; collision capsule/box extends upward.
        enemyBox.min.set(position.x - enemyRadius, position.y + skinWidth, position.z - enemyRadius);
        enemyBox.max.set(position.x + enemyRadius, position.y + EnemyConfig.collision.height * 2, position.z + enemyRadius);

        this.lastCollisionUserData = null;

        // 优化：优先使用物理系统 (Spatial Grid)
        if (this.physicsSystem) {
            const nearbyEntries = this.physicsSystem.getNearbyObjectsInto(position, 5.0, this.nearbyCollisionEntries);
            for (const entry of nearbyEntries) {
                // entry.box 已经是世界坐标 AABB
                if (enemyBox.intersectsBox(entry.box)) {
                    // 如果是楼梯，检查是否可以跨越
                    if (entry.object.userData.isStair) {
                        const enemyFeetY = position.y;
                        const stepHeight = entry.box.max.y - enemyFeetY;
                        if (stepHeight > 0 && stepHeight <= maxStepHeight) {
                            continue;
                        }
                    }
                    this.lastCollisionUserData = entry.object.userData;
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
                    const enemyFeetY = position.y;
                    const stepHeight = objectBox.max.y - enemyFeetY;
                    
                    // 如果台阶高度可跨越，不视为碰撞，让敌人可以走上去
                    if (stepHeight > 0 && stepHeight <= maxStepHeight) {
                        continue; // 跳过这个碰撞，允许敌人走上去
                    }
                }
                this.lastCollisionUserData = object.userData;
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
        this.isActive = false;
        this.hitStrength.value = 0.5; // 死亡时保持一定亮度
        this.events.emit({ type: 'sound:play', sound: 'enemyDeath' });
        this.events.emit({ type: 'state:updateScore', delta: EnemyConfig.rewards.score });

        // NOTE:
        // Do NOT run requestAnimationFrame loops here.
        // Enemies are frequently pooled/reused; an RAF-driven shrink animation would keep running
        // after respawn and corrupt the new enemy state.
        this.mesh.visible = false;
    }

    /**
     * Re-activate this Enemy instance for pooling.
     * Keeps all GPU resources/materials, only resets runtime state.
     */
    public respawn(position: THREE.Vector3) {
        this.isDead = false;
        this.isActive = true;

        this.health = this.config.health;

        // reset uniforms
        this.hitStrength.value = 0;
        this.dissolveAmount.value = 0;

        // reset movement/ai
        this.currentPath.length = 0;
        this.pathUpdateTimer = 0;
        this.stuckTimer = 0;
        this.stuckCheckTimer = 0;
        this.lastStuckCheckPos.copy(position);
        this.forcedStairTimer = 0;
        this.verticalVelocity = 0;
        this.jumpCooldownTimer = 0;

        // reset shooting/aim
        this.fireTimer = 0;
        this.muzzleFlashTimer = 0;
        this.lastShotHit = false;
        this.isAiming = false;
        this.aimProgress = 0;
        this.aimHoldTime = 0;
        this.targetAimDirection.set(0, 0, -1);
        if (this.muzzleFlash) this.muzzleFlash.visible = false;

        // reset render state
        this.renderCulled = false;
        this.currentLodLevel = -1;
        this.farUpdateAccumulator = 0;
        this.shadowsDisabled = false;

        // reset transform
        this.mesh.visible = true;
        this.mesh.position.copy(position);
        this.mesh.position.y = 0;
        this.originalY = 0;
        this.walkCycle = 0;

        // reset scale (death might have modified it)
        const s = this.config.scale ?? 1;
        this.mesh.scale.setScalar(s);
    }

    /**
     * Deactivate without freeing GPU resources (pool reuse).
     */
    public release() {
        this.isActive = false;
        this.mesh.visible = false;
    }

    public dispose() {
        // Final cleanup only.
        // IMPORTANT: EnemyFactory caches shared geometries; do not dispose geometries here.
        this.mesh.traverse((child) => {
            if (child instanceof THREE.Mesh) {
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
