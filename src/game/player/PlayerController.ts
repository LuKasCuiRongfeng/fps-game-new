import * as THREE from 'three';
import type { ParticleSimulation } from '../core/gpu/GpuSimulationFacade';
import { PlayerConfig } from '../core/GameConfig';
import { PlayerWeaponSystem } from '../weapon/PlayerWeaponSystem';
import type { RuntimeSettingsSource } from '../core/settings/RuntimeSettings';
import { PlayerInputController } from './PlayerInputController';
import type { GameServices } from '../core/services/GameServices';
import type { GameEventBus } from '../core/events/GameEventBus';

import { PhysicsSystem } from '../core/PhysicsSystem';
import { Enemy } from '../enemy/Enemy';
import { getUserData } from '../types/GameUserData';

export class PlayerController {
    private readonly settings: RuntimeSettingsSource;
    private readonly services: GameServices;
    private readonly events: GameEventBus;
    private domElement: HTMLElement;
    private camera: THREE.Camera;
    private weaponSystem: PlayerWeaponSystem;
    private scene: THREE.Scene;
    private physicsSystem: PhysicsSystem;

    private input: PlayerInputController;
    
    private canJump: boolean = false;
    
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
    
    // 拾取回调
    private onPickupAttempt: (() => void) | null = null;
    
    // 投掷手榴弹回调
    private onGrenadeThrow: ((position: THREE.Vector3, direction: THREE.Vector3) => void) | null = null;
    
    // 天气切换回调
    private onWeatherCycle: (() => void) | null = null;
    
    // 地形高度回调
    private onGetGroundHeight: ((x: number, z: number) => number) | null = null;

    
    private objects: THREE.Object3D[] = [];

    private nearbyCollisionEntries: Array<{ box: THREE.Box3; object: THREE.Object3D }> = [];

    // Hot-path temporaries (avoid per-frame allocations)
    private tmpForward: THREE.Vector3 = new THREE.Vector3();
    private tmpRight: THREE.Vector3 = new THREE.Vector3();
    private tmpPlayerBox: THREE.Box3 = new THREE.Box3();

    private readonly debugLogs: boolean = false;

    constructor(
        settings: RuntimeSettingsSource,
        services: GameServices,
        events: GameEventBus,
        camera: THREE.Camera, 
        domElement: HTMLElement, 
        scene: THREE.Scene, 
        objects: THREE.Object3D[],
        physicsSystem: PhysicsSystem
    ) {
        this.settings = settings;
        this.services = services;
        this.events = events;
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

        this.weaponSystem = new PlayerWeaponSystem(camera, scene, this.physicsSystem, this.services, this.events);

        this.input = new PlayerInputController({
            domElement: this.domElement,
            settings: this.settings,
            getAimProgress: () => this.weaponSystem.getAimProgress(),
            resumeAudio: () => {
                void this.services.sound.resume();
            },

            onTriggerDown: (isAiming) => this.weaponSystem.onTriggerDown(isAiming),
            onTriggerUp: () => this.weaponSystem.onTriggerUp(),
            onStartAiming: () => this.weaponSystem.startAiming(),
            onStopAiming: () => this.weaponSystem.stopAiming(),

            onSwitchNextWeapon: () => this.weaponSystem.switchToNextWeapon(),
            onSwitchPrevWeapon: () => this.weaponSystem.switchToPrevWeapon(),
            onSwitchToWeapon: (id) => this.weaponSystem.switchToWeapon(id),

            onQuickThrowGrenade: () => this.quickThrowGrenade(),

            onPickup: () => {
                this.onPickupAttempt?.();
            },
            onWeatherCycle: () => {
                this.onWeatherCycle?.();
            },

            onJumpPressed: () => this.handleJumpPressed(),
            onToggleCrouch: () => this.toggleCrouch(),
            onToggleProne: () => this.toggleProne(),

            onLookDelta: (yawDelta, pitchDelta) => {
                this.targetYaw += yawDelta;
                this.targetPitch += pitchDelta;
                // Clamp pitch
                this.targetPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.targetPitch));
            },
        });
    }

    private handleJumpPressed(): void {
        // If crouching/prone, Space stands up first.
        if (this.stance !== 'stand') {
            this.setStance('stand');
            return;
        }

        if (this.canJump !== true) return;
        this.velocity.y += this.settings.getRuntimeSettings().jumpHeight;
        this.canJump = false;
        this.services.sound.playJump();
    }

    private toggleCrouch(): void {
        if (this.stance === 'crouch') this.setStance('stand');
        else this.setStance('crouch');
    }

    private toggleProne(): void {
        if (this.stance === 'prone') this.setStance('stand');
        else this.setStance('prone');
    }

    private quickThrowGrenade(): void {
        // Quick-throw by temporarily switching to grenade weapon.
        const prevWeapon = this.weaponSystem.getCurrentWeaponId();
        this.weaponSystem.switchToWeapon('grenade');
        this.weaponSystem.onTriggerDown(false);
        setTimeout(() => {
            this.weaponSystem.switchToWeapon(prevWeapon);
        }, 1000);
    }
    
    /**
     * 设置敌人列表 (用于射击检测优化)
     */
    public setEnemies(enemies: Enemy[]) {
        this.weaponSystem.setEnemies(enemies);
    }

    /**
     * 设置粒子系统到武器
     */
    public setParticleSystem(particleSystem: ParticleSimulation) {
        this.weaponSystem.setParticleSystem(particleSystem);
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
        this.weaponSystem.setGrenadeThrowCallback(callback);
    }

    /**
     * Warmup: temporarily show all weapon viewmodels so WebGPU can compile their pipelines.
     */
    public beginWeaponWarmupVisible() {
        this.weaponSystem.beginWarmupVisible();
    }

    /** Restore normal weapon visibility after warmup. */
    public endWeaponWarmupVisible() {
        this.weaponSystem.endWarmupVisible();
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
        this.weaponSystem.setGroundHeightCallback(callback);
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
        if (this.debugLogs && this.frameCount % 60 === 0) {
            console.log(`[PlayerController] Delta: ${delta.toFixed(4)}, Pos: (${this.camera.position.x.toFixed(2)}, ${this.camera.position.y.toFixed(2)}, ${this.camera.position.z.toFixed(2)}), Vel: (${this.velocity.x.toFixed(2)}, ${this.velocity.y.toFixed(2)}, ${this.velocity.z.toFixed(2)}), CanJump: ${this.canJump}, GroundHeight: ${this.onGetGroundHeight ? this.onGetGroundHeight(this.camera.position.x, this.camera.position.z).toFixed(2) : 'N/A'}`);
            if (this.input.isLocked()) {
                console.log(
                    `[PlayerController] Movement Inputs: F:${this.input.getMoveForward()} B:${this.input.getMoveBackward()} L:${this.input.getMoveLeft()} R:${this.input.getMoveRight()}`
                );
            }
        }

        // 更新武器系统
        this.weaponSystem.update(delta);
        
        // 更新 FOV (由武器瞄准进度驱动)
        this.updateFOV(delta);
        
        if (this.input.isLocked() === true) {
            // Restore physics position (remove visual offset from previous frame)
            this.camera.position.y -= this.visualYOffset;

            // 1. Smooth Look
            // Interpolate current angles towards target angles
            // Using a simple lerp factor adjusted by delta for frame-rate independence
            const t = 1.0 - Math.pow(1.0 - this.settings.getRuntimeSettings().cameraSmoothFactor, delta * 60); 
            
            this.yaw += (this.targetYaw - this.yaw) * t;
            this.pitch += (this.targetPitch - this.pitch) * t;

            this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

            // 2. Movement Physics
            // Friction / Damping (Exponential decay for frame-rate independence)
            // Fix: Using simple subtraction causes instability at low FPS or high friction
            const damping = Math.exp(-this.settings.getRuntimeSettings().friction * delta);
            this.velocity.x *= damping;
            this.velocity.z *= damping;

            const moveForward = this.input.getMoveForward();
            const moveBackward = this.input.getMoveBackward();
            const moveLeft = this.input.getMoveLeft();
            const moveRight = this.input.getMoveRight();
            const wantsMove = moveForward || moveBackward || moveLeft || moveRight;
            // If we are grounded and not trying to move, don't apply gravity every frame.
            // This avoids doing a vertical collision broadphase just to cancel gravity.
            const idleGrounded = this.canJump === true && !wantsMove && Math.abs(this.velocity.y) < 0.01;
            if (!idleGrounded) {
                this.velocity.y -= this.settings.getRuntimeSettings().gravity * delta; // Gravity
            } else {
                this.velocity.y = 0;
            }

            this.direction.z = Number(moveForward) - Number(moveBackward);
            this.direction.x = Number(moveRight) - Number(moveLeft);
            this.direction.normalize();

            // 根据姿态调整速度
            let stanceMultiplier = 1.0;
            if (this.stance === 'crouch') {
                stanceMultiplier = PlayerConfig.stance.crouch.speedMultiplier;
            } else if (this.stance === 'prone') {
                stanceMultiplier = PlayerConfig.stance.prone.speedMultiplier;
            }
            
            // 趴下和蹲下时不能跑步
            const canRun = this.stance === 'stand' && this.input.isRunning();
            const s = this.settings.getRuntimeSettings();
            const currentSpeed = (canRun ? s.runSpeed : s.walkSpeed) * stanceMultiplier;

            if (moveForward || moveBackward) this.velocity.z -= this.direction.z * currentSpeed * delta;
            if (moveLeft || moveRight) this.velocity.x -= this.direction.x * currentSpeed * delta;

            // Calculate world space velocity vector
            // We want movement to be strictly horizontal (XZ plane), independent of camera pitch
            // Get forward vector (projected to XZ plane)
            const forward = this.tmpForward;
            this.camera.getWorldDirection(forward);
            forward.y = 0;
            forward.normalize();

            // Get right vector
            const right = this.tmpRight;
            right.crossVectors(forward, this.camera.up);
            right.normalize();

            const forwardSpeed = -this.velocity.z * delta;
            const rightSpeed = -this.velocity.x * delta;

            // Micro-optimization: when standing still, dx/dz are effectively zero.
            // Skipping horizontal collision checks avoids 2x broadphase queries per frame at idle.
            const moveEps = 1e-4;

            // X axis movement (World Space)
            const dx = (forward.x * forwardSpeed) + (right.x * rightSpeed);
            let collisionBox: THREE.Box3 | null = null;
            if (Math.abs(dx) > moveEps) {
                this.camera.position.x += dx;
                collisionBox = this.checkCollisions(true); // Use skinWidth for horizontal
                if (collisionBox) {
                    if (this.debugLogs && this.frameCount % 60 === 0) console.log("[PlayerController] Hit Object X:", collisionBox);
                    // 保存碰撞点的障碍物信息
                    const obstacleTop = collisionBox.max.y;
                    this.camera.position.x -= dx;
                    this.handleObstacle(obstacleTop, dx, 0);
                }
            }

            // Z axis movement (World Space)
            const dz = (forward.z * forwardSpeed) + (right.z * rightSpeed);
            if (Math.abs(dz) > moveEps) {
                this.camera.position.z += dz;
                collisionBox = this.checkCollisions(true); // Use skinWidth for horizontal
                if (collisionBox) {
                    if (this.debugLogs && this.frameCount % 60 === 0) console.log("[PlayerController] Hit Object Z:", collisionBox);
                    // 保存碰撞点的障碍物信息
                    const obstacleTop = collisionBox.max.y;
                    this.camera.position.z -= dz;
                    this.handleObstacle(obstacleTop, 0, dz);
                }
            }

            // Y axis movement (Gravity / Jump)
            // If idle + grounded, skip vertical broadphase checks to avoid spikes.
            const previousY = this.camera.position.y;
            // 当前相机高度偏移
            const currentCameraOffset = this.targetCameraHeight;

            if (!idleGrounded) {
                this.camera.position.y += (this.velocity.y * delta);

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
                    } else if (this.velocity.y > 0) {
                        // Jumping up and hit ceiling
                        this.velocity.y = 0;
                        this.camera.position.y = previousY;
                    }
                }
            } else {
                // Keep stable at rest.
                this.velocity.y = 0;
            }

            // Simple ground floor check
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
        const playerBox = this.tmpPlayerBox;
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
        const nearbyEntries = this.physicsSystem.getNearbyObjectsInto(position, 5.0, this.nearbyCollisionEntries);
        
        for (const entry of nearbyEntries) {
            // entry.box 已经是世界坐标的 AABB，直接检测
            if (playerBox.intersectsBox(entry.box)) {
                // 如果是地面物体，忽略水平碰撞 (由 checkCollisions(true) 调用时)
                // 只有当物体明确标记为 'isGround' 且我们是在做水平碰撞检测时才忽略
                // 这样可以防止卡在楼梯平台或地砖接缝处
                if (useSkinWidth && getUserData(entry.object).isGround) {
                    continue;
                }
                return entry.box;
            }
        }
        
        return null;
    }

    public unlock() {
        this.input.unlock();
    }

    /**
     * Request pointer lock (best-effort). In browsers this may require a user gesture;
     * in Tauri it may succeed immediately.
     */
    public lock() {
        this.input.requestLock();
    }
    
    /**
     * 更新 FOV - 瞄准时平滑缩小视野
     */
    private updateFOV(delta: number) {
        const perspectiveCamera = this.camera as THREE.PerspectiveCamera;
        if (!perspectiveCamera.fov) return;

        // 用武器瞄准进度插值 FOV（支持平滑过渡）
        const aimProgress = this.weaponSystem.getAimProgress();
        const s = this.settings.getRuntimeSettings();

        // 16x scope for long-range terrain observation.
        // We only apply this to the sniper to avoid changing iron-sight weapons.
        const weaponId = this.weaponSystem.getCurrentWeaponId();
        const scopeMagnification = 16;

        const scopedAimFov = (() => {
            // Magnification definition: M = tan(FOV_default/2) / tan(FOV_scoped/2)
            // => FOV_scoped = 2 * atan(tan(FOV_default/2) / M)
            const half = THREE.MathUtils.degToRad(s.defaultFov * 0.5);
            const scopedHalf = Math.atan(Math.tan(half) / scopeMagnification);
            // Clamp to a sane minimum to avoid numerical weirdness.
            return THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(scopedHalf * 2), 1.0, s.defaultFov);
        })();

        const aimFov = weaponId === 'sniper' ? scopedAimFov : s.aimFov;
        const targetFov = THREE.MathUtils.lerp(s.defaultFov, aimFov, aimProgress);

        perspectiveCamera.fov = THREE.MathUtils.lerp(perspectiveCamera.fov, targetFov, delta * s.fovLerpSpeed);
        
        perspectiveCamera.updateProjectionMatrix();
    }
    
    /**
     * 获取是否正在瞄准
     */
    public getIsAiming(): boolean {
        return this.input.isAiming();
    }
    
    /**
     * 获取瞄准进度 (0-1)
     * 用于后处理瞄准镜效果
     */
    public getAimProgress(): number {
        return this.weaponSystem.getAimProgress();
    }
    
    /**
     * 设置姿态
     */
    private setStance(newStance: 'stand' | 'crouch' | 'prone'): void {
        if (this.stance === newStance) return;
        
        const oldCameraHeight = this.targetCameraHeight;
        this.stance = newStance;
        
        // 更新GameState中的姿态
        this.services.state.setStance(newStance);
        
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
    private updateStanceHeight(_delta: number): void {
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
        this.weaponSystem.dispose();
        this.input.dispose();
        this.input.unlock();
    }
}
