import * as THREE from 'three';
import { MeshBasicNodeMaterial, SpriteNodeMaterial } from 'three/webgpu';
import { 
    uniform, time, sin, vec2, vec3, vec4, float, 
    smoothstep, uv, sub, abs, length
} from 'three/tsl';

/**
 * 弹道轨迹类 - 使用 TSL 增强的子弹轨迹
 * 使用圆柱体网格实现更好的视觉效果
 */
export class BulletTrail {
    // 共享几何体 (单位高度 1，中心在原点)
    private static mainGeometry = new THREE.CylinderGeometry(0.003, 0.003, 1, 4, 1);
    private static glowGeometry = new THREE.CylinderGeometry(0.015, 0.008, 1, 6, 1);

    public mesh: THREE.Group;
    public isDead: boolean = false;
    private lifetime: number = 0;
    private maxLifetime: number = 0.15;
    private trailOpacity: ReturnType<typeof uniform>;
    private trailLength: number = 1;

    private mainTrail: THREE.Mesh;
    private glowTrail: THREE.Mesh;

    constructor() {
        this.trailOpacity = uniform(1.0);
        
        this.mesh = new THREE.Group();
        this.mesh.userData = { isBulletTrail: true };
        
        // 创建材质 (每个实例独立，因为 uniforms 是绑定的)
        // 创建主轨迹
        const mainMaterial = this.createMainMaterial();
        this.mainTrail = new THREE.Mesh(BulletTrail.mainGeometry, mainMaterial);
        
        // 但这里我们之后统一旋转整个 Group
        this.mesh.add(this.mainTrail);
        
        // 创建发光轨迹
        const glowMaterial = this.createGlowMaterial();
        this.glowTrail = new THREE.Mesh(BulletTrail.glowGeometry, glowMaterial);
        this.mesh.add(this.glowTrail);
        
        // 初始隐藏
        this.mesh.visible = false;
    }

    /**
     * 重置并初始化轨迹 (对象池复用)
     */
    public init(start: THREE.Vector3, end: THREE.Vector3) {
        this.isDead = false;
        this.lifetime = 0;
        this.trailOpacity.value = 1.0;
        this.mesh.visible = true;

        // 计算轨迹方向和长度
        const direction = new THREE.Vector3().subVectors(end, start);
        this.trailLength = Math.max(0.1, direction.length());
        
        // 如果长度太短，隐藏
        if (direction.length() < 0.01) {
            this.mesh.visible = false;
            this.isDead = true;
            return;
        }
        
        // 设置位置到中点
        const midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
        this.mesh.position.copy(midpoint);
        
        // 计算旋转
        direction.normalize();
        const defaultDir = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion();
        
        const dot = defaultDir.dot(direction);
        if (Math.abs(dot) > 0.9999) {
            if (dot < 0) quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
        } else {
            quaternion.setFromUnitVectors(defaultDir, direction);
        }
        this.mesh.quaternion.copy(quaternion);

        // 应用缩放 (直接缩放 Mesh)
        this.mainTrail.scale.set(1, this.trailLength, 1);
        this.glowTrail.scale.set(1, this.trailLength, 1);
    }

    private createMainMaterial(): MeshBasicNodeMaterial {
        const material = new MeshBasicNodeMaterial();
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.side = THREE.DoubleSide;
        
        const opacity = this.trailOpacity;
        const t = time;
        const coreColor = vec3(1.0, 0.95, 0.7);
        const flicker = sin(t.mul(200)).mul(0.1).add(0.9);
        
        material.colorNode = coreColor.mul(flicker);
        material.opacityNode = opacity;
        return material;
    }

    private createGlowMaterial(): MeshBasicNodeMaterial {
        const material = new MeshBasicNodeMaterial();
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.side = THREE.DoubleSide;
        
        const opacity = this.trailOpacity;
        const uvCoord = uv();
        const gradient = smoothstep(float(0), float(0.3), uvCoord.y);
        const glowColor = vec3(1.0, 0.6, 0.15);
        const radialFade = smoothstep(float(0.5), float(0.2), abs(uvCoord.x.sub(0.5)));
        
        material.colorNode = glowColor.mul(gradient);
        material.opacityNode = opacity.mul(0.6).mul(radialFade);
        return material;
    }

    public update(delta: number) {
        if (this.isDead) return;

        this.lifetime += delta;
        const progress = this.lifetime / this.maxLifetime;
        
        const fadeOut = 1 - Math.pow(progress, 0.5);
        this.trailOpacity.value = fadeOut;
        
        // 轨迹收缩
        const shrinkProgress = Math.min(progress * 2, 1);
        
        // 更新缩放
        const scaleY = this.trailLength * (1 - shrinkProgress * 0.8);
        const scaleRadial = Math.max(0.1, 1 - shrinkProgress * 0.9);

        // 注意：scale.y 代表长度，scale.x/z 代表粗细
        this.mainTrail.scale.set(scaleRadial, scaleY, scaleRadial);
        this.glowTrail.scale.set(scaleRadial, scaleY, scaleRadial);
        
        if (this.lifetime >= this.maxLifetime) {
            this.isDead = true;
        }
    }

    public dispose() {
        // 静态几何体不需要销毁
        // 只销毁材质
        (this.mainTrail.material as THREE.Material).dispose();
        (this.glowTrail.material as THREE.Material).dispose();
    }
}


/**
 * 命中特效类
 */
export class HitEffect {
    // 共享几何体 - 换回 PlaneGeometry 以使用更好的纹理效果 (Billboarding)
    private static particleGeometry = new THREE.PlaneGeometry(0.08, 0.08);
    
    // 共享材质 (Spark 和 Blood 两种)
    private static sparkMaterial: SpriteNodeMaterial | null = null;
    private static bloodMaterial: SpriteNodeMaterial | null = null;

    public group: THREE.Group;
    public isDead: boolean = false;
    private lifetime: number = 0;
    private maxLifetime: number = 0.4;
    private particles: THREE.Mesh[] = [];
    private particleVelocities: THREE.Vector3[] = []; // 用于 CPU 端物理更新 (简单起见)
    
    private currentType: 'spark' | 'blood' = 'spark';

    constructor() {
        this.group = new THREE.Group();
        this.group.userData = { isEffect: true };
        
        // 确保静态材质已创建
        if (!HitEffect.sparkMaterial) {
            HitEffect.createSharedMaterials();
        }
        
        // 预创建最大可能数量的粒子
        const maxParticles = 8;
        
        for (let i = 0; i < maxParticles; i++) {
            // 默认给个材质占位
            const mat = HitEffect.sparkMaterial!.clone();
            
            // 使用 Sprite 来获得更好的 Billboard 效果
            const particle = new THREE.Sprite(mat);
            particle.visible = false;
            
            this.particles.push(particle as unknown as THREE.Mesh);
            this.particleVelocities.push(new THREE.Vector3());
            
            this.group.add(particle);
        }
    }
    
    private static createSharedMaterials() {
        // Spark Material (TSL)
        {
            const material = new SpriteNodeMaterial();
            material.transparent = true;
            material.blending = THREE.AdditiveBlending;
            material.depthWrite = false;
            
            // 简单的发光点 + 星芒
            const uvCoord = uv().sub(vec2(0.5));
            const dist = length(uvCoord);
            
            // 核心辉光
            const glow = float(0.05).div(dist.mul(dist).add(0.05));
            const core = smoothstep(float(0.5), float(0.0), dist);
            
            // 颜色
            const color = vec3(1.0, 0.7, 0.3); // 金色火花
            
            material.colorNode = vec4(color.mul(glow.add(core).mul(2.0)), 1.0);
            
            HitEffect.sparkMaterial = material;
        }
        
        // Blood Material (TSL)
        {
            const material = new SpriteNodeMaterial();
            material.transparent = true;
            
            const uvCoord = uv().sub(vec2(0.5));
            const dist = length(uvCoord);
            
            // 血滴形状
            const shape = smoothstep(float(0.5), float(0.4), dist);
            
            const color = vec3(0.6, 0.0, 0.0); // 深红
            
            material.colorNode = vec4(color, shape);
            
            HitEffect.bloodMaterial = material;
        }
    }

    public init(position: THREE.Vector3, normal: THREE.Vector3, type: 'spark' | 'blood') {
        this.reset();
        this.currentType = type;
        this.group.position.copy(position);
        this.group.visible = true;
        
        const particleCount = type === 'spark' ? 6 + Math.floor(Math.random() * 3) : 4 + Math.floor(Math.random() * 2);
        const baseMaterial = type === 'spark' ? HitEffect.sparkMaterial : HitEffect.bloodMaterial;
        
        for (let i = 0; i < particleCount; i++) {
            const particle = this.particles[i] as unknown as THREE.Sprite;
            particle.visible = true;
            
            // 设置材质
            particle.material = baseMaterial!.clone();

            const scale = type === 'spark' ? 0.05 + Math.random() * 0.05 : 0.08 + Math.random() * 0.06;
            particle.scale.set(scale, scale, 1);
            
            // 随机方向 (半球)
            const randomDir = new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2
            ).normalize();
            
            // 保证在法线半球内
            if (randomDir.dot(normal) < 0) randomDir.negate();
            
            // 混合法线方向和随机方向
            const dir = new THREE.Vector3().copy(normal).lerp(randomDir, 0.7).normalize();
            
            // 速度
            const speed = type === 'spark' ? 2 + Math.random() * 4 : 1 + Math.random() * 2;
            const velocity = dir.multiplyScalar(speed);
            
            this.particleVelocities[i].copy(velocity);
            particle.position.set(0, 0, 0); 
        }
        
        // 隐藏多余
        for (let i = particleCount; i < this.particles.length; i++) {
            this.particles[i].visible = false;
        }
    }
    
    private reset() {
        this.isDead = false;
        this.lifetime = 0;
    }

    public update(delta: number) {
        if (this.isDead) return;

        this.lifetime += delta;
        if (this.lifetime >= this.maxLifetime) {
            this.isDead = true;
            this.group.visible = false;
            return;
        }
        
        const progress = this.lifetime / this.maxLifetime;
        const alpha = 1.0 - Math.pow(progress, 2); // 非线性淡出
        
        // 更新物理
        const gravity = new THREE.Vector3(0, -9.8, 0); // 重力
        
        for (let i = 0; i < this.particles.length; i++) {
            const particle = this.particles[i];
            if (!particle.visible) continue;
            
            const velocity = this.particleVelocities[i];
            
            // 施加重力和阻力
            if (this.currentType === 'blood') {
                 velocity.add(gravity.clone().multiplyScalar(delta));
            }
            velocity.multiplyScalar(0.95); // 空气阻力
            
            // 移动
            particle.position.add(velocity.clone().multiplyScalar(delta));
            
            // 更新透明度
            if (particle.material instanceof SpriteNodeMaterial) {
                 particle.material.opacity = alpha;
            }
        }
    }

    public dispose() {
        this.particles.forEach(p => {
             if (p.material) (p.material as THREE.Material).dispose();
        });
    }
}
