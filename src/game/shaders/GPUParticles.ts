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
    varying
} from 'three/tsl';

// @ts-ignore - WebGPU API
const StorageBufferAttribute = THREE.StorageBufferAttribute || class extends THREE.BufferAttribute {};

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
        this.positionBuffer = new StorageBufferAttribute(positions, 3);
        
        // 速度 (vec3)
        const velocities = new Float32Array(this.maxParticles * 3);
        // @ts-ignore - WebGPU API
        this.velocityBuffer = new StorageBufferAttribute(velocities, 3);
        
        // 颜色 (vec4: startR, startG, startB, endR) + (vec4: endG, endB, alpha, unused)
        // 简化为 RGBA
        const colors = new Float32Array(this.maxParticles * 4);
        // @ts-ignore - WebGPU API
        this.colorBuffer = new StorageBufferAttribute(colors, 4);
        
        // 大小 (vec2: startSize, endSize)
        const sizes = new Float32Array(this.maxParticles * 2);
        // @ts-ignore - WebGPU API
        this.sizeBuffer = new StorageBufferAttribute(sizes, 2);
        
        // 生命周期 (vec3: currentLife, maxLife, drag)
        const lives = new Float32Array(this.maxParticles * 3);
        // 初始化为已死亡状态
        for (let i = 0; i < this.maxParticles; i++) {
            lives[i * 3] = 999;     // currentLife > maxLife = dead
            lives[i * 3 + 1] = 1;   // maxLife
            lives[i * 3 + 2] = 0.98; // drag
        }
        // @ts-ignore - WebGPU API
        this.lifeBuffer = new StorageBufferAttribute(lives, 3);
        
        // 类型 (float: 用于颜色插值等)
        const types = new Float32Array(this.maxParticles);
        // @ts-ignore - WebGPU API
        this.typeBuffer = new StorageBufferAttribute(types, 1);
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
        
        // Billboard 逻辑：在 View Space 计算
        const viewPos = modelViewMatrix.mul(vec4(pPos, 1.0));
        viewPos.xy = viewPos.xy.add(positionLocal.xy.mul(size));
        
        // 覆盖 vertex shader 的 position
        // 注意：SpriteNodeMaterial 可能会有不同的处理方式，
        // 这里为了保险，我们使用 vertexNode 来覆盖最终位置或者 positionNode
        
        // 在新版 Three.js TSL 中，我们可以直接设置 material.positionNode
        // 这决定了 "模型的位置"。对于 InstancedMesh，这就是 Instance 的位置。
        // 但我们需要 Billboard 效果。
        
        material.positionNode = pPos;
        material.scaleNode = vec2(size);
        material.rotationNode = float(0); // 可选：如果有旋转
        
        // 颜色和透明度
        // 如果死了 (currentLife >= maxLife)，透明度设为 0
        const isDead = currentLife.greaterThanEqual(maxLife);
        const alpha = select(isDead, float(0), pColor.w);
        
        material.colorNode = vec4(pColor.xyz, alpha);
        
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
            
            // 旋转方向向量
            const dir = config.direction.clone().normalize();
            const perpX = new THREE.Vector3(1, 0, 0);
            const perpY = new THREE.Vector3(0, 1, 0);
            
            // 简单扩散
            const spreadDir = dir.clone()
                .applyAxisAngle(perpX, spreadAngle)
                .applyAxisAngle(perpY, spreadAngle2);
            
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
        this.emit({
            type: 'spark',
            position: position,
            direction: direction,
            spread: Math.PI * 0.5,
            speed: { min: 3, max: 8 },
            lifetime: { min: 0.2, max: 0.5 },
            size: { start: 0.03, end: 0.01 },
            color: GPUParticleSystem.COLORS.spark,
            gravity: -15,
            drag: 0.95,
            count: count
        });
    }

    /**
     * 预设发射器 - 血液 (增强版)
     * 产生多层血液效果：主飞溅、细小飞沫、滴落、血雾
     */
    public emitBlood(position: THREE.Vector3, direction: THREE.Vector3, count: number = 10) {
        // 主血液飞溅 - 较大、较快、更亮的红色
        this.emit({
            type: 'blood',
            position: position,
            direction: direction,
            spread: Math.PI * 0.5,
            speed: { min: 5, max: 12 },
            lifetime: { min: 0.5, max: 1.0 },
            size: { start: 0.1, end: 0.03 },
            color: { 
                start: new THREE.Color(1.0, 0.05, 0.02),  // 亮红色
                end: new THREE.Color(0.6, 0.02, 0.01) 
            },
            gravity: -12,
            drag: 0.88,
            count: Math.floor(count * 0.4)
        });
        
        // 细小飞沫 - 更分散、更小
        this.emit({
            type: 'blood',
            position: position,
            direction: direction,
            spread: Math.PI * 0.7,
            speed: { min: 3, max: 9 },
            lifetime: { min: 0.4, max: 0.7 },
            size: { start: 0.05, end: 0.015 },
            color: GPUParticleSystem.COLORS.blood,
            gravity: -18,
            drag: 0.82,
            count: Math.floor(count * 0.35)
        });
        
        // 血雾效果 - 悬浮的细小颗粒
        this.emit({
            type: 'blood',
            position: position,
            direction: direction,
            spread: Math.PI * 0.8,
            speed: { min: 1, max: 4 },
            lifetime: { min: 0.6, max: 1.2 },
            size: { start: 0.08, end: 0.04 },
            color: { 
                start: new THREE.Color(0.8, 0.03, 0.02),
                end: new THREE.Color(0.4, 0.02, 0.01) 
            },
            gravity: -5,
            drag: 0.96,
            count: Math.floor(count * 0.15)
        });
        
        // 慢速滴落 - 重力主导
        this.emit({
            type: 'blood',
            position: position,
            direction: new THREE.Vector3(
                direction.x * 0.2,
                0.8,  // 向上一点点然后下落
                direction.z * 0.2
            ),
            spread: Math.PI * 0.25,
            speed: { min: 2, max: 5 },
            lifetime: { min: 0.7, max: 1.3 },
            size: { start: 0.07, end: 0.025 },
            color: { 
                start: new THREE.Color(0.7, 0.02, 0.01),  // 深血红色
                end: new THREE.Color(0.35, 0.01, 0.005) 
            },
            gravity: -22,
            drag: 0.94,
            count: Math.floor(count * 0.1)
        });
    }

    /**
     * 预设发射器 - 烟雾
     */
    public emitSmoke(position: THREE.Vector3, count: number = 20) {
        this.emit({
            type: 'smoke',
            position: position,
            direction: new THREE.Vector3(0, 1, 0),
            spread: Math.PI * 0.3,
            speed: { min: 0.5, max: 2 },
            lifetime: { min: 0.5, max: 1.5 },
            size: { start: 0.1, end: 0.3 },
            color: GPUParticleSystem.COLORS.smoke,
            gravity: 2,  // 向上飘
            drag: 0.98,
            count: count
        });
    }

    /**
     * 预设发射器 - 枪口火焰
     */
    public emitMuzzleFlash(position: THREE.Vector3, direction: THREE.Vector3) {
        this.emit({
            type: 'muzzle',
            position: position,
            direction: direction,
            spread: Math.PI * 0.2,
            speed: { min: 5, max: 10 },
            lifetime: { min: 0.05, max: 0.1 },
            size: { start: 0.05, end: 0.02 },
            color: GPUParticleSystem.COLORS.muzzle,
            gravity: 0,
            drag: 0.9,
            count: 8
        });
    }

    /**
     * 预设发射器 - 爆炸
     */
    public emitExplosion(position: THREE.Vector3, count: number = 50) {
        // 火焰
        this.emit({
            type: 'explosion',
            position: position,
            direction: new THREE.Vector3(0, 1, 0),
            spread: Math.PI,  // 全方向
            speed: { min: 3, max: 8 },
            lifetime: { min: 0.3, max: 0.8 },
            size: { start: 0.15, end: 0.05 },
            color: GPUParticleSystem.COLORS.explosion,
            gravity: -5,
            drag: 0.95,
            count: count
        });
        
        // 烟雾
        this.emitSmoke(position, count / 2);
    }

    /**
     * 更新粒子系统
     */
    public update(delta: number) {
        this.deltaTime.value = delta;
        this.globalTime.value += delta;
        
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
