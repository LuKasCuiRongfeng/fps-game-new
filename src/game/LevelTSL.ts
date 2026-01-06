/**
 * Level - 使用 TSL 材质增强的关卡系统
 * 所有地形材质使用程序化生成的 shader 纹理
 * 支持大地图和性能优化
 */
import * as THREE from 'three';
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { 
    time, sin, cos, vec3, mix, float, 
    smoothstep, fract, floor, uv,
    sub, max, mod, normalLocal, normalize, step, positionWorld, abs,
    positionLocal
} from 'three/tsl';
import { MapConfig } from './GameConfig';

// 地图配置已经被移除，请统一引用 GameConfig

export class Level {
    private scene: THREE.Scene;
    private objects: THREE.Object3D[];
    
    // 材质缓存 (性能优化 - 复用材质)
    private floorMaterial!: MeshStandardNodeMaterial;
    private wallMaterial!: MeshStandardNodeMaterial;
    private concreteMaterial!: MeshStandardNodeMaterial;
    private metalMaterial!: MeshStandardNodeMaterial;
    private rockMaterial!: MeshStandardNodeMaterial;
    
    // 地形高度图数据
    private terrainHeights: Float32Array | null = null;
    private terrainSegmentSize: number = MapConfig.size / MapConfig.terrainSegments;

    constructor(scene: THREE.Scene, objects: THREE.Object3D[]) {
        this.scene = scene;
        this.objects = objects;
        
        // 预创建共享材质 (性能优化)
        this.initSharedMaterials();
        
        this.createFloor();
        this.createWalls();
        this.createProceduralTerrain();
        this.createObstacles();
        this.createCoverObjects();
        this.createStairs();
        this.createSkybox();
        this.createAtmosphere();
    }
    
    /**
     * 初始化共享材质 (性能优化 - 减少材质实例)
     */
    private initSharedMaterials() {
        this.floorMaterial = this.createFloorMaterial();
        this.wallMaterial = this.createWallMaterial();
        this.concreteMaterial = this.createConcreteMaterial();
        this.metalMaterial = this.createMetalCrateMaterial();
        this.rockMaterial = this.createRockMaterial();
    }

    /**
     * 创建地板 - 带起伏的地形
     */
    private createFloor() {
        // 使用更多细分以支持地形起伏
        const geometry = new THREE.PlaneGeometry(
            MapConfig.size, 
            MapConfig.size, 
            MapConfig.terrainSegments, 
            MapConfig.terrainSegments
        );
        
        // 初始化高度图数组 (Rows x Cols)
        // 顶点数 = segments + 1
        const gridSize = MapConfig.terrainSegments + 1;
        this.terrainHeights = new Float32Array(gridSize * gridSize);
        const halfSize = MapConfig.size / 2;

        // 1. 先生成高度数据 (作为真理数据源)
        for (let iz = 0; iz < gridSize; iz++) {
            for (let ix = 0; ix < gridSize; ix++) {
                // 网格坐标转世界坐标
                // x = ix * segmentSize - halfSize
                const worldX = ix * this.terrainSegmentSize - halfSize;
                const worldZ = iz * this.terrainSegmentSize - halfSize;
                
                const height = this.computeNoiseHeight(worldX, worldZ);
                this.terrainHeights[iz * gridSize + ix] = height;
            }
        }
        
        // 2. 将高度数据应用到网格上 (确保网格完全匹配高度图)
        const positions = geometry.attributes.position;
        
        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const y = positions.getY(i); 
            
            // PlaneGeometry 旋转 -90度后，局部 Y 轴变为世界 Z 轴的负方向
            const worldZ = -y;
            
            // 计算对应的网格索引 (精确查找)
            const ix = Math.round((x + halfSize) / this.terrainSegmentSize);
            const iz = Math.round((worldZ + halfSize) / this.terrainSegmentSize);
            
            if (ix >= 0 && ix < gridSize && iz >= 0 && iz < gridSize) {
                // 直接从高度图读取，而不是重新计算，消除任何潜在的不一致
                const height = this.terrainHeights[iz * gridSize + ix];
                positions.setZ(i, height); 
            }
        }
        
        geometry.computeVertexNormals();
        geometry.attributes.position.needsUpdate = true;

        const plane = new THREE.Mesh(geometry, this.floorMaterial);
        plane.rotation.x = -Math.PI / 2;
        plane.receiveShadow = true;
        plane.userData = { isGround: true };
        this.scene.add(plane);
    }
    
    /**
     * 计算地形高度 - 多层噪声 (内部计算用)
     */
    private computeNoiseHeight(x: number, z: number): number {
        // 使用更平滑的噪声参数，减少高频抖动
        const scale1 = 0.015;  // 大尺度起伏
        const scale2 = 0.04;  // 中尺度变化
        
        // 中心区域较平坦（玩家出生点附近）
        const distFromCenter = Math.sqrt(x * x + z * z);
        const centerFlatten = Math.max(0.2, Math.min(1, (distFromCenter - 10) / 40));
        
        // 多层正弦噪声模拟 Perlin 噪声
        const noise1 = Math.sin(x * scale1 * 1.1 + 0.5) * Math.cos(z * scale1 * 0.9 + 0.3);
        const noise2 = Math.sin(x * scale2 * 1.3 + 1.2) * Math.cos(z * scale2 * 1.1 + 0.7) * 0.5;
        // 去掉高频噪声 scale3，使地形更平滑，利于物体贴合
        
        const combinedNoise = (noise1 + noise2);
        
        // 应用高度并在中心区域减弱
        const height = combinedNoise * MapConfig.terrainHeight * centerFlatten;
        
        return height;
    }

    /**
     * 获取地形高度 (外部查询用，基于实际网格插值)
     */
    public getTerrainHeight(x: number, z: number): number {
        // 如果高度图未初始化，回退到原始噪声计算
        if (!this.terrainHeights) {
            return this.computeNoiseHeight(x, z);
        }

        const halfSize = MapConfig.size / 2;
        const gridSize = MapConfig.terrainSegments + 1;
        
        // 转换到网格坐标 (Float)
        const gx = (x + halfSize) / this.terrainSegmentSize;
        const gz = (z + halfSize) / this.terrainSegmentSize;
        
        // 整数索引
        const ix = Math.floor(gx);
        const iz = Math.floor(gz);
        
        // 边界检查
        if (ix < 0 || ix >= gridSize - 1 || iz < 0 || iz >= gridSize - 1) {
            return this.computeNoiseHeight(x, z); // 超出范围回退
        }
        
        // 小数部分
        const fx = gx - ix;
        const fz = gz - iz;
        
        // 获取四个顶点的高度
        // Row = iz, Col = ix
        const h00 = this.terrainHeights[iz * gridSize + ix];         // Top-Left
        const h10 = this.terrainHeights[iz * gridSize + (ix + 1)];   // Top-Right
        const h01 = this.terrainHeights[(iz + 1) * gridSize + ix];   // Bottom-Left
        const h11 = this.terrainHeights[(iz + 1) * gridSize + (ix + 1)]; // Bottom-Right
        
        // 双线性插值
        // high performance approximate
        const hBottom = (1 - fx) * h00 + fx * h10;
        const hTop = (1 - fx) * h01 + fx * h11;
        
        return (1 - fz) * hBottom + fz * hTop;
    }

    /**
     * 地板材质 - 自然泥土/草地混合纹理 (增强版)
     */
    private createFloorMaterial(): MeshStandardNodeMaterial {
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
        
        material.colorNode = finalColor;
        
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
     * 创建墙壁 - 扩大的围墙
     */
    private createWalls() {
        const wallHeight = MapConfig.wallHeight;
        const wallThickness = 1.5;
        const arenaSize = MapConfig.size;
        
        const configs = [
            { pos: [0, wallHeight/2, -arenaSize/2], size: [arenaSize + wallThickness*2, wallHeight, wallThickness] },
            { pos: [0, wallHeight/2, arenaSize/2], size: [arenaSize + wallThickness*2, wallHeight, wallThickness] },
            { pos: [-arenaSize/2, wallHeight/2, 0], size: [wallThickness, wallHeight, arenaSize] },
            { pos: [arenaSize/2, wallHeight/2, 0], size: [wallThickness, wallHeight, arenaSize] },
        ];

        configs.forEach(cfg => {
            const geo = new THREE.BoxGeometry(cfg.size[0], cfg.size[1], cfg.size[2]);
            
            // 墙壁需要整个拔高，为了简单起见，这里取墙壁中心的地面高度作为基准高度
            // 实际上墙壁可能横跨很大的起伏，这里会造成穿帮（两端悬空或深埋）
            // 更好的做法是墙壁底部延伸很长到地下，或者分段生成
            // 简单处理：将墙壁向下延伸 10 米，防止下方露出
            
            // 更新高度：加上 extraDepth
            const extraDepth = 15;
            const newHeight = cfg.size[1] + extraDepth;
            const newGeo = new THREE.BoxGeometry(cfg.size[0], newHeight, cfg.size[2]);
            
            // Y中心位置下移 extraDepth/2
            const newY = cfg.pos[1] - extraDepth / 2;
            
            const mesh = new THREE.Mesh(newGeo, this.wallMaterial);
            mesh.position.set(cfg.pos[0], newY, cfg.pos[2]);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            this.objects.push(mesh);
        });
    }

    /**
     * 墙壁材质 - 风化混凝土/砖墙
     */
    private createWallMaterial(): MeshStandardNodeMaterial {
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
     * 创建障碍物 - 金属/混凝土方块 (扩展到更大地图)
     */
    private createObstacles() {
        // 使用 InstancedMesh 提升性能
        const boxGeo = new THREE.BoxGeometry(2, 2, 2);
        const tallGeo = new THREE.BoxGeometry(2, 6, 2);
        const mapRadius = MapConfig.size / 2 - 10;

        // 中心区域障碍物
        const centerPositions = [
            { x: 5, z: 5, type: 'box' },
            { x: -5, z: 5, type: 'box' },
            { x: 5, z: -5, type: 'box' },
            { x: -5, z: -5, type: 'box' },
            { x: 15, z: 15, type: 'tall' },
            { x: -15, z: 15, type: 'tall' },
            { x: 15, z: -15, type: 'tall' },
            { x: -15, z: -15, type: 'tall' },
            { x: 0, z: 15, type: 'box' },
            { x: 0, z: -15, type: 'box' },
            { x: 15, z: 0, type: 'box' },
            { x: -15, z: 0, type: 'box' },
        ];
        
        // 外围区域障碍物 (程序化生成)
        const outerPositions: {x: number, z: number, type: string}[] = [];
        
        // 网格分布的障碍物
        const gridSpacing = 25;
        for (let x = -mapRadius + 30; x <= mapRadius - 30; x += gridSpacing) {
            for (let z = -mapRadius + 30; z <= mapRadius - 30; z += gridSpacing) {
                // 跳过中心区域 (已有障碍物)
                if (Math.abs(x) < 25 && Math.abs(z) < 25) continue;
                
                // 伪随机偏移
                const seed = x * 127 + z * 311;
                const offsetX = Math.sin(seed) * 5;
                const offsetZ = Math.cos(seed * 1.3) * 5;
                
                const type = Math.sin(seed * 2.7) > 0.3 ? 'box' : 'tall';
                outerPositions.push({ 
                    x: x + offsetX, 
                    z: z + offsetZ, 
                    type 
                });
            }
        }
        
        const allPositions = [...centerPositions, ...outerPositions];

        allPositions.forEach((p, index) => {
            const geo = p.type === 'box' ? boxGeo : tallGeo;
            const height = p.type === 'box' ? 2 : 6;
            
            // 获取地形高度
            const groundY = this.getTerrainHeight(p.x, p.z);
            
            // 嵌入地面深度 (防止因地形起伏导致的悬空)
            const embedDepth = 0.5;
            
            // 物体Y坐标 = 地形高度 + 物体半高 - 嵌入深度
            const y = groundY + height / 2 - embedDepth;
            
            // 交替使用共享材质 (性能优化)
            const material = index % 2 === 0 
                ? this.metalMaterial 
                : this.concreteMaterial;
            
            const mesh = new THREE.Mesh(geo, material);
            mesh.position.set(p.x, y, p.z);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            this.objects.push(mesh);
        });
    }

    /**
     * 金属箱子材质 - 工业集装箱/军用储物箱
     */
    private createMetalCrateMaterial(): MeshStandardNodeMaterial {
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
    private createConcreteMaterial(): MeshStandardNodeMaterial {
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
    private createRockMaterial(): MeshStandardNodeMaterial {
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
     * 创建程序化地形 - 岩石、掩体、废墟
     */
    private createProceduralTerrain() {
        // createFloor 已经处理了地面网格的高度
        // 这里只负责添加装饰性物体
        
        const mapRadius = MapConfig.size / 2;
        
        // 1. 大型岩石群 (使用 InstancedMesh 性能优化)
        this.createRockFormations(mapRadius);
        
        // 2. 废墟/断墙
        this.createRuins(mapRadius);
        
        // 3. 沙袋掩体
        this.createSandbagCovers(mapRadius);
    }
    
    /**
     * 创建岩石群 - 使用 InstancedMesh 优化性能
     */
    private createRockFormations(mapRadius: number) {
        // 定义不同大小的岩石几何体
        const smallRockGeo = new THREE.DodecahedronGeometry(1.5, 0);
        const mediumRockGeo = new THREE.DodecahedronGeometry(2.5, 1);
        const largeRockGeo = new THREE.DodecahedronGeometry(4, 1);
        
        // 岩石群位置 (伪随机分布)
        const rockClusters = [
            { x: 60, z: 60, count: 5, size: 'mixed' },
            { x: -60, z: 60, count: 4, size: 'mixed' },
            { x: 60, z: -60, count: 5, size: 'mixed' },
            { x: -60, z: -60, count: 4, size: 'mixed' },
            { x: 0, z: 75, count: 3, size: 'large' },
            { x: 0, z: -75, count: 3, size: 'large' },
            { x: 75, z: 0, count: 3, size: 'large' },
            { x: -75, z: 0, count: 3, size: 'large' },
            // 边缘区域
            { x: 85, z: 50, count: 4, size: 'mixed' },
            { x: -85, z: 50, count: 4, size: 'mixed' },
            { x: 85, z: -50, count: 4, size: 'mixed' },
            { x: -85, z: -50, count: 4, size: 'mixed' },
            { x: 50, z: 85, count: 3, size: 'mixed' },
            { x: -50, z: 85, count: 3, size: 'mixed' },
            { x: 50, z: -85, count: 3, size: 'mixed' },
            { x: -50, z: -85, count: 3, size: 'mixed' },
        ];
        
        rockClusters.forEach((cluster, clusterIndex) => {
            for (let i = 0; i < cluster.count; i++) {
                // 伪随机偏移
                const seed = clusterIndex * 100 + i;
                const offsetX = Math.sin(seed * 12.9898) * 8;
                const offsetZ = Math.cos(seed * 78.233) * 8;
                
                // 选择几何体
                let geo: THREE.BufferGeometry;
                let scale: number;
                
                if (cluster.size === 'large' || (cluster.size === 'mixed' && i === 0)) {
                    geo = largeRockGeo;
                    scale = 0.8 + Math.sin(seed * 3.14) * 0.4;
                } else if (cluster.size === 'mixed' && i < 2) {
                    geo = mediumRockGeo;
                    scale = 0.7 + Math.sin(seed * 2.71) * 0.3;
                } else {
                    geo = smallRockGeo;
                    scale = 0.6 + Math.sin(seed * 1.41) * 0.4;
                }
                
                const mesh = new THREE.Mesh(geo, this.rockMaterial);
                
                const x = cluster.x + offsetX;
                const z = cluster.z + offsetZ;
                
                // 获取地面高度并让岩石稍微嵌入地面
                const groundH = this.getTerrainHeight(x, z);
                // DodecahedronGeometry(radius) 半径约为scale
                // 中心在y，底部在 y - scale
                // 我们希望底部稍微嵌入地面，比如嵌入 20%
                const y = groundH + scale * 0.8;
                
                mesh.position.set(x, y, z);
                mesh.scale.set(scale, scale * (0.6 + Math.random() * 0.4), scale);
                mesh.rotation.set(
                    Math.sin(seed) * 0.3,
                    Math.sin(seed * 2) * Math.PI,
                    Math.cos(seed) * 0.2
                );
                
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                mesh.userData = { isRock: true };
                
                this.scene.add(mesh);
                this.objects.push(mesh);
            }
        });
    }
    
    /**
     * 创建废墟断墙
     */
    private createRuins(mapRadius: number) {
        const ruinPositions = [
            { x: 40, z: 40, rotation: 0.3, height: 3 },
            { x: -40, z: 40, rotation: -0.2, height: 4 },
            { x: 40, z: -40, rotation: 0.5, height: 2.5 },
            { x: -40, z: -40, rotation: -0.4, height: 3.5 },
            { x: 70, z: 20, rotation: 0.8, height: 4 },
            { x: -70, z: 20, rotation: -0.6, height: 3 },
            { x: 70, z: -20, rotation: 0.2, height: 3.5 },
            { x: -70, z: -20, rotation: -0.3, height: 4 },
            { x: 20, z: 70, rotation: 1.2, height: 3 },
            { x: -20, z: 70, rotation: -1.1, height: 2.5 },
            { x: 20, z: -70, rotation: 0.9, height: 4 },
            { x: -20, z: -70, rotation: -0.8, height: 3 },
        ];
        
        ruinPositions.forEach((ruin, index) => {
            // 主墙段
            const wallWidth = 6 + Math.sin(index * 2.5) * 2;
            const wallGeo = new THREE.BoxGeometry(wallWidth, ruin.height, 0.8);
            const wallMesh = new THREE.Mesh(wallGeo, this.wallMaterial);
            
            const groundH = this.getTerrainHeight(ruin.x, ruin.z);
            // 稍微嵌入地面以避免悬空
            const embed = 0.5;
            
            wallMesh.position.set(ruin.x, groundH + ruin.height / 2 - embed, ruin.z);
            wallMesh.rotation.y = ruin.rotation;
            wallMesh.castShadow = true;
            wallMesh.receiveShadow = true;
            wallMesh.userData = { isRuin: true };
            
            this.scene.add(wallMesh);
            this.objects.push(wallMesh);
            
            // 碎片
            if (index % 2 === 0) {
                const debrisGeo = new THREE.BoxGeometry(1.5, 0.8, 1);
                const debrisMesh = new THREE.Mesh(debrisGeo, this.concreteMaterial);
                
                const offsetX = Math.cos(ruin.rotation) * 3;
                const offsetZ = Math.sin(ruin.rotation) * 3;
                
                const debrisX = ruin.x + offsetX;
                const debrisZ = ruin.z + offsetZ;
                const debrisGroundH = this.getTerrainHeight(debrisX, debrisZ);
                
                // 碎片高度0.8，中心0.4。稍微嵌入地面
                debrisMesh.position.set(debrisX, debrisGroundH + 0.3, debrisZ);
                debrisMesh.rotation.set(0.2, ruin.rotation + 0.5, 0.1);
                debrisMesh.castShadow = true;
                debrisMesh.receiveShadow = true;
                
                this.scene.add(debrisMesh);
                this.objects.push(debrisMesh);
            }
        });
    }
    
    /**
     * 创建沙袋掩体
     */
    private createSandbagCovers(mapRadius: number) {
        const sandbagMaterial = this.createSandbagMaterial();
        
        const coverPositions = [
            { x: 30, z: 0, rotation: 0 },
            { x: -30, z: 0, rotation: Math.PI },
            { x: 0, z: 30, rotation: Math.PI / 2 },
            { x: 0, z: -30, rotation: -Math.PI / 2 },
            { x: 50, z: 30, rotation: 0.5 },
            { x: -50, z: 30, rotation: -0.5 },
            { x: 50, z: -30, rotation: 0.3 },
            { x: -50, z: -30, rotation: -0.3 },
            { x: 30, z: 50, rotation: 1.2 },
            { x: -30, z: 50, rotation: -1.2 },
            { x: 30, z: -50, rotation: 0.8 },
            { x: -30, z: -50, rotation: -0.8 },
        ];
        
        coverPositions.forEach((pos) => {
            // U 形沙袋墙
            const group = new THREE.Group();
            
            // 前墙
            const frontGeo = new THREE.BoxGeometry(4, 1.2, 0.8);
            const frontMesh = new THREE.Mesh(frontGeo, sandbagMaterial);
            frontMesh.position.set(0, 0.6, 0);
            group.add(frontMesh);
            this.objects.push(frontMesh);
            
            // 左侧
            const leftGeo = new THREE.BoxGeometry(0.8, 1, 2);
            const leftMesh = new THREE.Mesh(leftGeo, sandbagMaterial);
            leftMesh.position.set(-1.8, 0.5, 1.2);
            group.add(leftMesh);
            this.objects.push(leftMesh);
            
            // 右侧
            const rightMesh = new THREE.Mesh(leftGeo, sandbagMaterial);
            rightMesh.position.set(1.8, 0.5, 1.2);
            group.add(rightMesh);
            this.objects.push(rightMesh);
            
            const groundH = this.getTerrainHeight(pos.x, pos.z);
            // 稍微嵌入地面确保底部不悬空
            group.position.set(pos.x, groundH - 0.2, pos.z);
            group.rotation.y = pos.rotation;
            
            group.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    child.userData = { isCover: true };
                }
            });
            
            this.scene.add(group);
        });
    }
    
    /**
     * 沙袋材质
     */
    private createSandbagMaterial(): MeshStandardNodeMaterial {
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
     * 创建掩体物体 (额外的战术掩护)
     */
    private createCoverObjects() {
        // 油桶 (使用圆柱体)
        const barrelGeo = new THREE.CylinderGeometry(0.6, 0.6, 1.2, 12);
        const barrelMaterial = this.createBarrelMaterial();
        
        const barrelPositions = [
            { x: 25, z: 10 },
            { x: -25, z: 10 },
            { x: 25, z: -10 },
            { x: -25, z: -10 },
            { x: 10, z: 25 },
            { x: -10, z: 25 },
            { x: 10, z: -25 },
            { x: -10, z: -25 },
            // 外围
            { x: 55, z: 55 },
            { x: -55, z: 55 },
            { x: 55, z: -55 },
            { x: -55, z: -55 },
            { x: 65, z: 0 },
            { x: -65, z: 0 },
            { x: 0, z: 65 },
            { x: 0, z: -65 },
        ];
        
        const embedDepth = 0.3; // 油桶嵌入深度
        
        barrelPositions.forEach((pos, index) => {
            const barrel = new THREE.Mesh(barrelGeo, barrelMaterial);
            // 获取地形高度
            const groundY = this.getTerrainHeight(pos.x, pos.z);
            barrel.position.set(pos.x, groundY + 0.6 - embedDepth, pos.z);
            
            barrel.rotation.y = index * 0.7;
            barrel.castShadow = true;
            barrel.receiveShadow = true;
            barrel.userData = { isBarrel: true };
            
            this.scene.add(barrel);
            this.objects.push(barrel);
            
            // 有些位置添加倒下的桶
            if (index % 3 === 0) {
                const fallenBarrel = new THREE.Mesh(barrelGeo, barrelMaterial);
                const offset = 1.0;
                // 获取倒下桶位置的地形高度
                const fallenX = pos.x + offset;
                const fallenZ = pos.z + 0.5;
                const fallenGroundY = this.getTerrainHeight(fallenX, fallenZ);
                 
                fallenBarrel.position.set(fallenX, fallenGroundY + 0.6 - embedDepth, fallenZ);
                fallenBarrel.rotation.z = Math.PI / 2;
                fallenBarrel.rotation.y = index * 0.3;
                fallenBarrel.castShadow = true;
                fallenBarrel.receiveShadow = true;
                
                this.scene.add(fallenBarrel);
                this.objects.push(fallenBarrel);
            }
        });
    }
    
    /**
     * 油桶材质
     */
    private createBarrelMaterial(): MeshStandardNodeMaterial {
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
     * 创建楼梯 (多处)
     */
    private createStairs() {
        const stepHeight = 0.5;
        const stepDepth = 1.0;
        const stepWidth = 4.0;
        const numSteps = 8;
        
        // 多个楼梯位置
        const stairConfigs = [
            { startX: 20, startZ: -5, rotation: 0 },
            { startX: -20, startZ: 5, rotation: Math.PI },
            { startX: 45, startZ: 30, rotation: Math.PI / 2 },
            { startX: -45, startZ: -30, rotation: -Math.PI / 2 },
        ];
        
        stairConfigs.forEach((config, configIndex) => {
            const group = new THREE.Group();
            
            // 获取楼梯起始点的地面高度作为基准
            const groundY = this.getTerrainHeight(config.startX, config.startZ);
            
            for (let i = 0; i < numSteps; i++) {
                const currentHeight = stepHeight * (i + 1);
                // 增加基础深度，让楼梯深入地下
                const baseDepth = 4.0;
                const totalHeight = currentHeight + baseDepth;
                
                const geo = new THREE.BoxGeometry(stepWidth, totalHeight, stepDepth);
                const material = this.createStairMaterial();
                
                // 调整位置使其顶部保持在正确高度，底部深入地下
                // 顶部 Y = currentHeight
                // 几何体中心 Y = currentHeight - totalHeight/2
                // = currentHeight - (currentHeight + baseDepth)/2
                // = currentHeight/2 - baseDepth/2
                const meshY = currentHeight / 2 - baseDepth / 2;
                
                const mesh = new THREE.Mesh(geo, material);
                mesh.position.set(0, meshY, i * stepDepth);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                mesh.userData = { isStair: true };
                
                group.add(mesh);
                this.objects.push(mesh);
            }

            // 顶部平台
            const platformWidth = 6;
            const platformDepth = 6;
            const platformHeight = stepHeight * numSteps;
            
            // 增加基础深度，防止平台悬空
            const baseDepth = 4.0;
            const totalPlatformHeight = platformHeight + baseDepth;
            
            const platformGeo = new THREE.BoxGeometry(platformWidth, totalPlatformHeight, platformDepth);
            const platformMaterial = this.createStairMaterial();
            const platformMesh = new THREE.Mesh(platformGeo, platformMaterial);
            
            // 计算Y位置：确保顶部高度正确，底部深入地下
            const platformY = platformHeight / 2 - baseDepth / 2;
            
            // 最终设置组位置
            group.position.set(config.startX, groundY, config.startZ);
            group.rotation.y = config.rotation;
            
            platformMesh.position.set(0, platformY, (numSteps * stepDepth) + platformDepth/2 - stepDepth/2);
            platformMesh.castShadow = true;
            platformMesh.receiveShadow = true;
            platformMesh.userData = { isGround: true }; // 平台视为地面可站立
            
            group.add(platformMesh);
            this.objects.push(platformMesh);

            this.scene.add(group);

            // 路径点 (Waypoints) - 帮助敌人导航楼梯(世界坐标)
            const stairBottom = new THREE.Object3D();
            // 底部路径点位置 (偏移一点距离)
            const bottomOffset = new THREE.Vector3(0, 0, -2.0).applyAxisAngle(new THREE.Vector3(0, 1, 0), config.rotation);
            
            const bottomX = config.startX + bottomOffset.x;
            const bottomZ = config.startZ + bottomOffset.z;
            const bottomY = this.getTerrainHeight(bottomX, bottomZ);
            
            stairBottom.position.set(bottomX, bottomY + 0.5, bottomZ);
            stairBottom.userData = { isWayPoint: true, type: 'stair_bottom', id: configIndex + 1 };
            this.objects.push(stairBottom);

            const stairTop = new THREE.Object3D();
            // 顶部路径点位置 (在平台中心)
            // 平台相对于 startX/Z 的偏移: Z轴正方向
            const topLocalZ = (numSteps * stepDepth) + platformDepth/2; 
            const topOffset = new THREE.Vector3(0, 0, topLocalZ).applyAxisAngle(new THREE.Vector3(0, 1, 0), config.rotation);
            
            const topX = config.startX + topOffset.x;
            const topZ = config.startZ + topOffset.z;
            // 顶部高度 = 起始地面高度 + 平台高度
            const topY = groundY + platformHeight;
            
            stairTop.position.set(topX, topY + 0.5, topZ);
            stairTop.userData = { isWayPoint: true, type: 'stair_top', id: configIndex + 1 };
            this.objects.push(stairTop);
        });
    }

    /**
     * 楼梯材质 - 带防滑纹理
     */
    private createStairMaterial(): MeshStandardNodeMaterial {
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
     * 创建天空盒 - 更大范围
     */
    private createSkybox() {
        const skyRadius = MapConfig.size * 1.5;
        const skyGeo = new THREE.SphereGeometry(skyRadius, 32, 32);
        const skyMaterial = this.createSkyMaterial();
        
        const sky = new THREE.Mesh(skyGeo, skyMaterial);
        sky.userData = { isSkybox: true };
        this.scene.add(sky);
    }

    /**
     * 天空材质 - 动态渐变
     */
    private createSkyMaterial(): MeshBasicNodeMaterial {
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

    /**
     * 创建大气效果 - 环境雾
     */
    private createAtmosphere() {
        // Three.js 内置雾已在 Game.ts 中设置
        // 这里可以添加额外的大气效果
        
        // 灰尘粒子 (扩大范围)
        this.createDustParticles();
    }

    /**
     * 创建环境灰尘粒子 - 扩展到更大地图
     */
    private createDustParticles() {
        const particleCount = 500; // 增加粒子数量
        const mapSize = MapConfig.size;
        const positions = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        
        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * mapSize;
            positions[i * 3 + 1] = Math.random() * 15;
            positions[i * 3 + 2] = (Math.random() - 0.5) * mapSize;
            sizes[i] = Math.random() * 0.15 + 0.03;
        }
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        
        // 简单材质 - 可以用 TSL 增强
        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.08,
            transparent: true,
            opacity: 0.25,
            depthWrite: false
        });
        
        const particles = new THREE.Points(geometry, material);
        particles.userData = { isDust: true };
        this.scene.add(particles);
    }
}
