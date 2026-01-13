import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { MapConfig, EnvironmentConfig, LevelConfig } from '../core/GameConfig';
import { LevelMaterials } from './LevelMaterials';
import { getUserData } from '../types/GameUserData';
import { PhysicsSystem } from '../core/PhysicsSystem';

export class EnvironmentSystem {
    private scene: THREE.Scene;
    private objects: THREE.Object3D[];
    private getTerrainHeight: (x: number, z: number) => number;
    private physicsSystem: PhysicsSystem | null;
    
    // 材质缓存
    private wallMaterial: THREE.Material;
    private concreteMaterial: THREE.Material;
    private metalMaterial: THREE.Material;
    private rockMaterial: THREE.Material;

    constructor(
        scene: THREE.Scene, 
        objects: THREE.Object3D[], 
        getTerrainHeight: (x: number, z: number) => number,
        physicsSystem: PhysicsSystem | null = null
    ) {
        this.scene = scene;
        this.objects = objects;
        this.getTerrainHeight = getTerrainHeight;
        this.physicsSystem = physicsSystem;

        // 初始化材质
        this.wallMaterial = LevelMaterials.createWallMaterial();
        this.concreteMaterial = LevelMaterials.createConcreteMaterial();
        this.metalMaterial = LevelMaterials.createMetalCrateMaterial();
        this.rockMaterial = LevelMaterials.createRockMaterial();
    }

    /**
     * 创建空气墙边界 (Invisible Boundary)
     */
    public createWalls() {
        const boundaryRadius = MapConfig.boundaryRadius;
        const thickness = 10;
        const range = boundaryRadius; 
        
        // Node-material only (WebGPU-first). We keep the mesh invisible but still use a WebGPU node material.
        const wallMaterial = new MeshBasicNodeMaterial({ transparent: true, opacity: 0.0 });
        
        const configs = [
            { pos: [0, 0, -range], size: [range * 2, 100, thickness] }, // North
            { pos: [0, 0, range], size: [range * 2, 100, thickness] },  // South
            { pos: [-range, 0, 0], size: [thickness, 100, range * 2] }, // West
            { pos: [range, 0, 0], size: [thickness, 100, range * 2] },  // East
        ];

        configs.forEach(cfg => {
             const geo = new THREE.BoxGeometry(cfg.size[0], cfg.size[1], cfg.size[2]);
             const mesh = new THREE.Mesh(geo, wallMaterial);
             mesh.position.set(cfg.pos[0] as number, cfg.pos[1] as number, cfg.pos[2] as number);
               mesh.visible = false;
             
             this.scene.add(mesh);
             this.objects.push(mesh);
        });
    }

    /**
     * 创建障碍物
     */
    public createObstacles() {
        const boxGeo = new THREE.BoxGeometry(2, 2, 2);
        const tallGeo = new THREE.BoxGeometry(2, 6, 2);
        const mapRadius = MapConfig.size / 2 - 10;

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
        
        const outerPositions: {x: number, z: number, type: string}[] = [];
        const gridSpacing = 25;
        for (let x = -mapRadius + 30; x <= mapRadius - 30; x += gridSpacing) {
            for (let z = -mapRadius + 30; z <= mapRadius - 30; z += gridSpacing) {
                if (Math.abs(x) < 25 && Math.abs(z) < 25) continue;
                
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

        // Render via instancing (massive drawcall reduction), but keep accurate per-obstacle AABB collisions
        // by registering per-instance Box3 colliders into PhysicsSystem.
        const instances: {
            boxMetal: THREE.Matrix4[];
            boxConcrete: THREE.Matrix4[];
            tallMetal: THREE.Matrix4[];
            tallConcrete: THREE.Matrix4[];
            colliders: Array<{ box: THREE.Box3; objectKey: 'boxMetal' | 'boxConcrete' | 'tallMetal' | 'tallConcrete' }>;
        } = {
            boxMetal: [],
            boxConcrete: [],
            tallMetal: [],
            tallConcrete: [],
            colliders: [],
        };

        const embedDepth = 0.5;
        const dummy = new THREE.Object3D();

        allPositions.forEach((p, index) => {
            const height = p.type === 'box' ? 2 : 6;
            const groundY = this.getTerrainHeight(p.x, p.z);

            const distToSpawn = Math.sqrt(p.x * p.x + p.z * p.z);
            if (distToSpawn < LevelConfig.safeZoneRadius) return;
            if (groundY < EnvironmentConfig.water.level + 0.5) return;

            const y = groundY + height / 2 - embedDepth;

            const isMetal = index % 2 === 0;
            const key: 'boxMetal' | 'boxConcrete' | 'tallMetal' | 'tallConcrete' =
                p.type === 'box'
                    ? (isMetal ? 'boxMetal' : 'boxConcrete')
                    : (isMetal ? 'tallMetal' : 'tallConcrete');

            dummy.position.set(p.x, y, p.z);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            (instances[key] as THREE.Matrix4[]).push(dummy.matrix.clone());

            // Axis-aligned collider (no rotation)
            const halfX = 1;
            const halfZ = 1;
            const halfY = height / 2;
            const collider = new THREE.Box3(
                new THREE.Vector3(p.x - halfX, y - halfY, p.z - halfZ),
                new THREE.Vector3(p.x + halfX, y + halfY, p.z + halfZ)
            );
            instances.colliders.push({ box: collider, objectKey: key });
        });

        const createdMeshes: Partial<Record<'boxMetal' | 'boxConcrete' | 'tallMetal' | 'tallConcrete', THREE.InstancedMesh>> = {};
        const createBatch = (
            key: 'boxMetal' | 'boxConcrete' | 'tallMetal' | 'tallConcrete',
            geo: THREE.BufferGeometry,
            mat: THREE.Material
        ) => {
            const matrices = instances[key];
            if (matrices.length === 0) return;
            const mesh = new THREE.InstancedMesh(geo, mat, matrices.length);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            {
                const ud = getUserData(mesh);
                ud.isObstacleBatch = true;
                ud.noPhysics = true;
            }

            for (let i = 0; i < matrices.length; i++) {
                mesh.setMatrixAt(i, matrices[i]);
            }
            mesh.instanceMatrix.needsUpdate = true;
            mesh.computeBoundingSphere();

            this.scene.add(mesh);
            this.objects.push(mesh);
            createdMeshes[key] = mesh;

            // Prepare for raycasts (BVH/targets) without registering a huge AABB collider
            this.physicsSystem?.prepareStaticObject(mesh);
        };

        createBatch('boxMetal', boxGeo, this.metalMaterial);
        createBatch('boxConcrete', boxGeo, this.concreteMaterial);
        createBatch('tallMetal', tallGeo, this.metalMaterial);
        createBatch('tallConcrete', tallGeo, this.concreteMaterial);

        // Register per-instance colliders
        if (this.physicsSystem) {
            for (const c of instances.colliders) {
                const obj = createdMeshes[c.objectKey];
                if (!obj) continue;
                this.physicsSystem.addStaticBoxCollider(c.box, obj);
            }
        }
    }

    /**
     * 创建岩石群
     */
    public createRockFormations(_mapRadius: number) {
        const smallRockGeo = new THREE.DodecahedronGeometry(1.5, 0);
        const mediumRockGeo = new THREE.DodecahedronGeometry(2.5, 1);
        const largeRockGeo = new THREE.DodecahedronGeometry(4, 1);
        
        const rockClusters = [
            { x: 60, z: 60, count: 5, size: 'mixed' },
            { x: -60, z: 60, count: 4, size: 'mixed' },
            { x: 60, z: -60, count: 5, size: 'mixed' },
            { x: -60, z: -60, count: 4, size: 'mixed' },
            { x: 0, z: 75, count: 3, size: 'large' },
            { x: 0, z: -75, count: 3, size: 'large' },
            { x: 75, z: 0, count: 3, size: 'large' },
            { x: -75, z: 0, count: 3, size: 'large' },
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
                const seed = clusterIndex * 100 + i;
                const offsetX = Math.sin(seed * 12.9898) * 8;
                const offsetZ = Math.cos(seed * 78.233) * 8;
                
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
                
                const groundH = this.getTerrainHeight(x, z);
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
                getUserData(mesh).isRock = true;
                
                this.scene.add(mesh);
                this.objects.push(mesh);
            }
        });
    }
    
    /**
     * 创建废墟断墙
     */
    public createRuins(_mapRadius: number) {
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
            const wallWidth = 6 + Math.sin(index * 2.5) * 2;
            const wallGeo = new THREE.BoxGeometry(wallWidth, ruin.height, 0.8);
            const wallMesh = new THREE.Mesh(wallGeo, this.wallMaterial);
            
            const groundH = this.getTerrainHeight(ruin.x, ruin.z);
            const embed = 0.5;
            
            wallMesh.position.set(ruin.x, groundH + ruin.height / 2 - embed, ruin.z);
            wallMesh.rotation.y = ruin.rotation;
            wallMesh.castShadow = true;
            wallMesh.receiveShadow = true;
            getUserData(wallMesh).isRuin = true;
            
            this.scene.add(wallMesh);
            this.objects.push(wallMesh);
            
            if (index % 2 === 0) {
                const debrisGeo = new THREE.BoxGeometry(1.5, 0.8, 1);
                const debrisMesh = new THREE.Mesh(debrisGeo, this.concreteMaterial);
                
                const offsetX = Math.cos(ruin.rotation) * 3;
                const offsetZ = Math.sin(ruin.rotation) * 3;
                
                const debrisX = ruin.x + offsetX;
                const debrisZ = ruin.z + offsetZ;
                const debrisGroundH = this.getTerrainHeight(debrisX, debrisZ);
                
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
    public createSandbagCovers(_mapRadius: number) {
        const sandbagMaterial = LevelMaterials.createSandbagMaterial();
        
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
            const group = new THREE.Group();
            
            const frontGeo = new THREE.BoxGeometry(4, 1.2, 0.8);
            const frontMesh = new THREE.Mesh(frontGeo, sandbagMaterial);
            frontMesh.position.set(0, 0.6, 0);
            group.add(frontMesh);
            this.objects.push(frontMesh);
            
            const leftGeo = new THREE.BoxGeometry(0.8, 1, 2);
            const leftMesh = new THREE.Mesh(leftGeo, sandbagMaterial);
            leftMesh.position.set(-1.8, 0.5, 1.2);
            group.add(leftMesh);
            this.objects.push(leftMesh);
            
            const rightMesh = new THREE.Mesh(leftGeo, sandbagMaterial);
            rightMesh.position.set(1.8, 0.5, 1.2);
            group.add(rightMesh);
            this.objects.push(rightMesh);
            
            const groundH = this.getTerrainHeight(pos.x, pos.z);
            if (groundH < EnvironmentConfig.water.level + 0.5) return;

            group.position.set(pos.x, groundH - 0.2, pos.z);
            group.rotation.y = pos.rotation;
            
            group.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    getUserData(child).isCover = true;
                }
            });
            
            this.scene.add(group);
        });
    }

    /**
     * 创建掩体物体 (额外的战术掩护)
     */
    public createCoverObjects() {
        const barrelGeo = new THREE.CylinderGeometry(0.6, 0.6, 1.2, 12);
        const barrelMaterial = LevelMaterials.createBarrelMaterial();
        
        const barrelPositions = [
            { x: 25, z: 10 },
            { x: -25, z: 10 },
            { x: 25, z: -10 },
            { x: -25, z: -10 },
            { x: 10, z: 25 },
            { x: -10, z: 25 },
            { x: 10, z: -25 },
            { x: -10, z: -25 },
            { x: 55, z: 55 },
            { x: -55, z: 55 },
            { x: 55, z: -55 },
            { x: -55, z: -55 },
            { x: 65, z: 0 },
            { x: -65, z: 0 },
            { x: 0, z: 65 },
            { x: 0, z: -65 },
        ];
        
        const embedDepth = 0.3;
        
        barrelPositions.forEach((pos, index) => {
            const groundY = this.getTerrainHeight(pos.x, pos.z);
            if (groundY < EnvironmentConfig.water.level + 0.5) return;

            const barrel = new THREE.Mesh(barrelGeo, barrelMaterial);
            barrel.position.set(pos.x, groundY + 0.6 - embedDepth, pos.z);
            
            barrel.rotation.y = index * 0.7;
            barrel.castShadow = true;
            barrel.receiveShadow = true;
            getUserData(barrel).isBarrel = true;
            
            this.scene.add(barrel);
            this.objects.push(barrel);
            
            if (index % 3 === 0) {
                const fallenBarrel = new THREE.Mesh(barrelGeo, barrelMaterial);
                const offset = 1.0;
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
     * 创建楼梯 (多处)
     */
    public createStairs() {
        const stepHeight = 0.5;
        const stepDepth = 1.0;
        const stepWidth = 4.0;
        const numSteps = 8;
        
        const stairConfigs = [
            { startX: 20, startZ: -5, rotation: 0 },
            { startX: -20, startZ: 5, rotation: Math.PI },
            { startX: 45, startZ: 30, rotation: Math.PI / 2 },
            { startX: -45, startZ: -30, rotation: -Math.PI / 2 },
        ];
        
        stairConfigs.forEach((config, configIndex) => {
            const group = new THREE.Group();
            
            const groundY = this.getTerrainHeight(config.startX, config.startZ);
            
            for (let i = 0; i < numSteps; i++) {
                const currentHeight = stepHeight * (i + 1);
                const baseDepth = 4.0;
                
                const geo = new THREE.BoxGeometry(stepWidth, currentHeight + baseDepth, stepDepth);
                const material = LevelMaterials.createStairMaterial();
                
                const meshY = currentHeight / 2 - baseDepth / 2;
                
                const mesh = new THREE.Mesh(geo, material);
                mesh.position.set(0, meshY, i * stepDepth);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                getUserData(mesh).isStair = true;
                
                group.add(mesh);
                this.objects.push(mesh);
            }

            const platformWidth = 6;
            const platformDepth = 6;
            const platformHeight = stepHeight * numSteps;
            const baseDepth = 4.0;
            
            const platformGeo = new THREE.BoxGeometry(platformWidth, platformHeight + baseDepth, platformDepth);
            const platformMaterial = LevelMaterials.createStairMaterial();
            const platformMesh = new THREE.Mesh(platformGeo, platformMaterial);
            
            const platformY = platformHeight / 2 - baseDepth / 2;
            
            group.position.set(config.startX, groundY, config.startZ);
            group.rotation.y = config.rotation;
            
            platformMesh.position.set(0, platformY, (numSteps * stepDepth) + platformDepth/2 - stepDepth/2);
            platformMesh.castShadow = true;
            platformMesh.receiveShadow = true;
            // IMPORTANT:
            // PlayerController ignores horizontal collisions with objects marked `isGround`.
            // The stair platform is a thick volume; if we mark it as ground, the player can pass through
            // it from the sides/back. Mark as stair/platform so it's walkable on top but blocks sides.
            {
                const ud = getUserData(platformMesh);
                ud.isStair = true;
                ud.isPlatform = true;
            }
            
            group.add(platformMesh);
            this.objects.push(platformMesh);

            this.scene.add(group);

            const stairBottom = new THREE.Object3D();
            const bottomOffset = new THREE.Vector3(0, 0, -2.0).applyAxisAngle(new THREE.Vector3(0, 1, 0), config.rotation);
            
            const bottomX = config.startX + bottomOffset.x;
            const bottomZ = config.startZ + bottomOffset.z;
            const bottomY = this.getTerrainHeight(bottomX, bottomZ);
            
            stairBottom.position.set(bottomX, bottomY + 0.5, bottomZ);
            {
                const ud = getUserData(stairBottom);
                ud.isWayPoint = true;
                ud.type = 'stair_bottom';
                ud.id = configIndex + 1;
            }
            this.objects.push(stairBottom);

            const stairTop = new THREE.Object3D();
            const topLocalZ = (numSteps * stepDepth) + platformDepth/2; 
            const topOffset = new THREE.Vector3(0, 0, topLocalZ).applyAxisAngle(new THREE.Vector3(0, 1, 0), config.rotation);
            
            const topX = config.startX + topOffset.x;
            const topZ = config.startZ + topOffset.z;
            const topY = groundY + platformHeight;
            
            stairTop.position.set(topX, topY + 0.5, topZ);
            {
                const ud = getUserData(stairTop);
                ud.isWayPoint = true;
                ud.type = 'stair_top';
                ud.id = configIndex + 1;
            }
            this.objects.push(stairTop);
        });
    }

    /**
     * 创建天空盒
     */
    public createSkybox() {
        const skyRadius = MapConfig.size * 1.5;
        const skyGeo = new THREE.SphereGeometry(skyRadius, 32, 32);
        const skyMaterial = LevelMaterials.createSkyMaterial();
        
        const sky = new THREE.Mesh(skyGeo, skyMaterial);
        getUserData(sky).isSkybox = true;
        this.scene.add(sky);
    }

    /**
     * 创建大气效果
     */
    public createAtmosphere() {
        this.createDustParticles();
    }

    /**
     * 创建环境灰尘粒子
     */
    public createDustParticles() {
        const particleCount = 500;
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
        
        const material = new THREE.PointsMaterial({
            color: 0xffffff,
            size: 0.08,
            transparent: true,
            opacity: 0.25,
            depthWrite: false
        });
        
        const particles = new THREE.Points(geometry, material);
        getUserData(particles).isDust = true;
        this.scene.add(particles);
    }
}