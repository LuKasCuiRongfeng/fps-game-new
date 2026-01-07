import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu'; // 注意：Vite 环境下可能是 three/webgpu
import { 
    color, uniform, time, sin, cos, vec3, float, 
    mix, positionLocal, normalLocal, uv, floor,
    positionWorld, hash, modelWorldMatrix
} from 'three/tsl';

// 定义风的参数，全局共享，保证风向一致
const windSpeed = uniform(1.5);
const windStrength = uniform(0.15);

/**
 * 创建树干材质 (TSL)
 * @param colorTint 树干的基础颜色倾向
 */
export function createTrunkMaterial(colorTint: THREE.Color = new THREE.Color(0.35, 0.25, 0.15)): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();
    
    // 基础颜色
    const baseColor = vec3(colorTint.r, colorTint.g, colorTint.b);
    const variation = hash(positionWorld.xz).mul(0.1); // 基于位置的颜色微调
    
    // 简单的树皮纹理噪声
    const uvCoord = uv();
    const barkNoise = sin(uvCoord.y.mul(20.0).add(sin(uvCoord.x.mul(10.0)))).mul(0.1);
    
    material.colorNode = baseColor.add(variation).add(barkNoise);
    material.roughnessNode = float(0.9);
    material.metalnessNode = float(0.0);
    
    // 简单的风动 (树干)
    const heightFactor = positionLocal.y.max(0.0);
    const worldPos = positionWorld;
    const windOffset = sin(time.mul(windSpeed).add(worldPos.x.mul(0.5))).mul(windStrength).mul(0.1).mul(heightFactor);
    
    material.positionNode = positionLocal.add(vec3(windOffset, 0, 0));
    
    return material;
}

/**
 * 创建树叶材质 (TSL)
 * @param color1Hex 深色 (底部/阴影)
 * @param color2Hex 浅色 (顶部/高光)
 */
export function createLeavesMaterial(color1Hex: THREE.Color = new THREE.Color(0.1, 0.4, 0.1), color2Hex: THREE.Color = new THREE.Color(0.3, 0.6, 0.2)): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();
    
    const color1 = vec3(color1Hex.r, color1Hex.g, color1Hex.b);
    const color2 = vec3(color2Hex.r, color2Hex.g, color2Hex.b);
    
    // 基于世界坐标的随机颜色，让每棵树颜色不同
    const randomVal = hash(floor(positionWorld.xz.div(2.0))); 
    const treeColor = mix(color1, color2, randomVal);
    
    // 增加一点基于 UV 的渐变
    const leafGradient = uv().y.mul(0.2);
    
    material.colorNode = treeColor.add(leafGradient);
    material.roughnessNode = float(0.8);
    
    // === 风动效果 ===
    const heightFactor = positionLocal.y.max(0.0);
    const worldPos = positionWorld;
    
    const t = time.mul(windSpeed);
    
    // 主风向摆动 (X轴)
    const swayX = sin(t.add(worldPos.x.mul(0.3)).add(worldPos.z.mul(0.1)))
        .mul(windStrength)
        .mul(heightFactor.pow(1.5));
        
    // 侧向扰动 (Z轴)
    const swayZ = cos(t.mul(0.8).add(worldPos.z.mul(0.3)))
        .mul(windStrength).mul(0.5)
        .mul(heightFactor);
        
    // 树叶颤动
    const flutter = sin(t.mul(5.0).add(positionLocal.x).add(positionLocal.z))
        .mul(0.02)
        .mul(heightFactor);

    material.positionNode = positionLocal.add(vec3(swayX.add(flutter), 0, swayZ.add(flutter)));
    
    return material;
}
