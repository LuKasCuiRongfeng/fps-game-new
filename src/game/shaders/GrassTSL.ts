import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { 
    uniform, time, sin, cos, vec3, float, 
    mix, positionLocal, uv, 
    positionWorld, hash, modelWorldMatrix
} from 'three/tsl';

import { WindUniforms as Wind } from './WindUniforms';

/**
 * 创建草丛材质 (TSL)
 * @param colorBase 基础颜色 (底部)
 * @param colorTip 顶部颜色
 */
export function createGrassMaterial(colorBase: THREE.Color, colorTip: THREE.Color): MeshStandardNodeMaterial {
    const material = new MeshStandardNodeMaterial();
    material.side = THREE.DoubleSide;
    material.transparent = true;
    // material.alphaTest = 0.5; // 如果有纹理需要开启，纯几何体可以不需要
    
    // 颜色渐变 (基于 UV.y)
    const uvCoord = uv();
    const cBase = vec3(colorBase.r, colorBase.g, colorBase.b);
    const cTip = vec3(colorTip.r, colorTip.g, colorTip.b);
    
    // 随机色调偏移
    // TSL: positionWorld 在 InstancedMesh 中是顶点世界坐标
    const randomVal = hash(positionWorld.xz.mul(0.1));
    
    // 基于高度的颜色变化: 顶部亮，底部暗 (模拟 AO)
    const ao = uvCoord.y.pow(0.5); // 根部变黑
    
    // 基础颜色混合
    const randomColor = mix(cBase, cTip, randomVal.mul(0.5).add(0.2)); 
    // 增加一点高光色 (阳光穿透)
    const sunColor = vec3(1.0, 1.0, 0.8);
    
    // 垂直渐变: 
    const mixFactor = uvCoord.y;
    // 增加中间色调
    const midColor = mix(cBase, cTip, 0.5);
    
    // 使用 any 绕过 TSL 类型推断问题 (colorNode 最终接受 Node)
    let finalColor: any = mix(cBase, cTip, mixFactor);
    
    // 添加一点条纹噪声 (程序化草叶纹理)
    const bladeNoise = sin(uvCoord.x.mul(10.0)).mul(0.1);
    finalColor = finalColor.add(bladeNoise);
    
    // 应用 AO
    finalColor = finalColor.mul(ao.add(0.2));
    
    // 假 SSS (Subsurface Scattering): 背光时更亮? 这里简单模拟顶部透光
    // 假设顶部受天空光影响更大
    finalColor = finalColor.add(sunColor.mul(uvCoord.y.pow(3.0)).mul(0.2));

    material.colorNode = finalColor;
    material.roughnessNode = float(1.0); // 粗糙度高，模拟植物表面
    
    // Alpha Test 模拟叶子边缘形状 (如果不用几何体收缩)
    // float shape = 1.0 - abs(uv.x - 0.5) * 2;
    // material.opacityNode = smoothstep(0.0, 0.2, shape);
    
    // === 风动效果 ===
    // 只有上半部分摆动
    const heightFactor = uvCoord.y.pow(1.5); 
    
    // 基于世界坐标的风场 - 更自然的噪声风
    const t = time.mul(Wind.speed);
    const worldPos = positionWorld;

    // Directional phase: keeps wind coherent across all vegetation.
    const phase = worldPos.x.mul(Wind.direction.x).add(worldPos.z.mul(Wind.direction.z));
    
    // 低频波浪 (大风)
    const windWave = sin(t.add(phase.mul(0.35)));
    
    // 高频颤动 (细节)
    const flutter = sin(t.mul(3.0).add(phase.mul(2.0))).mul(0.1);
    
    // 阵风 (间歇性)
    const gust = sin(t.mul(0.5).add(phase.mul(0.08))).add(1.0).mul(0.5);
    gust.mul(gust); // 强化对比度
    
    const combinedWind = windWave.add(flutter).mul(gust).mul(Wind.strength);
    
    const sway = combinedWind.mul(heightFactor);
    const swayX = sway.mul(Wind.direction.x);
    const swayZ = sway.mul(Wind.direction.z);
    
    material.positionNode = positionLocal.add(vec3(swayX, 0, swayZ));
    
    return material;
}
