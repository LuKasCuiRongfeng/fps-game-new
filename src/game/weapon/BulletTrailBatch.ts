import * as THREE from 'three';
import { MeshBasicNodeMaterial, StorageBufferAttribute } from 'three/webgpu';
import type { UniformNode } from 'three/webgpu';
import {
    abs,
    float,
    instanceIndex,
    sin,
    smoothstep,
    positionLocal,
    storage,
    uniform,
    uv,
    vec3,
} from 'three/tsl';
import { getUserData } from '../types/GameUserData';

export class BulletTrailBatch {
    private static instance: BulletTrailBatch | null = null;

    public static get(): BulletTrailBatch {
        if (!BulletTrailBatch.instance) BulletTrailBatch.instance = new BulletTrailBatch();
        return BulletTrailBatch.instance;
    }

    private static readonly defaultDir = new THREE.Vector3(0, 1, 0);
    private static readonly axisX = new THREE.Vector3(1, 0, 0);

    private readonly maxTrails = 256;
    private readonly maxLifetime = 0.15;

    private readonly now: UniformNode<number>;

    private readonly startArray: Float32Array;
    private readonly endArray: Float32Array;
    private readonly metaArray: Float32Array;

    private readonly startBuffer: StorageBufferAttribute;
    private readonly endBuffer: StorageBufferAttribute;
    private readonly metaBuffer: StorageBufferAttribute;

    private readonly mainMesh: THREE.InstancedMesh;
    private readonly glowMesh: THREE.InstancedMesh;

    private nextIndex = 0;

    private lastTimeSeconds = Number.NaN;

    private attachedScene: THREE.Scene | null = null;

    private readonly tmpDirection = new THREE.Vector3();
    private readonly tmpMidpoint = new THREE.Vector3();
    private readonly tmpQuaternion = new THREE.Quaternion();
    private readonly tmpMatrix = new THREE.Matrix4();
    private readonly tmpScaleOne = new THREE.Vector3(1, 1, 1);

    private constructor() {
        this.now = uniform(0);

        // Unit cylinders centered at origin with height 1.
        const mainGeometry = new THREE.CylinderGeometry(0.003, 0.003, 1, 4, 1);
        const glowGeometry = new THREE.CylinderGeometry(0.015, 0.008, 1, 6, 1);

        this.startArray = new Float32Array(this.maxTrails * 3);
        this.endArray = new Float32Array(this.maxTrails * 3);
        this.metaArray = new Float32Array(this.maxTrails * 4);

        // Initialize inactive trails so they render with 0 opacity.
        for (let i = 0; i < this.maxTrails; i++) {
            this.metaArray[i * 4] = -1000; // spawnTime
            this.metaArray[i * 4 + 1] = 0; // length
            this.metaArray[i * 4 + 2] = 0; // seed
            this.metaArray[i * 4 + 3] = 0; // unused
        }

        this.startBuffer = new StorageBufferAttribute(this.startArray, 3);
        this.endBuffer = new StorageBufferAttribute(this.endArray, 3);
        this.metaBuffer = new StorageBufferAttribute(this.metaArray, 4);

        const mainMaterial = this.createMainMaterial();
        const glowMaterial = this.createGlowMaterial();

        this.mainMesh = new THREE.InstancedMesh(mainGeometry, mainMaterial, this.maxTrails);
        this.glowMesh = new THREE.InstancedMesh(glowGeometry, glowMaterial, this.maxTrails);

        // Trails update frequently; mark buffers as dynamic so WebGPU uses an appropriate upload path.
        this.mainMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        this.mainMesh.frustumCulled = false;
        this.glowMesh.frustumCulled = false;

        this.mainMesh.castShadow = false;
        this.glowMesh.castShadow = false;

        this.mainMesh.receiveShadow = false;
        this.glowMesh.receiveShadow = false;

        this.mainMesh.renderOrder = 1000;
        this.glowMesh.renderOrder = 1001;

        getUserData(this.mainMesh).isBulletTrail = true;
        getUserData(this.glowMesh).isBulletTrail = true;
    }

    public ensureInScene(scene: THREE.Scene): void {
        if (this.attachedScene === scene) return;

        if (this.attachedScene) {
            this.attachedScene.remove(this.mainMesh);
            this.attachedScene.remove(this.glowMesh);
        }

        this.attachedScene = scene;
        this.attachedScene.add(this.mainMesh);
        this.attachedScene.add(this.glowMesh);
    }

    public setTimeSeconds(seconds: number): void {
        this.now.value = seconds;

        // Clear update ranges once per frame so multiple emits in the same frame
        // upload all touched ranges instead of only the last one.
        if (seconds !== this.lastTimeSeconds) {
            this.lastTimeSeconds = seconds;

            this.startBuffer.clearUpdateRanges();
            this.endBuffer.clearUpdateRanges();
            this.metaBuffer.clearUpdateRanges();

            this.mainMesh.instanceMatrix.clearUpdateRanges();
            this.glowMesh.instanceMatrix.clearUpdateRanges();
        }
    }

    public emit(start: THREE.Vector3, end: THREE.Vector3): void {
        const direction = this.tmpDirection.subVectors(end, start);
        const len = direction.length();
        if (len < 0.01) return;

        const index = this.nextIndex;
        this.nextIndex = (this.nextIndex + 1) % this.maxTrails;

        // Store endpoints (for potential debugging / future GPU path).
        const sOff = index * 3;
        this.startArray[sOff] = start.x;
        this.startArray[sOff + 1] = start.y;
        this.startArray[sOff + 2] = start.z;

        this.endArray[sOff] = end.x;
        this.endArray[sOff + 1] = end.y;
        this.endArray[sOff + 2] = end.z;

        // Meta: spawnTime, length, seed.
        const mOff = index * 4;
        this.metaArray[mOff] = this.now.value as number;
        this.metaArray[mOff + 1] = len;
        this.metaArray[mOff + 2] = Math.random();

        // Mark only the written elements for upload.
        this.startBuffer.addUpdateRange(sOff, 3);
        this.endBuffer.addUpdateRange(sOff, 3);
        this.metaBuffer.addUpdateRange(mOff, 4);
        this.startBuffer.needsUpdate = true;
        this.endBuffer.needsUpdate = true;
        this.metaBuffer.needsUpdate = true;

        // Instance transform: translate to midpoint and rotate Y-axis to direction.
        this.tmpMidpoint.addVectors(start, end).multiplyScalar(0.5);
        direction.multiplyScalar(1 / len);

        const defaultDir = BulletTrailBatch.defaultDir;
        const quaternion = this.tmpQuaternion;

        const dot = defaultDir.dot(direction);
        if (Math.abs(dot) > 0.9999) {
            quaternion.identity();
            if (dot < 0) quaternion.setFromAxisAngle(BulletTrailBatch.axisX, Math.PI);
        } else {
            quaternion.setFromUnitVectors(defaultDir, direction);
        }

        this.tmpMatrix.compose(this.tmpMidpoint, quaternion, this.tmpScaleOne);
        this.mainMesh.setMatrixAt(index, this.tmpMatrix);
        this.glowMesh.setMatrixAt(index, this.tmpMatrix);

        this.mainMesh.instanceMatrix.addUpdateRange(index * 16, 16);
        this.glowMesh.instanceMatrix.addUpdateRange(index * 16, 16);
        this.mainMesh.instanceMatrix.needsUpdate = true;
        this.glowMesh.instanceMatrix.needsUpdate = true;
    }

    private createTrailNodes() {
        const metaStorage = storage(this.metaBuffer, 'vec4', this.maxTrails);
        const meta = metaStorage.element(instanceIndex);
        const spawnTime = meta.x;
        const length = meta.y.max(0.0);
        const seed = meta.z;

        // NOTE: TSL `time` is typically elapsed time since renderer/material init.
        // We use a CPU-driven uniform `now` to match the spawnTime we write from JS.
        const now = this.now;
        const age = now.sub(spawnTime).max(0.0);
        const progress = age.div(float(this.maxLifetime)).clamp(0.0, 1.0);

        const fadeOut = float(1.0).sub(progress.pow(0.5));
        const shrinkProgress = progress.mul(2.0).min(1.0);

        const scaleY = length.mul(float(1.0).sub(shrinkProgress.mul(0.8)));
        const scaleRadial = float(1.0).sub(shrinkProgress.mul(0.9)).max(0.1);

        const flicker = sin(now.mul(200.0).add(seed.mul(31.0))).mul(0.1).add(0.9);

        return { opacity: fadeOut, scaleRadial, scaleY, flicker };
    }

    private createMainMaterial(): MeshBasicNodeMaterial {
        const material = new MeshBasicNodeMaterial();
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.side = THREE.DoubleSide;

        const { opacity, scaleRadial, scaleY, flicker } = this.createTrailNodes();

        const coreColor = vec3(1.0, 0.95, 0.7);

        // Fade out the two caps so the trail feels more like a streak, not a rod.
        const v = uv().y;
        const capFade = smoothstep(float(0.0), float(0.12), v).mul(smoothstep(float(1.0), float(0.88), v));

        // Scale in shader (shrink over time) – instanceMatrix carries only translation/rotation.
        material.positionNode = positionLocal.mul(vec3(scaleRadial, scaleY, scaleRadial));
        material.colorNode = coreColor.mul(flicker);
        material.opacityNode = opacity.mul(capFade);

        return material;
    }

    private createGlowMaterial(): MeshBasicNodeMaterial {
        const material = new MeshBasicNodeMaterial();
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.side = THREE.DoubleSide;

        const { opacity, scaleRadial, scaleY } = this.createTrailNodes();

        const uvCoord = uv();
        const gradient = smoothstep(float(0.0), float(0.3), uvCoord.y);
        const glowColor = vec3(1.0, 0.6, 0.15);
        const radialFade = smoothstep(float(0.5), float(0.2), abs(uvCoord.x.sub(0.5)));
        const capFade = smoothstep(float(0.0), float(0.12), uvCoord.y).mul(smoothstep(float(1.0), float(0.88), uvCoord.y));

        material.positionNode = positionLocal.mul(vec3(scaleRadial, scaleY, scaleRadial));
        material.colorNode = glowColor.mul(gradient);
        material.opacityNode = opacity.mul(0.6).mul(radialFade).mul(capFade);

        return material;
    }

    public dispose(): void {
        if (this.attachedScene) {
            this.attachedScene.remove(this.mainMesh);
            this.attachedScene.remove(this.glowMesh);
        }

        this.mainMesh.geometry.dispose();
        this.glowMesh.geometry.dispose();
        (this.mainMesh.material as THREE.Material).dispose();
        (this.glowMesh.material as THREE.Material).dispose();

        this.attachedScene = null;
    }
}
