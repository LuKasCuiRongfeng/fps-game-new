import * as THREE from 'three';
import { createGrassMaterial } from '../shaders/GrassTSL';
import { EnvironmentConfig, MapConfig } from '../core/GameConfig';

/**
 * 草丛系统 - 管理多种地被植物
 * 使用 Chunk (分块) + InstancedMesh 进行性能优化
 */
export class GrassSystem {
    private scene: THREE.Scene;
    // 存储所有分块产生的 Mesh，用于清理
    private chunkMeshes: THREE.InstancedMesh[] = []; 
    private dummy = new THREE.Object3D();
    
    // 草的类型定义 (几何体、材质、配置)
    private grassTypes: Array<{
        id: string;
        geometry: THREE.BufferGeometry;
        material: any;
        baseCount: number; // 原始配置的数量 (基于小地图)
        scaleRange: { min: number, max: number };
        colorBase: THREE.Color;
        colorTip: THREE.Color;
    }> = [];

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.initGrassTypes();
    }
    
    private initGrassTypes() {
        // 1. 高草 (Tall Grass)
        const tall = EnvironmentConfig.grass.tall;
        const tallGeo = this.createMultipleBladeGeometry(tall.height, tall.width, tall.bladeCount);
        const tallMat = createGrassMaterial(new THREE.Color(tall.colorBase), new THREE.Color(tall.colorTip));
        
        this.grassTypes.push({
            id: 'tall',
            geometry: tallGeo,
            material: tallMat,
            baseCount: tall.count,
            scaleRange: tall.scale,
            colorBase: new THREE.Color(tall.colorBase),
            colorTip: new THREE.Color(tall.colorTip)
        });
        
        // 2. 灌木丛 (Shrub)
        const shrub = EnvironmentConfig.grass.shrub;
        const shrubGeo = this.createBushGeometry();
        const shrubMat = createGrassMaterial(new THREE.Color(shrub.colorBase), new THREE.Color(shrub.colorTip));
        
        this.grassTypes.push({
            id: 'shrub',
            geometry: shrubGeo,
            material: shrubMat,
            baseCount: shrub.count,
            scaleRange: shrub.scale,
            colorBase: new THREE.Color(shrub.colorBase),
            colorTip: new THREE.Color(shrub.colorTip)
        });
        
        // 3. 枯草 (Dry Grass)
        const dry = EnvironmentConfig.grass.dry;
        const dryGeo = this.createMultipleBladeGeometry(dry.height, dry.width, dry.bladeCount);
        const dryMat = createGrassMaterial(new THREE.Color(dry.colorBase), new THREE.Color(dry.colorTip));
        
        this.grassTypes.push({
            id: 'dry',
            geometry: dryGeo,
            material: dryMat,
            baseCount: dry.count,
            scaleRange: dry.scale,
            colorBase: new THREE.Color(dry.colorBase),
            colorTip: new THREE.Color(dry.colorTip)
        });
    }

    /**
     * 放置草丛 (Chunked)
     */
    public placeGrass(
        mapSize: number, 
        getHeightAt: (x: number, z: number) => number,
        excludeAreas: Array<{x: number, z: number, radius: number}> = []
    ) {
        this.dispose();

        const chunkSize = MapConfig.chunkSize;
        const chunksPerRow = Math.ceil(mapSize / chunkSize);
        const halfSize = mapSize / 2;
        
        // 配置中的 count 代表“全图总量”（小地图时代的经验值）。
        // 在大地图 + Chunk 方案下，如果仍按“每 chunk”生成会导致实例数爆炸。
        // 这里将总量按有效 chunk 数均摊，保证视觉密度合理且性能可控。
        const countMultiplier = 1.0;

        // 性能优化：严格限制生成范围，仅在岛屿上生成
        const maxGrassDist = MapConfig.boundaryRadius + 50;
        const maxGrassDistSq = (maxGrassDist + chunkSize / 2) * (maxGrassDist + chunkSize / 2);

        // Low-frequency macro noise (0..1) to create natural "patches": dense areas + sparse clearings.
        const hash2 = (x: number, z: number) => {
            const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
            return s - Math.floor(s);
        };
        const macroNoise = (x: number, z: number) => {
            const s1 = 0.0012;
            const s2 = 0.0027;
            const s3 = 0.006;
            let n = 0;
            n += (Math.sin(x * s1) * Math.sin(z * s1) + 1) * 0.5;
            n += (Math.sin(x * s2 + 1.7) * Math.sin(z * s2 + 2.1) + 1) * 0.5 * 0.6;
            n += (Math.sin(x * s3 + 3.9) * Math.sin(z * s3 + 4.2) + 1) * 0.5 * 0.25;
            // jitter to break symmetry
            n = n * 0.85 + hash2(x * 0.2, z * 0.2) * 0.15;
            return Math.min(1, Math.max(0, n / (1 + 0.6 + 0.25)));
        };

        // 预先计算有效 chunks（中心点在岛屿范围内）+ 权重（用于非均匀分布）
        const activeChunks: Array<{ cx: number; cz: number; weight: number }> = [];
        let weightSum = 0;

        const distCfg = EnvironmentConfig.grass.distribution;
        const wCfg = distCfg.macroWeight;
        const shoreCfg = distCfg.shoreFade;
        for (let x = 0; x < chunksPerRow; x++) {
            for (let z = 0; z < chunksPerRow; z++) {
                const chunkCX = (x * chunkSize) - halfSize + chunkSize / 2;
                const chunkCZ = (z * chunkSize) - halfSize + chunkSize / 2;
                if (chunkCX * chunkCX + chunkCZ * chunkCZ <= maxGrassDistSq) {
                    const d = Math.sqrt(chunkCX * chunkCX + chunkCZ * chunkCZ);
                    // slightly reduce density near shoreline to create more believable gradients
                    const shoreFade = Math.min(1, Math.max(0, 1 - (d - shoreCfg.startDistance) / Math.max(1, (MapConfig.boundaryRadius - shoreCfg.startDistance))));
                    const m = macroNoise(chunkCX, chunkCZ);
                    // Strong contrast: push most instances into dense patches (forest-floor look).
                    // This does NOT increase total counts; it reallocates the budget across chunks.
                    const w = (wCfg.base + Math.pow(m, wCfg.exponent) * wCfg.amplitude) * (shoreCfg.min + shoreCfg.max * shoreFade);
                    activeChunks.push({ cx: chunkCX, cz: chunkCZ, weight: w });
                    weightSum += w;
                }
            }
        }

        const activeChunkCount = Math.max(1, activeChunks.length);
        console.log(
            `Generating Grass: Map=${mapSize}, Chunk=${chunkSize}, ActiveChunks=${activeChunkCount}, Multiplier=${countMultiplier}`
        );

        // 计算每个 chunk 的目标数量：按 macro 权重分配（非均匀），同时尽量保持总量不变。
        // perChunkCountsByChunk[i] = Map<typeId, count>
        const perChunkCountsByChunk: Array<Map<string, number>> = [];
        const totalsByType = new Map<string, number>();
        for (const type of this.grassTypes) {
            totalsByType.set(type.id, Math.max(0, Math.floor(type.baseCount * countMultiplier)));
        }

        for (let i = 0; i < activeChunks.length; i++) {
            perChunkCountsByChunk.push(new Map());
        }

        for (const type of this.grassTypes) {
            const total = totalsByType.get(type.id) ?? 0;
            if (total <= 0) continue;

            // First pass: floor allocation
            let allocated = 0;
            const remainders: Array<{ i: number; frac: number }> = [];
            for (let i = 0; i < activeChunks.length; i++) {
                const exact = (total * (activeChunks[i].weight / Math.max(1e-6, weightSum)));
                const flo = Math.max(0, Math.floor(exact));
                perChunkCountsByChunk[i].set(type.id, flo);
                allocated += flo;
                remainders.push({ i, frac: exact - flo });
            }

            // Second pass: distribute remainder to highest fractional weights
            let remaining = total - allocated;
            remainders.sort((a, b) => b.frac - a.frac);
            for (let k = 0; k < remainders.length && remaining > 0; k++) {
                const idx = remainders[k].i;
                perChunkCountsByChunk[idx].set(type.id, (perChunkCountsByChunk[idx].get(type.id) ?? 0) + 1);
                remaining--;
            }
        }

        for (let i = 0; i < activeChunks.length; i++) {
            const c = activeChunks[i];
            const m = macroNoise(c.cx, c.cz);
            // 0..1 with extra emphasis on the top end.
            const dfCfg = distCfg.denseFactor;
            const denseFactor = Math.pow(
                Math.min(1, Math.max(0, (m - dfCfg.start) / Math.max(1e-6, dfCfg.range))),
                dfCfg.power
            );
            this.generateChunk(c.cx, c.cz, chunkSize, perChunkCountsByChunk[i], getHeightAt, excludeAreas, denseFactor);
        }
    }
    
    private generateChunk(
        cx: number, cz: number, size: number, 
        perChunkCounts: Map<string, number>,
        getHeightAt: (x: number, z: number) => number,
        excludeAreas: any[],
        denseFactor: number = 0
    ) {
        // 对每种草类型生成一个 Mesh
        this.grassTypes.forEach(type => {
            const targetCount = perChunkCounts.get(type.id) ?? 0;
            if (targetCount <= 0) return;

            // 由于噪声/排除区/水位会剔除大量候选点，如果仅尝试 targetCount 次会导致实际生成很稀疏。
            // 这里对候选点做 oversample，并在达到目标数量后提前停止。
            const oversample = 3.0;
            const attemptCount = Math.max(targetCount, Math.floor(targetCount * oversample));

            const mesh = new THREE.InstancedMesh(type.geometry, type.material, attemptCount);
            // 草投射阴影代价很大（尤其在 WebGPU 阴影 pass），且视觉收益有限。
            // 保留 receiveShadow 让草与环境融合，但禁用 castShadow。
            mesh.castShadow = false;
            mesh.receiveShadow = true;
            // 标记 + 位置缓存（用于近战/镰刀快速割草，避免昂贵的 InstancedMesh raycast）
            // grassPositions: [x,y,z] * instanceCount (world space)
            const grassPositions = new Float32Array(attemptCount * 3);
            mesh.userData = { isGrass: true, grassPositions, chunkCenterX: cx, chunkCenterZ: cz };
            
            let validCount = 0;
            
            // 预先缓存噪声参数以减少对象访问开销
            const noiseScale = EnvironmentConfig.grass.noise.scale;
            const noiseThreshold = EnvironmentConfig.grass.noise.threshold;
            // Dense chunks accept more candidates; sparse chunks accept fewer.
            // Keeps total budget stable (counts are allocated above), but increases visual contrast.
            const tCfg = EnvironmentConfig.grass.distribution.microThresholdShift;
            const thresholdShift = (1 - denseFactor) * tCfg.sparseBoost - denseFactor * tCfg.denseReduce;
            const effectiveThreshold = Math.min(0.98, Math.max(0.02, noiseThreshold + thresholdShift));
            
            for (let i = 0; i < attemptCount; i++) {
                const rx = (Math.random() - 0.5) * size;
                const rz = (Math.random() - 0.5) * size;
                const wx = cx + rx;
                const wz = cz + rz;

                // --- 1. 密度噪声剔除 (Clustering) ---
                // 使用简单的正弦波叠加模拟噪声 (必须快速)
                // 不同类型的草可以使用稍微不同的偏移，避免所有草长在完全一样的位置
                const typeOffset = type.id === 'dry' ? 100 : 0;
                let n = Math.sin((wx + typeOffset) * noiseScale) * Math.sin((wz + typeOffset) * noiseScale);
                n += Math.sin(wx * noiseScale * 2.3) * Math.sin(wz * noiseScale * 2.3) * 0.5;
                // 归一化后剔除
                if (((n/1.5 + 1) * 0.5) < effectiveThreshold + (Math.random() * 0.15 - 0.075)) {
                    continue;
                }
                
                // 排除检查
                 // 检查排除区域 (稍微宽松一点，草可以靠近一点路)
                 let valid = true;
                 for (const area of excludeAreas) {
                     const dx = wx - area.x;
                     const dz = wz - area.z;
                     if (dx * dx + dz * dz < (area.radius * 0.8) ** 2) {
                         valid = false;
                         break;
                     }
                 }
                 if (!valid) continue;
                 
                 const y = getHeightAt(wx, wz);
                 // 水位检查
                 if (y < EnvironmentConfig.water.level + 0.5) continue;

                 // cache world-space position for fast queries
                 const pi = validCount * 3;
                 grassPositions[pi] = wx;
                 grassPositions[pi + 1] = y;
                 grassPositions[pi + 2] = wz;
                 
                 this.dummy.position.set(wx, y, wz);
                 this.dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
                 
                 const s = type.scaleRange.min + Math.random() * (type.scaleRange.max - type.scaleRange.min);
                 this.dummy.scale.set(s, s, s);
                 this.dummy.updateMatrix();
                 
                 mesh.setMatrixAt(validCount, this.dummy.matrix);
                 validCount++;

                 // 达到目标密度就停止，避免无意义的额外采样
                 if (validCount >= targetCount) break;
            }
            
            if (validCount > 0) {
                mesh.count = validCount;
                mesh.instanceMatrix.needsUpdate = true;

                // shrink cached positions to valid range
                mesh.userData.grassPositions = (mesh.userData.grassPositions as Float32Array).subarray(0, validCount * 3);
                
                // Culling
                mesh.computeBoundingSphere();
                
                this.scene.add(mesh);
                this.chunkMeshes.push(mesh);
            } else {
                mesh.dispose();
            }
        });
    }
    
    public dispose() {
        this.chunkMeshes.forEach(m => {
            this.scene.remove(m);
            m.dispose();
        });
        this.chunkMeshes = [];
    }

    /**
     * 生成复杂的单株草丛几何体 (由多根草叶组成)
     */
    private createMultipleBladeGeometry(height: number, width: number, bladeCount: number): THREE.BufferGeometry {
        const geometries: THREE.BufferGeometry[] = [];
        
        for (let i = 0; i < bladeCount; i++) {
            // 每根草叶高度稍微随机
            const h = height * (0.8 + Math.random() * 0.4);
            
            // 使用细分平面作为草叶，方便风吹弯曲
            // widthSegments=1, heightSegments=4
            // 修正：确保顶部在 +y
            const geometry = new THREE.PlaneGeometry(width, h, 1, 4);
            
            // 底部对齐 (PlaneGeometry 默认中心在 0,0,0)
            geometry.translate(0, h / 2, 0); 
            
            // 顶点操作：顶部变窄 + 弯曲
            const pos = geometry.attributes.position;
            for(let j=0; j<pos.count; j++) {
                const y = pos.getY(j);
                const t = y / h; // 0 (bottom) to 1 (top)
                
                // 宽度收缩
                const x = pos.getX(j);
                const scale = 1.0 - Math.pow(t, 2) * 0.9;
                pos.setX(j, x * scale);
                
                // 向后弯曲
                const curve = Math.pow(t, 2) * 0.2; 
                pos.setZ(j, pos.getZ(j) - curve);
            }
            geometry.computeVertexNormals();
            
            // 随机向外倾斜
            const tilt = Math.random() * 0.3 + 0.1; 
            geometry.rotateX(tilt); 
            
            // 随机偏移中心
            const offset = 0.1;
            geometry.translate(
                (Math.random() - 0.5) * offset,
                0,
                (Math.random() - 0.5) * offset
            );
            
            // 旋转分布
            const angle = (i / bladeCount) * Math.PI * 2 + (Math.random() - 0.5);
            geometry.rotateY(angle);
            
            geometries.push(geometry);
        }
        
        return this.mergeGeometries(geometries);
    }
    
    /**
     * 生成灌木几何体 (多个小平面球状分布)
     */
    private createBushGeometry(): THREE.BufferGeometry {
        const geometries: THREE.BufferGeometry[] = [];
        const config = EnvironmentConfig.grass.shrub;
        const count = config.segments ?? 8; 
        
        for(let i=0; i<count; i++) {
            const w = config.width ?? 0.8;
            const h = config.height ?? 0.7;
            const geo = new THREE.PlaneGeometry(w, h, 1, 2);
            geo.translate(0, h/2, 0);
            
            // 随机旋转
            geo.rotateY((Math.PI * 2 * i) / count + Math.random() * 0.5);
            geo.rotateX((Math.random() - 0.5) * 0.5); 
            
            // 随机中心偏移
            geo.translate(
                 (Math.random() - 0.5) * 0.3,
                 (Math.random() - 0.5) * 0.1,
                 (Math.random() - 0.5) * 0.3
            );
            
            geometries.push(geo);
        }
        return this.mergeGeometries(geometries);
    }
    
    private mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
        const positions: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
        let offset = 0;
        
        geos.forEach(g => {
            const pos = g.attributes.position;
            const norm = g.attributes.normal;
            const uv = g.attributes.uv;
            const idx = g.index;
            
            for(let i=0; i<pos.count; i++) {
                positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
                normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));
                uvs.push(uv.getX(i), uv.getY(i));
            }
            
            if(idx) {
                for(let i=0; i<idx.count; i++) {
                    indices.push(idx.getX(i) + offset);
                }
            } else {
                for(let i=0; i<pos.count; i++) indices.push(i + offset);
            }
            offset += pos.count;
        });
        
        const res = new THREE.BufferGeometry();
        res.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        res.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        res.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        res.setIndex(indices);
        return res;
    }
}
