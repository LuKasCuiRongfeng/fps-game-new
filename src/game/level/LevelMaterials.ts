import * as THREE from 'three';
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { 
    sin, vec3, mix, float, 
    smoothstep, fract, floor, uv,
    sub, max, min, mod, normalLocal, normalize, step, positionWorld, abs, time
} from 'three/tsl';
import { MapConfig, EnvironmentConfig } from '../core/GameConfig';

export class LevelMaterials {
    /**
     * 地板材质 - 自然泥土/草地混合纹理 (增强版)
     */
    public static createFloorMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            side: THREE.DoubleSide,
            roughness: 0.92,
            metalness: 0.0
        });

        const uvCoord = uv().mul(50); // 更大的纹理缩放
        const worldPos = positionWorld;
        
        // ========== 多层噪声基础 (更复杂的变化) ==========
        // 超大尺度地形变化
        const hugeNoise = sin(uvCoord.x.mul(0.05)).mul(sin(uvCoord.y.mul(0.04))).mul(0.5).add(0.5);
        // 大尺度地形变化
        const largeNoise = sin(uvCoord.x.mul(0.15).add(hugeNoise)).mul(sin(uvCoord.y.mul(0.12))).mul(0.5).add(0.5);
        // 中尺度变化
        const medNoise = sin(uvCoord.x.mul(0.8).add(largeNoise.mul(0.5))).mul(sin(uvCoord.y.mul(0.7))).mul(0.5).add(0.5);
        // 细节噪声
        const fineNoise = sin(uvCoord.x.mul(3.5)).mul(sin(uvCoord.y.mul(4.2))).mul(0.5).add(0.5);
        const microNoise = sin(uvCoord.x.mul(12)).mul(sin(uvCoord.y.mul(11))).mul(0.5).add(0.5);
        // 超细节噪声
        const ultraFineNoise = sin(uvCoord.x.mul(25)).mul(sin(uvCoord.y.mul(28))).mul(0.5).add(0.5);
        
        // ========== 泥土基础色 (更丰富的变化) ==========
        const dirtBase = vec3(0.32, 0.25, 0.18);      // 深棕土
        const dirtLight = vec3(0.52, 0.42, 0.32);     // 浅棕土
        const dirtDark = vec3(0.18, 0.14, 0.1);       // 暗泥
        const dirtRed = vec3(0.4, 0.28, 0.2);         // 红褐土
        const sandColor = vec3(0.65, 0.55, 0.42);     // 沙色
        const clayColor = vec3(0.5, 0.38, 0.28);      // 黏土色
        
        // ========== 草地颜色 (更多层次) ==========
        const grassDark = vec3(0.18, 0.3, 0.12);      // 深草绿
        const grassMid = vec3(0.28, 0.4, 0.18);       // 中草绿
        const grassLight = vec3(0.38, 0.5, 0.25);     // 浅草绿
        const grassDry = vec3(0.5, 0.45, 0.28);       // 枯黄草
        const grassDead = vec3(0.42, 0.38, 0.3);      // 枯死草
        
        // ========== 混合泥土变化 (更自然) ==========
        const dirtVariation = mix(dirtBase, dirtLight, medNoise);
        const dirtWithDark = mix(dirtVariation, dirtDark, fineNoise.mul(0.5));
        const dirtWithRed = mix(dirtWithDark, dirtRed, largeNoise.mul(0.3));
        const dirtWithClay = mix(dirtWithRed, clayColor, hugeNoise.mul(0.25));
        const dirtWithSand = mix(dirtWithClay, sandColor, largeNoise.mul(medNoise).mul(0.35));
        
        // ========== 草地覆盖 (更自然的分布) ==========
        const grassMix1 = mix(grassDark, grassMid, fineNoise);
        const grassMix2 = mix(grassMix1, grassLight, microNoise.mul(0.6));
        const grassWithDry = mix(grassMix2, grassDry, medNoise.mul(0.4));
        const grassWithDead = mix(grassWithDry, grassDead, largeNoise.mul(hugeNoise).mul(0.3));
        
        // 草地分布 - 更自然的斑块状
        const grassPattern1 = sin(uvCoord.x.mul(0.4).add(largeNoise.mul(3)))
            .mul(sin(uvCoord.y.mul(0.5).add(medNoise.mul(2)))).mul(0.5).add(0.5);
        const grassPattern2 = sin(uvCoord.x.mul(0.7).sub(hugeNoise.mul(2)))
            .mul(sin(uvCoord.y.mul(0.6).add(fineNoise))).mul(0.5).add(0.5);
        const grassCombined = grassPattern1.mul(0.6).add(grassPattern2.mul(0.4));
        const grassMask = smoothstep(float(0.3), float(0.7), grassCombined);
        
        // 混合泥土和草地
        const groundColor = mix(dirtWithSand, grassWithDead, grassMask);
        
        // ========== 小石子和碎屑 (更多变化) ==========
        const pebbleNoise1 = sin(uvCoord.x.mul(30)).mul(sin(uvCoord.y.mul(32))).mul(0.5).add(0.5);
        const pebbleNoise2 = sin(uvCoord.x.mul(45).add(1.5)).mul(sin(uvCoord.y.mul(42))).mul(0.5).add(0.5);
        const pebbleMask = step(float(0.9), pebbleNoise1).add(step(float(0.92), pebbleNoise2));
        const pebbleColorDark = vec3(0.35, 0.33, 0.3);
        const pebbleColorLight = vec3(0.55, 0.52, 0.48);
        const pebbleColor = mix(pebbleColorDark, pebbleColorLight, ultraFineNoise);
        const withPebbles = mix(groundColor, pebbleColor, pebbleMask.mul(0.7));
        
        // ========== 裂缝和纹路 ==========
        const crackPattern = sin(uvCoord.x.mul(2.5).add(largeNoise.mul(5)))
            .mul(sin(uvCoord.y.mul(2.8).add(medNoise.mul(4))));
        const crackMask = smoothstep(float(0.85), float(0.95), abs(crackPattern));
        const crackColor = vec3(0.15, 0.12, 0.1);
        const withCracks = mix(withPebbles, crackColor, crackMask.mul(0.4).mul(float(1).sub(grassMask)));
        
        // ========== 路径/踩踏痕迹 (更自然) ==========
        const pathNoise = sin(uvCoord.x.mul(0.06).add(hugeNoise)).mul(0.5).add(0.5);
        const pathWidth = smoothstep(float(0.42), float(0.5), pathNoise).mul(smoothstep(float(0.58), float(0.5), pathNoise));
        const pathColor = vec3(0.4, 0.34, 0.26);
        const withPath = mix(withCracks, pathColor, pathWidth.mul(0.5));
        
        // ========== 微表面变化和污渍 ==========
        const surfaceDetail = microNoise.mul(0.05).sub(0.025);
        const stainNoise = sin(uvCoord.x.mul(1.2)).mul(sin(uvCoord.y.mul(1.5))).mul(0.5).add(0.5);
        const stainMask = smoothstep(float(0.7), float(0.9), stainNoise);
        const stainColor = vec3(0.25, 0.2, 0.15);
        const withStains = mix(withPath, stainColor, stainMask.mul(0.15));
        
        const finalColor = withStains.add(surfaceDetail);
        
        // ========== 水边湿润效果 ==========
        const waterHeight = float(EnvironmentConfig.water.level);
        // 水面以上 1.5 米范围内逐渐变干
        const wetZone = smoothstep(waterHeight.add(1.5), waterHeight.sub(0.2), worldPos.y); 
        // 湿润的地面变暗
        const wetColor = finalColor.mul(0.5);
        
        material.colorNode = mix(finalColor, wetColor, wetZone);
        
        // 湿润的地面更光滑
        material.roughnessNode = mix(float(0.92), float(0.3), wetZone);
        
        // ========== 法线变化模拟凹凸 (更强的凹凸) ==========
        // 降低 bump 强度，因为物理地形已经足够丰富
        const bumpScale = float(0.05); 
        const bumpX = sin(uvCoord.x.mul(6)).mul(fineNoise).mul(bumpScale)
            .add(sin(uvCoord.x.mul(15)).mul(microNoise).mul(bumpScale.mul(0.5)));
        const bumpZ = sin(uvCoord.y.mul(6)).mul(fineNoise).mul(bumpScale)
            .add(sin(uvCoord.y.mul(15)).mul(microNoise).mul(bumpScale.mul(0.5)));
        // 石子产生更强的凹凸
        const pebbleBump = pebbleMask.mul(0.2);
        const bumpNormal = normalize(normalLocal.add(vec3(bumpX.add(pebbleBump), 0, bumpZ.add(pebbleBump))));
        material.normalNode = bumpNormal;
        
        // ========== 动态粗糙度 (更多变化) ==========
        // 草地更粗糙，路径更光滑，石子最粗糙
        const roughnessBase = mix(float(0.95), float(0.82), grassMask);
        const roughnessWithPath = mix(roughnessBase, float(0.7), pathWidth);
        const roughnessWithPebbles = mix(roughnessWithPath, float(0.98), pebbleMask.mul(0.5));
        material.roughnessNode = roughnessWithPebbles.add(microNoise.mul(0.08));
        
        return material;
    }

    /**
     * 墙壁材质 - 风化混凝土/砖墙
     */
    public static createWallMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.9,
            metalness: 0.0
        });

        const uvCoord = uv();
        
        // ========== 大砖块图案 ==========
        const brickScaleX = float(8);
        const brickScaleY = float(4);
        
        const row = floor(uvCoord.y.mul(brickScaleY));
        const offset = mod(row, float(2)).mul(0.5);
        const adjustedX = uvCoord.x.mul(brickScaleX).add(offset);
        
        const brickX = fract(adjustedX);
        const brickY = fract(uvCoord.y.mul(brickScaleY));
        
        // 砖缝
        const gap = float(0.03);
        const brickMaskX = smoothstep(float(0), gap, brickX)
            .mul(smoothstep(float(1), sub(float(1), gap), brickX));
        const brickMaskY = smoothstep(float(0), gap, brickY)
            .mul(smoothstep(float(1), sub(float(1), gap), brickY));
        const brickMask = brickMaskX.mul(brickMaskY);
        
        // ========== 混凝土/砖块变化纹理 ==========
        const noiseFreq1 = float(20);
        const noiseFreq2 = float(50);
        const noiseFreq3 = float(100);
        
        const noise1 = sin(uvCoord.x.mul(noiseFreq1)).mul(sin(uvCoord.y.mul(noiseFreq1))).mul(0.5).add(0.5);
        const noise2 = sin(uvCoord.x.mul(noiseFreq2)).mul(sin(uvCoord.y.mul(noiseFreq2))).mul(0.5).add(0.5);
        const noise3 = sin(uvCoord.x.mul(noiseFreq3)).mul(sin(uvCoord.y.mul(noiseFreq3))).mul(0.5).add(0.5);
        
        // 砖块颜色变化 (每块砖不同)
        const brickIndex = floor(adjustedX).add(row.mul(50));
        const colorVar1 = sin(brickIndex.mul(43.758)).mul(0.5).add(0.5);
        const colorVar2 = sin(brickIndex.mul(27.619)).mul(0.5).add(0.5);
        
        // ========== 砖块颜色 ==========
        const brickRed = vec3(0.52, 0.35, 0.3);      // 红砖色
        const brickBrown = vec3(0.45, 0.38, 0.32);   // 棕砖色
        const brickGray = vec3(0.42, 0.4, 0.38);     // 灰砖色
        const brickDark = vec3(0.32, 0.28, 0.25);    // 深色砖
        
        // 混合不同砖色
        const brickBase = mix(brickRed, brickBrown, colorVar1);
        const brickMixed = mix(brickBase, brickGray, colorVar2.mul(0.4));
        const brickWithVar = mix(brickMixed, brickDark, noise1.mul(0.25));
        
        // 砖块表面纹理
        const surfaceDetail = noise2.mul(0.06).sub(0.03);
        const microDetail = noise3.mul(0.03).sub(0.015);
        const brickSurface = brickWithVar.add(surfaceDetail).add(microDetail);
        
        // 砖缝颜色
        const mortarColor = vec3(0.55, 0.52, 0.48); // 浅灰色灰浆
        
        // ========== 风化效果 ==========
        // 顶部雨水痕迹
        const rainStreak = sin(uvCoord.x.mul(80)).mul(0.5).add(0.5);
        const rainMask = smoothstep(float(0.85), float(1.0), uvCoord.y).mul(rainStreak);
        const rainDark = vec3(0.25, 0.23, 0.22);
        
        // 底部湿气/污渍
        const bottomDirt = smoothstep(float(0.15), float(0.0), uvCoord.y);
        const dirtColor = vec3(0.28, 0.25, 0.2);
        
        // 随机污渍斑块
        const stainNoise = sin(uvCoord.x.mul(8)).mul(sin(uvCoord.y.mul(6))).mul(0.5).add(0.5);
        const stainMask = smoothstep(float(0.7), float(0.85), stainNoise);
        const stainColor = vec3(0.3, 0.28, 0.25);
        
        // 应用风化
        const brickWeathered = mix(brickSurface, rainDark, rainMask.mul(0.4));
        const brickWithDirt = mix(brickWeathered, dirtColor, bottomDirt.mul(0.35));
        const brickWithStains = mix(brickWithDirt, stainColor, stainMask.mul(0.2));
        
        // ========== 裂缝效果 ==========
        const crackNoise = sin(uvCoord.x.mul(3).add(uvCoord.y.mul(2)))
            .mul(sin(uvCoord.x.mul(7).sub(uvCoord.y.mul(5)))).mul(0.5).add(0.5);
        const crackMask = step(float(0.95), crackNoise);
        const crackColor = vec3(0.15, 0.13, 0.12);
        const withCracks = mix(brickWithStains, crackColor, crackMask.mul(0.8));
        
        // 最终颜色 - 混合砖块和砖缝
        const finalColor = mix(mortarColor, withCracks, brickMask);
        
        material.colorNode = finalColor;
        
        // ========== 法线贴图 - 砖块凹凸 ==========
        const bumpStrength = sub(float(1), brickMask).mul(0.12);
        const crackBump = crackMask.mul(0.1);
        const bumpNormal = normalize(normalLocal.add(vec3(0, bumpStrength.add(crackBump), 0)));
        material.normalNode = bumpNormal;
        
        // 粗糙度变化 - 风化处更粗糙
        const roughnessBase = mix(float(0.92), float(0.82), brickMask);
        const roughnessWeathered = mix(roughnessBase, float(0.98), rainMask.add(bottomDirt).mul(0.5));
        material.roughnessNode = roughnessWeathered;
        
        return material;
    }

    /**
     * 金属箱子材质 - 工业集装箱/军用储物箱
     */
    public static createMetalCrateMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.45,
            metalness: 0.85
        });

        const uvCoord = uv();
        
        // ========== 金属板图案 ==========
        const panelCountX = float(2);
        const panelCountY = float(3);
        const panelX = fract(uvCoord.x.mul(panelCountX));
        const panelY = fract(uvCoord.y.mul(panelCountY));
        
        // 面板边框/加强筋
        const borderWidth = float(0.06);
        const ribWidth = float(0.03);
        
        const borderMaskX = smoothstep(float(0), borderWidth, panelX)
            .mul(smoothstep(float(1), sub(float(1), borderWidth), panelX));
        const borderMaskY = smoothstep(float(0), borderWidth, panelY)
            .mul(smoothstep(float(1), sub(float(1), borderWidth), panelY));
        const panelMask = borderMaskX.mul(borderMaskY);
        
        // 垂直加强筋
        const ribPattern = fract(uvCoord.x.mul(8));
        const ribMask = smoothstep(float(0), ribWidth, ribPattern)
            .mul(smoothstep(ribWidth.mul(2), ribWidth, ribPattern));
        
        // ========== 表面纹理 ==========
        // 细密划痕
        const scratchFreq = float(80);
        const scratch1 = sin(uvCoord.x.mul(scratchFreq).add(uvCoord.y.mul(3)));
        const scratch2 = sin(uvCoord.y.mul(scratchFreq.mul(0.7)).add(uvCoord.x.mul(5)));
        const scratchPattern = max(scratch1, scratch2).mul(0.5).add(0.5);
        const scratchMask = smoothstep(float(0.85), float(0.95), scratchPattern);
        
        // 刷纹
        const brushFreq = float(150);
        const brushPattern = sin(uvCoord.y.mul(brushFreq)).mul(0.5).add(0.5);
        
        // ========== 锈迹和腐蚀 ==========
        const rustNoise1 = sin(uvCoord.x.mul(12)).mul(sin(uvCoord.y.mul(15))).mul(0.5).add(0.5);
        const rustNoise2 = sin(uvCoord.x.mul(25)).mul(sin(uvCoord.y.mul(22))).mul(0.5).add(0.5);
        const rustPattern = rustNoise1.mul(rustNoise2);
        
        // 锈迹集中在边角和底部
        const edgeRust = sub(float(1), panelMask).mul(0.6);
        const bottomRust = smoothstep(float(0.3), float(0.0), uvCoord.y).mul(0.4);
        const rustMask = smoothstep(float(0.25), float(0.5), rustPattern.add(edgeRust).add(bottomRust));
        
        // ========== 油漆剥落 ==========
        const paintChipNoise = sin(uvCoord.x.mul(18)).mul(sin(uvCoord.y.mul(20))).mul(0.5).add(0.5);
        const paintChipMask = step(float(0.88), paintChipNoise);
        
        // ========== 颜色 ==========
        // 军绿色油漆 (主色)
        const paintGreen = vec3(0.28, 0.32, 0.25);
        // 备选: 工业灰蓝
        const paintBlue = vec3(0.3, 0.35, 0.4);
        // 金属原色
        const metalBase = vec3(0.55, 0.53, 0.5);
        // 锈迹颜色
        const rustLight = vec3(0.5, 0.3, 0.18);
        const rustDark = vec3(0.35, 0.2, 0.12);
        // 加强筋/边框
        const borderColor = vec3(0.25, 0.28, 0.22);
        
        // 根据面板位置变化颜色
        const panelIndex = floor(uvCoord.y.mul(panelCountY));
        const colorChoice = sin(panelIndex.mul(12.5)).mul(0.5).add(0.5);
        const paintColor = mix(paintGreen, paintBlue, step(float(0.7), colorChoice));
        
        // 表面带刷纹的油漆
        const paintWithBrush = paintColor.mul(mix(float(0.95), float(1.02), brushPattern));
        
        // 划痕露出底层金属
        const paintWithScratch = mix(paintWithBrush, metalBase, scratchMask.mul(0.5));
        
        // 油漆剥落
        const paintChipped = mix(paintWithScratch, metalBase, paintChipMask.mul(0.8));
        
        // 锈迹
        const rustColor = mix(rustLight, rustDark, rustNoise2);
        const withRust = mix(paintChipped, rustColor, rustMask);
        
        // 边框/加强筋
        const withBorder = mix(withRust, borderColor, sub(float(1), panelMask).mul(0.7));
        const withRibs = mix(withBorder, borderColor.mul(0.9), ribMask.mul(panelMask).mul(0.4));
        
        // ========== 污渍 ==========
        const grime = sin(uvCoord.x.mul(5)).mul(sin(uvCoord.y.mul(4))).mul(0.5).add(0.5);
        const grimeColor = vec3(0.2, 0.18, 0.15);
        const finalColor = mix(withRibs, grimeColor, grime.mul(0.12));
        
        material.colorNode = finalColor;
        
        // ========== 动态粗糙度 ==========
        const roughnessBase = float(0.4);
        const roughnessScratched = mix(roughnessBase, float(0.6), scratchMask);
        const roughnessRusted = mix(roughnessScratched, float(0.9), rustMask);
        material.roughnessNode = roughnessRusted;
        
        // ========== 金属度 ==========
        // 锈迹处金属度降低，油漆处也降低
        const metalnessBase = float(0.85);
        const metalnessPainted = mix(metalnessBase, float(0.1), sub(float(1), scratchMask.add(paintChipMask)));
        const metalnessRusted = mix(metalnessPainted, float(0.15), rustMask);
        material.metalnessNode = metalnessRusted;
        
        return material;
    }

    /**
     * 混凝土材质 - 风化混凝土块
     */
    public static createConcreteMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.95,
            metalness: 0.0
        });

        const uvCoord = uv();
        
        // ========== 多层混凝土噪声 ==========
        const noise1 = sin(uvCoord.x.mul(15)).mul(sin(uvCoord.y.mul(15))).mul(0.5).add(0.5);
        const noise2 = sin(uvCoord.x.mul(35)).mul(sin(uvCoord.y.mul(40))).mul(0.5).add(0.5);
        const noise3 = sin(uvCoord.x.mul(80)).mul(sin(uvCoord.y.mul(75))).mul(0.5).add(0.5);
        const microNoise = sin(uvCoord.x.mul(150)).mul(sin(uvCoord.y.mul(160))).mul(0.5).add(0.5);
        
        // ========== 骨料/石子 ==========
        const aggregateNoise = sin(uvCoord.x.mul(25)).mul(sin(uvCoord.y.mul(28))).mul(0.5).add(0.5);
        const aggregateMask = smoothstep(float(0.65), float(0.75), aggregateNoise);
        const aggregateColor = vec3(0.5, 0.48, 0.45);  // 浅色石子
        const aggregateDark = vec3(0.35, 0.33, 0.3);   // 深色石子
        
        // ========== 基础混凝土颜色 ==========
        const concreteLight = vec3(0.6, 0.58, 0.55);
        const concreteMid = vec3(0.5, 0.48, 0.45);
        const concreteDark = vec3(0.4, 0.38, 0.36);
        
        // 混合基础色
        const baseColor = mix(concreteMid, concreteLight, noise1.mul(0.5));
        const withVariation = mix(baseColor, concreteDark, noise2.mul(0.35));
        
        // 表面纹理
        const surfaceDetail = noise3.mul(0.08).sub(0.04);
        const microDetail = microNoise.mul(0.03).sub(0.015);
        const texturedConcrete = withVariation.add(surfaceDetail).add(microDetail);
        
        // 添加骨料
        const aggregateMixed = mix(aggregateColor, aggregateDark, noise2);
        const withAggregate = mix(texturedConcrete, aggregateMixed, aggregateMask.mul(0.6));
        
        // ========== 风化效果 ==========
        // 水渍/污渍
        const stainNoise = sin(uvCoord.x.mul(6)).mul(sin(uvCoord.y.mul(5))).mul(0.5).add(0.5);
        const stainMask = smoothstep(float(0.6), float(0.8), stainNoise);
        const stainColor = vec3(0.35, 0.32, 0.3);
        const withStains = mix(withAggregate, stainColor, stainMask.mul(0.25));
        
        // 边角磨损 (用 UV 模拟)
        const edgeWear = smoothstep(float(0.05), float(0.0), uvCoord.x)
            .add(smoothstep(float(0.95), float(1.0), uvCoord.x))
            .add(smoothstep(float(0.05), float(0.0), uvCoord.y))
            .add(smoothstep(float(0.95), float(1.0), uvCoord.y));
        const wornColor = vec3(0.55, 0.52, 0.5);
        const withWear = mix(withStains, wornColor, edgeWear.mul(0.3));
        
        // ========== 裂缝 ==========
        const crackNoise = sin(uvCoord.x.mul(2.5).add(uvCoord.y.mul(1.5)))
            .mul(sin(uvCoord.x.mul(5).sub(uvCoord.y.mul(3)))).mul(0.5).add(0.5);
        const crackMask = step(float(0.93), crackNoise);
        const crackColor = vec3(0.2, 0.18, 0.17);
        const finalColor = mix(withWear, crackColor, crackMask.mul(0.7));
        
        material.colorNode = finalColor;
        
        // ========== 法线变化 ==========
        const bumpX = noise2.mul(0.1).sub(0.05);
        const bumpZ = noise3.mul(0.08).sub(0.04);
        const crackBump = crackMask.mul(0.15);
        const bumpNormal = normalize(normalLocal.add(vec3(bumpX, crackBump, bumpZ)));
        material.normalNode = bumpNormal;
        
        // 粗糙度
        const roughnessBase = float(0.9);
        const roughnessWithAggregate = mix(roughnessBase, float(0.7), aggregateMask);
        material.roughnessNode = roughnessWithAggregate;
        
        return material;
    }
    
    /**
     * 岩石材质 - 自然岩石纹理
     */
    public static createRockMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.95,
            metalness: 0.05
        });
        
        const uvCoord = uv();
        
        // ========== 多层噪声 ==========
        const largeNoise = sin(uvCoord.x.mul(8)).mul(sin(uvCoord.y.mul(7))).mul(0.5).add(0.5);
        const medNoise = sin(uvCoord.x.mul(20)).mul(sin(uvCoord.y.mul(22))).mul(0.5).add(0.5);
        const fineNoise = sin(uvCoord.x.mul(50)).mul(sin(uvCoord.y.mul(55))).mul(0.5).add(0.5);
        const microNoise = sin(uvCoord.x.mul(100)).mul(sin(uvCoord.y.mul(95))).mul(0.5).add(0.5);
        
        // ========== 岩石分层 ==========
        const layerPattern = sin(uvCoord.y.mul(12).add(uvCoord.x.mul(2))).mul(0.5).add(0.5);
        const layerMask = smoothstep(float(0.4), float(0.6), layerPattern);
        
        // ========== 岩石颜色 ==========
        const rockGray = vec3(0.45, 0.43, 0.4);
        const rockBrown = vec3(0.42, 0.38, 0.32);
        const rockDark = vec3(0.3, 0.28, 0.25);
        const rockLight = vec3(0.55, 0.52, 0.48);
        
        // 基础混合
        const baseRock = mix(rockGray, rockBrown, largeNoise);
        const layeredRock = mix(baseRock, rockDark, layerMask.mul(0.4));
        const variedRock = mix(layeredRock, rockLight, medNoise.mul(0.3));
        
        // 表面细节
        const surfaceDetail = fineNoise.mul(0.1).sub(0.05);
        const microDetail = microNoise.mul(0.04).sub(0.02);
        const texturedRock = variedRock.add(surfaceDetail).add(microDetail);
        
        // ========== 苔藓/地衣 ==========
        const mossNoise = sin(uvCoord.x.mul(6)).mul(sin(uvCoord.y.mul(5))).mul(0.5).add(0.5);
        const mossMask = smoothstep(float(0.65), float(0.85), mossNoise.mul(largeNoise));
        const mossColor = vec3(0.25, 0.35, 0.2);
        const withMoss = mix(texturedRock, mossColor, mossMask.mul(0.5));
        
        // ========== 裂隙 ==========
        const crackPattern = sin(uvCoord.x.mul(4).add(uvCoord.y.mul(2)))
            .mul(sin(uvCoord.x.mul(8).sub(uvCoord.y.mul(6)))).mul(0.5).add(0.5);
        const crackMask = step(float(0.92), crackPattern);
        const crackColor = vec3(0.15, 0.13, 0.12);
        const finalColor = mix(withMoss, crackColor, crackMask.mul(0.6));
        
        material.colorNode = finalColor;
        
        // ========== 法线 ==========
        const bumpX = medNoise.mul(0.15).sub(0.075);
        const bumpZ = fineNoise.mul(0.12).sub(0.06);
        const layerBump = layerMask.mul(0.1);
        const bumpNormal = normalize(normalLocal.add(vec3(bumpX, layerBump, bumpZ)));
        material.normalNode = bumpNormal;
        
        // 粗糙度
        const roughnessBase = float(0.92);
        const roughnessWithMoss = mix(roughnessBase, float(0.98), mossMask);
        material.roughnessNode = roughnessWithMoss;
        
        return material;
    }

    /**
     * 沙袋材质
     */
    public static createSandbagMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.95,
            metalness: 0.0
        });
        
        const uvCoord = uv();
        
        // 粗麻布纹理
        const weaveFreq = float(40);
        const weave1 = sin(uvCoord.x.mul(weaveFreq)).mul(0.5).add(0.5);
        const weave2 = sin(uvCoord.y.mul(weaveFreq)).mul(0.5).add(0.5);
        const weavePattern = weave1.mul(weave2).mul(0.1);
        
        // 沙袋堆叠纹理
        const bagHeight = float(0.25);
        const bagRow = floor(uvCoord.y.div(bagHeight));
        const bagOffset = mod(bagRow, float(2)).mul(0.3);
        const bagX = fract(uvCoord.x.add(bagOffset).mul(2));
        const bagY = fract(uvCoord.y.div(bagHeight));
        
        // 沙袋边缘
        const bagEdgeX = smoothstep(float(0), float(0.05), bagX)
            .mul(smoothstep(float(1), float(0.95), bagX));
        const bagEdgeY = smoothstep(float(0), float(0.1), bagY)
            .mul(smoothstep(float(1), float(0.9), bagY));
        const bagShape = bagEdgeX.mul(bagEdgeY);
        
        // 沙袋颜色
        const bagColor = vec3(0.65, 0.55, 0.4);
        const seamColor = vec3(0.4, 0.35, 0.25);
        
        const finalColor = mix(seamColor, bagColor.add(weavePattern), bagShape);
        material.colorNode = finalColor;
        
        return material;
    }
    
    /**
     * 油桶材质
     */
    public static createBarrelMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.5,
            metalness: 0.7
        });
        
        const uvCoord = uv();
        
        // 桶身条纹
        const stripeFreq = float(30);
        const stripes = sin(uvCoord.y.mul(stripeFreq)).mul(0.5).add(0.5);
        const stripeMask = smoothstep(float(0.4), float(0.6), stripes);
        
        // 锈迹
        const rustNoise = sin(uvCoord.x.mul(20).add(uvCoord.y.mul(15)));
        const rustMask = smoothstep(float(0.3), float(0.6), rustNoise).mul(0.4);
        
        // 油桶颜色 (绿色/黄色)
        const barrelColor = vec3(0.2, 0.35, 0.15);
        const stripeColor = vec3(0.6, 0.5, 0.1);
        const rustColor = vec3(0.5, 0.3, 0.15);
        
        let finalColor = mix(barrelColor, stripeColor, stripeMask.mul(0.3));
        finalColor = mix(finalColor, rustColor, rustMask);
        
        material.colorNode = finalColor;
        material.roughnessNode = float(0.4).add(rustMask.mul(0.5));
        material.metalnessNode = float(0.8).sub(rustMask.mul(0.4));
        
        return material;
    }

    /**
     * 楼梯材质 - 带防滑纹理
     */
    public static createStairMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.7,
            metalness: 0.2
        });

        const uvCoord = uv();
        
        // 防滑条纹
        const stripeFreq = float(20);
        const stripes = sin(uvCoord.x.mul(stripeFreq)).mul(0.5).add(0.5);
        const stripeMask = step(float(0.7), stripes);
        
        // 混凝土基础
        const noiseFreq = float(30);
        const noise = sin(uvCoord.x.mul(noiseFreq)).mul(sin(uvCoord.y.mul(noiseFreq))).mul(0.03);
        
        // 颜色
        const baseColor = vec3(0.5, 0.48, 0.45);
        const stripeColor = vec3(0.3, 0.28, 0.25);
        
        const finalColor = mix(baseColor.add(noise), stripeColor, stripeMask.mul(0.3));
        
        material.colorNode = finalColor;
        
        // 条纹处更粗糙
        material.roughnessNode = mix(float(0.6), float(0.9), stripeMask);
        
        return material;
    }

    /**
     * 天空材质 - 动态渐变
     */
    public static createSkyMaterial(): MeshBasicNodeMaterial {
        const material = new MeshBasicNodeMaterial({
            side: THREE.BackSide
        });

        const t = time;
        
        // 使用世界位置计算高度
        const worldPos = positionWorld;
        const skyRadius = float(MapConfig.size * 1.5);
        const height = worldPos.y.div(skyRadius).add(0.5); // 归一化到 0-1
        
        // 天空渐变
        const horizonColor = vec3(0.75, 0.88, 0.98);
        const zenithColor = vec3(0.4, 0.6, 0.95);
        const sunsetTint = vec3(0.95, 0.85, 0.7);
        
        // 基础渐变
        const skyGradient = smoothstep(float(0.3), float(0.8), height);
        let skyColor = mix(horizonColor, zenithColor, skyGradient);
        
        // 添加日落色调 (可选，基于时间)
        const sunsetAmount = sin(t.mul(0.1)).mul(0.5).add(0.5).mul(0.2);
        skyColor = mix(skyColor, sunsetTint, sunsetAmount.mul(sub(float(1), skyGradient)));
        
        material.colorNode = skyColor;
        
        return material;
    }
}