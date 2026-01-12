/**
 * GPU Compute System - 使用 TSL Compute Shader 进行高性能计算
 * 用于敌人AI更新、粒子系统、碰撞检测等
 */
import * as THREE from 'three';
import { StorageBufferAttribute, WebGPURenderer, type ComputeNode } from 'three/webgpu';
import {
    Fn, uniform, storage, instanceIndex,
    float, vec3, vec4,
    If,
    max, sqrt, select, sub
} from 'three/tsl';

// ============= 敌人数据结构 =============
export interface EnemyGPUData {
    positions: Float32Array;      // vec3: x, y, z
    velocities: Float32Array;     // vec3: vx, vy, vz
    states: Float32Array;         // vec4: health, speed, pathIndex, isActive
    targets: Float32Array;        // vec3: targetX, targetY, targetZ
}

// ============= 粒子数据结构 =============
export interface ParticleGPUData {
    positions: Float32Array;      // vec3
    velocities: Float32Array;     // vec3
    colors: Float32Array;         // vec4: r, g, b, a
    lifetimes: Float32Array;      // vec2: currentLife, maxLife
}

// ============= GPU Compute 管理器 =============
export class GPUComputeSystem {
    private renderer: WebGPURenderer;
    private maxEnemies: number;
    private maxParticles: number;
    
    // 敌人数据存储
    private enemyPositionBuffer!: StorageBufferAttribute;
    private enemyVelocityBuffer!: StorageBufferAttribute;
    private enemyStateBuffer!: StorageBufferAttribute;
    private enemyTargetBuffer!: StorageBufferAttribute;
    
    // 粒子数据存储
    private particlePositionBuffer!: StorageBufferAttribute;
    private particleVelocityBuffer!: StorageBufferAttribute;
    private particleColorBuffer!: StorageBufferAttribute;
    private particleLifetimeBuffer!: StorageBufferAttribute;
    
    // Uniforms
    private deltaTime = uniform(0);
    private playerPosition = uniform(new THREE.Vector3());
    private gravity = uniform(-9.8);

    // Compute 函数
    private enemyUpdateCompute!: ComputeNode;
    private particleUpdateCompute!: ComputeNode;

    constructor(renderer: WebGPURenderer, maxEnemies: number = 100, maxParticles: number = 10000) {
        this.renderer = renderer;
        this.maxEnemies = maxEnemies;
        this.maxParticles = maxParticles;
        
        this.initEnemyBuffers();
        this.initParticleBuffers();
        this.createEnemyComputeShader();
        this.createParticleComputeShader();
    }

    public getDebugInfo(): { maxEnemies: number; maxParticles: number } {
        return {
            maxEnemies: this.maxEnemies,
            maxParticles: this.maxParticles,
        };
    }

    // ============= 初始化敌人缓冲区 =============
    private initEnemyBuffers() {
        // 位置缓冲区 (vec3)
        const positions = new Float32Array(this.maxEnemies * 3);
        this.enemyPositionBuffer = new StorageBufferAttribute(positions, 3);
        
        // 速度缓冲区 (vec3)
        const velocities = new Float32Array(this.maxEnemies * 3);
        this.enemyVelocityBuffer = new StorageBufferAttribute(velocities, 3);
        
        // 状态缓冲区 (vec4: health, speed, pathIndex, isActive)
        const states = new Float32Array(this.maxEnemies * 4);
        this.enemyStateBuffer = new StorageBufferAttribute(states, 4);
        
        // 目标位置缓冲区 (vec3)
        const targets = new Float32Array(this.maxEnemies * 3);
        this.enemyTargetBuffer = new StorageBufferAttribute(targets, 3);
    }

    // ============= 初始化粒子缓冲区 =============
    private initParticleBuffers() {
        // 位置缓冲区 (vec3)
        const positions = new Float32Array(this.maxParticles * 3);
        this.particlePositionBuffer = new StorageBufferAttribute(positions, 3);
        
        // 速度缓冲区 (vec3)
        const velocities = new Float32Array(this.maxParticles * 3);
        this.particleVelocityBuffer = new StorageBufferAttribute(velocities, 3);
        
        // 颜色缓冲区 (vec4)
        const colors = new Float32Array(this.maxParticles * 4);
        this.particleColorBuffer = new StorageBufferAttribute(colors, 4);
        
        // 生命周期缓冲区 (vec2: current, max)
        const lifetimes = new Float32Array(this.maxParticles * 2);
        this.particleLifetimeBuffer = new StorageBufferAttribute(lifetimes, 2);
    }

    // ============= 敌人移动 Compute Shader =============
    private createEnemyComputeShader() {
        const positionStorage = storage(this.enemyPositionBuffer, 'vec3', this.maxEnemies);
        const velocityStorage = storage(this.enemyVelocityBuffer, 'vec3', this.maxEnemies);
        const stateStorage = storage(this.enemyStateBuffer, 'vec4', this.maxEnemies);
        const targetStorage = storage(this.enemyTargetBuffer, 'vec3', this.maxEnemies);

        // Compute Shader: 更新敌人位置
        this.enemyUpdateCompute = Fn(() => {
            const index = instanceIndex;
            
            // 读取当前状态
            const state = stateStorage.element(index);
            const isActive = state.w;
            
            // 只处理活跃的敌人
            If(isActive.greaterThan(0.5), () => {
                const position = positionStorage.element(index);
                const velocity = velocityStorage.element(index);
                const target = targetStorage.element(index);
                const speed = state.y;
                
                // 计算到目标的方向
                const toTarget = target.sub(position);
                const distXZ = sqrt(toTarget.x.mul(toTarget.x).add(toTarget.z.mul(toTarget.z)));
                
                // 归一化方向 (只在XZ平面)
                const dirX = select(distXZ.greaterThan(0.1), toTarget.x.div(distXZ), float(0));
                const dirZ = select(distXZ.greaterThan(0.1), toTarget.z.div(distXZ), float(0));
                
                // 更新速度
                const newVelX = dirX.mul(speed);
                const newVelZ = dirZ.mul(speed);
                
                // 应用重力
                const newVelY = velocity.y.add(this.gravity.mul(this.deltaTime));
                
                // 更新位置
                const newPosX = position.x.add(newVelX.mul(this.deltaTime));
                const newPosY = max(float(1), position.y.add(newVelY.mul(this.deltaTime))); // 保持在地面上
                const newPosZ = position.z.add(newVelZ.mul(this.deltaTime));
                
                // 写回缓冲区
                positionStorage.element(index).assign(vec3(newPosX, newPosY, newPosZ));
                velocityStorage.element(index).assign(vec3(newVelX, newVelY, newVelZ));
            });
        })().compute(this.maxEnemies);
    }

    // ============= 粒子更新 Compute Shader =============
    private createParticleComputeShader() {
        const positionStorage = storage(this.particlePositionBuffer, 'vec3', this.maxParticles);
        const velocityStorage = storage(this.particleVelocityBuffer, 'vec3', this.maxParticles);
        const colorStorage = storage(this.particleColorBuffer, 'vec4', this.maxParticles);
        const lifetimeStorage = storage(this.particleLifetimeBuffer, 'vec2', this.maxParticles);

        // Compute Shader: 更新粒子
        this.particleUpdateCompute = Fn(() => {
            const index = instanceIndex;
            
            const lifetime = lifetimeStorage.element(index);
            const currentLife = lifetime.x;
            const maxLife = lifetime.y;
            
            // 只处理存活的粒子
            If(currentLife.lessThan(maxLife), () => {
                const position = positionStorage.element(index);
                const velocity = velocityStorage.element(index);
                const color = colorStorage.element(index);
                
                // 更新生命周期
                const newLife = currentLife.add(this.deltaTime);
                const lifeRatio = newLife.div(maxLife);
                
                // 应用重力和阻力
                const drag = float(0.98);
                const newVelX = velocity.x.mul(drag);
                const newVelY = velocity.y.add(this.gravity.mul(this.deltaTime).mul(0.5));
                const newVelZ = velocity.z.mul(drag);
                
                // 更新位置
                const newPosX = position.x.add(newVelX.mul(this.deltaTime));
                const newPosY = position.y.add(newVelY.mul(this.deltaTime));
                const newPosZ = position.z.add(newVelZ.mul(this.deltaTime));
                
                // 淡出效果
                const fadeAlpha = sub(float(1), lifeRatio);
                const newAlpha = color.w.mul(fadeAlpha);
                
                // 写回缓冲区
                positionStorage.element(index).assign(vec3(newPosX, newPosY, newPosZ));
                velocityStorage.element(index).assign(vec3(newVelX, newVelY, newVelZ));
                colorStorage.element(index).assign(vec4(color.x, color.y, color.z, newAlpha));
                lifetimeStorage.element(index).assign(vec3(newLife, maxLife, 0).xy); // vec2
            });
        })().compute(this.maxParticles);
    }

    // ============= 更新敌人 =============
    public updateEnemies(delta: number, playerPos: THREE.Vector3) {
        this.deltaTime.value = delta;
        this.playerPosition.value.copy(playerPos);
        
        // 执行 Compute Shader
        this.renderer.computeAsync(this.enemyUpdateCompute);
    }

    // ============= 更新粒子 =============
    public updateParticles(delta: number) {
        this.deltaTime.value = delta;
        
        // 执行 Compute Shader
        this.renderer.computeAsync(this.particleUpdateCompute);
    }

    // ============= 设置敌人数据 =============
    public setEnemyData(index: number, position: THREE.Vector3, target: THREE.Vector3, speed: number, health: number) {
        const posArray = this.enemyPositionBuffer.array as Float32Array;
        const stateArray = this.enemyStateBuffer.array as Float32Array;
        const targetArray = this.enemyTargetBuffer.array as Float32Array;
        
        // 位置
        posArray[index * 3] = position.x;
        posArray[index * 3 + 1] = position.y;
        posArray[index * 3 + 2] = position.z;
        
        // 状态
        stateArray[index * 4] = health;
        stateArray[index * 4 + 1] = speed;
        stateArray[index * 4 + 2] = 0; // pathIndex
        stateArray[index * 4 + 3] = 1; // isActive
        
        // 目标
        targetArray[index * 3] = target.x;
        targetArray[index * 3 + 1] = target.y;
        targetArray[index * 3 + 2] = target.z;
        
        this.enemyPositionBuffer.needsUpdate = true;
        this.enemyStateBuffer.needsUpdate = true;
        this.enemyTargetBuffer.needsUpdate = true;
    }

    // ============= 获取敌人位置 =============
    public getEnemyPosition(index: number): THREE.Vector3 {
        const posArray = this.enemyPositionBuffer.array as Float32Array;
        return new THREE.Vector3(
            posArray[index * 3],
            posArray[index * 3 + 1],
            posArray[index * 3 + 2]
        );
    }

    // ============= 更新敌人目标 =============
    public setEnemyTarget(index: number, target: THREE.Vector3) {
        const targetArray = this.enemyTargetBuffer.array as Float32Array;
        targetArray[index * 3] = target.x;
        targetArray[index * 3 + 1] = target.y;
        targetArray[index * 3 + 2] = target.z;
        this.enemyTargetBuffer.needsUpdate = true;
    }

    // ============= 设置敌人状态 =============
    public setEnemyActive(index: number, active: boolean) {
        const stateArray = this.enemyStateBuffer.array as Float32Array;
        stateArray[index * 4 + 3] = active ? 1 : 0;
        this.enemyStateBuffer.needsUpdate = true;
    }

    // ============= 生成粒子 =============
    public spawnParticles(
        startIndex: number,
        count: number,
        position: THREE.Vector3,
        velocityRange: { min: THREE.Vector3, max: THREE.Vector3 },
        color: THREE.Color,
        lifetime: number
    ) {
        const posArray = this.particlePositionBuffer.array as Float32Array;
        const velArray = this.particleVelocityBuffer.array as Float32Array;
        const colorArray = this.particleColorBuffer.array as Float32Array;
        const lifeArray = this.particleLifetimeBuffer.array as Float32Array;
        
        for (let i = 0; i < count; i++) {
            const idx = (startIndex + i) % this.maxParticles;
            
            // 位置 (带小随机偏移)
            posArray[idx * 3] = position.x + (Math.random() - 0.5) * 0.2;
            posArray[idx * 3 + 1] = position.y + (Math.random() - 0.5) * 0.2;
            posArray[idx * 3 + 2] = position.z + (Math.random() - 0.5) * 0.2;
            
            // 随机速度
            velArray[idx * 3] = THREE.MathUtils.lerp(velocityRange.min.x, velocityRange.max.x, Math.random());
            velArray[idx * 3 + 1] = THREE.MathUtils.lerp(velocityRange.min.y, velocityRange.max.y, Math.random());
            velArray[idx * 3 + 2] = THREE.MathUtils.lerp(velocityRange.min.z, velocityRange.max.z, Math.random());
            
            // 颜色
            colorArray[idx * 4] = color.r;
            colorArray[idx * 4 + 1] = color.g;
            colorArray[idx * 4 + 2] = color.b;
            colorArray[idx * 4 + 3] = 1.0; // alpha
            
            // 生命周期
            lifeArray[idx * 2] = 0; // current
            lifeArray[idx * 2 + 1] = lifetime * (0.8 + Math.random() * 0.4); // max with variance
        }
        
        this.particlePositionBuffer.needsUpdate = true;
        this.particleVelocityBuffer.needsUpdate = true;
        this.particleColorBuffer.needsUpdate = true;
        this.particleLifetimeBuffer.needsUpdate = true;
    }

    // ============= 获取粒子缓冲区 (用于渲染) =============
    public getParticlePositionBuffer(): StorageBufferAttribute {
        return this.particlePositionBuffer;
    }

    public getParticleColorBuffer(): StorageBufferAttribute {
        return this.particleColorBuffer;
    }

    public getParticleLifetimeBuffer(): StorageBufferAttribute {
        return this.particleLifetimeBuffer;
    }

    // ============= 销毁 =============
    public dispose() {
        // 清理缓冲区
        this.enemyPositionBuffer.array = new Float32Array(0);
        this.enemyVelocityBuffer.array = new Float32Array(0);
        this.enemyStateBuffer.array = new Float32Array(0);
        this.enemyTargetBuffer.array = new Float32Array(0);
        this.particlePositionBuffer.array = new Float32Array(0);
        this.particleVelocityBuffer.array = new Float32Array(0);
        this.particleColorBuffer.array = new Float32Array(0);
        this.particleLifetimeBuffer.array = new Float32Array(0);
    }
}
