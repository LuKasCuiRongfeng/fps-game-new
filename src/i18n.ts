import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export type SupportedLanguage = 'zh' | 'en';

const STORAGE_KEY = 'lang';

function getInitialLanguage(): SupportedLanguage {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'en' || stored === 'zh') return stored;
    } catch {
        // ignore
    }
    return 'zh';
}

export function setLanguage(lang: SupportedLanguage) {
    i18n.changeLanguage(lang);
    try {
        localStorage.setItem(STORAGE_KEY, lang);
    } catch {
        // ignore
    }
}

void i18n
    .use(initReactI18next)
    .init({
        lng: getInitialLanguage(),
        fallbackLng: 'zh',
        supportedLngs: ['zh', 'en'],
        interpolation: {
            escapeValue: false,
        },
        resources: {
            zh: {
                translation: {
                    language: { zh: '中文', en: 'English' },
                    loading: {
                        title: '加载中',
                        ready: '准备就绪',
                        stage: {
                            init: '初始化…',
                            webgpu: '初始化 WebGPU 渲染器…',
                            scene: '创建场景与光照…',
                            physics: '初始化关卡 / 物理 / BVH…',
                            pathfinding: '生成 AI 寻路数据…',
                            compute: '编译 GPU Compute / TSL Shader（首次可能较慢）…',
                            effects: '加载特效系统（爆炸 / 天气 / 音频 / 粒子）…',
                            player: '初始化玩家控制器与交互…',
                            postfx: '配置后处理（TSL PostFX）…',
                            spawn: '准备生成实体…',
                            dummy: '预生成虚拟实体（避免首次卡顿）…',
                            shaderWarmup: '预编译 Shader 管线（Warmup）…',
                            gpuWarmup: '预热 GPU 资源上传与渲染通路…',
                            renderWarmup: '预热渲染循环（多方向采样）…',
                            startLoop: '启动渲染循环（即将进入游戏）…',
                            finalize: '收尾处理中（等待稳定帧）…',
                        },
                    },
                    hud: {
                        score: '得分',
                        controls: '点击开始 | WASD 移动 | 滚轮/1-2 切换 | G 手榴弹',
                        hp: '生命',
                        stance: {
                            stand: '站立',
                            crouch: '蹲下',
                            prone: '趴下',
                        },
                        keyHints: {
                            crouch: 'C - 蹲下',
                            prone: 'Z - 趴下',
                        },
                        weapon: {
                            ammo: '弹药',
                            grenades: '手雷',
                        },
                        perf: {
                            fps: 'FPS',
                            ms: '毫秒',
                        },
                    },
                    gameOver: {
                        title: '游戏结束',
                        finalScore: '最终得分：{{score}}',
                        tryAgain: '再来一次',
                    },
                    settings: {
                        title: '设置',
                        hint: '按 Esc 返回游戏（重新锁定鼠标）',
                        close: '关闭',
                        resume: '继续游戏',
                        reset: '重置默认',
                        section: {
                            camera: '视角',
                            movement: '移动',
                            weapons: '武器',
                        },
                        camera: {
                            sensitivity: '鼠标灵敏度',
                            smooth: '视角平滑',
                            defaultFov: '默认 FOV',
                            aimFov: '瞄准 FOV',
                            aimMultiplier: '瞄准灵敏度倍率',
                            fovLerp: 'FOV 过渡速度',
                        },
                        movement: {
                            walkSpeed: '行走速度',
                            runSpeed: '奔跑速度',
                            jump: '跳跃高度',
                            gravity: '重力',
                            friction: '摩擦/减速',
                        },
                        weapons: {
                            switchCooldown: '切枪冷却 (ms)',
                        },
                    },
                    weapon: {
                        rifle: '步枪',
                        sniper: '狙击枪',
                        pistol: '手枪',
                        smg: '冲锋枪',
                        shotgun: '霰弹枪',
                        bow: '弓',
                        knife: '匕首',
                        axe: '斧头',
                        scythe: '镰刀',
                        grenade: '手榴弹',
                    },
                },
            },
            en: {
                translation: {
                    language: { zh: '中文', en: 'English' },
                    loading: {
                        title: 'Loading',
                        ready: 'Ready',
                        stage: {
                            init: 'Initializing…',
                            webgpu: 'Initializing WebGPU renderer…',
                            scene: 'Setting up scene & lighting…',
                            physics: 'Initializing level / physics / BVH…',
                            pathfinding: 'Building AI pathfinding…',
                            compute: 'Compiling GPU compute / TSL shaders (first run may be slow)…',
                            effects: 'Loading effects (explosions / weather / audio / particles)…',
                            player: 'Initializing player controller & input…',
                            postfx: 'Configuring post-processing (TSL PostFX)…',
                            spawn: 'Preparing entities…',
                            dummy: 'Spawning warmup dummies (avoid first-use hitch)…',
                            shaderWarmup: 'Pre-compiling shader pipelines (warmup)…',
                            gpuWarmup: 'Warming up GPU uploads & render paths…',
                            renderWarmup: 'Warming up render loop (multi-view sampling)…',
                            startLoop: 'Starting render loop…',
                            finalize: 'Finalizing (waiting for stable frames)…',
                        },
                    },
                    hud: {
                        score: 'Score',
                        controls: 'Click to Play | WASD Move | Scroll/1-2 Switch | G Grenade',
                        hp: 'HP',
                        stance: {
                            stand: 'Stand',
                            crouch: 'Crouch',
                            prone: 'Prone',
                        },
                        keyHints: {
                            crouch: 'C - Crouch',
                            prone: 'Z - Prone',
                        },
                        weapon: {
                            ammo: 'Ammo',
                            grenades: 'Grenades',
                        },
                        perf: {
                            fps: 'FPS',
                            ms: 'ms',
                        },
                    },
                    gameOver: {
                        title: 'Game Over',
                        finalScore: 'Final Score: {{score}}',
                        tryAgain: 'Try Again',
                    },
                    settings: {
                        title: 'Settings',
                        hint: 'Press Esc to resume (re-lock pointer)',
                        close: 'Close',
                        resume: 'Resume',
                        reset: 'Reset',
                        section: {
                            camera: 'Camera',
                            movement: 'Movement',
                            weapons: 'Weapons',
                        },
                        camera: {
                            sensitivity: 'Mouse sensitivity',
                            smooth: 'Look smoothing',
                            defaultFov: 'Default FOV',
                            aimFov: 'Aim FOV',
                            aimMultiplier: 'Aim sensitivity multiplier',
                            fovLerp: 'FOV lerp speed',
                        },
                        movement: {
                            walkSpeed: 'Walk speed',
                            runSpeed: 'Run speed',
                            jump: 'Jump height',
                            gravity: 'Gravity',
                            friction: 'Friction/deceleration',
                        },
                        weapons: {
                            switchCooldown: 'Weapon switch cooldown (ms)',
                        },
                    },
                    weapon: {
                        rifle: 'Rifle',
                        sniper: 'Sniper',
                        pistol: 'Pistol',
                        smg: 'SMG',
                        shotgun: 'Shotgun',
                        bow: 'Bow',
                        knife: 'Knife',
                        axe: 'Axe',
                        scythe: 'Scythe',
                        grenade: 'Grenade',
                    },
                },
            },
        },
    });

export default i18n;
