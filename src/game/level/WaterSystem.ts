import * as THREE from 'three';
import { MeshStandardNodeMaterial, type UniformNode } from 'three/webgpu';
import { 
    time, sin, cos, vec3, vec2, mix, float, 
    smoothstep, fract, positionWorld, abs,
    sub, max, min, normalize, dot, pow, exp, step, normalView
} from 'three/tsl';
import { MapConfig, EnvironmentConfig } from '../core/GameConfig';
import { terrainHeightNode } from '../shaders/TerrainTSL';

export class WaterSystem {
    private scene: THREE.Scene;
    private waterMesh: THREE.Mesh | null = null;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
    }

    /**
     * 创建湖泊 - 真实水面效果
     * @param rainIntensity 雨量强度 Uniform
     */
    public createWater(rainIntensity: UniformNode<number>) {
        // 水面平面
        const geometry = new THREE.PlaneGeometry(MapConfig.size, MapConfig.size, 64, 64);
        geometry.rotateX(-Math.PI / 2);
        
        const material = new MeshStandardNodeMaterial({
            color: new THREE.Color(EnvironmentConfig.water.color),
            transparent: true,
            opacity: EnvironmentConfig.water.opacity,
            roughness: 0.05,
            metalness: 0.9,
        });

        // 动态涟漪 (基于世界坐标和时间)
        const pos = positionWorld.xz;
        const t = time.mul(1.5); // 加快时间流速，增强流动感
        
        // 模拟风向/水流方向 (向东北方流动)
        const flowDir = vec2(0.5, 0.2);
        // 坐标反向移动 = 纹理正向移动
        const flowPosMain = pos.sub(flowDir.mul(t)); 
        const flowPosSec = pos.sub(vec2(0.2, 0.5).mul(t.mul(0.7))); // 次级波浪流速稍慢

        // 多层正弦波模拟自然的无规则水波
        // Wave 1: 主波浪 (流动)
        const wave1 = sin(flowPosMain.x.mul(0.4).add(t.mul(0.2)))
            .mul(sin(flowPosMain.y.mul(0.3).add(t.mul(0.3))));
        
        // Wave 2: 次级干涉波 (流动方向不同)
        const wave2 = sin(flowPosSec.x.mul(1.2))
            .mul(sin(flowPosSec.y.mul(1.5).add(t.mul(0.5))));
            
        // Wave 3: 高频细节 (快速闪烁)
        const wave3 = sin(pos.x.mul(5.0).add(t.mul(4.0)))
            .mul(sin(pos.y.mul(4.5).sub(t.mul(3.0))));
        
        // 混合波浪
        const ripple = wave1.mul(1.0).add(wave2.mul(0.5)).add(wave3.mul(0.2));
        
        // 法线扰动强度 (增强明显度)
        const strength = float(0.25);
        
        // 雨滴涟漪 (Rain Ripples) - 视觉增强版
        const rainStrength = rainIntensity.mul(1.0); // 全强度
        const rainTime = time.mul(8.0); // 快速闪烁
        const rainScale = float(25.0);  // 高密度

        // 生成高频干涉图案 -> 通过 pow 锐化成点状
        const rainNoise1 = sin(pos.x.mul(rainScale).add(rainTime)).mul(sin(pos.y.mul(rainScale).sub(rainTime.mul(0.8))));
        const rainNoise2 = sin(pos.x.mul(rainScale.mul(1.2)).sub(rainTime.mul(1.1))).mul(sin(pos.y.mul(rainScale.mul(1.3)).add(rainTime.mul(0.5))));
        
        // 锐化噪声以形成独立的雨滴点 (Splashes)
        // 只有当 rainIntensity > 0 时才显示
        const rainDroplets = max(rainNoise1.add(rainNoise2), float(0.0)).pow(float(4.0)).mul(rainStrength);

        // 主波浪产生的倾斜 (需要保留)
        const slopeX = cos(flowPosMain.x.mul(0.4)).mul(0.5)
            .add(cos(flowPosSec.x.mul(1.2)).mul(0.5));
            
        const slopeZ = cos(flowPosMain.y.mul(0.3)).mul(0.5)
            .add(cos(flowPosSec.y.mul(1.5)).mul(0.5));
        
        // 雨滴造成的强烈法线扰动
        const nX = slopeX.mul(strength).add(fract(time.mul(2)).mul(0.01))
            .add(rainDroplets.mul(0.2)); // 增强法线扰动
        const nZ = slopeZ.mul(strength)
            .add(rainDroplets.mul(0.2)); 
        
        material.normalNode = normalize(vec3(nX, float(1.0), nZ));

        // ========== 岸边泡沫效果 (Shoreline Foam) ==========
        // Use the shared terrain height node so shoreline stays consistent with Level terrain.
        const terrainHeight = terrainHeightNode(positionWorld.xz);
        
        // 计算水深: 水面高度 - 地形高度
        // 如果 terrainHeight > waterLevel, depth < 0, 说明在岸上
        const waterLevel = float(EnvironmentConfig.water.level);
        const depth = waterLevel.sub(terrainHeight);
        
        // 泡沫区域: 水深在 [0, 0.8] 范围内产生泡沫
        const foamThreshold = float(0.8);
        const foamMask = smoothstep(foamThreshold, float(0.0), depth); // 越浅越接近1
        
        // 增加泡沫的动态噪声
        const foamNoise = sin(pos.x.mul(10).add(t)).mul(sin(pos.z.mul(10).sub(t)));
        const dynamicFoam = foamMask.mul(foamNoise.add(1.0).mul(0.5)).step(0.4); // 硬边泡沫
        
        // 波峰泡沫: 在波浪最高处增加泡沫
        const crestFoam = ripple.step(0.8).mul(0.5); // 波浪值 > 0.8 时显示泡沫
        
        // 混合泡沫颜色
        const foamColor = vec3(1.0, 1.0, 1.0); // 纯白泡沫
        const totalFoam = max(dynamicFoam, crestFoam);
        
        // 雨滴产生的白色水花 (White Splashes)
        // 使用 step 函数硬切断，使得水花边缘清晰
        const rainSplashes = step(float(0.7), rainDroplets).mul(0.8);
        
        // 最终颜色混合: 基础水色 + 泡沫 + 雨滴水花
        const waterBaseColor = new THREE.Color(EnvironmentConfig.water.color);
        const colorVec = vec3(waterBaseColor.r, waterBaseColor.g, waterBaseColor.b);
        
        // 混合顺序: 颜色 -> 泡沫 -> 雨滴
        const colorWithFoam = mix(colorVec, foamColor, totalFoam);
        material.colorNode = mix(colorWithFoam, foamColor, rainSplashes);
        
        // ========== 更加物理真实的透明度 (Murky Water) ==========
        // 1. Beer's Law (深度吸收): 深度越深，透明度越低
        // alpha = 1 - e^(-density * depth)
        const density = float(0.8); // 水的浑浊度
        const absorption = sub(float(1.0), exp(depth.mul(density).negate()));
        
        // 2. Fresnel Effect (菲涅尔效应): 视线角度越平，水面越不透明(反射越强)
        // dot(normalView, vec3(0,0,1)) 是视线夹角的余弦
        // Use normalView directly but we need view vector.
        // Simplified Fresnel using dot(N, V)
        const viewZ = dot(normalView, vec3(0, 0, 1)); // View space normal . View Vector (0,0,1)
        const fresnel = pow(sub(float(1.0), abs(viewZ)), float(4.0)); // Power controls falloff
        
        // 组合透明度: 吸收 + 菲涅尔 + 泡沫 (泡沫总是不透明)
        const murkyOpacity = max(absorption, fresnel.mul(0.6)); // Fresnel 不完全不透明
        const finalOpacity = max(murkyOpacity, totalFoam).mul(EnvironmentConfig.water.opacity);
        
        material.opacityNode = finalOpacity;
        
        this.waterMesh = new THREE.Mesh(geometry, material);
        this.waterMesh.position.y = EnvironmentConfig.water.level;
        this.waterMesh.receiveShadow = true;
        
        // 确保水面不遮挡半透明粒子(如果有)
        this.waterMesh.renderOrder = 0; 
        
        this.scene.add(this.waterMesh);
        // 不加入 objects 列表，防止被自动销毁或碰撞检测错误
    }
}