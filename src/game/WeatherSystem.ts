/**
 * WeatherSystem - 天气系统
 * 支持晴天、雨天、大风、沙尘暴等天气效果
 */
import * as THREE from 'three';
import { WeatherConfig, WeatherType } from './GameConfig';
import { SoundManager } from './SoundManager';

// 天气粒子实例
interface WeatherParticle {
    mesh: THREE.Mesh | THREE.Points;
    velocity: THREE.Vector3;
    lifetime: number;
}

export class WeatherSystem {
    private scene: THREE.Scene;
    private camera: THREE.Camera;
    
    // 当前天气状态
    private currentWeather: WeatherType = 'sunny';
    private targetWeather: WeatherType = 'sunny';
    private transitionProgress: number = 1.0;  // 1.0 = 完全过渡完成
    
    // 天气自动切换
    private weatherTimer: number = 0;
    private nextWeatherChange: number = 0;
    
    // 光照引用
    private ambientLight: THREE.AmbientLight | null = null;
    private sunLight: THREE.DirectionalLight | null = null;
    
    // 粒子系统
    private rainSystem: THREE.Points | null = null;
    private sandSystem: THREE.Points | null = null;
    private debrisSystem: THREE.Points | null = null;
    
    // 粒子数据
    private rainPositions: Float32Array | null = null;
    private rainVelocities: Float32Array | null = null;
    private sandPositions: Float32Array | null = null;
    private sandVelocities: Float32Array | null = null;
    private debrisPositions: Float32Array | null = null;
    private debrisVelocities: Float32Array | null = null;
    private debrisRotations: Float32Array | null = null;
    
    // 风向
    private windDirection: THREE.Vector3 = new THREE.Vector3(1, 0, 0);
    private windStrength: number = 0;
    private gustOffset: number = 0;
    
    // 天气变化回调
    private onWeatherChange: ((weather: WeatherType) => void) | null = null;

    constructor(scene: THREE.Scene, camera: THREE.Camera) {
        this.scene = scene;
        this.camera = camera;
        
        this.initParticleSystems();
        this.scheduleNextWeatherChange();
    }
    
    /**
     * 设置光照引用
     */
    public setLights(ambient: THREE.AmbientLight, sun: THREE.DirectionalLight) {
        this.ambientLight = ambient;
        this.sunLight = sun;
    }
    
    /**
     * 设置天气变化回调
     */
    public setWeatherChangeCallback(callback: (weather: WeatherType) => void) {
        this.onWeatherChange = callback;
    }
    
    /**
     * 初始化粒子系统
     */
    private initParticleSystems() {
        this.initRainSystem();
        this.initSandSystem();
        this.initDebrisSystem();
    }
    
    /**
     * 初始化雨滴系统
     */
    private initRainSystem() {
        const config = WeatherConfig.rainy;
        const count = config.particleDensity;
        
        const geometry = new THREE.BufferGeometry();
        this.rainPositions = new Float32Array(count * 3);
        this.rainVelocities = new Float32Array(count * 3);
        
        const area = config.rain.area;
        
        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            // 随机位置
            this.rainPositions[i3] = (Math.random() - 0.5) * area.x;
            this.rainPositions[i3 + 1] = Math.random() * area.y;
            this.rainPositions[i3 + 2] = (Math.random() - 0.5) * area.z;
            
            // 下落速度
            const speed = config.rain.speed.min + Math.random() * (config.rain.speed.max - config.rain.speed.min);
            this.rainVelocities[i3] = 0;
            this.rainVelocities[i3 + 1] = -speed;
            this.rainVelocities[i3 + 2] = 0;
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
        
        // 雨滴材质 - 使用拉长的点
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
        this.rainSystem.raycast = () => {}; // 禁用射线检测
        this.scene.add(this.rainSystem);
    }
    
    /**
     * 初始化沙尘系统
     */
    private initSandSystem() {
        const config = WeatherConfig.sandstorm;
        const count = config.particleDensity;
        
        const geometry = new THREE.BufferGeometry();
        this.sandPositions = new Float32Array(count * 3);
        this.sandVelocities = new Float32Array(count * 3);
        
        const area = config.sand.area;
        
        for (let i = 0; i < count; i++) {
            const i3 = i * 3;
            this.sandPositions[i3] = (Math.random() - 0.5) * area.x;
            this.sandPositions[i3 + 1] = Math.random() * area.y;
            this.sandPositions[i3 + 2] = (Math.random() - 0.5) * area.z;
            
            // 随机速度
            const speed = config.sand.speed.min + Math.random() * (config.sand.speed.max - config.sand.speed.min);
            this.sandVelocities[i3] = speed;
            this.sandVelocities[i3 + 1] = (Math.random() - 0.5) * 2;
            this.sandVelocities[i3 + 2] = (Math.random() - 0.5) * speed * 0.3;
        }
        
        geometry.setAttribute('position', new THREE.BufferAttribute(this.sandPositions, 3));
        
        // 沙粒材质
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
        this.sandSystem.raycast = () => {}; // 禁用射线检测
        this.scene.add(this.sandSystem);
    }
    
    /**
     * 初始化碎片系统 (大风天气)
     */
    private initDebrisSystem() {
        const config = WeatherConfig.windy;
        const count = config.particleDensity;
        
        const geometry = new THREE.BufferGeometry();
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
        
        // 碎片材质
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
        this.debrisSystem.raycast = () => {}; // 禁用射线检测
        this.scene.add(this.debrisSystem);
    }
    
    /**
     * 设置天气
     */
    public setWeather(weather: WeatherType, immediate: boolean = false) {
        // 如果目标天气相同，忽略
        if (weather === this.targetWeather) return;
        
        this.targetWeather = weather;
        
        if (immediate) {
            this.currentWeather = weather;
            this.transitionProgress = 1.0;
            this.applyWeatherSettings(weather, 1.0);
        } else {
            this.transitionProgress = 0.0;
        }
        
        // 更新粒子系统可见性
        this.updateParticleVisibility();
        
        // 播放天气音效
        SoundManager.getInstance().playWeatherSound(weather);
        
        // 调度下次天气变化
        this.scheduleNextWeatherChange();
        
        // 触发回调
        if (this.onWeatherChange) {
            this.onWeatherChange(weather);
        }
    }
    
    /**
     * 获取当前天气
     */
    public getCurrentWeather(): WeatherType {
        return this.currentWeather;
    }
    
    /**
     * 获取当前风力强度
     */
    public getWindStrength(): number {
        return this.windStrength;
    }
    
    /**
     * 获取当前风向
     */
    public getWindDirection(): THREE.Vector3 {
        return this.windDirection.clone();
    }
    
    /**
     * 更新粒子系统可见性
     */
    private updateParticleVisibility() {
        if (this.rainSystem) {
            this.rainSystem.visible = this.targetWeather === 'rainy';
        }
        if (this.sandSystem) {
            this.sandSystem.visible = this.targetWeather === 'sandstorm';
        }
        if (this.debrisSystem) {
            this.debrisSystem.visible = this.targetWeather === 'windy';
        }
    }
    
    /**
     * 调度下次天气变化
     */
    private scheduleNextWeatherChange() {
        if (!WeatherConfig.autoChange.enabled) return;
        
        const min = WeatherConfig.autoChange.minDuration;
        const max = WeatherConfig.autoChange.maxDuration;
        this.nextWeatherChange = min + Math.random() * (max - min);
        this.weatherTimer = 0;
    }
    
    /**
     * 随机选择下一个天气
     */
    private getRandomWeather(): WeatherType {
        const weathers: WeatherType[] = ['sunny', 'rainy', 'windy', 'sandstorm'];
        // 避免连续相同天气
        const available = weathers.filter(w => w !== this.currentWeather);
        return available[Math.floor(Math.random() * available.length)];
    }
    
    /**
     * 应用天气设置
     */
    private applyWeatherSettings(weather: WeatherType, progress: number) {
        const config = WeatherConfig[weather];
        
        // 更新天空颜色
        if (this.scene.background instanceof THREE.Color) {
            const targetColor = new THREE.Color(config.skyColor);
            (this.scene.background as THREE.Color).lerp(targetColor, progress * 0.1);
        }
        
        // 更新雾气
        if (this.scene.fog instanceof THREE.Fog) {
            const targetFogColor = new THREE.Color(config.fogColor);
            this.scene.fog.color.lerp(targetFogColor, progress * 0.1);
            this.scene.fog.near = THREE.MathUtils.lerp(this.scene.fog.near, config.fogNear, progress * 0.1);
            this.scene.fog.far = THREE.MathUtils.lerp(this.scene.fog.far, config.fogFar, progress * 0.1);
        }
        
        // 更新光照
        if (this.ambientLight) {
            this.ambientLight.intensity = THREE.MathUtils.lerp(
                this.ambientLight.intensity, 
                config.ambientIntensity, 
                progress * 0.1
            );
        }
        
        if (this.sunLight) {
            this.sunLight.intensity = THREE.MathUtils.lerp(
                this.sunLight.intensity, 
                config.sunIntensity, 
                progress * 0.1
            );
            const targetSunColor = new THREE.Color(config.sunColor);
            this.sunLight.color.lerp(targetSunColor, progress * 0.1);
        }
        
        // 更新风力
        this.windStrength = THREE.MathUtils.lerp(this.windStrength, config.windStrength, progress * 0.1);
        
        // 更新风向 (大风和沙尘暴)
        if (weather === 'windy') {
            const windConfig = WeatherConfig.windy.wind;
            this.windDirection.set(
                windConfig.direction.x,
                windConfig.direction.y,
                windConfig.direction.z
            ).normalize();
        } else if (weather === 'sandstorm') {
            // 沙尘暴风向 - 主要是水平方向
            this.windDirection.set(1, 0.05, 0.2).normalize();
        }
    }
    
    /**
     * 更新雨滴
     */
    private updateRain(delta: number) {
        if (!this.rainSystem || !this.rainPositions || !this.rainVelocities) return;
        if (!this.rainSystem.visible) return;
        
        const config = WeatherConfig.rainy;
        const area = config.rain.area;
        const camPos = this.camera.position;
        
        for (let i = 0; i < config.particleDensity; i++) {
            const i3 = i * 3;
            
            // 更新位置
            this.rainPositions[i3] += (this.rainVelocities[i3] + this.windStrength * 2) * delta;
            this.rainPositions[i3 + 1] += this.rainVelocities[i3 + 1] * delta;
            this.rainPositions[i3 + 2] += this.rainVelocities[i3 + 2] * delta;
            
            // 重置到顶部 (相对于相机)
            if (this.rainPositions[i3 + 1] < camPos.y - 5) {
                this.rainPositions[i3] = camPos.x + (Math.random() - 0.5) * area.x;
                this.rainPositions[i3 + 1] = camPos.y + area.y * 0.5;
                this.rainPositions[i3 + 2] = camPos.z + (Math.random() - 0.5) * area.z;
            }
            
            // 保持在相机附近
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
    
    /**
     * 更新沙尘
     */
    private updateSand(delta: number) {
        if (!this.sandSystem || !this.sandPositions || !this.sandVelocities) return;
        if (!this.sandSystem.visible) return;
        
        const config = WeatherConfig.sandstorm;
        const area = config.sand.area;
        const camPos = this.camera.position;
        
        // 阵风效果
        this.gustOffset += delta * 2;
        const gustMultiplier = 1 + Math.sin(this.gustOffset) * 0.3;
        
        for (let i = 0; i < config.particleDensity; i++) {
            const i3 = i * 3;
            
            // 更新位置 - 主要水平移动
            this.sandPositions[i3] += this.sandVelocities[i3] * gustMultiplier * delta;
            this.sandPositions[i3 + 1] += this.sandVelocities[i3 + 1] * delta;
            this.sandPositions[i3 + 2] += this.sandVelocities[i3 + 2] * delta;
            
            // 上下波动
            this.sandPositions[i3 + 1] += Math.sin(this.gustOffset + i * 0.1) * 0.5 * delta;
            
            // 循环回到起点 (相对于相机)
            const dx = this.sandPositions[i3] - camPos.x;
            if (dx > area.x * 0.5) {
                this.sandPositions[i3] = camPos.x - area.x * 0.5;
                this.sandPositions[i3 + 1] = camPos.y + Math.random() * area.y - area.y * 0.3;
                this.sandPositions[i3 + 2] = camPos.z + (Math.random() - 0.5) * area.z;
            }
            
            // 保持在相机附近
            const dz = this.sandPositions[i3 + 2] - camPos.z;
            if (Math.abs(dz) > area.z * 0.5) {
                this.sandPositions[i3 + 2] = camPos.z + (Math.random() - 0.5) * area.z;
            }
            
            // 高度限制
            if (this.sandPositions[i3 + 1] < 0) {
                this.sandPositions[i3 + 1] = Math.random() * area.y;
            }
            if (this.sandPositions[i3 + 1] > area.y) {
                this.sandPositions[i3 + 1] = 0;
            }
        }
        
        (this.sandSystem.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    
    /**
     * 更新碎片 (大风)
     */
    private updateDebris(delta: number) {
        if (!this.debrisSystem || !this.debrisPositions || !this.debrisVelocities || !this.debrisRotations) return;
        if (!this.debrisSystem.visible) return;
        
        const config = WeatherConfig.windy;
        const camPos = this.camera.position;
        
        // 阵风效果
        this.gustOffset += delta * config.wind.gustFrequency;
        const gustMultiplier = 1 + Math.sin(this.gustOffset) * config.wind.gustStrength;
        
        for (let i = 0; i < config.particleDensity; i++) {
            const i3 = i * 3;
            
            // 更新位置
            this.debrisPositions[i3] += this.debrisVelocities[i3] * gustMultiplier * delta;
            this.debrisPositions[i3 + 1] += this.debrisVelocities[i3 + 1] * delta;
            this.debrisPositions[i3 + 2] += this.debrisVelocities[i3 + 2] * delta;
            
            // 螺旋上升下降
            this.debrisRotations[i] += config.debris.rotationSpeed * delta;
            this.debrisPositions[i3 + 1] += Math.sin(this.debrisRotations[i]) * 2 * delta;
            
            // 循环
            const dx = this.debrisPositions[i3] - camPos.x;
            if (dx > 40) {
                this.debrisPositions[i3] = camPos.x - 40;
                this.debrisPositions[i3 + 1] = Math.random() * 20;
                this.debrisPositions[i3 + 2] = camPos.z + (Math.random() - 0.5) * 80;
            }
            
            // 高度限制
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
    
    /**
     * 更新天气系统
     */
    public update(delta: number) {
        // 天气过渡
        if (this.transitionProgress < 1.0) {
            this.transitionProgress += delta / WeatherConfig.transitionDuration;
            if (this.transitionProgress >= 1.0) {
                this.transitionProgress = 1.0;
                this.currentWeather = this.targetWeather;
            }
        }
        
        // 应用当前天气设置
        this.applyWeatherSettings(this.targetWeather, this.transitionProgress);
        
        // 自动天气切换
        if (WeatherConfig.autoChange.enabled) {
            this.weatherTimer += delta;
            if (this.weatherTimer >= this.nextWeatherChange) {
                const nextWeather = this.getRandomWeather();
                this.setWeather(nextWeather);
            }
        }
        
        // 更新粒子系统
        this.updateRain(delta);
        this.updateSand(delta);
        this.updateDebris(delta);
    }
    
    /**
     * 获取移动速度修正
     */
    public getMovementModifier(): number {
        if (this.currentWeather === 'sandstorm') {
            return WeatherConfig.sandstorm.visibility.movementPenalty;
        }
        return 1.0;
    }
    
    /**
     * 切换到下一个天气 (用于调试/测试)
     */
    public cycleWeather() {
        const weathers: WeatherType[] = ['sunny', 'rainy', 'windy', 'sandstorm'];
        // 使用 targetWeather 而不是 currentWeather，以支持快速连续切换
        const currentIndex = weathers.indexOf(this.targetWeather);
        const nextIndex = (currentIndex + 1) % weathers.length;
        this.setWeather(weathers[nextIndex]);
    }
    
    /**
     * 清理资源
     */
    public dispose() {
        if (this.rainSystem) {
            this.rainSystem.geometry.dispose();
            (this.rainSystem.material as THREE.Material).dispose();
            this.scene.remove(this.rainSystem);
        }
        
        if (this.sandSystem) {
            this.sandSystem.geometry.dispose();
            (this.sandSystem.material as THREE.Material).dispose();
            this.scene.remove(this.sandSystem);
        }
        
        if (this.debrisSystem) {
            this.debrisSystem.geometry.dispose();
            (this.debrisSystem.material as THREE.Material).dispose();
            this.scene.remove(this.debrisSystem);
        }
    }
}
