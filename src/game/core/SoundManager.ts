import { SoundConfig } from './GameConfig';
import { invoke } from '@tauri-apps/api/core';

export class SoundManager {
    private static instance: SoundManager;
    private audioContext: AudioContext;
    private masterGain: GainNode;
    
    // 天气音效
    private weatherGain: GainNode | null = null;
    private weatherNodes: (OscillatorNode | AudioBufferSourceNode)[] = [];
    private currentWeatherSound: string | null = null;
    private weatherCleanupId: number = 0;  // 用于标识清理操作
    
    // 背景音乐系统
    private bgmGain: GainNode;
    private currentBGMState: 'none' | 'sunny' | 'rainy' | 'combat' = 'none';
    private bgmBuffers: Map<string, AudioBuffer> = new Map();
    private activeBgmSource: AudioBufferSourceNode | null = null;
    private activeBgmGain: GainNode | null = null;

    private constructor() {
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.masterGain = this.audioContext.createGain();
        this.masterGain.gain.value = SoundConfig.masterVolume;
        this.masterGain.connect(this.audioContext.destination);
        
        // 独立的 BGM 音量控制
        this.bgmGain = this.audioContext.createGain();
        this.bgmGain.gain.value = SoundConfig.bgmVolume;
        this.bgmGain.connect(this.masterGain);

        this.loadBgmAssets();
    }

    private async loadBgmAssets() {
        const loadBuffer = async (filename: string, key: string) => {
            try {
                console.log(`Loading BGM from Rust: ${filename}`);
                // Call Rust command to get raw bytes
                const data = await invoke<number[]>('load_audio_asset', { filename });
                
                // Convert number[] (Vec<u8>) to Uint8Array/ArrayBuffer
                const arrayBuffer = Uint8Array.from(data).buffer;
                
                // Decode audio data
                const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
                this.bgmBuffers.set(key, audioBuffer);
                console.log(`Loaded BGM: ${key}`);

                // Check if this BGM should be playing now but was waiting for asset
                if (this.currentBGMState === key && !this.activeBgmSource) {
                    console.log(`BGM asset ${key} ready, starting delayed playback.`);
                    this.startBGM(key);
                }
            } catch (error) {
                console.error(`Failed to load BGM ${key} via Rust:`, error);
            }
        };

        // Don't await here, let them load in background so we don't block game init if used elsewhere
        // But since this is async void intended, Promise.all is fine to kick them off
        Promise.all([
            loadBuffer('sunny.mp3', 'sunny'),
            loadBuffer('rainy.mp3', 'rainy'),
            loadBuffer('combat.mp3', 'combat'),
        ]);
    }

    public static getInstance(): SoundManager {
        if (!SoundManager.instance) {
            SoundManager.instance = new SoundManager();
        }
        return SoundManager.instance;
    }

    /**
     * 设置背景音乐状态
     */
    public setBGMState(state: 'sunny' | 'rainy' | 'combat' | 'none') {
        if (this.currentBGMState === state) return;
        
        console.log(`BGM State Switch: ${this.currentBGMState} -> ${state}`);

        // Fade out current BGM
        if (this.activeBgmGain) {
            const oldGain = this.activeBgmGain;
            const oldSource = this.activeBgmSource;
            const now = this.audioContext.currentTime;
            
            try {
                oldGain.gain.cancelScheduledValues(now);
                oldGain.gain.setValueAtTime(oldGain.gain.value, now);
                oldGain.gain.linearRampToValueAtTime(0, now + (SoundConfig.bgm.fadeDuration));
                
                if (oldSource) {
                    oldSource.stop(now + (SoundConfig.bgm.fadeDuration) + 0.1);
                }
            } catch(e) { console.warn("Error stopping old BGM", e); }
        }

        this.currentBGMState = state;
        
        if (state !== 'none') {
             this.startBGM(state);
        } else {
             this.activeBgmSource = null;
             this.activeBgmGain = null;
        }
    }

    private startBGM(key: string) {
        if (this.audioContext.state === 'suspended') {
            this.resume();
        }

        const buffer = this.bgmBuffers.get(key);
        if (!buffer) {
            console.warn(`BGM asset '${key}' not ready yet.`);
            return;
        }

        try {
            const source = this.audioContext.createBufferSource();
            source.buffer = buffer;
            source.loop = true;

            const gain = this.audioContext.createGain();
            
            // Determine target volume based on BGM type
            let targetVolume = 1.0;
            if (key === 'sunny') targetVolume = SoundConfig.bgm.sunnyVolume || 0.8;
            if (key === 'rainy') targetVolume = SoundConfig.bgm.rainyVolume || 0.8;
            if (key === 'combat') targetVolume = SoundConfig.bgm.combatVolume || 0.8;
            
            source.connect(gain);
            gain.connect(this.bgmGain); 

            const now = this.audioContext.currentTime;
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(targetVolume, now + (SoundConfig.bgm.fadeDuration));
            
            source.start(now);
            
            this.activeBgmSource = source;
            this.activeBgmGain = gain;
        } catch (e) {
            console.error("Failed to start BGM", e);
        }
    }

    // Ensure AudioContext is resumed (browsers block auto-play)
    public async resume() {
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
            
            // 如果恢复成功，且当前有 BGM 状态，重启 BGM 以便立即听到声音
            // 否则可能会因为 'suspended' check 跳过初始播放，导致长达数秒的静音
            // 使用 type assertion 绕过 TS 的静态分析 (因为 await 改变了状态)
            if ((this.audioContext.state as AudioContextState) === 'running' && this.currentBGMState !== 'none') {
                const savedState = this.currentBGMState;
                this.currentBGMState = 'none'; // 强制状态重置
                this.setBGMState(savedState);
            }
        }
    }

    private playTone(freq: number, type: OscillatorType, duration: number, startTime: number = 0, vol: number = 1) {
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.audioContext.currentTime + startTime);

        gain.gain.setValueAtTime(vol, this.audioContext.currentTime + startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + startTime + duration);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(this.audioContext.currentTime + startTime);
        osc.stop(this.audioContext.currentTime + startTime + duration);
    }

    private lastShootTime: number = 0;
    private readonly SHOOT_THROTTLE: number = SoundConfig.weapon.shoot.throttle; // ms

    public playShoot() {
        const now = Date.now();
        if (now - this.lastShootTime < this.SHOOT_THROTTLE) {
            return;
        }
        this.lastShootTime = now;

        this.resume();
        // Pew pew sound
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(800, this.audioContext.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, this.audioContext.currentTime + 0.1);

        gain.gain.setValueAtTime(SoundConfig.weapon.shoot.volume, this.audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start();
        osc.stop(this.audioContext.currentTime + 0.1);
    }
    
    /**
     * 播放狙击枪射击声 - 更有震慑力
     */
    public playSniperShoot() {
        this.resume();
        
        // 主爆发音 - 极其低沉有力
        const osc1 = this.audioContext.createOscillator();
        const gain1 = this.audioContext.createGain();
        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(120, this.audioContext.currentTime);
        osc1.frequency.exponentialRampToValueAtTime(25, this.audioContext.currentTime + 0.5);
        gain1.gain.setValueAtTime(1.5, this.audioContext.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.5);
        osc1.connect(gain1);
        gain1.connect(this.masterGain);
        osc1.start();
        osc1.stop(this.audioContext.currentTime + 0.5);
        
        // 高频冲击音 - 尖锐的枪击声
        const osc2 = this.audioContext.createOscillator();
        const gain2 = this.audioContext.createGain();
        osc2.type = 'square';
        osc2.frequency.setValueAtTime(1500, this.audioContext.currentTime);
        osc2.frequency.exponentialRampToValueAtTime(150, this.audioContext.currentTime + 0.12);
        gain2.gain.setValueAtTime(1.2, this.audioContext.currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.12);
        osc2.connect(gain2);
        gain2.connect(this.masterGain);
        osc2.start();
        osc2.stop(this.audioContext.currentTime + 0.12);
        
        // 超低频震撼 - 身体能感受到的低音
        const osc3 = this.audioContext.createOscillator();
        const gain3 = this.audioContext.createGain();
        osc3.type = 'sine';
        osc3.frequency.setValueAtTime(45, this.audioContext.currentTime);
        osc3.frequency.exponentialRampToValueAtTime(20, this.audioContext.currentTime + 0.7);
        gain3.gain.setValueAtTime(1.5, this.audioContext.currentTime);
        gain3.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.7);
        osc3.connect(gain3);
        gain3.connect(this.masterGain);
        osc3.start();
        osc3.stop(this.audioContext.currentTime + 0.7);
        
        // 中频爆破音
        const osc4 = this.audioContext.createOscillator();
        const gain4 = this.audioContext.createGain();
        osc4.type = 'sawtooth';
        osc4.frequency.setValueAtTime(300, this.audioContext.currentTime);
        osc4.frequency.exponentialRampToValueAtTime(80, this.audioContext.currentTime + 0.25);
        gain4.gain.setValueAtTime(1.0, this.audioContext.currentTime);
        gain4.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.25);
        osc4.connect(gain4);
        gain4.connect(this.masterGain);
        osc4.start();
        osc4.stop(this.audioContext.currentTime + 0.25);
        
        // 回响余音 - 远处的回声
        const osc5 = this.audioContext.createOscillator();
        const gain5 = this.audioContext.createGain();
        osc5.type = 'sine';
        osc5.frequency.setValueAtTime(80, this.audioContext.currentTime + 0.08);
        osc5.frequency.exponentialRampToValueAtTime(35, this.audioContext.currentTime + 1.0);
        gain5.gain.setValueAtTime(0, this.audioContext.currentTime);
        gain5.gain.linearRampToValueAtTime(0.6, this.audioContext.currentTime + 0.08);
        gain5.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 1.0);
        osc5.connect(gain5);
        gain5.connect(this.masterGain);
        osc5.start();
        osc5.stop(this.audioContext.currentTime + 1.0);
        
        // 噪声层 - 模拟爆炸气流
        const bufferSize = this.audioContext.sampleRate * 0.3;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }
        const noise = this.audioContext.createBufferSource();
        noise.buffer = noiseBuffer;
        const noiseGain = this.audioContext.createGain();
        noiseGain.gain.setValueAtTime(0.8, this.audioContext.currentTime);
        noiseGain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);
        const noiseFilter = this.audioContext.createBiquadFilter();
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.value = 2000;
        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.masterGain);
        noise.start();
    }

    public playHit() {
        this.resume();
        // Short high pitch ping
        this.playTone(1200, 'sine', 0.05, 0, 0.5);
    }

    public playJump() {
        this.resume();
        // Rising pitch
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, this.audioContext.currentTime);
        osc.frequency.linearRampToValueAtTime(400, this.audioContext.currentTime + 0.2);

        gain.gain.setValueAtTime(0.5, this.audioContext.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, this.audioContext.currentTime + 0.2);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start();
        osc.stop(this.audioContext.currentTime + 0.2);
    }

    public playEnemyDeath() {
        this.resume();
        // Explosion-ish noise (simulated with low freq saw/square)
        this.playTone(100, 'sawtooth', 0.3, 0, 0.8);
        this.playTone(80, 'square', 0.3, 0.05, 0.8);
    }

    public playDamage() {
        this.resume();
        // Low thud
        this.playTone(150, 'sawtooth', 0.1, 0, 0.8);
    }

    public playPickup() {
        this.resume();
        // High happy chime
        this.playTone(1000, 'sine', 0.1, 0, 0.3);
        this.playTone(1500, 'sine', 0.2, 0.05, 0.3);
    }
    
    public playHitImpact() {
        this.resume();
        // Short impact sound
        this.playTone(200, 'square', 0.05, 0, 0.3);
    }
    
    public playExplosion() {
        this.resume();
        // Explosion sound - layered low frequency rumble
        
        // Main boom
        const osc1 = this.audioContext.createOscillator();
        const gain1 = this.audioContext.createGain();
        osc1.type = 'sawtooth';
        osc1.frequency.setValueAtTime(100, this.audioContext.currentTime);
        osc1.frequency.exponentialRampToValueAtTime(30, this.audioContext.currentTime + 0.5);
        gain1.gain.setValueAtTime(1.0, this.audioContext.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.5);
        osc1.connect(gain1);
        gain1.connect(this.masterGain);
        osc1.start();
        osc1.stop(this.audioContext.currentTime + 0.5);
        
        // Secondary crack
        const osc2 = this.audioContext.createOscillator();
        const gain2 = this.audioContext.createGain();
        osc2.type = 'square';
        osc2.frequency.setValueAtTime(200, this.audioContext.currentTime);
        osc2.frequency.exponentialRampToValueAtTime(50, this.audioContext.currentTime + 0.3);
        gain2.gain.setValueAtTime(0.8, this.audioContext.currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3);
        osc2.connect(gain2);
        gain2.connect(this.masterGain);
        osc2.start();
        osc2.stop(this.audioContext.currentTime + 0.3);
        
        // High frequency crack
        this.playTone(800, 'sawtooth', 0.08, 0, 0.5);
        this.playTone(400, 'square', 0.15, 0.02, 0.4);
    }
    
    public playWeaponSwitch() {
        this.resume();
        // Click sound for weapon switch
        this.playTone(600, 'sine', 0.03, 0, 0.2);
        this.playTone(800, 'sine', 0.03, 0.02, 0.2);
    }
    
    public playGrenadeThrow() {
        this.resume();
        // Whoosh sound
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, this.audioContext.currentTime);
        osc.frequency.linearRampToValueAtTime(100, this.audioContext.currentTime + 0.2);
        
        gain.gain.setValueAtTime(0.3, this.audioContext.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, this.audioContext.currentTime + 0.2);
        
        osc.connect(gain);
        gain.connect(this.masterGain);
        
        osc.start();
        osc.stop(this.audioContext.currentTime + 0.2);
    }
    
    /**
     * 播放天气环境音效
     */
    public playWeatherSound(weather: 'sunny' | 'rainy' | 'windy' | 'sandstorm') {
        this.resume();
        
        // 如果是同一个天气音效，不重复播放
        if (this.currentWeatherSound === weather) return;
        
        // 停止当前天气音效
        this.stopWeatherSound();
        
        this.currentWeatherSound = weather;
        
        // 晴天没有特殊音效
        if (weather === 'sunny') return;
        
        // 创建天气音效增益节点
        this.weatherGain = this.audioContext.createGain();
        this.weatherGain.gain.setValueAtTime(0, this.audioContext.currentTime);
        this.weatherGain.gain.linearRampToValueAtTime(0.5, this.audioContext.currentTime + 1);
        this.weatherGain.connect(this.masterGain);
        
        if (weather === 'rainy') {
            this.createRainSound();
        } else if (weather === 'windy') {
            this.createWindSound();
        } else if (weather === 'sandstorm') {
            this.createSandstormSound();
        }
    }
    
    /**
     * 停止天气音效
     */
    public stopWeatherSound() {
        this.currentWeatherSound = null;  // 立即设置，阻止新的循环音效
        
        // 保存当前要清理的节点引用
        const nodesToClean = [...this.weatherNodes];
        const gainToClean = this.weatherGain;
        
        // 清空当前数组，为新音效腾出空间
        this.weatherNodes = [];
        this.weatherGain = null;
        
        if (gainToClean) {
            // 渐出
            gainToClean.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 1);
        }
        
        // 延迟停止旧节点
        setTimeout(() => {
            for (const node of nodesToClean) {
                try {
                    node.stop();
                    node.disconnect();
                } catch (e) {
                    // 忽略已停止的节点
                }
            }
            if (gainToClean) {
                gainToClean.disconnect();
            }
        }, 1100);
    }
    
    /**
     * 创建雨声 - 使用白噪声模拟
     */
    private createRainSound() {
        if (!this.weatherGain) return;
        
        // 创建白噪声缓冲区
        const bufferSize = 2 * this.audioContext.sampleRate;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        
        // 创建噪声源
        const whiteNoise = this.audioContext.createBufferSource();
        whiteNoise.buffer = noiseBuffer;
        whiteNoise.loop = true;
        
        // 滤波器 - 让雨声更自然
        const lowpass = this.audioContext.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 3000;
        
        const highpass = this.audioContext.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 500;
        
        // 连接节点
        whiteNoise.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(this.weatherGain);
        
        whiteNoise.start();
        this.weatherNodes.push(whiteNoise);
        
        // 添加雨滴滴答声
        this.addRainDrops();
    }
    
    /**
     * 添加雨滴滴答声效果
     */
    private addRainDrops() {
        if (!this.weatherGain || this.currentWeatherSound !== 'rainy') return;
        
        // 随机播放更多雨滴声
        const dropCount = 5 + Math.floor(Math.random() * 5);
        for (let i = 0; i < dropCount; i++) {
            setTimeout(() => {
                if (!this.weatherGain || this.currentWeatherSound !== 'rainy') return;
                
                const osc = this.audioContext.createOscillator();
                const gain = this.audioContext.createGain();
                
                osc.type = 'sine';
                const freq = 1500 + Math.random() * 3000;
                osc.frequency.setValueAtTime(freq, this.audioContext.currentTime);
                osc.frequency.exponentialRampToValueAtTime(freq * 0.3, this.audioContext.currentTime + 0.08);
                
                gain.gain.setValueAtTime(0.08, this.audioContext.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 0.08);
                
                osc.connect(gain);
                gain.connect(this.weatherGain!);
                
                osc.start();
                osc.stop(this.audioContext.currentTime + 0.08);
            }, Math.random() * 300);
        }
        
        // 更频繁地循环播放雨滴声
        setTimeout(() => this.addRainDrops(), 100 + Math.random() * 200);
    }
    
    /**
     * 创建风声
     */
    private createWindSound() {
        if (!this.weatherGain) return;
        
        // 使用低频振荡器调制噪声来模拟风声
        const bufferSize = 2 * this.audioContext.sampleRate;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        
        const whiteNoise = this.audioContext.createBufferSource();
        whiteNoise.buffer = noiseBuffer;
        whiteNoise.loop = true;
        
        // 带通滤波器让风声更自然
        const bandpass = this.audioContext.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 400;
        bandpass.Q.value = 0.5;
        
        // LFO 调制音量模拟阵风 - 更强烈
        const lfo = this.audioContext.createOscillator();
        const lfoGain = this.audioContext.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = 0.4; // 更快的阵风
        lfoGain.gain.value = 0.5;
        
        const modulatedGain = this.audioContext.createGain();
        modulatedGain.gain.value = 1.2;
        
        lfo.connect(lfoGain);
        lfoGain.connect(modulatedGain.gain);
        
        whiteNoise.connect(bandpass);
        bandpass.connect(modulatedGain);
        modulatedGain.connect(this.weatherGain);
        
        whiteNoise.start();
        lfo.start();
        
        this.weatherNodes.push(whiteNoise, lfo);
        
        // 添加呼啸声
        this.addWindWhistle();
    }
    
    /**
     * 添加风的呼啸声
     */
    private addWindWhistle() {
        if (!this.weatherGain || this.currentWeatherSound !== 'windy') return;
        
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        
        osc.type = 'sine';
        const baseFreq = 250 + Math.random() * 300;
        osc.frequency.setValueAtTime(baseFreq, this.audioContext.currentTime);
        osc.frequency.linearRampToValueAtTime(baseFreq * 2.0, this.audioContext.currentTime + 0.8);
        osc.frequency.linearRampToValueAtTime(baseFreq * 0.5, this.audioContext.currentTime + 1.8);
        
        gain.gain.setValueAtTime(0, this.audioContext.currentTime);
        gain.gain.linearRampToValueAtTime(0.12, this.audioContext.currentTime + 0.3);
        gain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 1.8);
        
        osc.connect(gain);
        gain.connect(this.weatherGain!);
        
        osc.start();
        osc.stop(this.audioContext.currentTime + 1.8);
        
        // 更频繁地添加呼啸声
        setTimeout(() => this.addWindWhistle(), 800 + Math.random() * 1500);
    }
    
    /**
     * 创建沙尘暴声音
     */
    private createSandstormSound() {
        if (!this.weatherGain) return;
        
        // 沙尘暴 = 强风 + 沙粒摩擦声
        const bufferSize = 2 * this.audioContext.sampleRate;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        
        // 更粗糙的噪声模拟沙粒
        for (let i = 0; i < bufferSize; i++) {
            output[i] = (Math.random() * 2 - 1) * (0.5 + Math.random() * 0.5);
        }
        
        const whiteNoise = this.audioContext.createBufferSource();
        whiteNoise.buffer = noiseBuffer;
        whiteNoise.loop = true;
        
        // 滤波器
        const lowpass = this.audioContext.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 2000;
        
        const highpass = this.audioContext.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 200;
        
        // 更强烈的 LFO 调制
        const lfo = this.audioContext.createOscillator();
        const lfoGain = this.audioContext.createGain();
        lfo.type = 'triangle';
        lfo.frequency.value = 0.5;
        lfoGain.gain.value = 0.6;
        
        const modulatedGain = this.audioContext.createGain();
        modulatedGain.gain.value = 1.5;
        
        lfo.connect(lfoGain);
        lfoGain.connect(modulatedGain.gain);
        
        whiteNoise.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(modulatedGain);
        modulatedGain.connect(this.weatherGain);
        
        whiteNoise.start();
        lfo.start();
        
        this.weatherNodes.push(whiteNoise, lfo);
        
        // 添加低频隆隆声
        this.addSandRumble();
    }
    
    /**
     * 添加沙尘暴的低频隆隆声
     */
    private addSandRumble() {
        if (!this.weatherGain || this.currentWeatherSound !== 'sandstorm') return;
        
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(40 + Math.random() * 40, this.audioContext.currentTime);
        
        gain.gain.setValueAtTime(0, this.audioContext.currentTime);
        gain.gain.linearRampToValueAtTime(0.2, this.audioContext.currentTime + 0.3);
        gain.gain.linearRampToValueAtTime(0, this.audioContext.currentTime + 1.2);
        
        osc.connect(gain);
        gain.connect(this.weatherGain!);
        
        osc.start();
        osc.stop(this.audioContext.currentTime + 1.2);
        
        // 更频繁的隆隆声
        setTimeout(() => this.addSandRumble(), 600 + Math.random() * 1000);
    }
}
