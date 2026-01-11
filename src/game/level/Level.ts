/**
 * Level - 使用 TSL 材质增强的关卡系统
 * 所有地形材质使用程序化生成的 shader 纹理
 * 支持大地图和性能优化
 */
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { MapConfig, EnvironmentConfig, LevelConfig } from '../core/GameConfig';
import { TreeSystem } from './TreeSystem';
import { GrassSystem } from './GrassSystem';
import { PhysicsSystem } from '../core/PhysicsSystem';
import { WaterSystem } from './WaterSystem';
import { EnvironmentSystem } from './EnvironmentSystem';
import { LevelMaterials } from './LevelMaterials';

export class Level {
    private scene: THREE.Scene;
    private objects: THREE.Object3D[];
    private physicsSystem: PhysicsSystem;
    
    // 子系统
    private treeSystem: TreeSystem | null = null;
    private grassSystem: GrassSystem | null = null;
    private waterSystem: WaterSystem | null = null;
    private environmentSystem: EnvironmentSystem | null = null;
    
    // 材质
    private floorMaterial!: MeshStandardNodeMaterial;
    
    // 地形高度图数据
    private terrainHeights: Float32Array | null = null;
    private terrainSegmentSize: number = MapConfig.size / MapConfig.terrainSegments;
    
    // 全局环境 Uniforms
    public rainIntensity = uniform(0); // 0 = 晴天, 1 = 暴雨

    constructor(scene: THREE.Scene, objects: THREE.Object3D[], physicsSystem: PhysicsSystem) {
        this.scene = scene;
        this.objects = objects;
        this.physicsSystem = physicsSystem;
        
        // 预创建共享材质
        this.floorMaterial = LevelMaterials.createFloorMaterial();
        
        // 1. 创建地板 (地形)
        this.createFloor();
        
        // 2. 初始化环境系统
        this.environmentSystem = new EnvironmentSystem(
            this.scene, 
            this.objects, 
            (x, z) => this.getTerrainHeight(x, z),
            this.physicsSystem
        );
        
        // 3. 创建环境物体
        this.createEnvironment();
        
        // 4. 创建植被
        this.createVegetation();
        
        // 5. 创建水体
        this.waterSystem = new WaterSystem(this.scene);
        this.waterSystem.createWater(this.rainIntensity);
    }
    
    public update(_deltaTime: number, _playerPos: THREE.Vector3) {
        // TSL shaders handle animation via global timers.
        // Level systems are currently static at runtime.
    }

    /**
     * 创建环境物体
     */
    private createEnvironment() {
        if (!this.environmentSystem) return;

        // 记录环境中新增物体的起始索引
        const startIndex = this.objects.length;

        // 天空和大气
        this.environmentSystem.createSkybox();
        this.environmentSystem.createAtmosphere();
        
        // 边界墙
        this.environmentSystem.createWalls();
        
        // 障碍物和装饰
        this.environmentSystem.createObstacles();
        
        // 复杂地形特征
        const mapRadius = MapConfig.size / 2;
        this.environmentSystem.createRockFormations(mapRadius);
        this.environmentSystem.createRuins(mapRadius);
        this.environmentSystem.createSandbagCovers(mapRadius);
        this.environmentSystem.createCoverObjects();
        this.environmentSystem.createStairs();

        // 将新增的环境物体注册到物理系统
        if (this.physicsSystem) {
            for (let i = startIndex; i < this.objects.length; i++) {
                const obj = this.objects[i];
                // 排除不需要物理碰撞的物体 (如路径点)
                if (obj.userData?.isWayPoint) continue;
                // 某些批处理渲染对象会自己注册 per-instance 碰撞体
                if (obj.userData?.noPhysics) continue;
                
                this.physicsSystem.addStaticObject(obj);
            }
        }
    }
    
    /**
     * 创建植被
     */
    private createVegetation() {
        this.createTrees();
        this.createGrass();
    }

    /**
     * 生成树木
     */
    private createTrees() {
        this.treeSystem = new TreeSystem(this.scene);
        
        // 排除区域
        const excludeAreas = [
            { x: 0, z: 0, radius: LevelConfig.safeZoneRadius },
            // 排除其他重要建筑区域...
        ];
        
        this.treeSystem.placeTrees(
            MapConfig.size,
            (x, z) => this.computeNoiseHeight(x, z),
            excludeAreas
        );
    }

    /**
     * 生成草丛
     */
    private createGrass() {
        this.grassSystem = new GrassSystem(this.scene);
        
        const excludeAreas = [
            { x: 0, z: 0, radius: LevelConfig.safeZoneRadius },
            { x: 30, z: 30, radius: EnvironmentConfig.grass.placement.excludeRadius.default }, 
            { x: -30, z: -30, radius: EnvironmentConfig.grass.placement.excludeRadius.default }
        ];
        
        this.grassSystem.placeGrass(
            MapConfig.size,
            (x, z) => this.computeNoiseHeight(x, z),
            excludeAreas
        );
    }

    /**
     * 创建地板 - 带起伏的地形
     * 使用分块生成 (Chunk System)
     */
    private createFloor() {
        // 全局计算高度图数据 (Truth Data)
        this.initTerrainData();
        
        // 创建分块 (Chunks)
        const chunkSize = MapConfig.chunkSize;
        const totalSize = MapConfig.size;
        const chunksPerRow = Math.ceil(totalSize / chunkSize);
        const segmentPerChunk = Math.floor(MapConfig.terrainSegments / chunksPerRow);
        
        const halfSize = totalSize / 2;
        
        for (let x = 0; x < chunksPerRow; x++) {
            for (let z = 0; z < chunksPerRow; z++) {
                // 当前块的中心位置
                const centerX = (x * chunkSize) - halfSize + (chunkSize / 2);
                const centerZ = (z * chunkSize) - halfSize + (chunkSize / 2);
                
                // 创建该块的几何体
                const geometry = new THREE.PlaneGeometry(
                    chunkSize, 
                    chunkSize, 
                    segmentPerChunk, 
                    segmentPerChunk
                );
                
                // 调整顶点高度 (基于预计算的数据)
                const posAttribute = geometry.attributes.position;
                for (let i = 0; i < posAttribute.count; i++) {
                    // Local position
                    const lx = posAttribute.getX(i);
                    const lz = -posAttribute.getY(i); // PlaneGeometry 是 XY 平面，旋转后 Y 变 -Z
                    
                    // World position (Original unrotated Z = -Y)
                    const wx = centerX + lx;
                    const wz = centerZ + lz;
                    
                    // 获取高度
                    const h = this.getTerrainHeight(wx, wz);
                    
                    // 设置 Z (旋转前的 Z 是高度)
                    posAttribute.setZ(i, h);
                }
                
                geometry.computeVertexNormals();
                
                // 使用 LevelMaterials 提供的地板材质
                const mesh = new THREE.Mesh(geometry, this.floorMaterial);
                mesh.rotation.x = -Math.PI / 2;
                mesh.position.set(centerX, 0, centerZ);
                mesh.receiveShadow = true;
                
                // 标记为地面
                mesh.userData = { isGround: true };
                
                this.scene.add(mesh);
                
                // 注册到物理系统 (如果有)
                // 地形物理碰撞需要特殊处理，因为是变形后的 Plane
                // 简单起见，这里假设 PhysicsSystem 使用射线检测高度，或者 PhysicsSystem 内部自己处理了
                // 如果 PhysicsSystem 需要 Mesh，这里调用
                if (this.physicsSystem) {
                    // PhysicsSystem 应该能够处理这种 Mesh，或者我们不在这里 addGround，
                    // 而是 PhysicsSystem 自己查询 getTerrainHeight
                    // 在目前架构下，PhysicsSystem 可能依赖 objects 列表做简单的检测
                    // 或者 PhysicsSystem 有专门的 terrain 处理
                }
            }
        }
    }
    
    /**
     * 初始化地形高度数据
     */
    private initTerrainData() {
        // 初始化高度图数组 (Rows x Cols)
        const gridSize = MapConfig.terrainSegments + 1;
        this.terrainHeights = new Float32Array(gridSize * gridSize);
        const halfSize = MapConfig.size / 2;

        for (let iz = 0; iz < gridSize; iz++) {
            for (let ix = 0; ix < gridSize; ix++) {
                const worldX = ix * this.terrainSegmentSize - halfSize;
                const worldZ = iz * this.terrainSegmentSize - halfSize;
                const height = this.computeNoiseHeight(worldX, worldZ);
                this.terrainHeights[iz * gridSize + ix] = height;
            }
        }
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
        let height = combinedNoise * MapConfig.terrainHeight * centerFlatten;
        
        // === 无尽之海边缘处理 (Island Mask) ===
        // 强制离岛屿中心一定距离外的地形下沉到海平面以下
        const islandRadius = MapConfig.boundaryRadius; 
        
        // 定义海岸线过渡区域
        // 在达到边界墙 (boundaryRadius) 之前就开始逐渐变为沙滩/浅滩
        // 并在边界墙之后迅速变为深海
        const coastStart = islandRadius - 100; // 离边界还有100米时开始下降
        const coastEnd = islandRadius + 50;    // 边界外50米完全变成深海
        
        if (distFromCenter > coastStart) {
            // 计算过渡因子 (0 = 陆地, 1 = 深海)
            let t = (distFromCenter - coastStart) / (coastEnd - coastStart);
            t = Math.max(0, Math.min(1, t));
            
            // 平滑过渡 (Smoothstep)
            const falloff = t * t * (3 - 2 * t);
            
            // 混合目标: 深海海床
            const seaFloorDepth = MapConfig.waterLevel - 15.0;
            
            // 线性插值当前高度到海床深度
            height = THREE.MathUtils.lerp(height, seaFloorDepth, falloff);
        }
        
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
}
