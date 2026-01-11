/**
 * GPU 粒子系统 - 使用 TSL Compute Shader 实现高性能粒子
 * 支持数万粒子的实时模拟
 */
import * as THREE from 'three';
// @ts-ignore - WebGPU types not fully available
import { WebGPURenderer, SpriteNodeMaterial } from 'three/webgpu';
import {
    Fn, uniform, storage, instanceIndex,
    float, vec2, vec3, vec4,
    If,
    sub, abs, pow,
    select,
    mix,
    positionLocal,
    modelViewMatrix,
    varying,
    uv, length, smoothstep, sin, atan
} from 'three/tsl';

import { createStorageBufferAttribute } from './StorageBufferAttributeCompat';

// 粒子类型
export type ParticleType = 'spark' | 'smoke' | 'blood' | 'debris' | 'muzzle' | 'explosion';

// 粒子发射器配置
export interface EmitterConfig {
    type: ParticleType;
    position: THREE.Vector3;
    direction: THREE.Vector3;
    spread: number;         // 扩散角度 (弧度)
    speed: { min: number; max: number };
    lifetime: { min: number; max: number };
    size: { start: number; end: number };
    color: { start: THREE.Color; end: THREE.Color };
    gravity: number;
    drag: number;
    count: number;
}

/**
 * GPU 粒子系统
 */
export class GPUParticleSystem {
    private renderer: WebGPURenderer;
    private maxParticles: number;
    private scene: THREE.Scene;
    
    // GPU 缓冲区 (使用 any 类型绕过 WebGPU 类型问题)
    private positionBuffer!: any;
    private velocityBuffer!: any;
    private colorBuffer!: any;
    private sizeBuffer!: any;
    private lifeBuffer!: any;      // vec2: currentLife, maxLife
    private typeBuffer!: any;      // int: particle type
    
    // Compute Shader Uniforms
    private deltaTime = uniform(0);
    private globalTime = uniform(0);
    private gravity = uniform(new THREE.Vector3(0, -9.8, 0));
    
    // Compute 函数
    private updateCompute: any;
    
    // 渲染
    private particleMesh!: THREE.InstancedMesh;
    private particleIndex: number = 0;

    // Perf: compute dispatch is expensive even when no particles are alive.
    // Track an approximate "active window" so we can skip compute work at idle.
    private hasActiveParticles = false;
    private activeUntilTime = 0;
    private didInitialCompute = false;
    private readonly activeTimeMargin = 0.15; // safety margin to avoid freezing particles near end-of-life

    // Reuse vectors in emit() to avoid heavy GC on shooting
    private readonly emitAxisX = new THREE.Vector3(1, 0, 0);
    private readonly emitAxisY = new THREE.Vector3(0, 1, 0);
    private readonly tmpEmitDir = new THREE.Vector3();
    private readonly tmpSpreadDir = new THREE.Vector3();

    private readonly tmpPresetPosition = new THREE.Vector3();
    private readonly tmpPresetDirection = new THREE.Vector3();
    private readonly tmpBloodDripDirection = new THREE.Vector3();
    private readonly presetConfig: EmitterConfig = {
        type: 'spark',
        position: this.tmpPresetPosition,
        direction: this.tmpPresetDirection,
        spread: 0,
        speed: { min: 0, max: 0 },
        lifetime: { min: 0, max: 0 },
        size: { start: 0, end: 0 },
        color: GPUParticleSystem.COLORS.spark,
        gravity: 0,
        drag: 1,
        count: 0,
    };

    private static readonly BLOOD_BRIGHT = {
        start: new THREE.Color(1.0, 0.05, 0.02),
        end: new THREE.Color(0.6, 0.02, 0.01),
    };
    private static readonly BLOOD_FOG = {
        start: new THREE.Color(0.8, 0.03, 0.02),
        end: new THREE.Color(0.4, 0.02, 0.01),
    };
    private static readonly BLOOD_DARK = {
        start: new THREE.Color(0.7, 0.02, 0.01),
        end: new THREE.Color(0.35, 0.01, 0.005),
    };

    private emitPreset(
        type: ParticleType,
        position: THREE.Vector3,
        direction: THREE.Vector3,
        spread: number,
        speedMin: number,
        speedMax: number,
        lifeMin: number,
        lifeMax: number,
        sizeStart: number,
        sizeEnd: number,
        gravity: number,
        drag: number,
        count: number,
        colorOverride?: { start: THREE.Color; end: THREE.Color }
    ) {
        const cfg = this.presetConfig;
        cfg.type = type;
        cfg.position.copy(position);
        cfg.direction.copy(direction);
        cfg.spread = spread;
        cfg.speed.min = speedMin;
        cfg.speed.max = speedMax;
        cfg.lifetime.min = lifeMin;
        cfg.lifetime.max = lifeMax;
        cfg.size.start = sizeStart;
        cfg.size.end = sizeEnd;
        cfg.gravity = gravity;
        cfg.drag = drag;
        cfg.count = count;
        cfg.color = colorOverride ?? (GPUParticleSystem.COLORS[type] || GPUParticleSystem.COLORS.spark);

        this.emit(cfg);
    }
    
    // 预设颜色
    private static readonly COLORS = {
        spark: { start: new THREE.Color(1, 0.9, 0.5), end: new THREE.Color(1, 0.3, 0) },
        smoke: { start: new THREE.Color(0.5, 0.5, 0.5), end: new THREE.Color(0.2, 0.2, 0.2) },
        blood: { start: new THREE.Color(0.9, 0.02, 0.01), end: new THREE.Color(0.5, 0.01, 0.005) },
        debris: { start: new THREE.Color(0.6, 0.5, 0.4), end: new THREE.Color(0.3, 0.25, 0.2) },
        muzzle: { start: new THREE.Color(1, 1, 0.9), end: new THREE.Color(1, 0.5, 0.1) },
        explosion: { start: new THREE.Color(1, 0.8, 0.3), end: new THREE.Color(0.8, 0.2, 0) }
    };

    constructor(renderer: WebGPURenderer, scene: THREE.Scene, maxParticles: number = 50000) {
        this.renderer = renderer;
        this.scene = scene;
        this.maxParticles = maxParticles;
        
        this.initBuffers();
        this.createComputeShader();
        this.createParticleMesh();
    }

    /**
     * 初始化 GPU 缓冲区
     */
    private initBuffers() {
        // 位置 (vec3)
        const positions = new Float32Array(this.maxParticles * 3);
        // @ts-ignore - WebGPU API
        this.positionBuffer = createStorageBufferAttribute(positions, 3);
        
        // 速度 (vec3)
        const velocities = new Float32Array(this.maxParticles * 3);
        // @ts-ignore - WebGPU API
        this.velocityBuffer = createStorageBufferAttribute(velocities, 3);
        
        // 颜色 (vec4: startR, startG, startB, endR) + (vec4: endG, endB, alpha, unused)
        // 简化为 RGBA
        const colors = new Float32Array(this.maxParticles * 4);
        // @ts-ignore - WebGPU API
        this.colorBuffer = createStorageBufferAttribute(colors, 4);
        
        // 大小 (vec2: startSize, endSize)
        const sizes = new Float32Array(this.maxParticles * 2);
        // @ts-ignore - WebGPU API
        this.sizeBuffer = createStorageBufferAttribute(sizes, 2);
        
        // 生命周期 (vec3: currentLife, maxLife, drag)
        const lives = new Float32Array(this.maxParticles * 3);
        // 初始化为已死亡状态
        for (let i = 0; i < this.maxParticles; i++) {
            lives[i * 3] = 999;     // currentLife > maxLife = dead
            lives[i * 3 + 1] = 1;   // maxLife
            lives[i * 3 + 2] = 0.98; // drag
        }
        // @ts-ignore - WebGPU API
        this.lifeBuffer = createStorageBufferAttribute(lives, 3);
        
        // 类型 (float: 用于颜色插值等)
        const types = new Float32Array(this.maxParticles);
        // @ts-ignore - WebGPU API
        this.typeBuffer = createStorageBufferAttribute(types, 1);
    }

    /**
     * 创建 Compute Shader
     */
    private createComputeShader() {
        const positionStorage = storage(this.positionBuffer, 'vec3', this.maxParticles);
        const velocityStorage = storage(this.velocityBuffer, 'vec3', this.maxParticles);
        const colorStorage = storage(this.colorBuffer, 'vec4', this.maxParticles);
        const sizeStorage = storage(this.sizeBuffer, 'vec2', this.maxParticles);
        const lifeStorage = storage(this.lifeBuffer, 'vec3', this.maxParticles);

        this.updateCompute = Fn(() => {
            const index = instanceIndex;
            
            // 读取生命周期数据
            const lifeData = lifeStorage.element(index);
            const currentLife = lifeData.x;
            const maxLife = lifeData.y;
            const drag = lifeData.z;
            
            // 只处理存活的粒子 (currentLife < maxLife)
            If(currentLife.lessThan(maxLife), () => {
                // 读取数据
                const position = positionStorage.element(index);
                const velocity = velocityStorage.element(index);
                const color = colorStorage.element(index);
                const sizeData = sizeStorage.element(index);
                
                // 更新生命周期
                const newLife = currentLife.add(this.deltaTime);
                const lifeRatio = newLife.div(maxLife);
                
                // 应用重力
                const newVelY = velocity.y.add(this.gravity.y.mul(this.deltaTime));
                
                // 应用阻力
                const newVelX = velocity.x.mul(drag);
                const newVelZ = velocity.z.mul(drag);
                
                // 更新位置
                const newPosX = position.x.add(velocity.x.mul(this.deltaTime));
                const newPosY = position.y.add(velocity.y.mul(this.deltaTime));
                const newPosZ = position.z.add(velocity.z.mul(this.deltaTime));
                
                // 地面碰撞 (简单反弹)
                const groundY = float(0.05);
                const finalPosY = select(
                    newPosY.lessThan(groundY),
                    groundY,
                    newPosY
                );
                const finalVelY = select(
                    newPosY.lessThan(groundY),
                    abs(newVelY).mul(0.3).mul(drag),  // 反弹并衰减
                    newVelY
                );
                
                // 淡出
                const fadeAlpha = sub(float(1), pow(lifeRatio, float(2)));
                const newAlpha = fadeAlpha;
                
                // 写回缓冲区
                positionStorage.element(index).assign(vec3(newPosX, finalPosY, newPosZ));
                velocityStorage.element(index).assign(vec3(newVelX, finalVelY, newVelZ));
                colorStorage.element(index).assign(vec4(color.x, color.y, color.z, newAlpha));
                lifeStorage.element(index).assign(vec3(newLife, maxLife, drag));
            });
        })().compute(this.maxParticles);
    }

    /**
     * 创建粒子渲染网格 - 纯 GPU TSL 驱动
     */
    private createParticleMesh() {
        // 使用 PlaneGeometry (Billboard)
        const geometry = new THREE.PlaneGeometry(1, 1);
        
        // 粒子材质
        const material = this.createParticleMaterial();
        
        // 实例化网格
        this.particleMesh = new THREE.InstancedMesh(geometry, material, this.maxParticles);
        this.particleMesh.frustumCulled = false;
        // 不再需要 instanceMatrix
        // this.particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); 
        
        this.scene.add(this.particleMesh);
    }

    /**
     * 创建粒子材质 - TSL 驱动
     */
    private createParticleMaterial(): THREE.Material {
        // 注意：这里需要重新获取 storage 引用，因为它们是 Shader 节点
        const positionStorage = storage(this.positionBuffer, 'vec3', this.maxParticles);
        const colorStorage = storage(this.colorBuffer, 'vec4', this.maxParticles);
        const sizeStorage = storage(this.sizeBuffer, 'vec2', this.maxParticles);
        const lifeStorage = storage(this.lifeBuffer, 'vec3', this.maxParticles);

        const material = new SpriteNodeMaterial();
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        
        // TSL 顶点逻辑
        const index = instanceIndex;
        
        // 获取粒子数据
        const pPos = positionStorage.element(index);
        const pColor = colorStorage.element(index);
        const pSize = sizeStorage.element(index);
        const pLife = lifeStorage.element(index);
        
        const currentLife = pLife.x;
        const maxLife = pLife.y;
        
        // 计算大小插值
        const lifeRatio = currentLife.div(maxLife);
        const size = mix(pSize.x, pSize.y, lifeRatio);
        
        // 设置位置 (SpriteNodeMaterial 默认处理 Billboard，我们只需要给 positionNode 设置世界坐标)
        // 但我们要让它变大变小，所以使用 scaleNode (如果没有直接提供，可以通过 positionNode 实现)
        // SpriteNodeMaterial 的 positionNode = "position of the sprite center in world space"
        
        // 修正：SpriteNodeMaterial 将整个 Mesh 视为一个 Sprite，如果是 InstancedMesh，我们需要重写 positionNode
        // 来包含 instance 位置 + local vertex position * size
        
        // 覆盖 vertex shader 的 position
        // 注意：SpriteNodeMaterial 可能会有不同的处理方式，
        // 这里为了保险，我们使用 vertexNode 来覆盖最终位置或者 positionNode
        
        // 在新版 Three.js TSL 中，我们可以直接设置 material.positionNode
        // 这决定了 "模型的位置"。对于 InstancedMesh，这就是 Instance 的位置。
        // 但我们需要 Billboard 效果。
        
        material.positionNode = pPos;
        material.scaleNode = vec2(size);
        material.rotationNode = float(0); // 可选：如果有旋转
        
        // --------------------------------------------------------
        //   改进的粒子形状 (不再是方块)
        // --------------------------------------------------------
        const uvNode = uv(); // 获取 Sprite UV (0..1)
        const centeredUV = uvNode.sub(vec2(0.5)); // -0.5 .. 0.5
        const distSq = centeredUV.x.mul(centeredUV.x).add(centeredUV.y.mul(centeredUV.y)); // r^2
        const dist = length(centeredUV); // r

        // 根据 typeBuffer 的值 (int) 来决定形状
        // 0:spark, 1:smoke, 2:blood, 3:debris, 4:muzzle, 5:explosion
        // 注意：WebGPU 中 int 比较通常用 equal
        // 此处为了性能和 TSL 兼容性，我们用 float 比较或者简单的通用圆形衰减

        // 通用的软圆形发光点 (模拟火花、光点)
        // 边缘软化：从中心 0 到边缘 0.5，强度从 1 降到 0
        // smoothstep(0.5, 0.0, dist) -> 边缘是 0 (硬切)，我们需要让它自然消散
        const circleShape = smoothstep(float(0.5), float(0.2), dist);

        // 如果是烟雾或爆炸，我们要更柔和、更像云团的形状
        // 简单的云雾噪声模拟 (基于 UV)
        const cloudNoise = sin(uvNode.x.mul(10.0)).mul(sin(uvNode.y.mul(10.0))).mul(0.2); 
        const cloudShape = smoothstep(float(0.5), float(0.0), dist.add(cloudNoise));

        // 如果是碎片 (debris/blood)，可能稍微锐利一点
        const hardShape = smoothstep(float(0.5), float(0.4), dist);

        // 由于这是所有粒子的统一 Shader (Instanced)，我们需要做出取舍或者根据额外属性分支
        // 这里我们先使用一个通用的漂亮的 "光晕点" 形状，它比方块好得多
        // 并在中心极亮。
        
        // 核心两倍亮度，边缘快速衰减
        const glow = float(0.05).div(distSq.add(0.01)); // 物理反平方衰减模拟
        const softCircle = smoothstep(float(0.5), float(0.0), dist);
        
        // 最终透明度形状：结合辉光和软圆，防止无限大
        const shapePre = glow.mul(softCircle).min(1.0);

        // 颜色和透明度
        // 如果死了 (currentLife >= maxLife)，透明度设为 0
        const isDead = currentLife.greaterThanEqual(maxLife);
        const alphaBase = select(isDead, float(0), pColor.w);
        
        // 最终 Alpha = 粒子自身 Alpha * 形状 Alpha
        const finalAlpha = alphaBase.mul(shapePre);
        
        // 丢弃过暗的像素 (Clip)
        // 避免不可见的片元写入深度或消耗混合带宽
        // if (finalAlpha < 0.01) discard; 
        // TSL 中用 discard(expr) 或直接通过 alpha 混合

        material.colorNode = vec4(pColor.xyz, finalAlpha);
        
        return material;
    }

    /**
     * 发射粒子
     */
    public emit(config: EmitterConfig) {
        const posArray = this.positionBuffer.array as Float32Array;
        const velArray = this.velocityBuffer.array as Float32Array;
        const colorArray = this.colorBuffer.array as Float32Array;
        const sizeArray = this.sizeBuffer.array as Float32Array;
        const lifeArray = this.lifeBuffer.array as Float32Array;
        
        const colors = GPUParticleSystem.COLORS[config.type] || GPUParticleSystem.COLORS.spark;

        // Avoid per-particle allocations in hot loops (clone/new)
        const baseDir = this.tmpEmitDir.copy(config.direction);
        if (baseDir.lengthSq() > 1e-10) baseDir.normalize();
        else baseDir.set(0, 1, 0);
        const axisX = this.emitAxisX;
        const axisY = this.emitAxisY;
        const spreadDir = this.tmpSpreadDir;
        
        for (let i = 0; i < config.count; i++) {
            const idx = (this.particleIndex + i) % this.maxParticles;
            
            // 位置 (带小随机偏移)
            posArray[idx * 3] = config.position.x + (Math.random() - 0.5) * 0.1;
            posArray[idx * 3 + 1] = config.position.y + (Math.random() - 0.5) * 0.1;
            posArray[idx * 3 + 2] = config.position.z + (Math.random() - 0.5) * 0.1;
            
            // 计算速度 (基于方向和扩散)
            const spreadAngle = (Math.random() - 0.5) * config.spread;
            const spreadAngle2 = (Math.random() - 0.5) * config.spread;
            
            const speed = THREE.MathUtils.lerp(config.speed.min, config.speed.max, Math.random());

            // 简单扩散
            spreadDir
                .copy(baseDir)
                .applyAxisAngle(axisX, spreadAngle)
                .applyAxisAngle(axisY, spreadAngle2);
            
            velArray[idx * 3] = spreadDir.x * speed;
            velArray[idx * 3 + 1] = spreadDir.y * speed;
            velArray[idx * 3 + 2] = spreadDir.z * speed;
            
            // 颜色 (使用起始颜色，结束颜色在 shader 中插值)
            const colorVariation = 1 - Math.random() * 0.2;
            colorArray[idx * 4] = colors.start.r * colorVariation;
            colorArray[idx * 4 + 1] = colors.start.g * colorVariation;
            colorArray[idx * 4 + 2] = colors.start.b * colorVariation;
            colorArray[idx * 4 + 3] = 1.0;
            
            // 大小
            sizeArray[idx * 2] = config.size.start * (0.8 + Math.random() * 0.4);
            sizeArray[idx * 2 + 1] = config.size.end;
            
            // 生命周期
            const lifetime = THREE.MathUtils.lerp(config.lifetime.min, config.lifetime.max, Math.random());
            lifeArray[idx * 3] = 0;                // currentLife
            lifeArray[idx * 3 + 1] = lifetime;     // maxLife
            lifeArray[idx * 3 + 2] = config.drag;  // drag
        }
        
        this.particleIndex = (this.particleIndex + config.count) % this.maxParticles;

        // Mark system as active for at least the maximum possible lifetime.
        // This allows update() to skip compute dispatch when everything should be dead.
        if (config.count > 0) {
            this.hasActiveParticles = true;
            const until = this.globalTime.value + (config.lifetime?.max ?? 0) + this.activeTimeMargin;
            if (until > this.activeUntilTime) this.activeUntilTime = until;
        }
        
        // 标记缓冲区需要更新
        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.colorBuffer.needsUpdate = true;
        this.sizeBuffer.needsUpdate = true;
        this.lifeBuffer.needsUpdate = true;
    }

    /**
     * 预设发射器 - 火花
     */
    public emitSparks(position: THREE.Vector3, direction: THREE.Vector3, count: number = 15) {
        this.emitPreset(
            'spark',
            position,
            direction,
            Math.PI * 0.5,
            3,
            8,
            0.2,
            0.5,
            0.03,
            0.01,
            -15,
            0.95,
            count
        );
    }

    /**
     * 预设发射器 - 血液 (增强版)
     * 产生多层血液效果：主飞溅、细小飞沫、滴落、血雾
     */
    public emitBlood(position: THREE.Vector3, direction: THREE.Vector3, count: number = 10) {
        // 主血液飞溅 - 较大、较快、更亮的红色
        this.emitPreset(
            'blood',
            position,
            direction,
            Math.PI * 0.5,
            5,
            12,
            0.5,
            1.0,
            0.1,
            0.03,
            -12,
            0.88,
            Math.floor(count * 0.4),
            GPUParticleSystem.BLOOD_BRIGHT
        );
        
        // 细小飞沫 - 更分散、更小
        this.emitPreset(
            'blood',
            position,
            direction,
            Math.PI * 0.7,
            3,
            9,
            0.4,
            0.7,
            0.05,
            0.015,
            -18,
            0.82,
            Math.floor(count * 0.35)
        );
        
        // 血雾效果 - 悬浮的细小颗粒
        this.emitPreset(
            'blood',
            position,
            direction,
            Math.PI * 0.8,
            1,
            4,
            0.6,
            1.2,
            0.08,
            0.04,
            -5,
            0.96,
            Math.floor(count * 0.15),
            GPUParticleSystem.BLOOD_FOG
        );
        
        // 慢速滴落 - 重力主导
        this.tmpBloodDripDirection.set(direction.x * 0.2, 0.8, direction.z * 0.2);
        this.emitPreset(
            'blood',
            position,
            this.tmpBloodDripDirection,
            Math.PI * 0.25,
            2,
            5,
            0.7,
            1.3,
            0.07,
            0.025,
            -22,
            0.94,
            Math.floor(count * 0.1),
            GPUParticleSystem.BLOOD_DARK
        );
    }

    /**
     * 预设发射器 - 烟雾
     */
    public emitSmoke(position: THREE.Vector3, count: number = 20) {
        this.tmpPresetDirection.set(0, 1, 0);
        this.emitPreset(
            'smoke',
            position,
            this.tmpPresetDirection,
            Math.PI * 0.3,
            0.5,
            2,
            0.5,
            1.5,
            0.1,
            0.3,
            2,
            0.98,
            count
        );
    }

    /**
     * 预设发射器 - 枪口火焰
     */
    public emitMuzzleFlash(position: THREE.Vector3, direction: THREE.Vector3) {
        this.emitPreset(
            'muzzle',
            position,
            direction,
            Math.PI * 0.2,
            5,
            10,
            0.05,
            0.1,
            0.05,
            0.02,
            0,
            0.9,
            8
        );
    }

    /**
     * 预设发射器 - 爆炸
     */
    public emitExplosion(position: THREE.Vector3, count: number = 50) {
        // 火焰
        this.tmpPresetDirection.set(0, 1, 0);
        this.emitPreset(
            'explosion',
            position,
            this.tmpPresetDirection,
            Math.PI,
            3,
            8,
            0.3,
            0.8,
            0.15,
            0.05,
            -5,
            0.95,
            count
        );
        
        // 烟雾
        this.emitSmoke(position, count / 2);
    }

    /**
     * 更新粒子系统
     */
    public update(delta: number) {
        this.deltaTime.value = delta;
        this.globalTime.value += delta;

        // Ensure we dispatch at least once early so WebGPU pipelines/resources get compiled during warmup.
        if (!this.didInitialCompute) {
            this.didInitialCompute = true;
            this.renderer.computeAsync(this.updateCompute);
            return;
        }

        // Idle fast-path: skip compute work when no particles are expected to be alive.
        if (!this.hasActiveParticles) return;
        if (this.globalTime.value > this.activeUntilTime) {
            this.hasActiveParticles = false;
            return;
        }

        // 执行 Compute Shader
        this.renderer.computeAsync(this.updateCompute);
        
        // 不需要 CPU 端循环更新实例矩阵
        // TSL 材质会自动读取 Storage Buffer
    }

    /**
     * 更新实例矩阵 (CPU 端，用于实际渲染)
     * @deprecated 使用 TSL Material 不需要此方法
     */
    private updateInstanceMatrices() {
        // 已弃用，直接移除逻辑
    }

    /**
     * 销毁
     */
    public dispose() {
        this.scene.remove(this.particleMesh);
        this.particleMesh.geometry.dispose();
        (this.particleMesh.material as THREE.Material).dispose();
        
        // 清理缓冲区
        this.positionBuffer.array = new Float32Array(0);
        this.velocityBuffer.array = new Float32Array(0);
        this.colorBuffer.array = new Float32Array(0);
        this.sizeBuffer.array = new Float32Array(0);
        this.lifeBuffer.array = new Float32Array(0);
        this.typeBuffer.array = new Float32Array(0);
    }
}
