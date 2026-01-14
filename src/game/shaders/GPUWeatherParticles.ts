import * as THREE from 'three';
import {
    StorageBufferAttribute,
    type WebGPURenderer,
    type ComputeNode,
    type Node,
} from 'three/webgpu';
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

export class GPUWeatherRainParticles {
    private readonly renderer: WebGPURenderer;
    private readonly maxParticles: number;

    // Storage buffers
    private positionBuffer!: StorageBufferAttribute;
    private velocityBuffer!: StorageBufferAttribute;

    // Uniforms
    private deltaTime = uniform(0);
    private cameraPosition = uniform(new THREE.Vector3());
    private area = uniform(new THREE.Vector3(200, 50, 200));
    private windDir = uniform(new THREE.Vector3(1, 0, 0));
    private windStrength = uniform(0);
    private seed = uniform(0);

    private spawnSpeedMin = uniform(12);
    private spawnSpeedMax = uniform(28);

    private spawnCompute!: ComputeNode;
    private updateCompute!: ComputeNode;

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
        this.area.value.set(opts.area.x, opts.area.y, opts.area.z);
        this.cameraPosition.value.copy(opts.cameraPos);
        this.spawnSpeedMin.value = opts.speedMin;
        this.spawnSpeedMax.value = opts.speedMax;

        // Deterministic-ish seed helps keep spawn stable between sessions.
        // Callers may override seed later in update().
        this.seed.value = this.seed.value + 0.001;

        // GPU spawn: avoids CPU-side buffer writes.
        this.renderer.computeAsync(this.spawnCompute);
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
        this.positionBuffer = new StorageBufferAttribute(positions, 3);

        const velocities = new Float32Array(this.maxParticles * 3);
        this.velocityBuffer = new StorageBufferAttribute(velocities, 3);
    }

    private createCompute(): void {
        const positionStorage = storage(this.positionBuffer, 'vec3', this.maxParticles);
        const velocityStorage = storage(this.velocityBuffer, 'vec3', this.maxParticles);

        const rand01 = (n: Node | number) => fract(sin(n).mul(43758.5453123));

        this.spawnCompute = Fn(() => {
            const index = instanceIndex;
            const base = float(index).add(this.seed.mul(1000.0));

            const r1 = rand01(base.add(1.23));
            const r2 = rand01(base.add(4.56));
            const r3 = rand01(base.add(7.89));

            const x = this.cameraPosition.x.add(r1.sub(0.5).mul(this.area.x));
            const y = this.cameraPosition.y.add(r2.mul(this.area.y));
            const z = this.cameraPosition.z.add(r3.sub(0.5).mul(this.area.z));

            const speed = this.spawnSpeedMin.add(r3.mul(this.spawnSpeedMax.sub(this.spawnSpeedMin)));

            positionStorage.element(index).assign(vec3(x, y, z));
            velocityStorage.element(index).assign(vec3(float(0.0), speed.mul(-1.0), float(0.0)));
        })().compute(this.maxParticles);

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
            let next: Node = pos.add(vel.add(wind).mul(this.deltaTime));

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
    }
}

export class GPUWeatherSandParticles {
    private readonly renderer: WebGPURenderer;
    private readonly maxParticles: number;

    // Storage buffers
    private positionBuffer!: StorageBufferAttribute;
    private velocityBuffer!: StorageBufferAttribute;

    // Uniforms
    private deltaTime = uniform(0);
    private cameraPosition = uniform(new THREE.Vector3());
    private area = uniform(new THREE.Vector3(160, 40, 120));
    private gustOffset = uniform(0);
    private seed = uniform(0);

    private spawnSpeedMin = uniform(8);
    private spawnSpeedMax = uniform(18);

    private spawnCompute!: ComputeNode;
    private updateCompute!: ComputeNode;

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
        this.area.value.set(opts.area.x, opts.area.y, opts.area.z);
        this.cameraPosition.value.copy(opts.cameraPos);
        this.spawnSpeedMin.value = opts.speedMin;
        this.spawnSpeedMax.value = opts.speedMax;
        this.seed.value = this.seed.value + 0.001;

        this.renderer.computeAsync(this.spawnCompute);
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
        this.positionBuffer = new StorageBufferAttribute(positions, 3);

        const velocities = new Float32Array(this.maxParticles * 3);
        this.velocityBuffer = new StorageBufferAttribute(velocities, 3);
    }

    private createCompute(): void {
        const positionStorage = storage(this.positionBuffer, 'vec3', this.maxParticles);
        const velocityStorage = storage(this.velocityBuffer, 'vec3', this.maxParticles);

        const rand01 = (n: Node | number) => fract(sin(n).mul(43758.5453123));

        this.spawnCompute = Fn(() => {
            const index = instanceIndex;
            const base = float(index).add(this.seed.mul(1000.0));

            const r1 = rand01(base.add(1.11));
            const r2 = rand01(base.add(2.22));
            const r3 = rand01(base.add(3.33));
            const r4 = rand01(base.add(4.44));

            const x = this.cameraPosition.x.add(r1.sub(0.5).mul(this.area.x));
            const y = this.cameraPosition.y.add(r2.mul(this.area.y));
            const z = this.cameraPosition.z.add(r3.sub(0.5).mul(this.area.z));

            const speed = this.spawnSpeedMin.add(r4.mul(this.spawnSpeedMax.sub(this.spawnSpeedMin)));

            // Horizontal drift is mostly +X, with random vertical + sideways jitter.
            const vy = r2.sub(0.5).mul(2.0);
            const vz = r3.sub(0.5).mul(speed.mul(0.3));

            positionStorage.element(index).assign(vec3(x, y, z));
            velocityStorage.element(index).assign(vec3(speed, vy, vz));
        })().compute(this.maxParticles);

        this.updateCompute = Fn(() => {
            const index = instanceIndex;
            const pos = positionStorage.element(index);
            const vel = velocityStorage.element(index);

            const halfX = this.area.x.mul(0.5);
            const halfZ = this.area.z.mul(0.5);

            const base = float(index).add(this.seed.mul(1000.0));
            const gustMultiplier = float(1.0).add(sin(this.gustOffset).mul(0.3));

            // TSL nodes have multiple concrete subtypes; we reassign `next` in branches.
            let next: Node = pos.add(vel.mul(gustMultiplier).mul(this.deltaTime));

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

            // Height limits (world space).
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
    }
}

export class GPUWeatherDebrisParticles {
    private readonly renderer: WebGPURenderer;
    private readonly maxParticles: number;

    // Storage buffers
    private positionBuffer!: StorageBufferAttribute;
    private velocityBuffer!: StorageBufferAttribute;
    private phaseBuffer!: StorageBufferAttribute;

    // Uniforms
    private deltaTime = uniform(0);
    private cameraPosition = uniform(new THREE.Vector3());
    private gustOffset = uniform(0);
    private gustStrength = uniform(0.5);
    private rotationSpeed = uniform(5.0);
    private seed = uniform(0);

    private spawnXRange = uniform(80);
    private spawnYRange = uniform(20);
    private spawnZRange = uniform(80);
    private spawnVelXMin = uniform(5);
    private spawnVelXMax = uniform(10);
    private spawnVelYRange = uniform(2);
    private spawnVelZRange = uniform(3);

    private spawnCompute!: ComputeNode;
    private updateCompute!: ComputeNode;

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
        this.cameraPosition.value.copy(opts.cameraPos);
        this.spawnXRange.value = opts.xRange;
        this.spawnYRange.value = opts.yRange;
        this.spawnZRange.value = opts.zRange;
        this.spawnVelXMin.value = opts.velXMin;
        this.spawnVelXMax.value = opts.velXMax;
        this.spawnVelYRange.value = opts.velYRange;
        this.spawnVelZRange.value = opts.velZRange;
        this.seed.value = this.seed.value + 0.001;

        this.renderer.computeAsync(this.spawnCompute);
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
        this.positionBuffer = new StorageBufferAttribute(positions, 3);

        const velocities = new Float32Array(this.maxParticles * 3);
        this.velocityBuffer = new StorageBufferAttribute(velocities, 3);

        const phases = new Float32Array(this.maxParticles);
        this.phaseBuffer = new StorageBufferAttribute(phases, 1);
    }

    private createCompute(): void {
        const positionStorage = storage(this.positionBuffer, 'vec3', this.maxParticles);
        const velocityStorage = storage(this.velocityBuffer, 'vec3', this.maxParticles);
        const phaseStorage = storage(this.phaseBuffer, 'float', this.maxParticles);

        const rand01 = (n: Node | number) => fract(sin(n).mul(43758.5453123));

        this.spawnCompute = Fn(() => {
            const index = instanceIndex;
            const base = float(index).add(this.seed.mul(1000.0));

            const r1 = rand01(base.add(11.11));
            const r2 = rand01(base.add(22.22));
            const r3 = rand01(base.add(33.33));
            const r4 = rand01(base.add(44.44));
            const r5 = rand01(base.add(55.55));
            const r6 = rand01(base.add(66.66));

            const x = this.cameraPosition.x.add(r1.sub(0.5).mul(this.spawnXRange));
            const y = r2.mul(this.spawnYRange);
            const z = this.cameraPosition.z.add(r3.sub(0.5).mul(this.spawnZRange));

            const vx = this.spawnVelXMin.add(r4.mul(this.spawnVelXMax.sub(this.spawnVelXMin)));
            const vy = r5.sub(0.5).mul(this.spawnVelYRange);
            const vz = r6.sub(0.5).mul(this.spawnVelZRange);

            const phase = r6.mul(Math.PI * 2);

            positionStorage.element(index).assign(vec3(x, y, z));
            velocityStorage.element(index).assign(vec3(vx, vy, vz));
            phaseStorage.element(index).assign(phase);
        })().compute(this.maxParticles);

        this.updateCompute = Fn(() => {
            const index = instanceIndex;
            const pos = positionStorage.element(index);
            const vel = velocityStorage.element(index);
            const phase = phaseStorage.element(index);

            const base = float(index).add(this.seed.mul(1000.0));
            const gustMultiplier = float(1.0).add(sin(this.gustOffset).mul(this.gustStrength));

            // Update position.
            let nextPos: Node = pos.add(vel.mul(gustMultiplier).mul(this.deltaTime));

            // Advance phase (used for vertical swirl).
            let nextPhase: Node = phase.add(this.rotationSpeed.mul(this.deltaTime));
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
            let nextVel: Node = vel;
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
    }
}
