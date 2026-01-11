import * as THREE from 'three';
import { WeatherConfig, WeatherType } from '../core/GameConfig';
// @ts-ignore - WebGPU types not fully available
import type { WebGPURenderer } from 'three/webgpu';
import {
    GPUWeatherRainParticles,
    GPUWeatherSandParticles,
    GPUWeatherDebrisParticles,
} from '../shaders/GPUWeatherParticles';

export class WeatherParticles {
    private readonly scene: THREE.Scene;
    private readonly camera: THREE.Camera;
    private readonly renderer: WebGPURenderer | null;

    private rainSystem: THREE.Points | null = null;
    private sandSystem: THREE.Points | null = null;
    private debrisSystem: THREE.Points | null = null;

    private rainPositions: Float32Array | null = null;
    private rainVelocities: Float32Array | null = null;
    private sandPositions: Float32Array | null = null;
    private sandVelocities: Float32Array | null = null;
    private debrisPositions: Float32Array | null = null;
    private debrisVelocities: Float32Array | null = null;
    private debrisRotations: Float32Array | null = null;

    private gpuRain: GPUWeatherRainParticles | null = null;
    private gpuSand: GPUWeatherSandParticles | null = null;
    private gpuDebris: GPUWeatherDebrisParticles | null = null;

    private gustOffset: number = 0;

    constructor(scene: THREE.Scene, camera: THREE.Camera, renderer?: WebGPURenderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer ?? null;

        this.initParticleSystems();
    }

    public setTargetWeather(targetWeather: WeatherType) {
        if (this.rainSystem) this.rainSystem.visible = targetWeather === 'rainy';
        if (this.sandSystem) this.sandSystem.visible = targetWeather === 'sandstorm';
        if (this.debrisSystem) this.debrisSystem.visible = targetWeather === 'windy';
    }

    public update(delta: number, opts: { windDirection: THREE.Vector3; windStrength: number }) {
        this.updateRain(delta, opts.windDirection, opts.windStrength);
        this.updateSand(delta);
        this.updateDebris(delta);
    }

    private initParticleSystems() {
        this.initRainSystem();
        this.initSandSystem();
        this.initDebrisSystem();
    }

    private initRainSystem() {
        const config = WeatherConfig.rainy;
        const count = config.particleDensity;

        const geometry = new THREE.BufferGeometry();
        const area = config.rain.area;

        const canGpuCompute = Boolean(this.renderer && (this.renderer as any).computeAsync);
        if (canGpuCompute) {
            this.gpuRain = new GPUWeatherRainParticles(this.renderer!, count);
            this.gpuRain.initSpawn({
                area,
                cameraPos: this.camera.position,
                speedMin: config.rain.speed.min,
                speedMax: config.rain.speed.max,
            });
            geometry.setAttribute('position', this.gpuRain.getPositionAttribute());
        } else {
            this.rainPositions = new Float32Array(count * 3);
            this.rainVelocities = new Float32Array(count * 3);

            for (let i = 0; i < count; i++) {
                const i3 = i * 3;
                this.rainPositions[i3] = (Math.random() - 0.5) * area.x;
                this.rainPositions[i3 + 1] = Math.random() * area.y;
                this.rainPositions[i3 + 2] = (Math.random() - 0.5) * area.z;

                const speed =
                    config.rain.speed.min +
                    Math.random() * (config.rain.speed.max - config.rain.speed.min);
                this.rainVelocities[i3] = 0;
                this.rainVelocities[i3 + 1] = -speed;
                this.rainVelocities[i3 + 2] = 0;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
        }

        const material = new THREE.PointsMaterial({
            color: config.rain.color,
            size: config.rain.size.height,
            transparent: true,
            opacity: config.rain.opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });

        this.rainSystem = new THREE.Points(geometry, material);
        this.rainSystem.visible = false;
        this.rainSystem.frustumCulled = false;
        this.rainSystem.userData.isWeatherParticle = true;
        this.rainSystem.raycast = () => {};
        this.scene.add(this.rainSystem);
    }

    private initSandSystem() {
        const config = WeatherConfig.sandstorm;
        const count = config.particleDensity;

        const geometry = new THREE.BufferGeometry();
        const area = config.sand.area;

        const canGpuCompute = Boolean(this.renderer && (this.renderer as any).computeAsync);
        if (canGpuCompute) {
            this.gpuSand = new GPUWeatherSandParticles(this.renderer!, count);
            this.gpuSand.initSpawn({
                area,
                cameraPos: this.camera.position,
                speedMin: config.sand.speed.min,
                speedMax: config.sand.speed.max,
            });
            geometry.setAttribute('position', this.gpuSand.getPositionAttribute());
        } else {
            this.sandPositions = new Float32Array(count * 3);
            this.sandVelocities = new Float32Array(count * 3);

            for (let i = 0; i < count; i++) {
                const i3 = i * 3;
                this.sandPositions[i3] = (Math.random() - 0.5) * area.x;
                this.sandPositions[i3 + 1] = Math.random() * area.y;
                this.sandPositions[i3 + 2] = (Math.random() - 0.5) * area.z;

                const speed =
                    config.sand.speed.min +
                    Math.random() * (config.sand.speed.max - config.sand.speed.min);
                this.sandVelocities[i3] = speed;
                this.sandVelocities[i3 + 1] = (Math.random() - 0.5) * 2;
                this.sandVelocities[i3 + 2] = (Math.random() - 0.5) * speed * 0.3;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(this.sandPositions, 3));
        }

        const material = new THREE.PointsMaterial({
            color: config.sand.color,
            size: config.sand.size.max,
            transparent: true,
            opacity: config.sand.opacity,
            blending: THREE.NormalBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });

        this.sandSystem = new THREE.Points(geometry, material);
        this.sandSystem.visible = false;
        this.sandSystem.frustumCulled = false;
        this.sandSystem.userData.isWeatherParticle = true;
        this.sandSystem.raycast = () => {};
        this.scene.add(this.sandSystem);
    }

    private initDebrisSystem() {
        const config = WeatherConfig.windy;
        const count = config.particleDensity;

        const geometry = new THREE.BufferGeometry();

        const canGpuCompute = Boolean(this.renderer && (this.renderer as any).computeAsync);
        if (canGpuCompute) {
            this.gpuDebris = new GPUWeatherDebrisParticles(this.renderer!, count);
            this.gpuDebris.initSpawn({
                cameraPos: this.camera.position,
                xRange: 80,
                yRange: 20,
                zRange: 80,
                velXMin: 5,
                velXMax: 10,
                velYRange: 2,
                velZRange: 3,
            });
            geometry.setAttribute('position', this.gpuDebris.getPositionAttribute());
        } else {
            this.debrisPositions = new Float32Array(count * 3);
            this.debrisVelocities = new Float32Array(count * 3);
            this.debrisRotations = new Float32Array(count);

            for (let i = 0; i < count; i++) {
                const i3 = i * 3;
                this.debrisPositions[i3] = (Math.random() - 0.5) * 80;
                this.debrisPositions[i3 + 1] = Math.random() * 20;
                this.debrisPositions[i3 + 2] = (Math.random() - 0.5) * 80;

                this.debrisVelocities[i3] = 5 + Math.random() * 5;
                this.debrisVelocities[i3 + 1] = (Math.random() - 0.5) * 2;
                this.debrisVelocities[i3 + 2] = (Math.random() - 0.5) * 3;

                this.debrisRotations[i] = Math.random() * Math.PI * 2;
            }

            geometry.setAttribute('position', new THREE.BufferAttribute(this.debrisPositions, 3));
        }

        const material = new THREE.PointsMaterial({
            color: config.debris.color,
            size: config.debris.size.max,
            transparent: true,
            opacity: 0.8,
            blending: THREE.NormalBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });

        this.debrisSystem = new THREE.Points(geometry, material);
        this.debrisSystem.visible = false;
        this.debrisSystem.frustumCulled = false;
        this.debrisSystem.userData.isWeatherParticle = true;
        this.debrisSystem.raycast = () => {};
        this.scene.add(this.debrisSystem);
    }

    private updateRain(delta: number, windDirection: THREE.Vector3, windStrength: number) {
        if (!this.rainSystem) return;
        if (!this.rainSystem.visible) return;

        const config = WeatherConfig.rainy;
        const area = config.rain.area;
        const camPos = this.camera.position;

        if (this.gpuRain) {
            this.gpuRain.update({
                delta,
                cameraPos: camPos,
                windDirection,
                windStrength,
                area,
            });
            return;
        }

        if (!this.rainPositions || !this.rainVelocities) return;

        for (let i = 0; i < config.particleDensity; i++) {
            const i3 = i * 3;

            this.rainPositions[i3] += (this.rainVelocities[i3] + windStrength * 2) * delta;
            this.rainPositions[i3 + 1] += this.rainVelocities[i3 + 1] * delta;
            this.rainPositions[i3 + 2] += this.rainVelocities[i3 + 2] * delta;

            if (this.rainPositions[i3 + 1] < camPos.y - 5) {
                this.rainPositions[i3] = camPos.x + (Math.random() - 0.5) * area.x;
                this.rainPositions[i3 + 1] = camPos.y + area.y * 0.5;
                this.rainPositions[i3 + 2] = camPos.z + (Math.random() - 0.5) * area.z;
            }

            const dx = this.rainPositions[i3] - camPos.x;
            const dz = this.rainPositions[i3 + 2] - camPos.z;
            if (Math.abs(dx) > area.x * 0.5) {
                this.rainPositions[i3] = camPos.x + (Math.random() - 0.5) * area.x;
            }
            if (Math.abs(dz) > area.z * 0.5) {
                this.rainPositions[i3 + 2] = camPos.z + (Math.random() - 0.5) * area.z;
            }
        }

        (this.rainSystem.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    private updateSand(delta: number) {
        if (!this.sandSystem) return;
        if (!this.sandSystem.visible) return;

        const config = WeatherConfig.sandstorm;
        const area = config.sand.area;
        const camPos = this.camera.position;

        this.gustOffset += delta * 2;
        const gustMultiplier = 1 + Math.sin(this.gustOffset) * 0.3;

        if (this.gpuSand) {
            this.gpuSand.update({
                delta,
                cameraPos: camPos,
                area,
                gustOffset: this.gustOffset,
            });
            return;
        }

        if (!this.sandPositions || !this.sandVelocities) return;

        for (let i = 0; i < config.particleDensity; i++) {
            const i3 = i * 3;

            this.sandPositions[i3] += this.sandVelocities[i3] * gustMultiplier * delta;
            this.sandPositions[i3 + 1] += this.sandVelocities[i3 + 1] * delta;
            this.sandPositions[i3 + 2] += this.sandVelocities[i3 + 2] * delta;

            this.sandPositions[i3 + 1] += Math.sin(this.gustOffset + i * 0.1) * 0.5 * delta;

            const dx = this.sandPositions[i3] - camPos.x;
            if (dx > area.x * 0.5) {
                this.sandPositions[i3] = camPos.x - area.x * 0.5;
                this.sandPositions[i3 + 1] = camPos.y + Math.random() * area.y - area.y * 0.3;
                this.sandPositions[i3 + 2] = camPos.z + (Math.random() - 0.5) * area.z;
            }

            const dz = this.sandPositions[i3 + 2] - camPos.z;
            if (Math.abs(dz) > area.z * 0.5) {
                this.sandPositions[i3 + 2] = camPos.z + (Math.random() - 0.5) * area.z;
            }

            if (this.sandPositions[i3 + 1] < 0) {
                this.sandPositions[i3 + 1] = Math.random() * area.y;
            }
            if (this.sandPositions[i3 + 1] > area.y) {
                this.sandPositions[i3 + 1] = 0;
            }
        }

        (this.sandSystem.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    private updateDebris(delta: number) {
        if (!this.debrisSystem) return;
        if (!this.debrisSystem.visible) return;

        const config = WeatherConfig.windy;
        const camPos = this.camera.position;

        this.gustOffset += delta * config.wind.gustFrequency;
        const gustMultiplier = 1 + Math.sin(this.gustOffset) * config.wind.gustStrength;

        if (this.gpuDebris) {
            this.gpuDebris.update({
                delta,
                cameraPos: camPos,
                gustOffset: this.gustOffset,
                gustStrength: config.wind.gustStrength,
                rotationSpeed: config.debris.rotationSpeed,
            });
            return;
        }

        if (!this.debrisPositions || !this.debrisVelocities || !this.debrisRotations) return;

        for (let i = 0; i < config.particleDensity; i++) {
            const i3 = i * 3;

            this.debrisPositions[i3] += this.debrisVelocities[i3] * gustMultiplier * delta;
            this.debrisPositions[i3 + 1] += this.debrisVelocities[i3 + 1] * delta;
            this.debrisPositions[i3 + 2] += this.debrisVelocities[i3 + 2] * delta;

            this.debrisRotations[i] += config.debris.rotationSpeed * delta;
            this.debrisPositions[i3 + 1] += Math.sin(this.debrisRotations[i]) * 2 * delta;

            const dx = this.debrisPositions[i3] - camPos.x;
            if (dx > 40) {
                this.debrisPositions[i3] = camPos.x - 40;
                this.debrisPositions[i3 + 1] = Math.random() * 20;
                this.debrisPositions[i3 + 2] = camPos.z + (Math.random() - 0.5) * 80;
            }

            if (this.debrisPositions[i3 + 1] < 0) {
                this.debrisPositions[i3 + 1] = 0;
                this.debrisVelocities[i3 + 1] = Math.abs(this.debrisVelocities[i3 + 1]);
            }
            if (this.debrisPositions[i3 + 1] > 25) {
                this.debrisVelocities[i3 + 1] = -Math.abs(this.debrisVelocities[i3 + 1]);
            }
        }

        (this.debrisSystem.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    public dispose() {
        if (this.rainSystem) {
            this.rainSystem.geometry.dispose();
            (this.rainSystem.material as THREE.Material).dispose();
            this.scene.remove(this.rainSystem);
        }

        if (this.gpuRain) {
            this.gpuRain.dispose();
            this.gpuRain = null;
        }

        if (this.sandSystem) {
            this.sandSystem.geometry.dispose();
            (this.sandSystem.material as THREE.Material).dispose();
            this.scene.remove(this.sandSystem);
        }

        if (this.gpuSand) {
            this.gpuSand.dispose();
            this.gpuSand = null;
        }

        if (this.debrisSystem) {
            this.debrisSystem.geometry.dispose();
            (this.debrisSystem.material as THREE.Material).dispose();
            this.scene.remove(this.debrisSystem);
        }

        if (this.gpuDebris) {
            this.gpuDebris.dispose();
            this.gpuDebris = null;
        }
    }
}
