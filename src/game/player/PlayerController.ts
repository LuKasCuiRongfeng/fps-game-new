import * as THREE from 'three';
import { Weapon } from '../weapon/Weapon';
import { SoundManager } from '../core/SoundManager';
import { GPUParticleSystem } from '../shaders/GPUParticles';
import { GrenadeHand } from '../entities/GrenadeTSL';
import { GameStateService, WeaponType } from '../core/GameState';
import { PlayerConfig, WeaponConfig } from '../core/GameConfig';

import { PhysicsSystem } from '../core/PhysicsSystem';
import { Enemy } from '../enemy/Enemy';

export class PlayerController {
    private domElement: HTMLElement;
    private camera: THREE.Camera;
    private weapon: Weapon;
    private grenadeHand: GrenadeHand;
    private scene: THREE.Scene;
    private physicsSystem: PhysicsSystem;
    
    // Movement state
    private moveForward: boolean = false;
    private moveBackward: boolean = false;
    private moveLeft: boolean = false;
    private moveRight: boolean = false;
    private canJump: boolean = false;
    private isLocked: boolean = false;
    private isRunning: boolean = false;
    
    // 姿态状态: 'stand' | 'crouch' | 'prone'
    private stance: 'stand' | 'crouch' | 'prone' = 'stand';
    private targetCameraHeight: number = PlayerConfig.stance.stand.height;

    private velocity: THREE.Vector3 = new THREE.Vector3();
    private direction: THREE.Vector3 = new THREE.Vector3();

    // Look state
    private pitch: number = 0;
    private yaw: number = 0;
    private targetPitch: number = 0;
    private targetYaw: number = 0;
    
    private defaultY: number = PlayerConfig.stance.stand.height;
    
    // Smoothing
    private visualYOffset: number = 0;
    
    // 瞄准状态
    private isAiming: boolean = false;
    
    // 拾取回调
    private onPickupAttempt: (() => void) | null = null;
    
    // 投掷手榴弹回调
    private onGrenadeThrow: ((position: THREE.Vector3, direction: THREE.Vector3) => void) | null = null;
    
    // 天气切换回调
    private onWeatherCycle: (() => void) | null = null;
    
    // 地形高度回调
    private onGetGroundHeight: ((x: number, z: number) => number) | null = null;

    
    // 当前武器
    private currentWeapon: WeaponType = 'gun';
    
    // 武器切换冷却 (防止滚轮过快切换)
    private lastWeaponSwitchTime: number = 0;
    
    // 连射状态
    private isFiring: boolean = false;
    private lastFireTime: number = 0;
    private readonly fireInterval: number = 1000 / WeaponConfig.gun.fireRate;

    private objects: THREE.Object3D[] = [];

    constructor(
        camera: THREE.Camera, 
        domElement: HTMLElement, 
        scene: THREE.Scene, 
        objects: THREE.Object3D[],
        physicsSystem: PhysicsSystem
    ) {
        this.domElement = domElement;
        this.camera = camera;
        this.scene = scene;
        this.objects = objects; // 保留引用但不用于碰撞
        this.physicsSystem = physicsSystem;
        
        // Initialize angles from current camera rotation
        const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        this.pitch = euler.x;
        this.yaw = euler.y;
        this.targetPitch = this.pitch;
        this.targetYaw = this.yaw;

        this.weapon = new Weapon(camera);
        this.weapon.setPhysicsSystem(this.physicsSystem);
        this.grenadeHand = new GrenadeHand(camera);

        this.initInputListeners();
        this.initPointerLock();
    }
    
    /**
     * 设置敌人列表 (用于射击检测优化)
     */
    public setEnemies(enemies: Enemy[]) {
        this.weapon.setEnemies(enemies);
    }

    /**
     * 设置粒子系统到武器
     */
    public setParticleSystem(particleSystem: GPUParticleSystem) {
        this.weapon.setParticleSystem(particleSystem);
    }
    
    /**
     * 设置拾取回调
     */
    public setPickupCallback(callback: () => void) {
        this.onPickupAttempt = callback;
    }
    
    /**
     * 设置手榴弹投掷回调
     */
    public setGrenadeThrowCallback(callback: (position: THREE.Vector3, direction: THREE.Vector3) => void) {
        this.onGrenadeThrow = callback;
    }
    
    /**
     * 设置天气切换回调
     */
    public setWeatherCycleCallback(callback: () => void) {
        this.onWeatherCycle = callback;
    }
    
    /**
     * 设置地形高度回调
     */
    public setGroundHeightCallback(callback: (x: number, z: number) => number) {
        this.onGetGroundHeight = callback;
    }
    
    /**
     * 设置武器的地形高度回调
     */
    public setWeaponGroundHeightCallback(callback: (x: number, z: number) => number) {
        this.weapon.setGroundHeightCallback(callback);
    }

    /**
     * 切换武器
     */
    private switchWeapon(weapon: WeaponType): void {
        if (this.currentWeapon === weapon) return;
        if (this.grenadeHand.isPlaying()) return;  // 投掷动画中不能切换
        
        this.currentWeapon = weapon;
        GameStateService.getInstance().setCurrentWeapon(weapon);
        
        if (weapon === 'gun') {
            this.weapon.show();
            this.grenadeHand.hide();
        } else {
            this.weapon.hide();
            this.grenadeHand.show();
        }
        
        // 播放切换音效
        SoundManager.getInstance().playWeaponSwitch();
    }
    
    /**
     * 切换到下一个武器
     */
    private switchToNextWeapon(): void {
        const weapons: WeaponType[] = ['gun', 'grenade'];
        const currentIndex = weapons.indexOf(this.currentWeapon);
        const nextIndex = (currentIndex + 1) % weapons.length;
        this.switchWeapon(weapons[nextIndex]);
    }
    
    /**
     * 切换到上一个武器
     */
    private switchToPrevWeapon(): void {
        const weapons: WeaponType[] = ['gun', 'grenade'];
        const currentIndex = weapons.indexOf(this.currentWeapon);
        const prevIndex = (currentIndex - 1 + weapons.length) % weapons.length;
        this.switchWeapon(weapons[prevIndex]);
    }
    
    /**
     * 投掷手榴弹
     */
    private throwGrenade(): void {
        const state = GameStateService.getInstance().getState();
        if (state.grenades <= 0) return;
        if (this.grenadeHand.isPlaying()) return;
        
        this.grenadeHand.startThrow(() => {
            // 在动画中间触发实际投掷
            if (this.onGrenadeThrow) {
                // 获取投掷位置和方向
                const throwPosition = this.camera.position.clone();
                throwPosition.y -= 0.2;  // 稍微低一点
                
                const throwDirection = new THREE.Vector3();
                this.camera.getWorldDirection(throwDirection);
                
                this.onGrenadeThrow(throwPosition, throwDirection);
                
                // 消耗手榴弹
                GameStateService.getInstance().updateGrenades(-1);
            }
        });
    }

    private initPointerLock() {
        // 点击获取指针锁定
        this.domElement.addEventListener('click', (event) => {
            // 确保音频上下文已恢复 (用户交互后才能播放声音)
            SoundManager.getInstance().resume();

            if (!this.isLocked) {
                this.domElement.requestPointerLock();
            }
        });
        
        // 左键按下 - 开始射击/投掷
        this.domElement.addEventListener('mousedown', (event) => {
            if (!this.isLocked) return;
            
            if (event.button === 0) {  // 左键
                if (this.currentWeapon === 'gun') {
                    if (this.isAiming) {
                        // 开镜状态下只能点射，不进入连射模式
                        this.tryShoot();
                    } else {
                        // 腰射可以连射
                        this.isFiring = true;
                        // 立即射击第一发
                        this.tryShoot();
                    }
                } else if (this.currentWeapon === 'grenade') {
                    // 投掷手榴弹
                    this.throwGrenade();
                }
            } else if (event.button === 2) {  // 右键
                if (this.currentWeapon === 'gun') {
                    this.isAiming = true;
                    this.weapon.startAiming();
                }
            }
        });
        
        // 鼠标抬起 - 停止射击/瞄准
        this.domElement.addEventListener('mouseup', (event) => {
            if (event.button === 0) {  // 左键
                this.isFiring = false;
            } else if (event.button === 2) {  // 右键
                this.isAiming = false;
                this.weapon.stopAiming();
            }
        });
        
        // 鼠标滚轮 - 切换武器 (带冷却防止过快切换)
        this.domElement.addEventListener('wheel', (event) => {
            if (!this.isLocked) return;
            
            const now = performance.now();
            if (now - this.lastWeaponSwitchTime < WeaponConfig.switching.cooldown) {
                return;  // 冷却中，忽略此次滚轮事件
            }
            
            if (event.deltaY > 0) {
                this.switchToNextWeapon();
                this.lastWeaponSwitchTime = now;
            } else if (event.deltaY < 0) {
                this.switchToPrevWeapon();
                this.lastWeaponSwitchTime = now;
            }
        });
        
        // 禁用右键菜单
        this.domElement.addEventListener('contextmenu', (event) => {
            event.preventDefault();
        });

        document.addEventListener('pointerlockchange', () => {
            this.isLocked = document.pointerLockElement === this.domElement;
            // 退出指针锁定时取消瞄准和射击
            if (!this.isLocked) {
                this.isAiming = false;
                this.isFiring = false;
                this.weapon.stopAiming();
            }
        });

        document.addEventListener('mousemove', (event) => {
            if (!this.isLocked) return;

            const movementX = event.movementX || 0;
            const movementY = event.movementY || 0;
            
            // 瞄准时降低灵敏度
            const currentSensitivity = this.isAiming 
                ? PlayerConfig.camera.sensitivity * PlayerConfig.camera.aimSensitivityMultiplier 
                : PlayerConfig.camera.sensitivity;

            this.targetYaw -= movementX * currentSensitivity;
            this.targetPitch -= movementY * currentSensitivity;

            // Clamp pitch
            this.targetPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.targetPitch));
        });
    }

    private initInputListeners() {
        const onKeyDown = (event: KeyboardEvent) => {
            switch (event.code) {
                case 'ArrowUp':
                case 'KeyW':
                    this.moveForward = true;
                    break;
                case 'ArrowLeft':
                case 'KeyA':
                    this.moveLeft = true;
                    break;
                case 'ArrowDown':
                case 'KeyS':
                    this.moveBackward = true;
                    break;
                case 'ArrowRight':
                case 'KeyD':
                    this.moveRight = true;
                    break;
                case 'Space':
                    // 如果蹲下或趴下，先恢复站立
                    if (this.stance !== 'stand') {
                        this.setStance('stand');
                    } else if (this.canJump === true) {
                        this.velocity.y += PlayerConfig.movement.jumpHeight;
                        this.canJump = false;
                        SoundManager.getInstance().playJump();
                    }
                    break;
                case 'KeyC':
                    // 蹲下
                    if (this.stance === 'crouch') {
                        this.setStance('stand');
                    } else {
                        this.setStance('crouch');
                    }
                    break;
                case 'KeyZ':
                    // 趴下
                    if (this.stance === 'prone') {
                        this.setStance('stand');
                    } else {
                        this.setStance('prone');
                    }
                    break;
                case 'ShiftLeft':
                case 'ShiftRight':
                    this.isRunning = true;
                    break;
                case 'KeyF':
                    // 拾取物品
                    if (this.onPickupAttempt) {
                        this.onPickupAttempt();
                    }
                    break;
                case 'Digit1':
                    // 切换到枪
                    this.switchWeapon('gun');
                    break;
                case 'Digit2':
                    // 切换到手榴弹
                    this.switchWeapon('grenade');
                    break;
                case 'KeyG':
                    // 快捷键投掷手榴弹 (不切换武器)
                    if (this.currentWeapon !== 'grenade') {
                        // 临时切换、投掷、然后切回
                        const prevWeapon = this.currentWeapon;
                        this.switchWeapon('grenade');
                        this.throwGrenade();
                        // 延迟切回
                        setTimeout(() => {
                            this.switchWeapon(prevWeapon);
                        }, 1000);
                    } else {
                        this.throwGrenade();
                    }
                    break;
                case 'KeyT':
                    // 切换天气
                    if (this.onWeatherCycle) {
                        this.onWeatherCycle();
                    }
                    break;
            }
        };

        const onKeyUp = (event: KeyboardEvent) => {
            switch (event.code) {
                case 'ArrowUp':
                case 'KeyW':
                    this.moveForward = false;
                    break;
                case 'ArrowLeft':
                case 'KeyA':
                    this.moveLeft = false;
                    break;
                case 'ArrowDown':
                case 'KeyS':
                    this.moveBackward = false;
                    break;
                case 'ArrowRight':
                case 'KeyD':
                    this.moveRight = false;
                    break;
                case 'ShiftLeft':
                case 'ShiftRight':
                    this.isRunning = false;
                    break;
            }
        };

        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
    }

    private frameCount: number = 0;

    public resetPhysics() {
        this.velocity.set(0, 0, 0);
        this.canJump = true;
        this.visualYOffset = 0;
    }

    public update(delta: number) {
        // Debug Log every 60 frames
        this.frameCount++;
        if (this.frameCount % 60 === 0) {
            console.log(`[PlayerController] Delta: ${delta.toFixed(4)}, Pos: (${this.camera.position.x.toFixed(2)}, ${this.camera.position.y.toFixed(2)}, ${this.camera.position.z.toFixed(2)}), Vel: (${this.velocity.x.toFixed(2)}, ${this.velocity.y.toFixed(2)}, ${this.velocity.z.toFixed(2)}), CanJump: ${this.canJump}, GroundHeight: ${this.onGetGroundHeight ? this.onGetGroundHeight(this.camera.position.x, this.camera.position.z).toFixed(2) : 'N/A'}`);
            if (this.isLocked) console.log(`[PlayerController] Movement Inputs: F:${this.moveForward} B:${this.moveBackward} L:${this.moveLeft} R:${this.moveRight}`);
        }

        // 更新武器动画
        this.weapon.update(delta);
        
        // 更新手榴弹手部动画
        this.grenadeHand.update(delta);
        
        // 更新 FOV (瞄准时缩小视野，产生放大效果)
        this.updateFOV(delta);
        
        // 处理连射 (只有持枪时)
        if (this.currentWeapon === 'gun') {
            this.updateFiring();
        }
        
        if (this.isLocked === true) {
            // Restore physics position (remove visual offset from previous frame)
            this.camera.position.y -= this.visualYOffset;

            // 1. Smooth Look
            // Interpolate current angles towards target angles
            // Using a simple lerp factor adjusted by delta for frame-rate independence
            const t = 1.0 - Math.pow(1.0 - PlayerConfig.camera.smoothFactor, delta * 60); 
            
            this.yaw += (this.targetYaw - this.yaw) * t;
            this.pitch += (this.targetPitch - this.pitch) * t;

            this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

            // 2. Movement Physics
            // Friction / Damping (Exponential decay for frame-rate independence)
            // Fix: Using simple subtraction causes instability at low FPS or high friction
            const damping = Math.exp(-PlayerConfig.movement.friction * delta);
            this.velocity.x *= damping;
            this.velocity.z *= damping;
            
            this.velocity.y -= PlayerConfig.movement.gravity * delta; // Gravity

            this.direction.z = Number(this.moveForward) - Number(this.moveBackward);
            this.direction.x = Number(this.moveRight) - Number(this.moveLeft);
            this.direction.normalize();

            // 根据姿态调整速度
            let stanceMultiplier = 1.0;
            if (this.stance === 'crouch') {
                stanceMultiplier = PlayerConfig.stance.crouch.speedMultiplier;
            } else if (this.stance === 'prone') {
                stanceMultiplier = PlayerConfig.stance.prone.speedMultiplier;
            }
            
            // 趴下和蹲下时不能跑步
            const canRun = this.stance === 'stand' && this.isRunning;
            const currentSpeed = (canRun ? PlayerConfig.movement.runSpeed : PlayerConfig.movement.walkSpeed) * stanceMultiplier;

            if (this.moveForward || this.moveBackward) this.velocity.z -= this.direction.z * currentSpeed * delta;
            if (this.moveLeft || this.moveRight) this.velocity.x -= this.direction.x * currentSpeed * delta;

            // Calculate world space velocity vector
            // We want movement to be strictly horizontal (XZ plane), independent of camera pitch
            // Get forward vector (projected to XZ plane)
            const forward = new THREE.Vector3();
            this.camera.getWorldDirection(forward);
            forward.y = 0;
            forward.normalize();

            // Get right vector
            const right = new THREE.Vector3();
            right.crossVectors(forward, this.camera.up);
            right.normalize();

            const forwardSpeed = -this.velocity.z * delta;
            const rightSpeed = -this.velocity.x * delta;

            // X axis movement (World Space)
            const dx = (forward.x * forwardSpeed) + (right.x * rightSpeed);
            this.camera.position.x += dx;
            let collisionBox = this.checkCollisions(true); // Use skinWidth for horizontal
            if (collisionBox) {
                if (this.frameCount % 60 === 0) console.log("[PlayerController] Hit Object X:", collisionBox);
                // 保存碰撞点的障碍物信息
                const obstacleTop = collisionBox.max.y;
                this.camera.position.x -= dx;
                this.handleObstacle(obstacleTop, dx, 0);
            }

            // Z axis movement (World Space)
            const dz = (forward.z * forwardSpeed) + (right.z * rightSpeed);
            this.camera.position.z += dz;
            collisionBox = this.checkCollisions(true); // Use skinWidth for horizontal
            if (collisionBox) {
                if (this.frameCount % 60 === 0) console.log("[PlayerController] Hit Object Z:", collisionBox);
                // 保存碰撞点的障碍物信息
                const obstacleTop = collisionBox.max.y;
                this.camera.position.z -= dz;
                this.handleObstacle(obstacleTop, 0, dz);
            }

            // Y axis movement (Gravity / Jump)
            const previousY = this.camera.position.y;
            this.camera.position.y += (this.velocity.y * delta);
            
            // 当前相机高度偏移
            const currentCameraOffset = this.targetCameraHeight;

            const collisionBoxY = this.checkCollisions(false); // Strict check for vertical
            if (collisionBoxY) {
                 if (this.velocity.y < 0) {
                     // Falling down
                     // Check if we were above the object (landing)
                     const previousFeetY = previousY - currentCameraOffset;
                     // Tolerance of 0.1m to handle fast falling or slight penetration
                     if (previousFeetY >= collisionBoxY.max.y - 0.2) { // 增加容错到0.2
                         this.canJump = true;
                         this.velocity.y = 0;
                         // Snap to top
                         this.camera.position.y = collisionBoxY.max.y + currentCameraOffset;
                     } else {
                         // Hit side or bottom while falling? Revert.
                         this.camera.position.y = previousY;
                         this.velocity.y = 0;
                         // FIXME: 防止卡在空中，如果没有水平速度
                         if (Math.abs(this.velocity.x) < 0.1 && Math.abs(this.velocity.z) < 0.1) {
                             // 如果卡在物体内部，尝试向上弹一点
                             this.camera.position.y += 0.1;
                         }
                     }
                 } 
                 else if (this.velocity.y > 0) {
                     // Jumping up and hit ceiling
                     this.velocity.y = 0;
                     this.camera.position.y = previousY;
                 }
            }

            // Simple ground floor check (fallback)
            let groundHeight = 0;
            if (this.onGetGroundHeight) {
                groundHeight = this.onGetGroundHeight(this.camera.position.x, this.camera.position.z);
            }

            const minHeight = groundHeight + this.defaultY;

            if (this.camera.position.y < minHeight) {
                this.velocity.y = 0;
                this.camera.position.y = minHeight;
                this.canJump = true;
            }
            
            // 平滑更新相机高度 (姿态变化) - 在物理计算之后
            this.updateStanceHeight(delta);

            // Smooth camera Y
            // Decay the offset
            this.visualYOffset = THREE.MathUtils.lerp(this.visualYOffset, 0, delta * 15);
            if (Math.abs(this.visualYOffset) < 0.001) this.visualYOffset = 0;
            
            // Apply offset for rendering
            this.camera.position.y += this.visualYOffset;
        }
    }

    private handleObstacle(obstacleTopY: number, dx: number, dz: number) {
        // Only attempt to step up if we are moving
        if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return;
        
        // 当前相机高度偏移 (脚到眼睛的距离)
        const currentCameraOffset = this.targetCameraHeight;

        const playerFeetY = this.camera.position.y - currentCameraOffset;
        const stepHeight = obstacleTopY - playerFeetY;

        // Allow stepping up if obstacle is not too high
        // stepHeight > 0 means obstacle is above our feet
        // stepHeight <= maxStepHeight means it's climbable
        if (stepHeight > 0.01 && stepHeight <= PlayerConfig.collision.maxStepHeight) {
            // Check if there is space at the new position (on top of obstacle)
            const originalY = this.camera.position.y;
            const originalX = this.camera.position.x;
            const originalZ = this.camera.position.z;

            // Try to move up and forward
            this.camera.position.y = obstacleTopY + currentCameraOffset + 0.05; // Slightly above
            this.camera.position.x += dx;
            this.camera.position.z += dz;

            // Check for collision at new position using skinWidth to avoid detecting floor
            if (!this.checkCollisions(true)) {
                // Success! We can step up.
                // Smooth the transition
                this.visualYOffset -= (this.camera.position.y - originalY);
                this.velocity.y = 0;
                this.canJump = true;
            } else {
                // Failed, revert
                this.camera.position.y = originalY;
                this.camera.position.x = originalX;
                this.camera.position.z = originalZ;
            }
        }
    }

    private checkCollisions(useSkinWidth: boolean = false): THREE.Box3 | null {
        const playerBox = new THREE.Box3();
        const position = this.camera.position;

        // 如果物理系统未就绪，允许移动
        if (!this.physicsSystem) return null;
        
        // 使用当前目标相机高度作为偏移 (这是脚到眼睛的距离)
        const cameraOffset = this.targetCameraHeight;
        
        // 根据姿态调整碰撞盒高度
        const radius = PlayerConfig.collision.radius;
        let height: number;
        
        switch (this.stance) {
            case 'stand':
                height = PlayerConfig.stance.stand.collisionHeight;
                break;
            case 'crouch':
                height = PlayerConfig.stance.crouch.collisionHeight;
                break;
            case 'prone':
                height = PlayerConfig.stance.prone.collisionHeight;
                break;
            default:
                height = PlayerConfig.stance.stand.collisionHeight;
        }
        
        // IMPORTANT: When moving horizontally (useSkinWidth = true), we reduce the box height slightly 
        // from the bottom to allow "sliding" on top of surfaces without detecting the surface we are standing on as a collision.
        const skinWidth = useSkinWidth ? PlayerConfig.collision.skinWidth : 0.0;

        // 计算脚部位置
        const feetY = position.y - cameraOffset;
        
        playerBox.min.set(position.x - radius, feetY + skinWidth, position.z - radius);
        playerBox.max.set(position.x + radius, feetY + height, position.z + radius);

        // 使用物理系统获取附近的碰撞体 (空间划分优化)
        // 查询半径稍微大一点以覆盖周边
        const nearbyEntries = this.physicsSystem.getNearbyObjects(position, 5.0);
        
        for (const entry of nearbyEntries) {
            // entry.box 已经是世界坐标的 AABB，直接检测
            if (playerBox.intersectsBox(entry.box)) {
                // 如果是地面物体，忽略水平碰撞 (由 checkCollisions(true) 调用时)
                // 只有当物体明确标记为 'isGround' 且我们是在做水平碰撞检测时才忽略
                // 这样可以防止卡在楼梯平台或地砖接缝处
                if (useSkinWidth && entry.object.userData.isGround) {
                    continue;
                }
                return entry.box;
            }
        }
        
        return null;
    }

    public unlock() {
        document.exitPointerLock();
    }
    
    /**
     * 尝试射击 - 检查射击间隔
     */
    private tryShoot(): boolean {
        const currentTime = performance.now();
        // 开镜时射击间隔更长（模拟狙击枪拉栓）
        const interval = this.isAiming ? this.fireInterval * 3 : this.fireInterval;
        if (currentTime - this.lastFireTime >= interval) {
            this.weapon.shoot(this.scene, this.isAiming);
            this.lastFireTime = currentTime;
            return true;
        }
        return false;
    }
    
    /**
     * 更新连射状态
     */
    private updateFiring() {
        if (this.isFiring && this.isLocked) {
            this.tryShoot();
        }
    }
    
    /**
     * 更新 FOV - 瞄准时平滑缩小视野
     */
    private updateFOV(delta: number) {
        const perspectiveCamera = this.camera as THREE.PerspectiveCamera;
        if (!perspectiveCamera.fov) return;
        
        const targetFov = this.isAiming ? PlayerConfig.camera.aimFov : PlayerConfig.camera.defaultFov;
        
        perspectiveCamera.fov = THREE.MathUtils.lerp(
            perspectiveCamera.fov,
            targetFov,
            delta * PlayerConfig.camera.fovLerpSpeed
        );
        
        perspectiveCamera.updateProjectionMatrix();
    }
    
    /**
     * 获取是否正在瞄准
     */
    public getIsAiming(): boolean {
        return this.isAiming;
    }
    
    /**
     * 获取瞄准进度 (0-1)
     * 用于后处理瞄准镜效果
     */
    public getAimProgress(): number {
        const perspectiveCamera = this.camera as THREE.PerspectiveCamera;
        if (!perspectiveCamera.fov) return 0;
        
        // 根据当前FOV计算瞄准进度
        const progress = 1 - (perspectiveCamera.fov - PlayerConfig.camera.aimFov) / (PlayerConfig.camera.defaultFov - PlayerConfig.camera.aimFov);
        return THREE.MathUtils.clamp(progress, 0, 1);
    }
    
    /**
     * 设置姿态
     */
    private setStance(newStance: 'stand' | 'crouch' | 'prone'): void {
        if (this.stance === newStance) return;
        
        const oldCameraHeight = this.targetCameraHeight;
        this.stance = newStance;
        
        // 更新GameState中的姿态
        GameStateService.getInstance().setStance(newStance);
        
        // 设置目标相机高度
        switch (newStance) {
            case 'stand':
                this.targetCameraHeight = PlayerConfig.stance.stand.height;
                this.defaultY = PlayerConfig.stance.stand.height;
                break;
            case 'crouch':
                this.targetCameraHeight = PlayerConfig.stance.crouch.height;
                this.defaultY = PlayerConfig.stance.crouch.height;
                break;
            case 'prone':
                this.targetCameraHeight = PlayerConfig.stance.prone.height;
                this.defaultY = PlayerConfig.stance.prone.height;
                break;
        }
        
        // 计算高度差，用于平滑过渡
        const heightDiff = this.targetCameraHeight - oldCameraHeight;
        // 添加到 visualYOffset，会逐渐衰减到0
        this.visualYOffset -= heightDiff;
    }
    
    /**
     * 平滑更新相机高度 (姿态变化)
     * 只调整相对高度，不干扰物理系统
     */
    private updateStanceHeight(delta: number): void {
        // 姿态变化时，通过调整 visualYOffset 实现平滑过渡
        // 而不是直接修改 camera.position.y
        // 这样不会干扰物理碰撞系统
    }
    
    /**
     * 获取当前姿态
     */
    public getStance(): 'stand' | 'crouch' | 'prone' {
        return this.stance;
    }

    public dispose() {
        this.weapon.dispose();
        this.grenadeHand.dispose();
        document.exitPointerLock();
        // Remove listeners...
    }
}
