import * as THREE from 'three';
import { WeatherConfig, WeatherType } from '../core/GameConfig';
import type { WebGPURenderer } from 'three/webgpu';
import { PointsNodeMaterial } from 'three/webgpu';
import { float, uniform, vec3 } from 'three/tsl';
import {
    GPUWeatherRainParticles,
    GPUWeatherSandParticles,
    GPUWeatherDebrisParticles,
} from '../shaders/GPUWeatherParticles';
import { getUserData } from '../types/GameUserData';

export class WeatherParticles {
    private readonly scene: THREE.Scene;
    private readonly camera: THREE.Camera;
    private readonly renderer: WebGPURenderer;

    private rainSystem: THREE.Points | null = null;
    private sandSystem: THREE.Points | null = null;
    private debrisSystem: THREE.Points | null = null;

    private gpuRain: GPUWeatherRainParticles | null = null;
    private gpuSand: GPUWeatherSandParticles | null = null;
    private gpuDebris: GPUWeatherDebrisParticles | null = null;

    private gustOffset: number = 0;

    constructor(scene: THREE.Scene, camera: THREE.Camera, renderer: WebGPURenderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;

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

        this.gpuRain = new GPUWeatherRainParticles(this.renderer, count);
        this.gpuRain.initSpawn({
            area,
            cameraPos: this.camera.position,
            speedMin: config.rain.speed.min,
            speedMax: config.rain.speed.max,
        });
        geometry.setAttribute('position', this.gpuRain.getPositionAttribute());

        const material = new PointsNodeMaterial();
        material.transparent = true;
        material.blending = THREE.AdditiveBlending;
        material.depthWrite = false;
        material.sizeAttenuation = true;
        material.colorNode = uniform(new THREE.Color(config.rain.color));
        material.sizeNode = float(config.rain.size.height);
        material.opacityNode = float(config.rain.opacity);

        this.rainSystem = new THREE.Points(geometry, material);
        this.rainSystem.visible = false;
        this.rainSystem.frustumCulled = false;
        getUserData(this.rainSystem).isWeatherParticle = true;
        this.rainSystem.raycast = () => {};
        this.scene.add(this.rainSystem);
    }

    private initSandSystem() {
        const config = WeatherConfig.sandstorm;
        const count = config.particleDensity;

        const geometry = new THREE.BufferGeometry();
        const area = config.sand.area;

        this.gpuSand = new GPUWeatherSandParticles(this.renderer, count);
        this.gpuSand.initSpawn({
            area,
            cameraPos: this.camera.position,
            speedMin: config.sand.speed.min,
            speedMax: config.sand.speed.max,
        });
        geometry.setAttribute('position', this.gpuSand.getPositionAttribute());

        const material = new PointsNodeMaterial();
        material.transparent = true;
        material.blending = THREE.NormalBlending;
        material.depthWrite = false;
        material.sizeAttenuation = true;
        material.colorNode = uniform(new THREE.Color(config.sand.color));
        material.sizeNode = float(config.sand.size.max);
        material.opacityNode = float(config.sand.opacity);

        this.sandSystem = new THREE.Points(geometry, material);
        this.sandSystem.visible = false;
        this.sandSystem.frustumCulled = false;
        getUserData(this.sandSystem).isWeatherParticle = true;
        this.sandSystem.raycast = () => {};
        this.scene.add(this.sandSystem);
    }

    private initDebrisSystem() {
        const config = WeatherConfig.windy;
        const count = config.particleDensity;

        const geometry = new THREE.BufferGeometry();

        this.gpuDebris = new GPUWeatherDebrisParticles(this.renderer, count);
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

        const material = new PointsNodeMaterial();
        material.transparent = true;
        material.blending = THREE.NormalBlending;
        material.depthWrite = false;
        material.sizeAttenuation = true;
        material.colorNode = uniform(new THREE.Color(config.debris.color));
        material.sizeNode = float(config.debris.size.max);
        material.opacityNode = float(0.8);

        this.debrisSystem = new THREE.Points(geometry, material);
        this.debrisSystem.visible = false;
        this.debrisSystem.frustumCulled = false;
        getUserData(this.debrisSystem).isWeatherParticle = true;
        this.debrisSystem.raycast = () => {};
        this.scene.add(this.debrisSystem);
    }

    private updateRain(delta: number, windDirection: THREE.Vector3, windStrength: number) {
        if (!this.rainSystem) return;
        if (!this.rainSystem.visible) return;

        if (!this.gpuRain) return;

        const config = WeatherConfig.rainy;
        const area = config.rain.area;
        const camPos = this.camera.position;

        this.gpuRain.update({
            delta,
            cameraPos: camPos,
            windDirection,
            windStrength,
            area,
        });
    }

    private updateSand(delta: number) {
        if (!this.sandSystem) return;
        if (!this.sandSystem.visible) return;

        if (!this.gpuSand) return;

        const config = WeatherConfig.sandstorm;
        const area = config.sand.area;
        const camPos = this.camera.position;

        this.gustOffset += delta * 2;

        this.gpuSand.update({
            delta,
            cameraPos: camPos,
            area,
            gustOffset: this.gustOffset,
        });
    }

    private updateDebris(delta: number) {
        if (!this.debrisSystem) return;
        if (!this.debrisSystem.visible) return;

        if (!this.gpuDebris) return;

        const config = WeatherConfig.windy;
        const camPos = this.camera.position;

        this.gustOffset += delta * config.wind.gustFrequency;

        this.gpuDebris.update({
            delta,
            cameraPos: camPos,
            gustOffset: this.gustOffset,
            gustStrength: config.wind.gustStrength,
            rotationSpeed: config.debris.rotationSpeed,
        });
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
