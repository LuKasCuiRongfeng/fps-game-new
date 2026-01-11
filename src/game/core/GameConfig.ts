/**
 * GameConfig - 游戏配置中心
 * 集中管理所有游戏参数，便于调整和维护
 */

function deepFreeze<T>(obj: T): T {
    if (!obj || typeof obj !== 'object') return obj;
    Object.freeze(obj);

    const anyObj = obj as any;
    for (const key of Object.getOwnPropertyNames(anyObj)) {
        const value = anyObj[key];
        if (value && typeof value === 'object' && !Object.isFrozen(value)) {
            deepFreeze(value);
        }
    }

    return obj;
}

// ==================== 玩家配置 ====================
export const PlayerConfig = {
    // 移动速度
    movement: {
        walkSpeed: 60.0,           // 行走速度
        runSpeed: 120.0,           // 奔跑速度
        friction: 10.0,            // 摩擦力/减速系数
        jumpHeight: 10.0,          // 跳跃高度
        gravity: 30.0,             // 重力
    },
    
    // 姿态配置
    stance: {
        stand: {
            height: 1.6,           // 站立时相机高度
            speedMultiplier: 1.0,  // 速度倍率
            collisionHeight: 1.8,  // 碰撞盒高度
        },
        crouch: {
            height: 0.9,           // 蹲下时相机高度
            speedMultiplier: 0.5,  // 速度倍率 (50%)
            collisionHeight: 1.0,  // 碰撞盒高度
        },
        prone: {
            height: 0.4,           // 趴下时相机高度
            speedMultiplier: 0.25, // 速度倍率 (25%)
            collisionHeight: 0.5,  // 碰撞盒高度
        },
    },
    
    // 碰撞配置
    collision: {
        radius: 0.3,               // 玩家碰撞半径
        skinWidth: 0.1,            // 皮肤宽度 (用于水平碰撞检测)
        maxStepHeight: 0.6,        // 最大可跨越台阶高度
    },
    
    // 视角配置
    camera: {
        sensitivity: 0.002,        // 鼠标灵敏度
        smoothFactor: 0.15,        // 平滑因子 (越低越平滑)
        defaultFov: 75,            // 默认视野角度
        aimFov: 25,                // 瞄准时视野角度
        aimSensitivityMultiplier: 0.35,  // 瞄准时灵敏度倍率
        fovLerpSpeed: 10.0,        // FOV 变化速度
    },
};

// ==================== 武器配置 ====================
export const WeaponConfig = {
    // 枪械
    gun: {
        fireRate: 10,              // 每秒射击次数
        damage: 34,                // 腰射伤害
        sniperDamage: 150,         // 狙击伤害 (开镜)
        range: 100,                // 射程
        recoil: {
            vertical: 0.02,        // 垂直后座力
            horizontal: 0.01,      // 水平后座力
            recovery: 5.0,         // 后座力恢复速度
            amount: 0.05,          // 后座力位移量
        },
        muzzleFlash: {
            duration: 0.05,        // 枪口火焰持续时间
            intensity: 2.0,        // 光照强度
        },
        bulletTrail: {
            fadeTime: 100,         // 弹道轨迹淡出时间 (ms)
            coreRadius: 0.015,     // 核心半径
            glowRadius: 0.04,      // 发光半径
        },
    },
    
    // 瞄准配置
    aim: {
        speed: 8.0,                // 瞄准过渡速度
        hipPosition: { x: 0.3, y: -0.25, z: -0.6 },   // 腰射位置
        adsPosition: { x: 0, y: -0.18, z: -0.4 },     // 瞄准位置 (居中)
    },
    
    // 手榴弹
    grenade: {
        fuseTime: 3.0,             // 引信时间 (秒)
        throwStrength: 20,         // 投掷力度
        explosionRadius: 8.0,      // 爆炸半径
        explosionDamage: 100,      // 爆炸伤害
        radius: 0.06,              // 手榴弹碰撞半径
        physics: {
            gravity: -25,          // 重力
            bounceFactor: 0.4,     // 弹跳系数
            friction: 0.98,        // 摩擦力
            groundFriction: 0.7,   // 地面摩擦
            bounceAngularDamping: 0.6, // 弹跳角速度衰减
        },
    },

    // 近战 / 蓄力投掷（knife/scythe）
    melee: {
        // 近战动作时序（秒）
        swing: {
            knife: { duration: 0.24, hitTime: 0.42 },
            scythe: { duration: 0.36, hitTime: 0.5 },
            axe: { duration: 0.42, hitTime: 0.5 },
        },

        // 蓄力投掷/回旋（秒/米）
        chargeThrow: {
            chargeMinSeconds: 0.28,
            chargeMaxSeconds: 0.9,
            throwStartForward: 0.6,
            returnForward: 0.35,
            returnLerpBoost: 1.25,

            knife: {
                outDistBase: 8,
                outDistBonus: 10,
                totalTime: 0.95,
                outTime: 0.56,
                baseDamage: 40,
                bonusDamage: 35,
                hitRadius: 1.0,
                sideCurve: 0.9,
                spinX: 10,
                spinZ: 16,
            },
            scythe: {
                outDistBase: 10,
                outDistBonus: 14,
                totalTime: 1.15,
                outTime: 0.62,
                baseDamage: 55,
                bonusDamage: 45,
                hitRadius: 1.3,
                sideCurve: 1.2,
                spinX: 10,
                spinZ: 16,
                // performance: cut grass using cached instance positions (no raycast)
                grassCheckInterval: 0.05,
                grassCutRadius: 1.4,
                grassMaxCandidateMeshes: 3,
            },
        },

        // 环境交互（用于避免 InstancedMesh 极端坐标导致的 culling 异常）
        environment: {
            choppedTreeSink: 50,
            cutGrassSink: 20,
        },
    },
    
    // 武器切换
    switching: {
        cooldown: 200,             // 切换冷却时间 (ms)
    },
};

// ==================== 敌人配置 ====================
export type EnemyType = 'scout' | 'soldier' | 'heavy' | 'elite';

export const EnemyTypesConfig = {
    scout: {
        name: 'Scout',
        health: 50,
        speed: 4.5,
        scale: 0.9,
        color: 0xE67E22, // 焦橙色 (高可视度)
        weapon: 'smg',
        attack: {
            damage: 5,
            range: 35,
            fireRate: 3.0,
            accuracy: 0.6,
            engageRange: 30,
        },
        ai: {
            chaseSpeed: 5.5,
            aimSpeed: 10.0,
        }
    },
    soldier: {
        name: 'Soldier',
        health: 100,
        speed: 3.0,
        scale: 1.0,
        color: 0x2E8B57, // 海洋绿 (军用迷彩感)
        weapon: 'rifle',
        attack: {
            damage: 10,
            range: 50,
            fireRate: 1.5,
            accuracy: 0.8,
            engageRange: 40,
        },
        ai: {
            chaseSpeed: 4.0,
            aimSpeed: 8.0,
        }
    },
    heavy: {
        name: 'Heavy',
        health: 250,
        speed: 1.5,
        scale: 1.25,
        color: 0x1A5276, // 深海蓝 (防暴警察感，区别于黑)
        weapon: 'shotgun',
        attack: {
            damage: 20, // 这是一个弹丸或者一次射击的基准
            range: 25,
            fireRate: 0.6,
            accuracy: 0.5,
            engageRange: 15,
        },
        ai: {
            chaseSpeed: 2.5,
            aimSpeed: 5.0,
        }
    },
    elite: {
        name: 'Elite',
        health: 150,
        speed: 3.5,
        scale: 1.1,
        color: 0xC0392B, // 鲜红色 (高威胁)
        weapon: 'sniper',
        attack: {
            damage: 40,
            range: 80,
            fireRate: 0.5,
            accuracy: 0.95,
            engageRange: 70,
        },
        ai: {
            chaseSpeed: 4.5,
            aimSpeed: 12.0,
        }
    }
};

export const EnemyConfig = {
    // 基础属性 (默认值，实际使用 TypesConfig)
    health: 100,                   
    speed: 3.0,                    
    turnSpeed: 5.0,                
    rotationSpeed: 8.0,            
    
    // 攻击配置 (默认值)
    attack: {
        damage: 8,                 
        range: 50,                 
        fireRate: 1.5,             
        accuracy: 0.85,            
        engageRange: 40,           
        muzzleFlashDuration: 0.05, 
    },
    
    // AI 配置
    ai: {
        detectionRange: 50,        // 探测范围
        loseTargetTime: 5.0,       // 失去目标时间
        patrolSpeed: 1.5,          // 巡逻速度
        chaseSpeed: 4.0,           // 追击速度 (默认)
        pathUpdateInterval: 0.5,   // 路径更新间隔
        aimSpeed: 8.0,             // 抬枪速度
        aimHoldDuration: 0.8,      // 射击后保持瞄准时间

        // 性能/渲染 LOD
        farUpdateDistance: 55,     // 超过此距离后，AI/碰撞等降频更新
        farUpdateInterval: 0.33,   // 远距离敌人的更新间隔 (秒)
        limbLodDistance: 45,       // 超过此距离后隐藏四肢/武器等细节
        shadowDisableDistance: 65, // 超过此距离后禁用投射阴影以减少阴影开销
        // Keep this above the longest player weapon range (sniper=250) so far targets remain shootable/visible.
        renderCullDistance: 350,   // 超过此距离后直接隐藏敌人 (避免远处大量 drawcalls)
    },

    // GPU Compute (敌人) 配置：当前逻辑主要走 CPU，GPU 路径可关闭以避免额外开销
    gpuCompute: {
        enabled: false,
        targetUpdateDistance: 120,
    },

    // 运动能力（让敌人更接近玩家的移动表现）
    movement: {
        gravity: 24.0,             // 重力加速度 (m/s^2)
        jumpHeight: 1.4,           // 跳跃高度（用于翻越/跳上低障碍）
        jumpCooldown: 1.0,         // 跳跃冷却（秒）
        // 允许尝试“跳上去”的障碍高度上限（超过则需要楼梯/绕路）
        maxJumpObstacleHeight: 1.6,
        // 起跳时给一点前冲，帮助跳过窄障碍
        jumpForwardBoost: 0.9,
    },
    
    // 碰撞配置
    collision: {
        radius: 0.5,               // 碰撞半径
        height: 1.0,               // 碰撞高度 (从中心)
        skinWidth: 0.1,            // 皮肤宽度
        maxStepHeight: 0.6,        // 最大可跨越高度
        targetHeightOffset: 0.8,   // 目标高度偏移 (躯干)
    },
    
    // 弹道配置
    bulletTrail: {
        fadeTime: 80,              // 淡出时间 (ms)
        coreRadius: 0.008,         // 核心半径
        innerGlowRadius: 0.025,    // 内发光半径
        outerGlowRadius: 0.05,     // 外发光半径
        color: {
            core: 0xff6600,        // 核心颜色
            innerGlow: 0xff3300,   // 内发光颜色
            outerGlow: 0xff2200,   // 外发光颜色
        },
    },
    
    // 击杀奖励
    rewards: {
        score: 100,                // 击杀得分
    },
};

// ==================== 拾取物配置 ====================
export const PickupConfig = {
    // 弹药箱
    ammo: {
        amount: 15,                // 弹药数量
        respawnTime: 30,           // 重生时间 (秒)
    },
    
    // 血包
    health: {
        amount: 25,                // 恢复生命值
        respawnTime: 45,           // 重生时间 (秒)
    },
    
    // 手榴弹
    grenade: {
        amount: 2,                 // 手榴弹数量
        respawnTime: 60,           // 重生时间 (秒)
    },
    
    // 交互配置
    interaction: {
        range: 2.0,                // 拾取范围
    },
    
    // 视觉配置
    visual: {
        floatHeight: 0.8,          // 漂浮高度
        bobSpeed: 1.5,             // 浮动速度
        bobHeight: 0.1,            // 浮动高度
        rotateSpeed: 0.8,          // 旋转速度
    },
};

// ==================== 特效配置 ====================
export const EffectConfig = {
    // 爆炸特效
    explosion: {
        duration: 400,             // 持续时间 (ms)
        maxScale: 3.0,             // 最大缩放
        initialScale: 0.5,         // 初始缩放
        floatUp: 0.3,              // 上飘距离
        flashIntensity: 30,        // 闪光强度
        flashDecay: 3,             // 闪光衰减速度
        poolSize: 8,               // 对象池大小
    },
    
    // 血液特效
    blood: {
        particleCount: 25,         // 主要粒子数量
        sideParticleCount: 8,      // 侧面粒子数量
        lifetime: { min: 0.3, max: 0.6 },
        speed: { min: 3, max: 8 },
    },
    
    // 火花特效
    spark: {
        particleCount: 20,
        lifetime: { min: 0.2, max: 0.5 },
        speed: { min: 2, max: 6 },
    },
    
    // 伤害反馈
    damageFlash: {
        intensity: 0.7,            // 初始强度
        decaySpeed: 3.0,           // 衰减速度
    },
};

// ==================== UI 配置 ====================
export const UIConfig = {
    // 准星
    crosshair: {
        size: 16,                  // 大小 (像素)
        thickness: 2,              // 线条粗细
        gap: 4,                    // 中心间隙
        color: '#ffffff',          // 颜色
    },
    
    // HUD
    hud: {
        healthWarning: 30,         // 生命值警告阈值
        ammoWarning: 10,           // 弹药警告阈值
    },
};

// ==================== 游戏初始状态 ====================
export const InitialState = {
    health: 1000000,
    ammo: 3000000,
    grenades: 50000,
    score: 0,
};

// ==================== 关卡配置 ====================
export const LevelConfig = {
    // 玩家安全生成区 (半径)
    safeZoneRadius: 15.0,
    
    // 敌人生成
    enemySpawn: {
        maxEnemies: 2,            // 最大敌人数量
        spawnInterval: 5000,       // 生成间隔 (ms)
        spawnRadius: { min: 20, max: 40 },  // 生成距离范围
        initialDelay: 10000,          // 首次生成延迟 (ms)
        disabled: false,         // 是否禁用敌人生成
    },
    
    // 拾取物生成
    pickupSpawn: {
        maxPickups: 8,             // 最大拾取物数量
        initialDelay: 2000,        // 首次生成延迟 (ms)
        spawnInterval: 10000,      // 后续生成间隔 (ms)
    },
};

// ==================== 天气配置 ====================
export type WeatherType = 'sunny' | 'rainy' | 'windy' | 'sandstorm';

export const WeatherConfig = {
    // 天气切换
    transitionDuration: 3.0,       // 天气切换过渡时间 (秒)
    autoChange: {
        enabled: true,             // 是否自动切换天气
        minDuration: 500,           // 最短持续时间 (秒)
        maxDuration: 5000,          // 最长持续时间 (秒)
    },
    
    // 晴天配置
    sunny: {
        skyColor: 0x87ceeb,        // 天空颜色
        fogColor: 0x87ceeb,        // 雾气颜色
        fogNear: 100,              // 雾气起始距离
        fogFar: 800,               // 雾气结束距离 (匹配可视距离)
        ambientIntensity: 0.6,     // 环境光强度
        sunIntensity: 1.2,         // 太阳光强度
        sunColor: 0xffffff,        // 太阳光颜色
        windStrength: 0.0,         // 风力强度
        particleDensity: 0,        // 粒子密度
    },
    
    // 暴雨配置
    rainy: {
        skyColor: 0x2d3748,        // 更暗的天空
        fogColor: 0x4a5568,        // 深灰色雾气
        fogNear: 50,               // 雾气起始距离
        fogFar: 600,               // 能见度较低
        ambientIntensity: 0.15,    // 非常暗的环境光
        sunIntensity: 0.1,         // 太阳几乎不可见
        sunColor: 0x6b7280,        // 深灰色光
        windStrength: 1.0,         // 强风伴随暴雨
        particleDensity: 20000,    // 大量雨滴 (增加数量以适应大范围)
        rain: {
            speed: { min: 25, max: 40 },
            size: { width: 0.03, height: 0.5 },
            color: 0x8899bb,
            opacity: 0.7,
            area: { x: 200, y: 50, z: 200 },  // 降雨区域跟随相机，不需要覆盖全图
        },
    },
    
    // 大风配置
    windy: {
        skyColor: 0x9ca3af,        // 多云天空
        fogColor: 0xa0aec0,        // 雾气颜色
        fogNear: 50,               // 雾气起始
        fogFar: 300,               // 能见度
        ambientIntensity: 0.5,     // 环境光
        sunIntensity: 0.7,         // 太阳光
        sunColor: 0xe5e7eb,        // 偏白光
        windStrength: 1.5,         // 强风
        particleDensity: 1000,     // 树叶/灰尘数量
        wind: {
            direction: { x: 1, y: 0.1, z: 0.3 },  // 风向
            gustFrequency: 2.0,     // 阵风频率
            gustStrength: 0.5,      // 阵风强度变化
        },
        debris: {
            size: { min: 0.05, max: 0.15 },  // 碎片大小
            color: 0x8b7355,         // 碎片颜色 (树叶/灰尘)
            rotationSpeed: 5.0,      // 旋转速度
        },
    },
    
    // 沙尘暴配置
    sandstorm: {
        skyColor: 0xc9a86c,        // 沙黄色天空
        fogColor: 0xd4a84b,        // 黄色雾气
        fogNear: 10,               // 极近的雾
        fogFar: 100,               // 能见度极低
        ambientIntensity: 0.4,     // 昏暗环境
        sunIntensity: 0.2,         // 太阳几乎不可见
        sunColor: 0xd4a84b,        // 黄色光
        windStrength: 2.5,         // 极强风力
        particleDensity: 15000,    // 大量沙粒
        sand: {
            speed: { min: 8, max: 15 },     // 沙粒速度
            size: { min: 0.02, max: 0.08 }, // 沙粒大小
            color: 0xd4a84b,         // 沙粒颜色
            opacity: 0.7,            // 透明度
            area: { x: 150, y: 30, z: 150 },  // 沙尘区域跟随相机
        },
        visibility: {
            damagePerSecond: 0,      // 沙尘伤害 (可选)
            movementPenalty: 0.8,    // 移动速度惩罚
        },
    },
};

// ==================== 环境植被配置 ====================
export enum TreeType {
    Pine = 0,
    Oak = 1,
    Birch = 2
}

export const EnvironmentConfig = {
    trees: {
        // Density is interpreted as trees per square meter.
        // The previous value (0.06) produced extreme counts on 500x500 chunks (15k+ trees per chunk),
        // exploding triangles even with instancing.
        density: 0.0035,
        noise: { 
            scale: 0.005,    
            threshold: 0.45, 
        },
        // Distribution tuning (controls how "forest patches" form).
        // These values are intentionally exposed so we don't hardcode density behavior in systems.
        distribution: {
            // Chunk-level weight: controls how much of the total tree budget goes to dense chunks.
            // Higher exponent/amplitude => fewer but much denser forests.
            macroWeight: {
                base: 0.04,
                exponent: 4.4,
                amplitude: 7.2,
            },
            // Remap macro noise (0..1) -> denseFactor (0..1), emphasizing top-end.
            denseFactor: {
                start: 0.42,
                range: 0.34,
                power: 1.45,
            },
            // Keep shoreline a bit less dense.
            shoreFade: {
                startDistance: 250,
                min: 0.24,
                max: 0.76,
            },
            // Micro-noise threshold shift based on denseFactor.
            // Positive sparseBoost makes sparse areas clearer; negative denseReduce makes dense areas pack tighter.
            microThresholdShift: {
                sparseBoost: 0.06,
                denseReduce: 0.18,
            },
            // Global tree budget multiplier (overall forest fullness).
            globalBudgetMultiplier: 1.5,
            // Disable leaf shadow casting when a single InstancedMesh batch is extremely dense.
            leafShadowCutoff: 500,
        },
        // 树种配置
        types: [
            {
                type: TreeType.Pine,
                probability: 0.4,
                scale: { min: 0.6, max: 0.9 }, 
                colors: { trunk: 0x594026, leavesDeep: 0x1a661a, leavesLight: 0x338033 },
                geometry: {
                    layers: 5,
                    baseRadius: 0.8,   // 变细一半 (1.6 -> 0.8)
                    height: 5.5,       
                    jaggedness: 0.3
                }
            },
            {
                type: TreeType.Oak,
                probability: 0.4,
                scale: { min: 0.7, max: 1.1 }, 
                colors: { trunk: 0x664d33, leavesDeep: 0x33801a, leavesLight: 0x66b333 },
                geometry: {
                    height: 3.5,
                    clusters: 10,
                    clusterSize: 0.6, // 变小一半 (1.2 -> 0.6)
                    spread: 1.0       // 分布范围也收缩 (1.8 -> 1.0)
                }
            },
            {
                type: TreeType.Birch,
                probability: 0.2,
                scale: { min: 0.6, max: 0.9 }, 
                colors: { trunk: 0xe6e6cc, leavesDeep: 0x4d991a, leavesLight: 0xcccc33 },
                geometry: {
                    height: 5.2,
                    clusters: 7,
                    clusterSize: 0.4 // 变小一半 (0.8 -> 0.4)
                }
            }
        ],
        trunk: {
            // 通用树干配置作为fallback，具体参数在各自树种生成时指定
            segments: 7
        },
        placement: {
            minAltitude: -2.0, // 高于水位 (-3.0) 避免长在水里
            excludeRadius: {
                spawn: 45,
                default: 15
            }
        }
    },
    grass: {
        noise: {
            scale: 0.02,     
            threshold: 0.35  
        },
        // Distribution tuning (controls how "thick grass patches" form).
        distribution: {
            macroWeight: {
                base: 0.04,
                exponent: 4.6,
                amplitude: 7.8,
            },
            denseFactor: {
                start: 0.42,
                range: 0.34,
                power: 1.45,
            },
            shoreFade: {
                startDistance: 250,
                min: 0.24,
                max: 0.76,
            },
            microThresholdShift: {
                sparseBoost: 0.07,
                denseReduce: 0.20,
            },
        },
        tall: {
            count: 80000,
            height: 1.2,
            width: 0.12,
            bladeCount: 7,
            colorBase: 0x112200,
            colorTip: 0x4d6600,
            scale: { min: 0.8, max: 1.3 }
        },
        shrub: {
            count: 35000,
            colorBase: 0x003300,
            colorTip: 0x2d8600,
            scale: { min: 0.5, max: 0.9 },
            width: 0.8, 
            height: 0.7, 
            segments: 8
        },
        dry: {
            count: 25000,
            height: 0.9,
            width: 0.1,
            bladeCount: 5,
            colorBase: 0x3a3a10,
            colorTip: 0x86862d,
            scale: { min: 0.7, max: 1.1 }
        },
        placement: {
            excludeRadius: {
                spawn: 25,
                default: 8
            }
        }
    },
    water: {
        level: -3.0,
        color: 0x234d57, // 更自然的蓝绿色 (Teal)
        foamColor: 0xffffff,
        opacity: 1   // 更高的不透明度
    }
};

// ==================== 地图配置 ====================
export const MapConfig = {
    size: 4000,           // 地图大小 - 扩大以覆盖可视区域 (750 + 800 * 2)
    wallHeight: 0,        // 废弃
    waterLevel: -3.0,     // 水面高度
    boundaryRadius: 750,  // 实际可活动半径 (圆柱形边界)
    chunkSize: 500,      // 分块大小 (用于LOD和剔除) - 增大以减少 InstancedMesh 数量 (从 1600->64)，大幅降低 Draw Calls
    maxViewDistance: 800, // 最大可见距离 (为了看到海)
    terrainSegments: 800, // 地形细分数量 (保持 ~1米精度)
    terrainHeight: 15.0,  // 地形最大起伏高度
};

// ==================== 音效配置 ====================
export const SoundConfig = {
    // 全局音量
    masterVolume: 0.3,
    bgmVolume: 1.0,

    // 背景音乐配置
    bgm: {
        fadeDuration: 0.5, // Crossfade duration in seconds
        sunnyVolume: 0.8,
        rainyVolume: 0.8,
        combatVolume: 0.8,
    },
    
    // 武器音效
    weapon: {
        shoot: {
            throttle: 50, // ms
            volume: 0.5,
        },
    },

    // 环境音效
    ambient: {
        rain: {
            filterLow: 3000,
            filterHigh: 500,
        },
        wind: {
            filterFreq: 400,
            lfoFreq: 0.4,
        },
        sandstorm: {
             filterLow: 2000,
             filterHigh: 200,
        }
    }
};

// Prevent accidental runtime mutation of config.
// Runtime-tunable values should live in RuntimeSettings; these remain constants.
deepFreeze(PlayerConfig);
deepFreeze(WeaponConfig);
deepFreeze(EnemyTypesConfig);
deepFreeze(EnemyConfig);
deepFreeze(PickupConfig);
deepFreeze(EffectConfig);
deepFreeze(UIConfig);
deepFreeze(InitialState);
deepFreeze(LevelConfig);
deepFreeze(WeatherConfig);
deepFreeze(EnvironmentConfig);
deepFreeze(MapConfig);
deepFreeze(SoundConfig);
