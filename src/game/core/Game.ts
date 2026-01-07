/**
 * Game - 使用 TSL 和 GPU Compute 优化的游戏主类
 * 集成所有 shader 系统，最大化 GPU 性能
 */
import * as THREE from 'three';
// @ts-ignore - WebGPU types not fully available
import { WebGPURenderer, PostProcessing } from 'three/webgpu';
import { 
    pass, 
    uniform, time, sin, vec3, vec4, mix, float, 
    smoothstep, screenUV
} from 'three/tsl';

import { PlayerController } from '../player/PlayerController';
import { Enemy } from '../enemy/Enemy';
import { EnemyType, EnemyTypesConfig } from './GameConfig';
import { Pickup } from '../entities/PickupTSL';
import { Grenade } from '../entities/GrenadeTSL';
import { ExplosionManager } from '../entities/ExplosionEffect';
import { GameStateService } from './GameState';
import { SoundManager } from './SoundManager';
import { Level } from '../level/Level';
import { Pathfinding } from './Pathfinding';
import { PhysicsSystem } from './PhysicsSystem';
import { UniformManager } from '../shaders/TSLMaterials';
import { GPUComputeSystem } from '../shaders/GPUCompute';
import { GPUParticleSystem } from '../shaders/GPUParticles';
import { LevelConfig, WeaponConfig, EnemyConfig, EffectConfig } from './GameConfig';
import { WeatherSystem } from '../level/WeatherSystem';
import { WeatherType } from './GameConfig';

export class Game {
    private container: HTMLElement;
    private renderer: WebGPURenderer;
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private playerController: PlayerController;
    private clock: THREE.Clock;
    
    // 游戏对象
    private objects: THREE.Object3D[] = [];
    private enemies: Enemy[] = [];
    private pickups: Pickup[] = [];
    private grenades: Grenade[] = [];
    
    // 计时器
    private spawnTimer: number = 0;
    private pickupSpawnTimer: number = 0;
    private initialPickupsSpawned: boolean = false;
    
    // 系统
    private physicsSystem!: PhysicsSystem;
    private pathfinding!: Pathfinding;
    private level!: Level;
    private uniformManager: UniformManager;
    private gpuCompute!: GPUComputeSystem;
    private particleSystem!: GPUParticleSystem;
    private explosionManager!: ExplosionManager;
    private weatherSystem!: WeatherSystem;
    
    // 光照引用 (用于天气系统)
    private ambientLight!: THREE.AmbientLight;
    private sunLight!: THREE.DirectionalLight;
    
    // 后处理
    private postProcessing!: PostProcessing;
    private damageFlashIntensity = uniform(0);
    private scopeAimProgress = uniform(0);  // 瞄准进度 (0-1)
    
    // 性能监控
    private frameCount: number = 0;
    private lastFpsUpdate: number = 0;
    private currentFps: number = 60;
    
    
    // 加载回调
    private onProgressCallback?: (progress: number, desc: string) => void;
    private onLoadedCallback?: () => void;
    private hasLoaded: boolean = false;

    constructor(container: HTMLElement, onLoaded?: () => void, onProgress?: (progress: number, desc: string) => void) {
        this.container = container;
        this.onLoadedCallback = onLoaded;
        this.onProgressCallback = onProgress;
        this.clock = new THREE.Clock();
        
        // 异步初始化流程，以支持进度更新
        this.initGame();
    }

    private updateProgress(progress: number, desc: string) {
        if (this.onProgressCallback) {
            this.onProgressCallback(progress, desc);
        }
        // 简单的延迟，让 UI 有机会渲染 (在同步代码中这其实并不真正让出主线程，但对于步骤间的逻辑分隔有用)
        // 在 React 的 useEffect 中使用 setTimeout 才是真正让出主线程的关键
    }

    private async initGame() {
        this.updateProgress(10, 'Initializing WebGPU Renderer...');
        
        this.uniformManager = UniformManager.getInstance();

        // 初始化 WebGPU 渲染器
        this.renderer = new WebGPURenderer({ 
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 限制像素比以提高性能
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.container.appendChild(this.renderer.domElement);

        this.updateProgress(20, 'Setting up Scene & Lighting...');

        // 初始化场景
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb);
        // 扩大雾气距离以适应无尽海域
        // Fog 颜色需要和天空/地平线混合好
        this.scene.fog = new THREE.Fog(0x87ceeb, 100, 700);

        // 光照
        this.setupLighting();

        // 相机
        this.camera = new THREE.PerspectiveCamera(
            75, 
            window.innerWidth / window.innerHeight, 
            0.1, 
            1500 // 增加远裁剪面以看到更远的物体 (海平面)
        );
        this.camera.position.set(0, 1.6, 5);
        this.scene.add(this.camera);

        this.updateProgress(30, 'Initializing Physics & Level...');

        // 物理系统 (优化)
        this.physicsSystem = new PhysicsSystem();

        // 关卡
        this.level = new Level(this.scene, this.objects, this.physicsSystem);

        this.updateProgress(45, 'Generating AI Pathfinding...');

        // 寻路系统
        this.pathfinding = new Pathfinding(this.objects);

        this.updateProgress(55, 'Compiling Compute Shaders...');
        // GPU Compute 系统
        this.gpuCompute = new GPUComputeSystem(this.renderer, 100, 10000);

        // 粒子系统
        this.particleSystem = new GPUParticleSystem(this.renderer, this.scene, 50000);
        
        this.updateProgress(65, 'Loading Effect Systems...');

        // 爆炸特效管理器 (高性能)
        this.explosionManager = new ExplosionManager(this.scene);
        
        // 天气系统
        this.weatherSystem = new WeatherSystem(this.scene, this.camera);
        this.weatherSystem.setLights(this.ambientLight, this.sunLight);
        this.weatherSystem.setWeather('sunny', true);  // 初始晴天

        this.updateProgress(75, 'Initializing Player Controller...');

        // 玩家控制器
        this.playerController = new PlayerController(
            this.camera, 
            this.container, 
            this.scene, 
            this.objects,
            this.physicsSystem
        );
        
        // 设置地形高度回调
        this.playerController.setGroundHeightCallback((x, z) => this.level.getTerrainHeight(x, z));
        
        // 设置武器的地形高度回调 (用于射线检测优化)
        this.playerController.setWeaponGroundHeightCallback((x, z) => this.level.getTerrainHeight(x, z));
        
        // 将粒子系统连接到武器
        this.playerController.setParticleSystem(this.particleSystem);
        
        // 设置敌人列表 (优化射击检测)
        this.playerController.setEnemies(this.enemies);
        
        // 设置拾取回调
        this.playerController.setPickupCallback(() => {
            this.tryCollectPickup();
        });
        
        // 设置手榴弹投掷回调
        this.playerController.setGrenadeThrowCallback((position, direction) => {
            this.throwGrenade(position, direction);
        });
        
        // 设置天气切换回调
        this.playerController.setWeatherCycleCallback(() => {
            this.weatherSystem.cycleWeather();
        });

        // 修复：初始化玩家位置，确保在地面之上
        const spawnX = 0;
        const spawnZ = 0; // 移动到0,0，确保在安全区中心
        const spawnHeight = this.level.getTerrainHeight(spawnX, spawnZ);
        // 确保起步高度至少在地面上方 1.6米 (站立高度) + 额外缓冲防止卡住
        this.camera.position.set(spawnX, spawnHeight + 2.0, spawnZ);
        
        // 重置物理状态
        this.playerController.resetPhysics();

        this.updateProgress(85, 'Configuring Post-Processing...');

        // 后处理
        this.setupPostProcessing();

        this.updateProgress(90, 'Spawning Entities...');

        // 生成初始敌人和拾取物 (使用配置的初始延迟) - 恢复使用配置
        this.spawnTimer = -LevelConfig.enemySpawn.initialDelay / 1000; 
        
        // 拾取物也延迟生成 - 恢复使用配置
        this.pickupSpawnTimer = -LevelConfig.pickupSpawn.initialDelay / 1000;

        // 事件监听
        window.addEventListener('resize', this.onWindowResize.bind(this));

        this.updateProgress(92, 'Pre-spawning dummy entities...');
        
        // 关键修复：生成并添加虚拟实体，确保它们的 Shader 在 Warmup 阶段也被编译
        // 之前只 Warmup 了静态场景，导致敌人生成时产生的 Shader 编译导致卡顿
        
        // 1. 虚拟敌人
        const dummyEnemy = new Enemy(new THREE.Vector3(0, -100, 0)); // 藏在地下
        this.scene.add(dummyEnemy.mesh);
        
        // 2. 虚拟拾取物 (两种类型)
        const dummyPickupHealth = new Pickup('health', new THREE.Vector3(2, -100, 0));
        this.scene.add(dummyPickupHealth.mesh);
        
        const dummyPickupAmmo = new Pickup('ammo', new THREE.Vector3(4, -100, 0));
        this.scene.add(dummyPickupAmmo.mesh);
        
        // 3. 虚拟手榴弹
        const dummyGrenade = new Grenade(
            new THREE.Vector3(6, -100, 0), 
            new THREE.Vector3(0, 1, 0), 
            0, this.scene, [], new THREE.Vector3(0,0,0)
        );
        // Grenade 构造函数已经将 mesh 添加到 scene (稍后确认 implementation, 但 GameTSL 使用时没有 add?)
        // 检查 GameTSL.throwGrenade 实现：
        // grenade = new Grenade(...)
        // this.grenades.push(grenade) -> Grenade 内部处理 addToScene?
        // 让我们手动添加以防万一，或者依赖 warmup
        // 假设 Grenade 内部处理了
        
        // 强制更新这些物体的矩阵，确保它们被视作有效物体
        dummyEnemy.mesh.updateMatrixWorld(true);
        dummyPickupHealth.mesh.updateMatrixWorld(true);
        dummyPickupAmmo.mesh.updateMatrixWorld(true);

        this.updateProgress(95, 'Pre-compiling Shaders (Warmup)...');
        
        try {
            // 强制编译场景中的材质，避免运行时旋转视角产生卡顿
            // 这会遍历场景图并为当前相机编译所需的 pipeline
            if (this.renderer.compileAsync) {
                // 保存原始相机状态
                const originalQuaternion = this.camera.quaternion.clone();
                const originalPosition = this.camera.position.clone();

                // 确保至少把太阳光和环境光加入到场景 (如果之前没加的话)
                this.scene.updateMatrixWorld(true);
                
                // 模拟向四周看，确保视锥体覆盖所有方向的物体
                const angles = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
                // 增加上下视角
                const pitches = [0, -0.3, 0.3]; 

                // 增加更多采样角度，确保覆盖所有物体
                // 并强制渲染一帧到离屏缓冲 (dummy render) 以触发所有 buffer upload
                for (const angle of angles) {
                    for (const pitch of pitches) {
                        this.camera.setRotationFromEuler(new THREE.Euler(pitch, angle, 0, 'YXZ'));
                        this.camera.updateMatrixWorld();
                        
                        // 1. Compile Shaders
                        await this.renderer.compileAsync(this.scene, this.camera);
                    }
                }
                
                // 恢复相机
                this.camera.position.copy(originalPosition);
                this.camera.quaternion.copy(originalQuaternion);
                this.camera.updateMatrixWorld();

                // 2. 暴力预热：强制渲染几帧以触发所有后处理和阴影管线
                // CompileAsync 可能不会触发 PostProcessing 链中的所有 shader
                this.updateProgress(97, 'Warming up Render Loop...');
                for(let i = 0; i < 5; i++) {
                     // 稍微旋转一点点相机，强制更新视锥体相关计算
                    this.camera.rotateY(0.01);
                    this.camera.updateMatrixWorld();
                    
                    // 更新部分系统
                    this.uniformManager.update(0.016, this.camera.position, 100);
                    this.gpuCompute.updateEnemies(0.016, this.camera.position);
                    this.particleSystem.update(0.016);
                    
                    // 真实渲染 (触发 PostProcessing 等所有效果)
                    await this.postProcessing.render();
                    
                    // 让出主线程一瞬间，防止浏览器认为页面卡死
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
                // 恢复相机
                this.camera.position.copy(originalPosition);
                this.camera.quaternion.copy(originalQuaternion);
                this.camera.updateMatrixWorld();
                
                // 清理虚拟实体
                this.scene.remove(dummyEnemy.mesh);
                this.scene.remove(dummyPickupHealth.mesh);
                this.scene.remove(dummyPickupAmmo.mesh);
                dummyEnemy.dispose(); // 如果有 dispose
                
            } else {
                // @ts-ignore - Fallback/Compat
                await this.renderer.compile(this.scene, this.camera);
            }
        } catch (e) {
            console.warn("Shader pre-compilation failed:", e);
        }

        this.updateProgress(98, 'Starting Render Loop...');

        // 启动渲染循环
        this.renderer.setAnimationLoop(this.animate.bind(this));
        
        // 标记加载完成
        this.hasLoaded = true;
        this.updateProgress(100, 'Game Loaded');
        if (this.onLoadedCallback) {
            this.onLoadedCallback();
        }
    }

    /**
     * 设置光照
     */
    private setupLighting() {
        // 环境光
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(this.ambientLight);

        // 主方向光 (太阳)
        this.sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
        this.sunLight.position.set(15, 30, 15);
        this.sunLight.castShadow = true;
        
        // 阴影设置
        // 优化：缩小阴影相机范围，只覆盖玩家周围近处的物体
        // 远处的物体阴影由于分辨率不足也看不清，或者被雾遮挡，不如不要
        // 或者使用 Cascaded Shadow Maps (CSM)，但 Three.js 原生不支持好的 CSM，需要额外库
        // 作为一个简易优化，我们缩小范围
        const shadowSize = 80;
        this.sunLight.shadow.camera.top = shadowSize;
        this.sunLight.shadow.camera.bottom = -shadowSize;
        this.sunLight.shadow.camera.left = -shadowSize;
        this.sunLight.shadow.camera.right = shadowSize;
        this.sunLight.shadow.camera.near = 0.5;
        this.sunLight.shadow.camera.far = 150; // 稍远一点，覆盖主要视线
        
        // 降低阴影分辨率，因为使用了 PCFSoftShadowMap，低分辨率也有柔化效果，反而性能更好
        this.sunLight.shadow.mapSize.width = 1024;
        this.sunLight.shadow.mapSize.height = 1024;
        this.sunLight.shadow.bias = -0.0005;
        
        // 只有在光源位置会跟随玩家移动时，这么小的相机范围才有效
        // 否则你需要一个巨大的相机来覆盖整个地图，那样分辨率会很惨
        // 建议在 update 中让 sunLight 跟随 camera.position.xz 移动 (Snap to texel)
        
        this.scene.add(this.sunLight);

        // 填充光 (蓝色天空反射)
        const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
        fillLight.position.set(-10, 10, -10);
        this.scene.add(fillLight);

        // 半球光 (天空和地面)
        const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x444444, 0.4);
        this.scene.add(hemiLight);
    }

    /**
     * 设置后处理 - TSL 驱动
     */
    private setupPostProcessing() {
        this.postProcessing = new PostProcessing(this.renderer);
        
        // 场景渲染 pass
        const scenePass = pass(this.scene, this.camera);
        
        // 获取场景颜色
        const sceneColor = scenePass.getTextureNode('output');
        
        // ========== 伤害闪烁效果 ==========
        const damageOverlay = this.createDamageOverlay(sceneColor);
        
        // ========== 瞄准镜效果 ==========
        const scopeOverlay = this.createScopeEffect(damageOverlay);
        
        // ========== 简单晕影效果 ==========
        const vignette = this.createVignetteEffect(scopeOverlay);
        
        // 输出
        this.postProcessing.outputNode = vignette;
    }

    /**
     * 创建伤害叠加效果
     */
    private createDamageOverlay(inputColor: any) {
        const coord = screenUV;
        const damageAmount = this.damageFlashIntensity;
        
        // 红色叠加
        const damageColor = vec3(0.8, 0.1, 0.05);
        
        // 边缘晕影
        const center = vec3(0.5, 0.5, 0);
        const distFromCenter = coord.sub(center.xy).length();
        const edgeFade = smoothstep(float(0.3), float(0.8), distFromCenter);
        
        // 脉动
        const t = time;
        const pulse = sin(t.mul(15)).mul(0.2).add(0.8);
        
        // 伤害强度
        const damageStrength = damageAmount.mul(edgeFade).mul(pulse);
        
        // 混合
        const finalColor = mix(inputColor, vec4(damageColor, 1), damageStrength.mul(0.5));
        
        return finalColor;
    }

    /**
     * 创建晕影效果
     */
    private createVignetteEffect(inputColor: any) {
        const coord = screenUV;
        
        // 计算到中心的距离
        const center = vec3(0.5, 0.5, 0);
        const dist = coord.sub(center.xy).length();
        
        // 晕影强度
        const vignetteStrength = float(0.4);
        const vignetteRadius = float(0.8);
        const vignetteSoftness = float(0.5);
        
        // 平滑晕影
        const vignette = smoothstep(vignetteRadius, vignetteRadius.sub(vignetteSoftness), dist);
        
        // 应用晕影
        const darkening = mix(float(1), vignette, vignetteStrength);
        const finalColor = inputColor.mul(darkening);
        
        return finalColor;
    }
    
    /**
     * 创建瞄准镜效果 - 高倍镜遮罩
     */
    private createScopeEffect(inputColor: any) {
        const coord = screenUV;
        const aimProgress = this.scopeAimProgress;
        
        // 计算到屏幕中心的距离
        const center = vec3(0.5, 0.5, 0);
        const aspect = float(16.0 / 9.0);  // 屏幕宽高比
        
        // 校正宽高比，让圆形保持圆形
        const correctedCoord = vec3(
            coord.x.sub(0.5).mul(aspect),
            coord.y.sub(0.5),
            float(0)
        );
        const dist = correctedCoord.length();
        
        // ========== 瞄准镜内圈 ==========
        // 内圆半径 (可视区域)
        const innerRadius = float(0.35);
        // 外圆半径 (开始变黑)
        const outerRadius = float(0.38);
        // 边框结束半径
        const borderRadius = float(0.42);
        
        // 内圈到外圈的渐变 (边框)
        const borderMask = smoothstep(innerRadius, outerRadius, dist);
        
        // 外圈到完全黑色的渐变
        const outerMask = smoothstep(outerRadius, borderRadius, dist);
        
        // 边框颜色 (深灰色金属质感)
        const borderColor = vec3(0.08, 0.08, 0.1);
        
        // ========== 瞄准镜十字准星 ==========
        // 水平线
        const crosshairThickness = float(0.002);
        const crosshairLength = float(0.15);
        const horizontalLine = smoothstep(
            crosshairThickness, 
            float(0), 
            correctedCoord.y.abs()
        ).mul(
            smoothstep(crosshairLength, crosshairLength.sub(0.02), correctedCoord.x.abs())
        ).mul(
            smoothstep(float(0.02), float(0.03), correctedCoord.x.abs())  // 中心空隙
        );
        
        // 垂直线
        const verticalLine = smoothstep(
            crosshairThickness, 
            float(0), 
            correctedCoord.x.abs()
        ).mul(
            smoothstep(crosshairLength, crosshairLength.sub(0.02), correctedCoord.y.abs())
        ).mul(
            smoothstep(float(0.02), float(0.03), correctedCoord.y.abs())  // 中心空隙
        );
        
        // 合并十字线
        const crosshair = horizontalLine.add(verticalLine).clamp(0, 1);
        
        // 十字准星颜色 (黑色)
        const crosshairColor = vec3(0, 0, 0);
        
        // ========== 中心红点 ==========
        const dotRadius = float(0.008);
        const redDot = smoothstep(dotRadius, dotRadius.mul(0.5), dist);
        const redDotColor = vec3(1.0, 0.1, 0.05);
        
        // ========== 组合效果 ==========
        // 基础场景色
        let result = inputColor;
        
        // 应用边框遮罩 (在内圈外变暗)
        const borderDarkening = mix(float(1), float(0), borderMask);
        result = mix(inputColor, vec4(borderColor, 1), borderMask.mul(aimProgress));
        
        // 应用外围完全黑色
        result = mix(result, vec4(0, 0, 0, 1), outerMask.mul(aimProgress));
        
        // 应用十字准星 (只在内圈内)
        const crosshairVisible = crosshair.mul(float(1).sub(borderMask)).mul(aimProgress);
        result = mix(result, vec4(crosshairColor, 1), crosshairVisible.mul(0.8));
        
        // 应用中心红点
        result = mix(result, vec4(redDotColor, 1), redDot.mul(aimProgress));
        
        // 边缘微光 (镜片反光效果)
        const edgeHighlight = smoothstep(innerRadius.sub(0.02), innerRadius, dist)
            .mul(smoothstep(outerRadius, innerRadius, dist));
        const highlightColor = vec3(0.3, 0.4, 0.5);
        result = mix(result, result.add(vec4(highlightColor.mul(0.1), 0)), edgeHighlight.mul(aimProgress));
        
        return result;
    }

    /**
     * 生成敌人 - 扩大生成范围
     */
    private spawnEnemy() {
        const angle = Math.random() * Math.PI * 2;
        // 扩大生成半径范围以适应大地图
        // 确保最小生成半径大于安全区
        const minRadius = Math.max(LevelConfig.enemySpawn.spawnRadius.min, LevelConfig.safeZoneRadius + 5);
        const radius = minRadius + Math.random() * (LevelConfig.enemySpawn.spawnRadius.max - minRadius);
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        
        // 随机选择敌人类型
        const types = Object.keys(EnemyTypesConfig) as EnemyType[];
        const type = types[Math.floor(Math.random() * types.length)];

        const enemy = new Enemy(new THREE.Vector3(x, 0, z), type);
        enemy.onGetGroundHeight = (x, z) => this.level.getTerrainHeight(x, z);
        enemy.setPhysicsSystem(this.physicsSystem);
        enemy.gpuIndex = this.enemies.length;
        
        this.scene.add(enemy.mesh);
        this.enemies.push(enemy);
        
        // 更新 GPU Compute 数据
        this.gpuCompute.setEnemyData(
            enemy.gpuIndex,
            enemy.mesh.position,
            this.camera.position,
            EnemyConfig.speed,
            EnemyConfig.health
        );
    }

    /**
     * 生成拾取物 - 扩大范围
     */
    private spawnPickup() {
        if (this.pickups.length >= LevelConfig.pickupSpawn.maxPickups * 2) return; // 增加最大数量

        const type = Math.random() > 0.5 ? 'health' : 'ammo';
        // 扩大拾取物生成范围，但避开安全区
        let x = 0, z = 0;
        let dist = 0;
        
        // 简单的随机生成并检查距离，尝试 10 次
        for (let i = 0; i < 10; i++) {
            x = (Math.random() - 0.5) * 150;
            z = (Math.random() - 0.5) * 150;
            dist = Math.sqrt(x * x + z * z);
            if (dist > LevelConfig.safeZoneRadius) {
                break;
            }
        }
        
        // 如果依然在安全区内 (极小概率)，强制移到安全区边缘
        if (dist <= LevelConfig.safeZoneRadius) {
            const angle = Math.random() * Math.PI * 2;
            x = Math.cos(angle) * (LevelConfig.safeZoneRadius + 2);
            z = Math.sin(angle) * (LevelConfig.safeZoneRadius + 2);
        }

        const y = this.level.getTerrainHeight(x, z);
        
        const pickup = new Pickup(type, new THREE.Vector3(x, y, z));
        this.scene.add(pickup.mesh);
        this.pickups.push(pickup);
    }

    /**
     * 窗口大小变化
     */
    private onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    /**
     * 主循环
     */
    private animate() {
        const rawDelta = this.clock.getDelta();
        const delta = Math.min(rawDelta, 0.1);

        // 更新 FPS
        this.updateFPS(delta);

        const gameState = GameStateService.getInstance().getState();

        if (gameState.isGameOver) {
            this.playerController.unlock();
            return;
        }

        // 更新玩家
        this.playerController.update(delta);
        const playerPos = this.camera.position;
        
        // 优化：让阳光跟随玩家移动，保持阴影在玩家周围清晰
        if (this.sunLight) {
            // 计算纹素大小以通过对其网格来防止阴影闪烁 (Shadow Swimming)
            const shadowSize = 80 * 2; // right - left
            const mapSize = 1024;
            const texelSize = shadowSize / mapSize;
            
            // 对齐到纹素网格
            const x = Math.floor(playerPos.x / texelSize) * texelSize;
            const z = Math.floor(playerPos.z / texelSize) * texelSize;
            
            // 保持相对偏移 (15, 30, 15)
            this.sunLight.position.set(x + 15, 30, z + 15);
            this.sunLight.target.position.set(x, 0, z);
            this.sunLight.target.updateMatrixWorld();
        }
        
        // 更新瞄准状态 (用于后处理效果)
        const aimProgress = this.playerController.getAimProgress();
        this.scopeAimProgress.value = aimProgress;

        // 更新全局 uniforms
        this.uniformManager.update(delta, playerPos, gameState.health);

        // 更新 GPU Compute 系统
        this.gpuCompute.updateEnemies(delta, playerPos);
        
        // 更新粒子系统
        this.particleSystem.update(delta);

        // 更新天气系统
        this.weatherSystem.update(delta);
        
        // --- 背景音乐状态更新 ---
        const sm = SoundManager.getInstance();
        const currentWeather = this.weatherSystem.getCurrentWeather();
        
        // 1. 检查是否有战斗 (敌人靠近)
        let isCombat = false;
        // 优化: 不需要检测所有敌人，只要有一个活跃敌人距离小于 20 米，就是战斗状态
        for (const enemy of this.enemies) {
             if (!enemy.isDead && enemy.mesh.visible) { // visible 已经在 EnemyTSL 中简单LOD处理过，大致可信，或者直接检查距离
                 const distSq = enemy.mesh.position.distanceToSquared(playerPos);
                 if (distSq < 20 * 20) { // 20m 内有敌人
                     isCombat = true;
                     break;
                 }
             }
        }
        
        if (isCombat) {
            sm.setBGMState('combat');
        } else {
            // 根据天气播放
            if (currentWeather === 'rainy') {
                sm.setBGMState('rainy');
            } else {
                sm.setBGMState('sunny');
            }
        }

        // 同步雨水强度到关卡 (用于水面涟漪)
        const isRainy = currentWeather === 'rainy';
        const targetRain = isRainy ? 1.0 : 0.0;
        // 平滑过渡
        this.level.rainIntensity.value = THREE.MathUtils.lerp(
            this.level.rainIntensity.value, 
            targetRain, 
            delta * 0.5
        );

        // 更新拾取物
        this.updatePickups(playerPos, delta);

        // 更新敌人
        this.updateEnemies(playerPos, delta);
        
        // 更新手榴弹
        this.updateGrenades(delta);

        // 更新伤害闪烁
        this.damageFlashIntensity.value = Math.max(0, this.damageFlashIntensity.value - delta * 3);

        // 生成逻辑
        this.spawnTimer += delta;
        if (this.spawnTimer > 3.0 && this.enemies.length < LevelConfig.enemySpawn.maxEnemies) {
            this.spawnEnemy();
            this.spawnTimer = 0;
        }

        this.pickupSpawnTimer += delta;
        // if (this.pickupSpawnTimer > 10.0) { // 已移除旧逻辑
        
        // 初始批量生成拾取物
        if (!this.initialPickupsSpawned && this.pickupSpawnTimer > 0) {
            for (let i = 0; i < 5; i++) {
                this.spawnPickup();
            }
            this.initialPickupsSpawned = true;
            this.pickupSpawnTimer = 0; // 重置计时器用于后续生成
        }

        // 后续周期性生成
        if (this.initialPickupsSpawned && this.pickupSpawnTimer > LevelConfig.pickupSpawn.spawnInterval / 1000) {
            if (this.pickups.length < LevelConfig.pickupSpawn.maxPickups) {
                this.spawnPickup();
            }
            this.pickupSpawnTimer = 0;
        }

        // 渲染 (使用后处理)
        this.postProcessing.render();

        // 第一帧渲染完成后调用加载回调
        if (!this.hasLoaded) {
            this.hasLoaded = true;
            if (this.onLoadedCallback) {
                this.onLoadedCallback();
            }
        }
    }

    /**
     * 更新拾取物
     */
    private updatePickups(playerPos: THREE.Vector3, delta: number) {
        for (let i = this.pickups.length - 1; i >= 0; i--) {
            const pickup = this.pickups[i];
            pickup.update(playerPos, delta);
            
            if (pickup.isCollected) {
                this.scene.remove(pickup.mesh);
                pickup.dispose();
                this.pickups.splice(i, 1);
            }
        }
    }
    
    /**
     * 尝试拾取物品 (玩家按F键触发)
     */
    private tryCollectPickup() {
        for (const pickup of this.pickups) {
            if (pickup.tryCollect()) {
                // 成功拾取一个就返回，不同时拾取多个
                return;
            }
        }
    }
    
    /**
     * 投掷手榴弹
     */
    private throwGrenade(position: THREE.Vector3, direction: THREE.Vector3) {
        const throwStrength = WeaponConfig.grenade.throwStrength;
        const grenade = new Grenade(
            position, 
            direction, 
            throwStrength, 
            this.scene, 
            this.objects,
            this.camera.position
        );
        
        grenade.setParticleSystem(this.particleSystem);
        grenade.setExplosionManager(this.explosionManager);
        grenade.setEnemies(this.enemies);
        grenade.setGroundHeightCallback((x, z) => this.level.getTerrainHeight(x, z));
        
        this.grenades.push(grenade);
        
        // 播放投掷音效
        SoundManager.getInstance().playGrenadeThrow();
    }
    
    /**
     * 更新手榴弹
     */
    private updateGrenades(delta: number) {
        // 更新爆炸特效管理器
        this.explosionManager.update(delta);
        
        for (let i = this.grenades.length - 1; i >= 0; i--) {
            const grenade = this.grenades[i];
            grenade.update(delta);
            
            if (!grenade.isActive) {
                grenade.dispose();
                this.grenades.splice(i, 1);
            }
        }
    }

    /**
     * 更新敌人
     */
    private updateEnemies(playerPos: THREE.Vector3, delta: number) {
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            
            // 更新敌人目标 (玩家位置)
            if (enemy.gpuIndex >= 0) {
                this.gpuCompute.setEnemyTarget(enemy.gpuIndex, playerPos);
            }
            
            // 更新敌人并获取射击结果
            const shootResult = enemy.update(playerPos, delta, this.objects, this.pathfinding);
            
            // 处理敌人射击
            if (shootResult.fired) {
                // 绘制敌人弹道轨迹
                const muzzlePos = enemy.getMuzzleWorldPosition();
                // 弹道终点：命中时指向玩家相机位置，未命中时沿射击方向延伸
                // 注意: playerPos 已经是相机位置，不需要再加偏移
                const trailEnd = shootResult.hit 
                    ? playerPos.clone()
                    : muzzlePos.clone().add(enemy.lastShotDirection.clone().multiplyScalar(50));
                
                // 创建弹道轨迹 (红色，与玩家弹道区分)
                this.createEnemyBulletTrail(muzzlePos, trailEnd);
                
                // 如果命中玩家
                if (shootResult.hit) {
                    GameStateService.getInstance().updateHealth(-shootResult.damage);
                    this.damageFlashIntensity.value = EffectConfig.damageFlash.intensity;
                    SoundManager.getInstance().playDamage();
                    
                    // 玩家受击粒子效果
                    this.particleSystem.emit({
                        type: 'spark',
                        position: playerPos.clone().add(new THREE.Vector3(0, 1, 0)),
                        direction: enemy.lastShotDirection.clone().negate(),
                        count: 5,
                        speed: { min: 1, max: 3 },
                        spread: 0.5,
                        color: { start: new THREE.Color(1, 0.1, 0.05), end: new THREE.Color(0.3, 0.02, 0.01) },
                        size: { start: 0.03, end: 0.01 },
                        lifetime: { min: 0.2, max: 0.4 },
                        gravity: -5,
                        drag: 0.95
                    });
                }
            }
            
            // 玩家碰撞检测 (近战伤害)
            const dist = enemy.mesh.position.distanceTo(playerPos);
            if (dist < 1.0) {
                GameStateService.getInstance().updateHealth(-10 * delta);
                
                // 触发伤害效果
                if (Math.random() < 0.1) {
                    this.damageFlashIntensity.value = EffectConfig.damageFlash.intensity * 0.7;
                    SoundManager.getInstance().playDamage();
                }
            }

            // 死亡处理
            if (enemy.isDead) {
                // 死亡粒子效果
                this.particleSystem.emitBlood(
                    enemy.mesh.position,
                    new THREE.Vector3(0, 1, 0),
                    20
                );
                
                this.scene.remove(enemy.mesh);
                
                if (enemy.gpuIndex >= 0) {
                    this.gpuCompute.setEnemyActive(enemy.gpuIndex, false);
                }
                
                enemy.dispose();
                this.enemies.splice(i, 1);
            }
        }
    }

    /**
     * 更新 FPS 显示
     */
    private updateFPS(delta: number) {
        this.frameCount++;
        this.lastFpsUpdate += delta;
        
        if (this.lastFpsUpdate >= 1.0) {
            this.currentFps = Math.round(this.frameCount / this.lastFpsUpdate);
            this.frameCount = 0;
            this.lastFpsUpdate = 0;
            
            // 可以将 FPS 发送到 UI
            // console.log('FPS:', this.currentFps);
        }
    }

    /**
     * 获取当前 FPS
     */
    public getFPS(): number {
        return this.currentFps;
    }

    /**
     * 获取粒子系统 (用于外部触发效果)
     */
    public getParticleSystem(): GPUParticleSystem {
        return this.particleSystem;
    }

    /**
     * 触发伤害效果
     */
    public triggerDamageEffect() {
        this.damageFlashIntensity.value = EffectConfig.damageFlash.intensity;
        this.uniformManager.triggerDamageFlash();
    }
    
    /**
     * 创建敌人弹道轨迹 (红色激光效果)
     */
    private createEnemyBulletTrail(start: THREE.Vector3, end: THREE.Vector3) {
        // 克隆向量避免被后续修改影响
        const startPos = start.clone();
        const endPos = end.clone();
        
        // 计算方向和长度
        const direction = new THREE.Vector3().subVectors(endPos, startPos);
        const length = direction.length();
        if (length < 0.1) return;
        direction.normalize();
        
        // 中点位置
        const midpoint = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5);
        
        // 计算旋转
        const defaultDir = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion();
        quaternion.setFromUnitVectors(defaultDir, direction);
        
        // 创建轨迹组
        const trailGroup = new THREE.Group();
        trailGroup.position.copy(midpoint);
        trailGroup.quaternion.copy(quaternion);
        trailGroup.userData = { isBulletTrail: true };
        
        // 主激光核心 (细亮线)
        const coreGeo = new THREE.CylinderGeometry(0.008, 0.008, length, 6, 1);
        const coreMaterial = new THREE.MeshBasicMaterial({
            color: 0xff6600,
            transparent: true,
            opacity: 1.0,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        const core = new THREE.Mesh(coreGeo, coreMaterial);
        trailGroup.add(core);
        
        // 内发光层
        const innerGlowGeo = new THREE.CylinderGeometry(0.025, 0.02, length, 8, 1);
        const innerGlowMaterial = new THREE.MeshBasicMaterial({
            color: 0xff3300,
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        const innerGlow = new THREE.Mesh(innerGlowGeo, innerGlowMaterial);
        trailGroup.add(innerGlow);
        
        // 外发光层 (更大更淡)
        const outerGlowGeo = new THREE.CylinderGeometry(0.05, 0.04, length, 8, 1);
        const outerGlowMaterial = new THREE.MeshBasicMaterial({
            color: 0xff2200,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });
        const outerGlow = new THREE.Mesh(outerGlowGeo, outerGlowMaterial);
        trailGroup.add(outerGlow);
        
        this.scene.add(trailGroup);
        
        // 淡出动画
        let opacity = 1.0;
        const fadeOut = () => {
            opacity -= 0.04;
            if (opacity > 0) {
                coreMaterial.opacity = opacity;
                innerGlowMaterial.opacity = opacity * 0.7;
                outerGlowMaterial.opacity = opacity * 0.35;
                requestAnimationFrame(fadeOut);
            } else {
                this.scene.remove(trailGroup);
                coreGeo.dispose();
                coreMaterial.dispose();
                innerGlowGeo.dispose();
                innerGlowMaterial.dispose();
                outerGlowGeo.dispose();
                outerGlowMaterial.dispose();
            }
        };
        
        // 延迟开始淡出
        setTimeout(fadeOut, 80);
    }

    /**
     * 销毁
     */
    public dispose() {
        this.playerController.dispose();
        this.particleSystem.dispose();
        this.explosionManager.dispose();
        this.gpuCompute.dispose();
        this.renderer.dispose();
        
        // 清理敌人
        this.enemies.forEach(e => {
            this.scene.remove(e.mesh);
            e.dispose();
        });
        
        // 清理拾取物
        this.pickups.forEach(p => {
            this.scene.remove(p.mesh);
            p.dispose();
        });
        
        // 清理手榴弹
        this.grenades.forEach(g => {
            g.dispose();
        });
        
        window.removeEventListener('resize', this.onWindowResize.bind(this));
        this.container.removeChild(this.renderer.domElement);
    }
}
