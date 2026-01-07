/**
 * ExplosionEffect - 超轻量爆炸特效
 * 使用简单的精灵图动画，避免复杂着色器
 */
import * as THREE from 'three';
import { EffectConfig } from '../core/GameConfig';

// 爆炸实例数据
interface ExplosionInstance {
    position: THREE.Vector3;
    startTime: number;
    duration: number;
    maxRadius: number;
    sprite: THREE.Sprite;
}

/**
 * 轻量爆炸管理器
 */
export class ExplosionManager {
    private scene: THREE.Scene;
    private explosions: ExplosionInstance[] = [];
    private spritePool: THREE.Sprite[] = [];
    private readonly poolSize: number = EffectConfig.explosion.poolSize;
    private material!: THREE.SpriteMaterial;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.initMaterial();
        this.initPool();
    }
    
    /**
     * 创建渐变纹理
     */
    private createGradientTexture(): THREE.CanvasTexture {
        const size = 64;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        
        // 径向渐变: 白核心 -> 黄 -> 橙 -> 红 -> 透明
        const gradient = ctx.createRadialGradient(
            size / 2, size / 2, 0,
            size / 2, size / 2, size / 2
        );
        gradient.addColorStop(0, 'rgba(255, 255, 240, 1)');
        gradient.addColorStop(0.2, 'rgba(255, 220, 100, 1)');
        gradient.addColorStop(0.4, 'rgba(255, 150, 50, 0.9)');
        gradient.addColorStop(0.7, 'rgba(200, 50, 10, 0.6)');
        gradient.addColorStop(1, 'rgba(50, 10, 0, 0)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        return texture;
    }
    
    /**
     * 初始化材质
     */
    private initMaterial(): void {
        this.material = new THREE.SpriteMaterial({
            map: this.createGradientTexture(),
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });
    }
    
    /**
     * 初始化对象池
     */
    private initPool(): void {
        for (let i = 0; i < this.poolSize; i++) {
            // 每个精灵需要独立的材质来控制透明度
            const mat = this.material.clone();
            const sprite = new THREE.Sprite(mat);
            sprite.visible = false;
            this.scene.add(sprite);
            this.spritePool.push(sprite);
        }
    }
    
    /**
     * 从对象池获取精灵
     */
    private getSpriteFromPool(): THREE.Sprite | null {
        for (const sprite of this.spritePool) {
            if (!sprite.visible) {
                return sprite;
            }
        }
        return null;
    }
    
    /**
     * 创建爆炸效果
     */
    public createExplosion(position: THREE.Vector3, radius: number = EffectConfig.explosion.maxScale): void {
        const sprite = this.getSpriteFromPool();
        if (!sprite) return;
        
        sprite.position.copy(position);
        sprite.scale.setScalar(EffectConfig.explosion.initialScale);
        sprite.visible = true;
        (sprite.material as THREE.SpriteMaterial).opacity = 1.0;
        
        const explosion: ExplosionInstance = {
            position: position.clone(),
            startTime: performance.now(),
            duration: EffectConfig.explosion.duration,
            maxRadius: radius * 2,
            sprite: sprite
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
                exp.sprite.visible = false;
                this.explosions.splice(i, 1);
                continue;
            }
            
            // 快速扩展然后消失
            const scale = exp.maxRadius * (0.3 + progress * 0.7);
            const opacity = 1.0 - progress * progress;  // 二次衰减
            
            exp.sprite.scale.setScalar(scale);
            (exp.sprite.material as THREE.SpriteMaterial).opacity = opacity;
            
            // 轻微上飘
            exp.sprite.position.y = exp.position.y + progress * EffectConfig.explosion.floatUp;
        }
    }
    
    /**
     * 清理资源
     */
    public dispose(): void {
        this.explosions = [];
        
        for (const sprite of this.spritePool) {
            this.scene.remove(sprite);
            (sprite.material as THREE.Material).dispose();
        }
        
        this.material.dispose();
        if (this.material.map) {
            this.material.map.dispose();
        }
    }
}
