/**
 * TSL Materials System - 统一管理所有游戏材质
 * 使用 Three.js Shading Language (TSL) 最大化 GPU 性能
 */
import * as THREE from 'three';
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial, SpriteNodeMaterial } from 'three/webgpu';
import {
    uniform, mix, vec3, float, uv, time, sin,
    smoothstep, fract, floor,
    max, min, sub, length,
    normalLocal, checker
} from 'three/tsl';

// ============= Uniform 管理器 =============
export class UniformManager {
    private static instance: UniformManager;
    
    // 全局时间
    public readonly globalTime = uniform(0);
    
    // 玩家相关
    public readonly playerPosition = uniform(new THREE.Vector3());
    public readonly playerHealth = uniform(1.0);
    
    // 环境相关
    public readonly fogDensity = uniform(0.02);
    public readonly fogColor = uniform(new THREE.Color(0x87ceeb));
    public readonly ambientIntensity = uniform(0.6);
    
    // 游戏状态
    public readonly gameTime = uniform(0);
    public readonly damageFlash = uniform(0);

    private constructor() {}

    public static getInstance(): UniformManager {
        if (!UniformManager.instance) {
            UniformManager.instance = new UniformManager();
        }
        return UniformManager.instance;
    }

    public update(delta: number, playerPos: THREE.Vector3, health: number) {
        this.globalTime.value += delta;
        this.gameTime.value += delta;
        this.playerPosition.value.copy(playerPos);
        this.playerHealth.value = health / 100;
        
        // 受伤闪烁效果衰减
        this.damageFlash.value = Math.max(0, this.damageFlash.value - delta * 5);
    }

    public triggerDamageFlash() {
        this.damageFlash.value = 1.0;
    }
}

// ============= 地面材质 =============
export function createGroundMaterial(): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial({
        side: THREE.DoubleSide,
        roughness: 0.9,
        metalness: 0.1
    });

    // UV 坐标
    const uvCoord = uv().mul(10);
    
    // 程序化地砖纹理
    const tileX = fract(uvCoord.x);
    const tileZ = fract(uvCoord.y);
    
    // 砖缝
    const gapWidth = float(0.05);
    const gapX = smoothstep(float(0), gapWidth, tileX).mul(smoothstep(float(1), sub(float(1), gapWidth), tileX));
    const gapZ = smoothstep(float(0), gapWidth, tileZ).mul(smoothstep(float(1), sub(float(1), gapWidth), tileZ));
    const gap = gapX.mul(gapZ);
    
    // 棋盘格颜色变化
    const checkerVal = checker(uvCoord);
    const baseColor1 = vec3(0.35, 0.32, 0.28);
    const baseColor2 = vec3(0.42, 0.38, 0.32);
    const tileColor = mix(baseColor1, baseColor2, checkerVal);
    
    // 添加噪声变化
    const noiseVal = sin(uvCoord.x.mul(3.14).add(uvCoord.y.mul(2.71))).mul(0.02);
    
    // 砖缝颜色
    const gapColor = vec3(0.15, 0.12, 0.1);
    
    // 混合
    const finalColor = mix(gapColor, tileColor.add(noiseVal), gap);
    
    material.colorNode = finalColor;
    
    // 砖缝处略微凹陷的法线效果
    const normalStrength = sub(float(1), gap).mul(0.3);
    material.normalNode = normalLocal.add(vec3(0, normalStrength, 0));
    
    return material;
}

// ============= 墙壁材质 =============
export function createWallMaterial(): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial({
        roughness: 0.8,
        metalness: 0.1
    });

    // 垂直砖纹理
    const uvCoord = uv();
    const brickScaleX = float(4);
    const brickScaleY = float(8);
    
    // 错位砖块
    const row = floor(uvCoord.y.mul(brickScaleY));
    const offset = row.mod(2).mul(0.5);
    const adjustedU = uvCoord.x.mul(brickScaleX).add(offset);
    
    const brickU = fract(adjustedU);
    const brickV = fract(uvCoord.y.mul(brickScaleY));
    
    // 砖缝
    const mortarWidth = float(0.08);
    const brickMaskU = smoothstep(float(0), mortarWidth, brickU)
        .mul(smoothstep(float(1), sub(float(1), mortarWidth), brickU));
    const brickMaskV = smoothstep(float(0), mortarWidth, brickV)
        .mul(smoothstep(float(1), sub(float(1), mortarWidth), brickV));
    const brickMask = brickMaskU.mul(brickMaskV);
    
    // 砖块颜色变化
    const brickIndex = floor(adjustedU).add(row.mul(17));
    const colorVariation = sin(brickIndex.mul(12.9898)).mul(0.05);
    
    const brickColor = vec3(0.28, 0.25, 0.22).add(colorVariation);
    const mortarColor = vec3(0.15, 0.13, 0.11);
    
    const finalColor = mix(mortarColor, brickColor, brickMask);
    material.colorNode = finalColor;
    
    return material;
}

// ============= 障碍物材质 =============
export function createObstacleMaterial(): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial({
        roughness: 0.5,
        metalness: 0.5
    });

    // 金属质感
    const uvCoord = uv();
    
    // 划痕纹理
    const scratchFreq = float(20);
    const scratch1 = sin(uvCoord.x.mul(scratchFreq).add(uvCoord.y.mul(0.5)));
    const scratch2 = sin(uvCoord.y.mul(scratchFreq).add(uvCoord.x.mul(0.3)));
    const scratches = max(scratch1, scratch2).mul(0.5).add(0.5);
    
    // 基础颜色带变化
    const baseColor = vec3(0.45, 0.42, 0.38);
    const colorWithScratches = baseColor.mul(mix(float(0.9), float(1.1), scratches));
    
    material.colorNode = colorWithScratches;
    
    // 划痕处更粗糙
    material.roughnessNode = mix(float(0.4), float(0.7), scratches);
    
    return material;
}

// ============= 敌人材质 =============
export function createEnemyMaterial(hitStrength: ReturnType<typeof uniform>): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial({
        roughness: 0.5,
        metalness: 0.2
    });

    const t = time;
    
    // 基础红色
    const baseRed = vec3(0.9, 0.1, 0.05);
    
    // 脉动效果
    const pulse = sin(t.mul(3)).mul(0.1).add(0.9);
    const pulsingRed = baseRed.mul(pulse);
    
    // 受击白色闪烁
    const hitColor = vec3(1, 1, 1);
    const finalColor = mix(pulsingRed, hitColor, hitStrength);
    
    material.colorNode = finalColor;
    
    // 受击时发光
    material.emissiveNode = mix(
        vec3(0.1, 0, 0), // 正常状态微弱红光
        vec3(1, 0.8, 0.6), // 受击时强烈发光
        hitStrength
    );
    
    return material;
}

// ============= 拾取物材质 =============
export function createPickupMaterial(type: 'health' | 'ammo', floatOffset: number): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial({
        roughness: 0.3,
        metalness: 0.7
    });

    const t = time;
    const offset = float(floatOffset);
    
    // 彩虹边缘效果
    const uvCoord = uv();
    const edgeDist = min(
        min(uvCoord.x, sub(float(1), uvCoord.x)),
        min(uvCoord.y, sub(float(1), uvCoord.y))
    );
    const edgeGlow = smoothstep(float(0), float(0.3), edgeDist);
    
    // 基础颜色
    let baseColor;
    if (type === 'health') {
        // 绿色治疗
        baseColor = vec3(0.1, 0.9, 0.2);
    } else {
        // 金色弹药
        baseColor = vec3(1.0, 0.85, 0.1);
    }
    
    // 脉动
    const pulse = sin(t.mul(5).add(offset)).mul(0.3).add(0.7);
    
    // 旋转彩虹效果
    const angle = t.mul(2).add(offset);
    const rainbow = vec3(
        sin(angle).mul(0.5).add(0.5),
        sin(angle.add(2.094)).mul(0.5).add(0.5),
        sin(angle.add(4.188)).mul(0.5).add(0.5)
    );
    
    // 边缘彩虹
    const colorWithEdge = mix(rainbow.mul(0.5).add(baseColor.mul(0.5)), baseColor, edgeGlow);
    
    material.colorNode = colorWithEdge.mul(pulse);
    
    // 强发光效果
    material.emissiveNode = baseColor.mul(pulse).mul(0.6);
    
    return material;
}

// ============= 武器材质 =============
export function createWeaponMaterial(): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial({
        roughness: 0.3,
        metalness: 0.9
    });

    const uvCoord = uv();
    
    // 金属刷纹
    const brushFreq = float(100);
    const brushPattern = sin(uvCoord.x.mul(brushFreq)).mul(0.02);
    
    // 深灰金属
    const baseColor = vec3(0.35, 0.32, 0.30);
    const brushedColor = baseColor.add(brushPattern);
    
    material.colorNode = brushedColor;
    
    // 环境反射
    material.envMapIntensity = 0.5;
    
    return material;
}

// ============= 枪口火焰材质 =============
export function createMuzzleFlashMaterial(): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial();

    const t = time;
    
    // 快速闪烁
    const flash = sin(t.mul(100)).mul(0.5).add(0.5);
    
    // 橙黄色火焰
    const fireColor = mix(
        vec3(1, 0.8, 0.2),
        vec3(1, 0.4, 0.1),
        flash
    );
    
    material.colorNode = fireColor;
    material.transparent = true;
    material.opacity = 0.9;
    
    return material;
}

// ============= 楼梯材质 =============
export function createStairMaterial(): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial({
        roughness: 0.6,
        metalness: 0.3
    });

    const uvCoord = uv();
    
    // 混凝土纹理
    const noiseScale = float(10);
    const noise1 = sin(uvCoord.x.mul(noiseScale)).mul(sin(uvCoord.y.mul(noiseScale)));
    const noise2 = sin(uvCoord.x.mul(noiseScale.mul(2.3))).mul(sin(uvCoord.y.mul(noiseScale.mul(1.7))));
    const combinedNoise = noise1.mul(0.5).add(noise2.mul(0.3)).mul(0.05);
    
    // 水泥灰
    const baseColor = vec3(0.55, 0.53, 0.50);
    const texturedColor = baseColor.add(combinedNoise);
    
    material.colorNode = texturedColor;
    
    // 边缘磨损
    const edgeWear = smoothstep(float(0.02), float(0.1), uvCoord.x)
        .mul(smoothstep(float(0.98), float(0.9), uvCoord.x));
    material.roughnessNode = mix(float(0.8), float(0.5), edgeWear);
    
    return material;
}

// ============= 天空盒材质 (用于雾效果) =============
export function createSkyMaterial(): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial();
    
    // 渐变天空
    const uvCoord = uv();
    
    const horizonColor = vec3(0.7, 0.85, 0.95);
    const zenithColor = vec3(0.4, 0.6, 0.9);
    
    const gradient = smoothstep(float(0), float(1), uvCoord.y);
    const skyColor = mix(horizonColor, zenithColor, gradient);
    
    material.colorNode = skyColor;
    material.side = THREE.BackSide;
    
    return material;
}

// ============= 伤害叠加效果 (用于后处理) =============
export function createDamageOverlayMaterial(): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial();
    
    const uniforms = UniformManager.getInstance();
    const damageAmount = uniforms.damageFlash;
    
    // 红色边缘晕影
    const coord = uv();
    const center = vec3(0.5, 0.5, 0);
    const distFromCenter = length(coord.sub(center.xy));
    
    // 边缘更红
    const vignette = smoothstep(float(0.3), float(0.8), distFromCenter);
    
    // 脉动
    const pulse = sin(time.mul(20)).mul(0.2).add(0.8);
    
    const damageColor = vec3(0.8, 0.1, 0.05).mul(vignette).mul(damageAmount).mul(pulse);
    
    material.colorNode = damageColor;
    material.transparent = true;
    material.opacityNode = damageAmount.mul(0.6);
    material.depthTest = false;
    material.depthWrite = false;
    
    return material;
}

// ============= 弹道轨迹材质 =============
export function createBulletTrailMaterial(): MeshBasicNodeMaterial {
    const material = new MeshBasicNodeMaterial();

    const uvCoord = uv();
    
    // 渐变消失
    const fade = sub(float(1), uvCoord.x);
    
    // 橙黄色轨迹
    const trailColor = vec3(1, 0.7, 0.2).mul(fade);
    
    material.colorNode = trailColor;
    material.transparent = true;
    material.opacity = 0.8;
    
    return material;
}

// ============= 粒子材质 =============
export function createParticleMaterial(particleType: 'spark' | 'smoke' | 'blood'): SpriteNodeMaterial {
    const material = new SpriteNodeMaterial();

    switch (particleType) {
        case 'spark':
            material.colorNode = vec3(1, 0.8, 0.3);
            break;
        case 'smoke':
            material.colorNode = vec3(0.3, 0.3, 0.35);
            break;
        case 'blood':
            material.colorNode = vec3(0.7, 0.05, 0.02);
            break;
    }
    
    material.transparent = true;
    material.depthWrite = false;
    
    return material;
}

export const TSLMaterials = {
    createGroundMaterial,
    createWallMaterial,
    createObstacleMaterial,
    createEnemyMaterial,
    createPickupMaterial,
    createWeaponMaterial,
    createMuzzleFlashMaterial,
    createStairMaterial,
    createSkyMaterial,
    createDamageOverlayMaterial,
    createBulletTrailMaterial,
    createParticleMaterial
};
