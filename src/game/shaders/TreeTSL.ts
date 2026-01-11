import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu'; // 注意：Vite 环境下可能是 three/webgpu
import { 
    color, uniform, time, sin, cos, vec3, float, 
    mix, positionLocal, normalLocal, uv, floor,
    positionWorld, hash, modelWorldMatrix
} from 'three/tsl';

import { WindUniforms as Wind } from './WindUniforms';

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
    const t = time.mul(Wind.speed);
    const phase = worldPos.x.mul(Wind.direction.x).add(worldPos.z.mul(Wind.direction.z));
    const sway = sin(t.add(phase.mul(0.5)))
        .mul(Wind.strength)
        .mul(0.1)
        .mul(heightFactor);

    material.positionNode = positionLocal.add(vec3(sway.mul(Wind.direction.x), 0, sway.mul(Wind.direction.z)));
    
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
    
    const t = time.mul(Wind.speed);
    const phase = worldPos.x.mul(Wind.direction.x).add(worldPos.z.mul(Wind.direction.z));
    
    // 主风向摆动 (X轴)
    const sway = sin(t.add(phase.mul(0.35)))
        .mul(Wind.strength)
        .mul(heightFactor.pow(1.5));
    const swayX = sway.mul(Wind.direction.x);
    const swayZ = sway.mul(Wind.direction.z);
        
    // 树叶颤动
    const flutter = sin(t.mul(5.0).add(positionLocal.x).add(positionLocal.z).add(phase.mul(1.5)))
        .mul(0.02)
        .mul(heightFactor);

    material.positionNode = positionLocal.add(vec3(swayX.add(flutter), 0, swayZ.add(flutter)));
    
    return material;
}
