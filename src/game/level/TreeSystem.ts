import * as THREE from 'three';
import { createTrunkMaterial, createLeavesMaterial } from '../shaders/TreeTSL';
import { EnvironmentConfig, MapConfig, TreeType } from '../core/GameConfig';

interface TreeDefinition {
    type: TreeType;
    trunkGeo: THREE.BufferGeometry;
    leavesGeo: THREE.BufferGeometry;
    trunkMat: any;
    leavesMat: any;
    probability: number;
    scaleRange: { min: number, max: number };
}

/**
 * 树木系统 - 管理多种树木的生成和渲染
 * 使用 Chunk (分块) + InstancedMesh 进行性能优化
 */
export class TreeSystem {
    private scene: THREE.Scene;
    // 按树种分类存储的 Chunks
    private chunks: Map<TreeType, { trunk: THREE.InstancedMesh, leaves: THREE.InstancedMesh }[]> = new Map();
    
    // 用于坐标转换的辅助对象
    private dummy = new THREE.Object3D();
    
    private definitions: TreeDefinition[] = [];

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.initTreeDefinitions();
    }

    private initTreeDefinitions() {
        // 从配置中获取定义
        const configs = EnvironmentConfig.trees.types;
        
        // --- 1. 松树 (Pine) ---
        const pineConfig = configs.find(c => c.type === TreeType.Pine)!;
        
        // 树干需适配新的细树冠
        // 树干高度约占总高度的 40%
        const pineTrunkHei = pineConfig.geometry.height * 0.45;
        // 半径大幅减小: 顶部 0.1, 底部 0.25 (配合 baseRadius 0.8)
        const pineTrunkGeo = new THREE.CylinderGeometry(0.1, 0.25, pineTrunkHei, 7);
        pineTrunkGeo.translate(0, pineTrunkHei / 2, 0); 
        
        const pineLeavesGeo = this.createPineLeavesGeometry(pineConfig.geometry, pineTrunkHei);
        
        this.definitions.push({
            type: TreeType.Pine,
            trunkGeo: pineTrunkGeo,
            leavesGeo: pineLeavesGeo,
            trunkMat: createTrunkMaterial(new THREE.Color(pineConfig.colors.trunk)),
            leavesMat: createLeavesMaterial(new THREE.Color(pineConfig.colors.leavesDeep), new THREE.Color(pineConfig.colors.leavesLight)), 
            probability: pineConfig.probability,
            scaleRange: pineConfig.scale
        });
        
        // --- 2. 橡树 (Oak) ---
        const oakConfig = configs.find(c => c.type === TreeType.Oak)!;
        const oakHeight = oakConfig.geometry.height || 5.0;

        // 粗短树干，适度变细
        const oakTrunkHei = oakHeight * 0.6; 
        // 半径适配小树冠: 0.15 -> 0.3
        const oakTrunkGeo = new THREE.CylinderGeometry(0.15, 0.3, oakTrunkHei, 8);
        oakTrunkGeo.translate(0, oakTrunkHei / 2, 0);
        
        const oakLeavesGeo = this.createOakLeavesGeometry(oakConfig.geometry, oakTrunkHei);
        
        this.definitions.push({
            type: TreeType.Oak,
            trunkGeo: oakTrunkGeo,
            leavesGeo: oakLeavesGeo,
            trunkMat: createTrunkMaterial(new THREE.Color(oakConfig.colors.trunk)),
            leavesMat: createLeavesMaterial(new THREE.Color(oakConfig.colors.leavesDeep), new THREE.Color(oakConfig.colors.leavesLight)), 
            probability: oakConfig.probability,
            scaleRange: oakConfig.scale 
        });

        // --- 3. 白桦 (Birch) ---
        const birchConfig = configs.find(c => c.type === TreeType.Birch)!;
        const birchHeight = birchConfig.geometry.height || 7.0;

        // 细高树干
        const birchTrunkHei = birchHeight * 0.8; 
        // 极细风格: 0.05 -> 0.12
        const birchTrunkGeo = new THREE.CylinderGeometry(0.05, 0.12, birchTrunkHei, 6);
        birchTrunkGeo.translate(0, birchTrunkHei / 2, 0);
        
        const birchLeavesGeo = this.createBirchLeavesGeometry(birchConfig.geometry, birchTrunkHei);
        
        this.definitions.push({
            type: TreeType.Birch,
            trunkGeo: birchTrunkGeo,
            leavesGeo: birchLeavesGeo,
            trunkMat: createTrunkMaterial(new THREE.Color(birchConfig.colors.trunk)),
            leavesMat: createLeavesMaterial(new THREE.Color(birchConfig.colors.leavesDeep), new THREE.Color(birchConfig.colors.leavesLight)), 
            probability: birchConfig.probability,
            scaleRange: birchConfig.scale 
        });

        // 初始化存储结构
        this.definitions.forEach(def => {
            this.chunks.set(def.type, []);
        });
    }

    public placeTrees(
        mapSize: number, 
        getHeightAt: (x: number, z: number) => number,
        excludeAreas: Array<{x: number, z: number, radius: number}> = []
    ) {
        // 清理旧资源
        this.dispose();

        const chunkSize = MapConfig.chunkSize;
        const chunksPerRow = Math.ceil(mapSize / chunkSize);
        const halfSize = mapSize / 2;
        // 使用配置中的密度
        const density = EnvironmentConfig.trees.density;
        
        // 计算每块(Chunk)的目标树木数量
        const treesPerChunk = Math.floor((chunkSize * chunkSize) * density);

        // Macro noise for patchy distribution (0..1)
        const hash2 = (x: number, z: number) => {
            const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
            return s - Math.floor(s);
        };
        const macroNoise = (x: number, z: number) => {
            const s1 = 0.0009;
            const s2 = 0.0022;
            let n = 0;
            n += (Math.sin(x * s1) * Math.sin(z * s1) + 1) * 0.5;
            n += (Math.sin(x * s2 + 1.3) * Math.sin(z * s2 + 2.7) + 1) * 0.5 * 0.7;
            n = n * 0.85 + hash2(x * 0.15, z * 0.15) * 0.15;
            return Math.min(1, Math.max(0, n / (1 + 0.7)));
        };
        
        console.log(`Generating Trees: Map=${mapSize}, Chunk=${chunkSize}, PerChunk=${treesPerChunk} (Density: ${density})`);

        for (let x = 0; x < chunksPerRow; x++) {
            for (let z = 0; z < chunksPerRow; z++) {
                // 当前块中心的世​​界坐标
                const chunkCX = (x * chunkSize) - halfSize + (chunkSize / 2);
                const chunkCZ = (z * chunkSize) - halfSize + (chunkSize / 2);

                // Patchy chunk-level multiplier: creates groves/clearings.
                const d = Math.sqrt(chunkCX * chunkCX + chunkCZ * chunkCZ);
                const shoreFade = Math.min(1, Math.max(0, 1 - (d - 250) / Math.max(1, (MapConfig.boundaryRadius - 250))));
                const m = macroNoise(chunkCX, chunkCZ);
                // Target range ~[0.25..2.4]
                const multiplier = (0.25 + Math.pow(m, 1.8) * 2.15) * (0.35 + 0.65 * shoreFade);
                const target = Math.max(0, Math.floor(treesPerChunk * multiplier));
                
                this.generateChunk(chunkCX, chunkCZ, chunkSize, target, getHeightAt, excludeAreas);
            }
        }
    }
    
    private generateChunk(
        cx: number, 
        cz: number, 
        size: number, 
        totalCount: number, 
        getHeightAt: (x: number, z: number) => number, 
        excludeAreas: any[]
    ) {
        // 性能优化：严格限制生成范围
        // 岛屿半径外是深海，不需要生成树木
        const maxTreeDist = MapConfig.boundaryRadius + 50; 
        
        // 如果整个 Chunk 的中心离原点太远，直接跳过
        if (cx * cx + cz * cz > (maxTreeDist + size/2) * (maxTreeDist + size/2)) {
            return;
        }

        // 为每种树准备数据容器 Container for matrices
        const chunkData: Map<TreeType, THREE.Matrix4[]> = new Map();
        // Cache per-instance world positions for melee/environment interactions.
        // treePositions: [x,y,z] * instanceCount (world space)
        const chunkPositions: Map<TreeType, number[]> = new Map();
        this.definitions.forEach(def => chunkData.set(def.type, []));
        this.definitions.forEach(def => chunkPositions.set(def.type, []));
        
        let validCount = 0;

        // totalCount 表示“希望最终落地的树数量”。
        // 由于噪声阈值/排除区/水位会剔除大量候选点，如果仅尝试 totalCount 次会导致树过稀。
        // 这里 oversample 尝试次数，并在达到目标后提前结束。
        const oversample = 4;
        const attemptBudget = Math.max(totalCount, totalCount * oversample);

        for (let i = 0; i < attemptBudget; i++) {
            // 在 Chunk 范围内随机生成
            const rx = (Math.random() - 0.5) * size;
            const rz = (Math.random() - 0.5) * size;
            
            const wx = cx + rx;
            const wz = cz + rz;
            
            // --- 密度分布控制 ---
            // 使用噪声剔除部分区域，形成聚集和空地
            const noiseVal = this.getNoise(wx, wz);
            // 加上一点随机抖动(-0.05 ~ 0.05)使边缘不那么生硬
            if (noiseVal < EnvironmentConfig.trees.noise.threshold + (Math.random() * 0.1 - 0.05)) {
                continue;
            }

            // 检查排除区域
            let excluded = false;
            for (const area of excludeAreas) {
                const dx = wx - area.x;
                const dz = wz - area.z;
                if (dx * dx + dz * dz < area.radius * area.radius) {
                    excluded = true;
                    break;
                }
            }
            if (excluded) continue;

            const y = getHeightAt(wx, wz);
            
            // 避免水下生成
            const placeConfig = EnvironmentConfig.trees.placement;
            if (y < placeConfig.minAltitude) continue; 
            
            // 随机选择树种 (根据 probability)
            const rnd = Math.random();
            let accumulatedProb = 0;
            let selectedDef = this.definitions[0];
            
            // 简单轮盘赌选择
            for (const def of this.definitions) {
                accumulatedProb += def.probability;
                if (rnd <= accumulatedProb) {
                    selectedDef = def;
                    break;
                }
            }

            // 随机旋转和缩放
            const scale = selectedDef.scaleRange.min + Math.random() * (selectedDef.scaleRange.max - selectedDef.scaleRange.min);
            const rotationY = Math.random() * Math.PI * 2;
            
            this.dummy.position.set(wx, y, wz);
            this.dummy.rotation.set(0, rotationY, 0);
            this.dummy.scale.set(scale, scale, scale);
            this.dummy.updateMatrix();
            
            // 将矩阵推入对应的列表
            chunkData.get(selectedDef.type)!.push(this.dummy.matrix.clone());
            const posArr = chunkPositions.get(selectedDef.type)!;
            posArr.push(wx, y, wz);
            validCount++;

            if (validCount >= totalCount) break;
        }
        
        // 为该 Chunk 创建 InstancedMesh (只为有树的类型创建)
        this.definitions.forEach(def => {
            const matrices = chunkData.get(def.type)!;
            if (matrices.length > 0) {
                const trunkMesh = new THREE.InstancedMesh(def.trunkGeo, def.trunkMat, matrices.length);
                const leavesMesh = new THREE.InstancedMesh(def.leavesGeo, def.leavesMat, matrices.length);

                const positions = new Float32Array(chunkPositions.get(def.type)!);

                // 标记为树木（用于近战斧头用途：砍树）
                trunkMesh.userData = { isTree: true, treeType: def.type, treePart: 'trunk', pairedMesh: leavesMesh, treePositions: positions };
                leavesMesh.userData = { isTree: true, treeType: def.type, treePart: 'leaves', pairedMesh: trunkMesh, treePositions: positions };
                
                trunkMesh.castShadow = true;
                trunkMesh.receiveShadow = true;
                leavesMesh.castShadow = true;
                leavesMesh.receiveShadow = true;
                
                for (let k = 0; k < matrices.length; k++) {
                    trunkMesh.setMatrixAt(k, matrices[k]);
                    leavesMesh.setMatrixAt(k, matrices[k]);
                }
                
                trunkMesh.instanceMatrix.needsUpdate = true;
                leavesMesh.instanceMatrix.needsUpdate = true;
                
                // 重要：计算边界球以确保 Frustum Culling 工作正常
                trunkMesh.computeBoundingSphere();
                leavesMesh.computeBoundingSphere();

                this.scene.add(trunkMesh);
                this.scene.add(leavesMesh);
                
                this.chunks.get(def.type)!.push({ trunk: trunkMesh, leaves: leavesMesh });
            }
        });
    }
    
    public dispose() {
        this.chunks.forEach(list => {
            list.forEach(c => {
                this.scene.remove(c.trunk);
                this.scene.remove(c.leaves);
                c.trunk.dispose();
                c.leaves.dispose();
            });
            // 清空数组
            list.length = 0;
        });
        // 不必重置 Map，保留结构
        // this.chunks = new Map(); 
    }

    /**
     * 获取基于坐标的伪随机噪声值 (0-1)
     * 用于生成不均匀分布的植被
     */
    private getNoise(x: number, z: number): number {
        const scale = EnvironmentConfig.trees.noise.scale; 
        
        // 简单的正弦波叠加模拟噪声
        let n = Math.sin(x * scale) * Math.sin(z * scale); 
        n += Math.sin(x * scale * 2.1 + 1.2) * Math.sin(z * scale * 2.1 + 2.3) * 0.5;
        n += Math.sin(x * scale * 4.3 + 3.4) * Math.sin(z * scale * 4.3 + 4.5) * 0.25;
        
        // 归一化到 roughly 0..1
        return (n / 1.75 + 1) * 0.5;
    }

    /**
     * 创建合并的树叶几何体 (多个圆锥体叠加) - 改进版松树
     */
    private createPineLeavesGeometry(config: any, trunkHeight: number): THREE.BufferGeometry {
        const geometries: THREE.BufferGeometry[] = [];
        const layers = config.layers || 5;
        // 确保树叶覆盖住树干顶部
        const startHeight = trunkHeight * 0.6; // 从树干中部开始长叶子
        const totalHeight = config.height || 6.0;
        
        for (let i = 0; i < layers; i++) {
            const t = i / (layers - 1); // 0 -> 1
            const y = startHeight + t * (totalHeight - startHeight - 1.0);
            
            // 下面大，上面小
            const radius = (1.0 - t * 0.8) * (config.baseRadius || 2.5);
            const height = ((totalHeight - startHeight) / layers) * 1.5; 
            
            // 使用 Cone 模拟
            // 增加不规则性：可以稍微旋转或偏移中心
            const cone = new THREE.ConeGeometry(radius, height, 7);
            
            // 随机轻微偏移，看起来不那么像玩具
            const offsetX = (Math.random() - 0.5) * 0.1; // 较小的偏移
            const offsetZ = (Math.random() - 0.5) * 0.1;
            
            cone.translate(offsetX, y + height/2, offsetZ);
            
            // 随机旋转 Y 轴
            cone.rotateY(Math.random() * Math.PI);
            
            geometries.push(cone);
        }
        
        return this.mergeGeometries(geometries);
    }

    /**
     * 创建橡树叶子 - 改进版：更多随机Cluster
     */
    private createOakLeavesGeometry(config: any, trunkHeight: number): THREE.BufferGeometry {
        const geometries: THREE.BufferGeometry[] = [];
        const clusters = config.clusters || 12;
        const mainSize = config.clusterSize || 0.6;
        const spread = config.spread || 1.0;
        
        // 核心树冠 - 确保接在树干顶端
        const center = new THREE.IcosahedronGeometry(mainSize * 1.2, 0); 
        const coreHeight = trunkHeight + mainSize * 0.5;
        center.translate(0, coreHeight, 0);
        geometries.push(center);
        
        // 周围随机分布
        for(let i=0; i<clusters; i++) {
            // 球坐标随机分布
            const phi = Math.acos( -1 + ( 2 * i ) / clusters ); // 均匀分布
            const theta = Math.sqrt( clusters * Math.PI ) * phi;
            
            const r = spread * (0.8 + Math.random() * 0.4);
            
            const x = r * Math.sin(phi) * Math.cos(theta);
            // 围绕核心高度分布
            const y = coreHeight + r * Math.sin(phi) * Math.sin(theta) * 0.8; 
            const z = r * Math.cos(phi);
            
            const size = mainSize * (0.6 + Math.random() * 0.6);
            
            // 使用 Dodecahedron 会比 Icosahedron 看起来稍微 "方" 一点，更有低模风格
            const leaf = new THREE.DodecahedronGeometry(size, 0);
            
            // 随机拉伸一点，不做正球体
            leaf.scale(1.0 + Math.random()*0.3, 0.8 + Math.random()*0.4, 1.0 + Math.random()*0.3);
            
            leaf.rotateX(Math.random() * Math.PI);
            leaf.rotateZ(Math.random() * Math.PI);
            
            leaf.translate(x, y, z);
            geometries.push(leaf);
        }
         
        return this.mergeGeometries(geometries);
    }

    /**
     * 创建白桦树叶 - 改进版：更稀疏，更垂直分布
     */
    private createBirchLeavesGeometry(config: any, trunkHeight: number): THREE.BufferGeometry {
        const geometries: THREE.BufferGeometry[] = [];
        // 白桦树叶起始高度
        const baseHeight = trunkHeight * 0.6; 
        const clusters = config.clusters || 8;
        const sizeBase = config.clusterSize || 0.4;
        const totalH = config.height || 5.0;
        
        for (let i = 0; i < clusters; i++) {
            const hPercent = i / clusters; // 0 (bottom) -> 1 (top)
            
            // 越高越靠近中心
            const r = (1.0 - hPercent * 0.6) * 1.0 * (0.8 + Math.random() * 0.4);
            const angle = Math.random() * Math.PI * 2;
            const h = baseHeight + hPercent * (totalH - baseHeight) + Math.random() * 0.5;
            
            const x = Math.cos(angle) * r;
            const z = Math.sin(angle) * r;
            
            const size = sizeBase * (0.8 + Math.random() * 0.5);
            
            // 白桦树叶比较小且碎，用 Dodecahedron
            const geo = new THREE.DodecahedronGeometry(size, 0);
            
            geo.translate(x, h, z);
            geometries.push(geo);
        }

        // 必定有一个顶部盖子
        const top = new THREE.DodecahedronGeometry(sizeBase, 0);
        top.translate(0, totalH + sizeBase * 0.5, 0);
        geometries.push(top);

        return this.mergeGeometries(geometries);
    }
    
    /**
     * 简单的几何体合并工具
     */
    private mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
        const positions: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
        
        let vertexOffset = 0;
        
        geometries.forEach(geo => {
            const posAttr = geo.attributes.position;
            const normAttr = geo.attributes.normal;
            const uvAttr = geo.attributes.uv;
            const indexAttr = geo.index;
            
            for (let i = 0; i < posAttr.count; i++) {
                positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
                normals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
                uvs.push(uvAttr.getX(i), uvAttr.getY(i));
            }
            
            if (indexAttr) {
                for (let i = 0; i < indexAttr.count; i++) {
                    indices.push(indexAttr.getX(i) + vertexOffset);
                }
            } else {
                 for (let i = 0; i < posAttr.count; i++) {
                    indices.push(i + vertexOffset);
                }
            }
            
            vertexOffset += posAttr.count;
        });
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);

        // 确保清理原始临时的 geometries
        geometries.forEach(g => g.dispose());
        
        return geometry;
    }
}
