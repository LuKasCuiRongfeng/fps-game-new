/**
 * WeatherSystem - 天气系统
 * 支持晴天、雨天、大风、沙尘暴等天气效果
 */
import * as THREE from 'three';
import { WeatherConfig, WeatherType } from '../core/GameConfig';
// @ts-ignore - WebGPU types not fully available
import type { WebGPURenderer } from 'three/webgpu';
import type { FrameContext, System } from '../core/engine/System';
import { WeatherParticles } from './WeatherParticles';
import { WeatherStateMachine } from './WeatherStateMachine';
import { WeatherSceneApplier } from './WeatherSceneApplier';
import { WindController } from './WindController';

export class WeatherSystem implements System {
    public readonly name = 'weather';

    private scene: THREE.Scene;
    private camera: THREE.Camera;
    private renderer: WebGPURenderer | null;
    
    // Weather state machine (transition + auto-change)
    private weatherState: WeatherStateMachine;
    
    // 光照引用
    private ambientLight: THREE.AmbientLight | null = null;
    private sunLight: THREE.DirectionalLight | null = null;

    // Applies weather config to scene (fog/sky/lights)
    private readonly sceneApplier = new WeatherSceneApplier();

    // Wind is managed separately (direction/strength + shader uniform sync)
    private readonly wind = new WindController();
    
    // 粒子系统（雨/沙尘/碎片），内部自适应 GPU compute 与 CPU fallback
    private particles: WeatherParticles;
    
    // 天气变化回调
    private onWeatherChange: ((weather: WeatherType) => void) | null = null;

    constructor(scene: THREE.Scene, camera: THREE.Camera, renderer?: WebGPURenderer) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer ?? null;

        this.particles = new WeatherParticles(scene, camera, renderer);

        this.weatherState = new WeatherStateMachine({
            initialWeather: 'sunny',
            transitionDuration: WeatherConfig.transitionDuration,
            autoChange: WeatherConfig.autoChange,
            weathers: ['sunny', 'rainy', 'windy', 'sandstorm'],
        });
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
     * 设置天气
     */
    public setWeather(weather: WeatherType, immediate: boolean = false) {
        const changed = this.weatherState.setWeather(weather, immediate);
        if (!changed) return;

        if (immediate) {
            this.sceneApplier.apply({
                scene: this.scene,
                ambientLight: this.ambientLight,
                sunLight: this.sunLight,
                weather,
                progress: 1.0,
            });

            this.wind.apply({ weather, progress: 1.0 });
        }
        
        // 更新粒子系统可见性
        this.updateParticleVisibility();
        
        // 触发回调
        if (this.onWeatherChange) {
            this.onWeatherChange(weather);
        }
    }
    
    /**
     * 获取当前天气
     */
    public getCurrentWeather(): WeatherType {
        return this.weatherState.getSnapshot().currentWeather;
    }
    
    /**
     * 获取当前风力强度
     */
    public getWindStrength(): number {
        return this.wind.strength;
    }
    
    /**
     * 获取当前风向
     */
    public getWindDirection(): THREE.Vector3 {
        return this.wind.direction.clone();
    }
    
    /**
     * 更新粒子系统可见性
     */
    private updateParticleVisibility() {
        this.particles.setTargetWeather(this.weatherState.getSnapshot().targetWeather);
    }
    
    /**
     * 应用天气设置
     */
    // Particle simulation lives in WeatherParticles.
    
    /**
     * 更新天气系统
     */
    public update(frame: FrameContext) {
        const delta = frame.delta;
        const { snapshot, autoNextWeather } = this.weatherState.update(delta);

        // Apply weather config to scene (we lerp toward target)
        this.sceneApplier.apply({
            scene: this.scene,
            ambientLight: this.ambientLight,
            sunLight: this.sunLight,
            weather: snapshot.targetWeather,
            progress: snapshot.transitionProgress,
        });

        this.wind.apply({
            weather: snapshot.targetWeather,
            progress: snapshot.transitionProgress,
        });

        // 自动天气切换
        if (autoNextWeather) {
            this.setWeather(autoNextWeather);
        }
        
        // 更新粒子系统
        this.particles.update(delta, {
            windDirection: this.wind.direction,
            windStrength: this.wind.strength,
        });
    }
    
    /**
     * 获取移动速度修正
     */
    public getMovementModifier(): number {
        if (this.weatherState.getSnapshot().currentWeather === 'sandstorm') {
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
        const currentIndex = weathers.indexOf(this.weatherState.getSnapshot().targetWeather);
        const nextIndex = (currentIndex + 1) % weathers.length;
        this.setWeather(weathers[nextIndex]);
    }
    
    /**
     * 清理资源
     */
    public dispose() {
        this.particles.dispose();
    }
}
