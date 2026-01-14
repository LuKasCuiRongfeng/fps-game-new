/**
 * ExplosionEffect - 超轻量爆炸特效
 * 使用简单的精灵图动画，避免复杂着色器
 */
import * as THREE from 'three';
import type { UniformNode } from 'three/webgpu';
import { SpriteNodeMaterial } from 'three/webgpu';
import { float, length, mix, smoothstep, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { EffectConfig } from '../core/GameConfig';
import { getUserData } from '../types/GameUserData';

// 爆炸实例数据
interface ExplosionInstance {
    position: THREE.Vector3;
    startTime: number;
    duration: number;
    maxRadius: number;
    mesh: THREE.Mesh;
    opacity: UniformNode<number>;
}

/**
 * 轻量爆炸管理器
 */
export class ExplosionManager {
    private scene: THREE.Scene;
    private explosions: ExplosionInstance[] = [];
    private meshPool: THREE.Mesh[] = [];
    private opacityPool: Array<UniformNode<number>> = [];
    private readonly poolSize: number = EffectConfig.explosion.poolSize;
    private readonly geometry = new THREE.PlaneGeometry(1, 1);

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.initPool();
    }
    
    private createExplosionMaterial(opacity: UniformNode<number>): SpriteNodeMaterial {
        const material = new SpriteNodeMaterial();
        material.transparent = true;
        material.blending = THREE.AdditiveBlending;
        material.depthWrite = false;

        const centered = uv().sub(vec2(0.5));
        const d = length(centered);

        // Radial gradient: white core -> yellow -> orange -> deep red -> transparent.
        const c0 = vec3(1.0, 0.98, 0.92);
        const c1 = vec3(1.0, 0.86, 0.35);
        const c2 = vec3(1.0, 0.55, 0.12);
        const c3 = vec3(0.78, 0.20, 0.05);
        const c4 = vec3(0.20, 0.04, 0.00);

        const t01 = smoothstep(float(0.00), float(0.18), d);
        const t12 = smoothstep(float(0.18), float(0.34), d);
        const t23 = smoothstep(float(0.34), float(0.52), d);
        const t34 = smoothstep(float(0.52), float(0.68), d);

        const col01 = mix(c0, c1, t01);
        const col12 = mix(col01, c2, t12);
        const col23 = mix(col12, c3, t23);
        const col = mix(col23, c4, t34);

        // Alpha: soft core + smooth edge falloff.
        const alpha = smoothstep(float(0.68), float(0.25), d).mul(opacity);

        material.colorNode = vec4(col, alpha);
        return material;
    }
    
    /**
     * 初始化对象池
     */
    private initPool(): void {
        for (let i = 0; i < this.poolSize; i++) {
            // Each instance gets its own opacity uniform.
            const opacity = uniform(1.0);
            const material = this.createExplosionMaterial(opacity);

            const mesh = new THREE.Mesh(this.geometry, material);
            mesh.visible = false;
            mesh.frustumCulled = false;
            getUserData(mesh).isEffect = true;
            // Prevent accidental raycasts from intersecting VFX quads.
            mesh.raycast = () => {};
            this.scene.add(mesh);

            this.meshPool.push(mesh);
            this.opacityPool.push(opacity);
        }
    }
    
    /**
     * 从对象池获取精灵
     */
    private getMeshFromPool(): { mesh: THREE.Mesh; opacity: UniformNode<number> } | null {
        for (let i = 0; i < this.meshPool.length; i++) {
            const mesh = this.meshPool[i];
            if (!mesh.visible) return { mesh, opacity: this.opacityPool[i] };
        }
        return null;
    }
    
    /**
     * 创建爆炸效果
     */
    public createExplosion(position: THREE.Vector3, radius: number = EffectConfig.explosion.maxScale): void {
        const pooled = this.getMeshFromPool();
        if (!pooled) return;

        const { mesh, opacity } = pooled;
        mesh.position.copy(position);
        mesh.scale.setScalar(EffectConfig.explosion.initialScale);
        mesh.visible = true;
        opacity.value = 1.0;
        
        const explosion: ExplosionInstance = {
            position: position.clone(),
            startTime: performance.now(),
            duration: EffectConfig.explosion.duration,
            maxRadius: radius * 2,
            mesh,
            opacity,
        };
        
        this.explosions.push(explosion);
    }
    
    /**
     * 更新所有爆炸
     */
    public update(_delta: number): void {
        const now = performance.now();
        
        for (let i = this.explosions.length - 1; i >= 0; i--) {
            const exp = this.explosions[i];
            const elapsed = now - exp.startTime;
            const progress = elapsed / exp.duration;
            
            if (progress >= 1.0) {
                exp.mesh.visible = false;
                this.explosions.splice(i, 1);
                continue;
            }
            
            // 快速扩展然后消失
            const scale = exp.maxRadius * (0.3 + progress * 0.7);
            const opacity = 1.0 - progress * progress;  // 二次衰减
            
            exp.mesh.scale.setScalar(scale);
            exp.opacity.value = opacity;
            
            // 轻微上飘
            exp.mesh.position.y = exp.position.y + progress * EffectConfig.explosion.floatUp;
        }
    }
    
    /**
     * 清理资源
     */
    public dispose(): void {
        this.explosions = [];

        for (const mesh of this.meshPool) {
            this.scene.remove(mesh);
            (mesh.material as THREE.Material).dispose();
        }

        this.meshPool = [];
        this.opacityPool = [];

        this.geometry.dispose();
    }
}
