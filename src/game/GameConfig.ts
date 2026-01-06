/**
 * GameConfig - 游戏配置中心
 * 集中管理所有游戏参数，便于调整和维护
 */

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
    
    // 武器切换
    switching: {
        cooldown: 200,             // 切换冷却时间 (ms)
    },
};

// ==================== 敌人配置 ====================
export const EnemyConfig = {
    // 基础属性
    health: 100,                   // 生命值
    speed: 3.0,                    // 移动速度
    turnSpeed: 5.0,                // 转向速度
    rotationSpeed: 8.0,            // 平滑转向速度
    
    // 攻击配置
    attack: {
        damage: 8,                 // 每发伤害
        range: 50,                 // 射击范围
        fireRate: 1.5,             // 每秒射击次数
        accuracy: 0.85,            // 命中率
        engageRange: 40,           // 开火距离
        muzzleFlashDuration: 0.05, // 枪口闪光持续时间
    },
    
    // AI 配置
    ai: {
        detectionRange: 50,        // 探测范围
        loseTargetTime: 5.0,       // 失去目标时间
        patrolSpeed: 1.5,          // 巡逻速度
        chaseSpeed: 4.0,           // 追击速度
        pathUpdateInterval: 0.5,   // 路径更新间隔
        aimSpeed: 8.0,             // 抬枪速度
        aimHoldDuration: 0.8,      // 射击后保持瞄准时间
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
    // 敌人生成
    enemySpawn: {
        maxEnemies: 100,            // 最大敌人数量
        spawnInterval: 5000,       // 生成间隔 (ms)
        spawnRadius: { min: 20, max: 40 },  // 生成距离范围
    },
    
    // 拾取物生成
    pickupSpawn: {
        maxPickups: 8,             // 最大拾取物数量
    },
};

// ==================== 天气配置 ====================
export type WeatherType = 'sunny' | 'rainy' | 'windy' | 'sandstorm';

export const WeatherConfig = {
    // 天气切换
    transitionDuration: 3.0,       // 天气切换过渡时间 (秒)
    autoChange: {
        enabled: true,             // 是否自动切换天气
        minDuration: 5,           // 最短持续时间 (秒)
        maxDuration: 5,          // 最长持续时间 (秒)
    },
    
    // 晴天配置
    sunny: {
        skyColor: 0x87ceeb,        // 天空颜色
        fogColor: 0x87ceeb,        // 雾气颜色
        fogNear: 50,               // 雾气起始距离
        fogFar: 200,               // 雾气结束距离
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
        fogNear: 5,                // 极近的雾
        fogFar: 60,                // 能见度很低
        ambientIntensity: 0.15,    // 非常暗的环境光
        sunIntensity: 0.1,         // 太阳几乎不可见
        sunColor: 0x6b7280,        // 深灰色光
        windStrength: 1.0,         // 强风伴随暴雨
        particleDensity: 8000,     // 大量雨滴
        rain: {
            speed: { min: 25, max: 40 },    // 更快的下落速度
            size: { width: 0.03, height: 0.5 },  // 更大的雨滴
            color: 0x8899bb,        // 雨滴颜色
            opacity: 0.7,           // 更不透明
            area: { x: 80, y: 50, z: 80 },  // 更大的降雨区域
        },
    },
    
    // 大风配置
    windy: {
        skyColor: 0x9ca3af,        // 多云天空
        fogColor: 0xa0aec0,        // 雾气颜色
        fogNear: 30,               // 雾气起始
        fogFar: 150,               // 能见度
        ambientIntensity: 0.5,     // 环境光
        sunIntensity: 0.7,         // 太阳光
        sunColor: 0xe5e7eb,        // 偏白光
        windStrength: 1.5,         // 强风
        particleDensity: 500,      // 树叶/灰尘数量
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
        fogNear: 5,                // 极近的雾
        fogFar: 50,                // 能见度极低
        ambientIntensity: 0.4,     // 昏暗环境
        sunIntensity: 0.2,         // 太阳几乎不可见
        sunColor: 0xd4a84b,        // 黄色光
        windStrength: 2.5,         // 极强风力
        particleDensity: 5000,     // 大量沙粒
        sand: {
            speed: { min: 8, max: 15 },     // 沙粒速度
            size: { min: 0.02, max: 0.08 }, // 沙粒大小
            color: 0xd4a84b,         // 沙粒颜色
            opacity: 0.7,            // 透明度
            area: { x: 80, y: 30, z: 80 },  // 沙尘区域
        },
        visibility: {
            damagePerSecond: 0,      // 沙尘伤害 (可选)
            movementPenalty: 0.8,    // 移动速度惩罚
        },
    },
};
