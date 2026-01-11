import * as THREE from 'three';
// @ts-ignore - WebGPU types not fully available
import type { WebGPURenderer } from 'three/webgpu';
import {
    Fn,
    uniform,
    storage,
    instanceIndex,
    float,
    vec3,
    sin,
    fract,
    If,
} from 'three/tsl';

import { createStorageBufferAttribute } from './StorageBufferAttributeCompat';

export class GPUWeatherRainParticles {
    private readonly renderer: WebGPURenderer;
    private readonly maxParticles: number;

    // Storage buffers
    private positionBuffer: any;
    private velocityBuffer: any;

    // Uniforms
    private deltaTime = uniform(0);
    private cameraPosition = uniform(new THREE.Vector3());
    private area = uniform(new THREE.Vector3(200, 50, 200));
    private windDir = uniform(new THREE.Vector3(1, 0, 0));
    private windStrength = uniform(0);
    private seed = uniform(0);

    private updateCompute: any;

    constructor(renderer: WebGPURenderer, maxParticles: number) {
        this.renderer = renderer;
        this.maxParticles = maxParticles;

        this.initBuffers();
        this.createCompute();
    }

    public getPositionAttribute(): THREE.BufferAttribute {
        return this.positionBuffer as THREE.BufferAttribute;
    }

    public initSpawn(opts: {
        area: { x: number; y: number; z: number };
        cameraPos: THREE.Vector3;
        speedMin: number;
        speedMax: number;
    }): void {
        const positions = this.positionBuffer.array as Float32Array;
        const velocities = this.velocityBuffer.array as Float32Array;

        for (let i = 0; i < this.maxParticles; i++) {
            const i3 = i * 3;
            positions[i3] = opts.cameraPos.x + (Math.random() - 0.5) * opts.area.x;
            positions[i3 + 1] = opts.cameraPos.y + Math.random() * opts.area.y;
            positions[i3 + 2] = opts.cameraPos.z + (Math.random() - 0.5) * opts.area.z;

            const speed = opts.speedMin + Math.random() * (opts.speedMax - opts.speedMin);
            velocities[i3] = 0;
            velocities[i3 + 1] = -speed;
            velocities[i3 + 2] = 0;
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;

        this.area.value.set(opts.area.x, opts.area.y, opts.area.z);
        this.cameraPosition.value.copy(opts.cameraPos);
    }

    public update(opts: {
        delta: number;
        cameraPos: THREE.Vector3;
        windDirection: THREE.Vector3;
        windStrength: number;
        area: { x: number; y: number; z: number };
        seed?: number;
    }): void {
        this.deltaTime.value = opts.delta;
        this.cameraPosition.value.copy(opts.cameraPos);
        this.windStrength.value = opts.windStrength;
        this.windDir.value.copy(opts.windDirection).normalize();
        this.area.value.set(opts.area.x, opts.area.y, opts.area.z);
        this.seed.value = opts.seed ?? (this.seed.value + opts.delta);

        this.renderer.computeAsync(this.updateCompute);
    }

    private initBuffers(): void {
        const positions = new Float32Array(this.maxParticles * 3);
        // @ts-ignore
        this.positionBuffer = createStorageBufferAttribute(positions, 3);

        const velocities = new Float32Array(this.maxParticles * 3);
        // @ts-ignore
        this.velocityBuffer = createStorageBufferAttribute(velocities, 3);
    }

    private createCompute(): void {
        const positionStorage = storage(this.positionBuffer, 'vec3', this.maxParticles);
        const velocityStorage = storage(this.velocityBuffer, 'vec3', this.maxParticles);

        const rand01 = (n: any) => fract(sin(n).mul(43758.5453123));

        this.updateCompute = Fn(() => {
            const index = instanceIndex;
            const pos = positionStorage.element(index);
            const vel = velocityStorage.element(index);

            // Wind is horizontal.
            const wind = vec3(
                this.windDir.x.mul(this.windStrength).mul(2.0),
                float(0),
                this.windDir.z.mul(this.windStrength).mul(2.0)
            );

            // TSL nodes have multiple concrete subtypes; we reassign `next` in branches.
            let next: any = pos.add(vel.add(wind).mul(this.deltaTime));

            const halfX = this.area.x.mul(0.5);
            const halfZ = this.area.z.mul(0.5);
            const respawnY = this.cameraPosition.y.add(this.area.y.mul(0.5));
            const floorY = this.cameraPosition.y.sub(5.0);

            const base = float(index).add(this.seed.mul(1000.0));

            // Respawn when falling below camera band.
            If(next.y.lessThan(floorY), () => {
                const r1 = rand01(base.add(1.23));
                const r2 = rand01(base.add(4.56));
                next = vec3(
                    this.cameraPosition.x.add(r1.sub(0.5).mul(this.area.x)),
                    respawnY,
                    this.cameraPosition.z.add(r2.sub(0.5).mul(this.area.z))
                );
            });

            // Keep within the camera-centered box.
            If(next.x.sub(this.cameraPosition.x).abs().greaterThan(halfX), () => {
                const r = rand01(base.add(7.89));
                next = vec3(
                    this.cameraPosition.x.add(r.sub(0.5).mul(this.area.x)),
                    next.y,
                    next.z
                );
            });

            If(next.z.sub(this.cameraPosition.z).abs().greaterThan(halfZ), () => {
                const r = rand01(base.add(9.87));
                next = vec3(
                    next.x,
                    next.y,
                    this.cameraPosition.z.add(r.sub(0.5).mul(this.area.z))
                );
            });

            positionStorage.element(index).assign(next);
        })().compute(this.maxParticles);
    }

    public dispose(): void {
        // Geometry/material owns the position attribute lifetime; compute buffers are attributes.
        // @ts-ignore
        if (typeof this.positionBuffer.dispose === 'function') this.positionBuffer.dispose();
        // @ts-ignore
        if (typeof this.velocityBuffer.dispose === 'function') this.velocityBuffer.dispose();
    }
}

export class GPUWeatherSandParticles {
    private readonly renderer: WebGPURenderer;
    private readonly maxParticles: number;

    // Storage buffers
    private positionBuffer: any;
    private velocityBuffer: any;

    // Uniforms
    private deltaTime = uniform(0);
    private cameraPosition = uniform(new THREE.Vector3());
    private area = uniform(new THREE.Vector3(160, 40, 120));
    private gustOffset = uniform(0);
    private seed = uniform(0);

    private updateCompute: any;

    constructor(renderer: WebGPURenderer, maxParticles: number) {
        this.renderer = renderer;
        this.maxParticles = maxParticles;

        this.initBuffers();
        this.createCompute();
    }

    public getPositionAttribute(): THREE.BufferAttribute {
        return this.positionBuffer as THREE.BufferAttribute;
    }

    public initSpawn(opts: {
        area: { x: number; y: number; z: number };
        cameraPos: THREE.Vector3;
        speedMin: number;
        speedMax: number;
    }): void {
        const positions = this.positionBuffer.array as Float32Array;
        const velocities = this.velocityBuffer.array as Float32Array;

        for (let i = 0; i < this.maxParticles; i++) {
            const i3 = i * 3;
            positions[i3] = opts.cameraPos.x + (Math.random() - 0.5) * opts.area.x;
            positions[i3 + 1] = opts.cameraPos.y + Math.random() * opts.area.y;
            positions[i3 + 2] = opts.cameraPos.z + (Math.random() - 0.5) * opts.area.z;

            const speed = opts.speedMin + Math.random() * (opts.speedMax - opts.speedMin);
            velocities[i3] = speed;
            velocities[i3 + 1] = (Math.random() - 0.5) * 2;
            velocities[i3 + 2] = (Math.random() - 0.5) * speed * 0.3;
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;

        this.area.value.set(opts.area.x, opts.area.y, opts.area.z);
        this.cameraPosition.value.copy(opts.cameraPos);
    }

    public update(opts: {
        delta: number;
        cameraPos: THREE.Vector3;
        area: { x: number; y: number; z: number };
        gustOffset: number;
        seed?: number;
    }): void {
        this.deltaTime.value = opts.delta;
        this.cameraPosition.value.copy(opts.cameraPos);
        this.area.value.set(opts.area.x, opts.area.y, opts.area.z);
        this.gustOffset.value = opts.gustOffset;
        this.seed.value = opts.seed ?? (this.seed.value + opts.delta);

        this.renderer.computeAsync(this.updateCompute);
    }

    private initBuffers(): void {
        const positions = new Float32Array(this.maxParticles * 3);
        // @ts-ignore
        this.positionBuffer = createStorageBufferAttribute(positions, 3);

        const velocities = new Float32Array(this.maxParticles * 3);
        // @ts-ignore
        this.velocityBuffer = createStorageBufferAttribute(velocities, 3);
    }

    private createCompute(): void {
        const positionStorage = storage(this.positionBuffer, 'vec3', this.maxParticles);
        const velocityStorage = storage(this.velocityBuffer, 'vec3', this.maxParticles);

        const rand01 = (n: any) => fract(sin(n).mul(43758.5453123));

        this.updateCompute = Fn(() => {
            const index = instanceIndex;
            const pos = positionStorage.element(index);
            const vel = velocityStorage.element(index);

            const halfX = this.area.x.mul(0.5);
            const halfZ = this.area.z.mul(0.5);

            const base = float(index).add(this.seed.mul(1000.0));
            const gustMultiplier = float(1.0).add(sin(this.gustOffset).mul(0.3));

            // TSL nodes have multiple concrete subtypes; we reassign `next` in branches.
            let next: any = pos.add(vel.mul(gustMultiplier).mul(this.deltaTime));

            // Vertical flutter.
            const flutter = sin(this.gustOffset.add(float(index).mul(0.1)))
                .mul(0.5)
                .mul(this.deltaTime);
            next = vec3(next.x, next.y.add(flutter), next.z);

            // Loop back to the left side when passing the right boundary.
            If(next.x.sub(this.cameraPosition.x).greaterThan(halfX), () => {
                const rY = rand01(base.add(1.11));
                const rZ = rand01(base.add(2.22));
                next = vec3(
                    this.cameraPosition.x.sub(halfX),
                    this.cameraPosition.y.add(rY.mul(this.area.y)).sub(this.area.y.mul(0.3)),
                    this.cameraPosition.z.add(rZ.sub(0.5).mul(this.area.z))
                );
            });

            // Keep within camera-centered Z band.
            If(next.z.sub(this.cameraPosition.z).abs().greaterThan(halfZ), () => {
                const r = rand01(base.add(3.33));
                next = vec3(
                    next.x,
                    next.y,
                    this.cameraPosition.z.add(r.sub(0.5).mul(this.area.z))
                );
            });

            // Height limits (world space), matching the CPU fallback.
            If(next.y.lessThan(float(0.0)), () => {
                const r = rand01(base.add(4.44));
                next = vec3(next.x, r.mul(this.area.y), next.z);
            });
            If(next.y.greaterThan(this.area.y), () => {
                next = vec3(next.x, float(0.0), next.z);
            });

            positionStorage.element(index).assign(next);
        })().compute(this.maxParticles);
    }

    public dispose(): void {
        // Geometry/material owns the position attribute lifetime; compute buffers are attributes.
        // @ts-ignore
        if (typeof this.positionBuffer.dispose === 'function') this.positionBuffer.dispose();
        // @ts-ignore
        if (typeof this.velocityBuffer.dispose === 'function') this.velocityBuffer.dispose();
    }
}

export class GPUWeatherDebrisParticles {
    private readonly renderer: WebGPURenderer;
    private readonly maxParticles: number;

    // Storage buffers
    private positionBuffer: any;
    private velocityBuffer: any;
    private phaseBuffer: any;

    // Uniforms
    private deltaTime = uniform(0);
    private cameraPosition = uniform(new THREE.Vector3());
    private gustOffset = uniform(0);
    private gustStrength = uniform(0.5);
    private rotationSpeed = uniform(5.0);
    private seed = uniform(0);

    private updateCompute: any;

    constructor(renderer: WebGPURenderer, maxParticles: number) {
        this.renderer = renderer;
        this.maxParticles = maxParticles;

        this.initBuffers();
        this.createCompute();
    }

    public getPositionAttribute(): THREE.BufferAttribute {
        return this.positionBuffer as THREE.BufferAttribute;
    }

    public initSpawn(opts: {
        cameraPos: THREE.Vector3;
        xRange: number;
        yRange: number;
        zRange: number;
        velXMin: number;
        velXMax: number;
        velYRange: number;
        velZRange: number;
    }): void {
        const positions = this.positionBuffer.array as Float32Array;
        const velocities = this.velocityBuffer.array as Float32Array;
        const phases = this.phaseBuffer.array as Float32Array;

        for (let i = 0; i < this.maxParticles; i++) {
            const i3 = i * 3;
            positions[i3] = opts.cameraPos.x + (Math.random() - 0.5) * opts.xRange;
            positions[i3 + 1] = Math.random() * opts.yRange;
            positions[i3 + 2] = opts.cameraPos.z + (Math.random() - 0.5) * opts.zRange;

            velocities[i3] = opts.velXMin + Math.random() * (opts.velXMax - opts.velXMin);
            velocities[i3 + 1] = (Math.random() - 0.5) * opts.velYRange;
            velocities[i3 + 2] = (Math.random() - 0.5) * opts.velZRange;

            phases[i] = Math.random() * Math.PI * 2;
        }

        this.positionBuffer.needsUpdate = true;
        this.velocityBuffer.needsUpdate = true;
        this.phaseBuffer.needsUpdate = true;

        this.cameraPosition.value.copy(opts.cameraPos);
    }

    public update(opts: {
        delta: number;
        cameraPos: THREE.Vector3;
        gustOffset: number;
        gustStrength: number;
        rotationSpeed: number;
        seed?: number;
    }): void {
        this.deltaTime.value = opts.delta;
        this.cameraPosition.value.copy(opts.cameraPos);
        this.gustOffset.value = opts.gustOffset;
        this.gustStrength.value = opts.gustStrength;
        this.rotationSpeed.value = opts.rotationSpeed;
        this.seed.value = opts.seed ?? (this.seed.value + opts.delta);

        this.renderer.computeAsync(this.updateCompute);
    }

    private initBuffers(): void {
        const positions = new Float32Array(this.maxParticles * 3);
        // @ts-ignore
        this.positionBuffer = createStorageBufferAttribute(positions, 3);

        const velocities = new Float32Array(this.maxParticles * 3);
        // @ts-ignore
        this.velocityBuffer = createStorageBufferAttribute(velocities, 3);

        const phases = new Float32Array(this.maxParticles);
        // @ts-ignore
        this.phaseBuffer = createStorageBufferAttribute(phases, 1);
    }

    private createCompute(): void {
        const positionStorage = storage(this.positionBuffer, 'vec3', this.maxParticles);
        const velocityStorage = storage(this.velocityBuffer, 'vec3', this.maxParticles);
        const phaseStorage = storage(this.phaseBuffer, 'float', this.maxParticles);

        const rand01 = (n: any) => fract(sin(n).mul(43758.5453123));

        this.updateCompute = Fn(() => {
            const index = instanceIndex;
            const pos = positionStorage.element(index);
            const vel = velocityStorage.element(index);
            const phase = phaseStorage.element(index);

            const base = float(index).add(this.seed.mul(1000.0));
            const gustMultiplier = float(1.0).add(sin(this.gustOffset).mul(this.gustStrength));

            // Update position.
            let nextPos: any = pos.add(vel.mul(gustMultiplier).mul(this.deltaTime));

            // Advance phase (used for vertical swirl).
            let nextPhase: any = phase.add(this.rotationSpeed.mul(this.deltaTime));
            nextPos = vec3(
                nextPos.x,
                nextPos.y.add(sin(nextPhase).mul(2.0).mul(this.deltaTime)),
                nextPos.z
            );

            // Loop in X (match CPU path: dx > 40 => reset to left at -40, random y/z).
            If(nextPos.x.sub(this.cameraPosition.x).greaterThan(float(40.0)), () => {
                const rY = rand01(base.add(11.11));
                const rZ = rand01(base.add(22.22));
                nextPos = vec3(
                    this.cameraPosition.x.sub(float(40.0)),
                    rY.mul(float(20.0)),
                    this.cameraPosition.z.add(rZ.sub(0.5).mul(float(80.0)))
                );
            });

            // Height limits (match CPU path).
            let nextVel: any = vel;
            If(nextPos.y.lessThan(float(0.0)), () => {
                nextPos = vec3(nextPos.x, float(0.0), nextPos.z);
                nextVel = vec3(vel.x, vel.y.abs(), vel.z);
            });
            If(nextPos.y.greaterThan(float(25.0)), () => {
                nextVel = vec3(vel.x, vel.y.abs().mul(-1.0), vel.z);
            });

            positionStorage.element(index).assign(nextPos);
            velocityStorage.element(index).assign(nextVel);
            phaseStorage.element(index).assign(nextPhase);
        })().compute(this.maxParticles);
    }

    public dispose(): void {
        // @ts-ignore
        if (typeof this.positionBuffer.dispose === 'function') this.positionBuffer.dispose();
        // @ts-ignore
        if (typeof this.velocityBuffer.dispose === 'function') this.velocityBuffer.dispose();
        // @ts-ignore
        if (typeof this.phaseBuffer.dispose === 'function') this.phaseBuffer.dispose();
    }
}
