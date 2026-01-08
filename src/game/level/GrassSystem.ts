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
        
        // 计算密度缩放系数
        // 恢复正常密度，因为我们现在限制了生成范围
        // 目标是让岛屿上的草丛茂盛
        const countMultiplier = 1.0; 
        
        console.log(`Generating Grass: Map=${mapSize}, Chunk=${chunkSize}, Multiplier=${countMultiplier}`);

        for (let x = 0; x < chunksPerRow; x++) {
            for (let z = 0; z < chunksPerRow; z++) {
                const chunkCX = (x * chunkSize) - halfSize + (chunkSize / 2);
                const chunkCZ = (z * chunkSize) - halfSize + (chunkSize / 2);
                
                this.generateChunk(chunkCX, chunkCZ, chunkSize, countMultiplier, getHeightAt, excludeAreas);
            }
        }
    }
    
    private generateChunk(
        cx: number, cz: number, size: number, 
        multiplier: number,
        getHeightAt: (x: number, z: number) => number,
        excludeAreas: any[]
    ) {
        // 性能优化：严格限制生成范围，仅在岛屿上生成
        const maxGrassDist = MapConfig.boundaryRadius + 50; 
        
        // 粗略判断: Chunk中心距离 > 半径 + Chunk一半大小
        if (cx * cx + cz * cz > (maxGrassDist + size/2) * (maxGrassDist + size/2)) {
            return;
        }

        // 对每种草类型生成一个 Mesh
        this.grassTypes.forEach(type => {
            const count = Math.floor(type.baseCount * multiplier);
            if (count <= 0) return;
            
            const mesh = new THREE.InstancedMesh(type.geometry, type.material, count);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            // 标记 + 位置缓存（用于近战/镰刀快速割草，避免昂贵的 InstancedMesh raycast）
            // grassPositions: [x,y,z] * instanceCount (world space)
            const grassPositions = new Float32Array(count * 3);
            mesh.userData = { isGrass: true, grassPositions };
            
            let validCount = 0;
            const halfSize = size / 2;
            
            // 预先缓存噪声参数以减少对象访问开销
            const noiseScale = EnvironmentConfig.grass.noise.scale;
            const noiseThreshold = EnvironmentConfig.grass.noise.threshold;
            
            for (let i = 0; i < count; i++) {
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
                if (((n/1.5 + 1) * 0.5) < noiseThreshold + (Math.random() * 0.15 - 0.075)) {
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
