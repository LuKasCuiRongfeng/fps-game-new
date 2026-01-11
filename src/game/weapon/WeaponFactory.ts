import * as THREE from 'three';
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { 
    time, sin, vec2, vec3, mix, float, 
    smoothstep, uv, abs, length, atan
} from 'three/tsl';

export class WeaponFactory {

    /**
     * 创建玩家武器网格（按武器类型）
     * 返回 mesh、枪口位置辅助点，以及建议的 Hip/ADS 位置
     */
    static createPlayerWeaponMesh(weaponId: string): {
        mesh: THREE.Mesh,
        muzzlePoint: THREE.Object3D,
        hipPosition: THREE.Vector3,
        adsPosition: THREE.Vector3,
    } {
        // 通用材质
        const material = this.createWeaponMaterial();

        // 基础 mesh（以 Box 作为承载）
        const bodyGeo = new THREE.BoxGeometry(0.08, 0.12, 0.5);
        const mesh = new THREE.Mesh(bodyGeo, material);
        mesh.castShadow = true;

        // 枪口
        const muzzlePoint = new THREE.Object3D();
        mesh.add(muzzlePoint);

        // 默认位置
        let hip = new THREE.Vector3(0.3, -0.25, -0.6);
        let ads = new THREE.Vector3(0, -0.18, -0.4);

        // 形态参数
        let barrelLength = 0.3;
        let barrelRadius = 0.022;
        let muzzleZ = -0.45;
        let hasScope = false;

        if (weaponId === 'pistol') {
            mesh.scale.set(0.85, 0.85, 0.75);
            barrelLength = 0.18;
            barrelRadius = 0.02;
            muzzleZ = -0.33;
            hip = new THREE.Vector3(0.32, -0.28, -0.55);
            ads = new THREE.Vector3(0, -0.2, -0.38);
        } else if (weaponId === 'smg') {
            mesh.scale.set(0.9, 0.9, 0.9);
            barrelLength = 0.26;
            barrelRadius = 0.02;
            muzzleZ = -0.42;
        } else if (weaponId === 'shotgun') {
            mesh.scale.set(1.05, 1.0, 1.2);
            barrelLength = 0.45;
            barrelRadius = 0.028;
            muzzleZ = -0.65;
            hip = new THREE.Vector3(0.32, -0.26, -0.65);
            ads = new THREE.Vector3(0, -0.19, -0.48);
        } else if (weaponId === 'sniper') {
            mesh.scale.set(1.0, 1.0, 1.45);
            barrelLength = 0.55;
            barrelRadius = 0.02;
            muzzleZ = -0.9;
            hasScope = true;
            hip = new THREE.Vector3(0.34, -0.24, -0.7);
            ads = new THREE.Vector3(0, -0.18, -0.52);
        } else if (weaponId === 'bow') {
            // 用简化弓模型替代枪
            const bow = this.createPlayerBow(material);
            // 用 bow 替代 mesh 的几何表现
            mesh.geometry.dispose();
            mesh.geometry = new THREE.BoxGeometry(0.01, 0.01, 0.01);
            mesh.add(bow);
            mesh.scale.set(1, 1, 1);
            muzzleZ = -0.55;
            hip = new THREE.Vector3(0.28, -0.26, -0.62);
            ads = new THREE.Vector3(0, -0.18, -0.46);
        }

        // 枪身位置（保持与旧 Weapon 视觉一致）
        mesh.position.copy(hip);

        // 枪管
        if (weaponId !== 'bow') {
            const barrelGeo = new THREE.CylinderGeometry(barrelRadius, barrelRadius * 1.2, barrelLength, 8);
            const barrelMesh = new THREE.Mesh(barrelGeo, material);
            barrelMesh.rotation.x = Math.PI / 2;
            barrelMesh.position.set(0, 0.02, -0.3 - (barrelLength - 0.3) * 0.6);
            mesh.add(barrelMesh);

            // 简易瞄具
            const sightGeo = new THREE.BoxGeometry(0.02, 0.04, 0.02);
            const sightMesh = new THREE.Mesh(sightGeo, material);
            sightMesh.position.set(0, 0.08, -0.1);
            mesh.add(sightMesh);
        }

        // 倍镜（狙击）
        if (hasScope) {
            const scopeMesh = this.createScope(material);
            mesh.add(scopeMesh);
        }

        // 设置枪口点
        muzzlePoint.position.set(0, 0.02, muzzleZ);

        return { mesh, muzzlePoint, hipPosition: hip, adsPosition: ads };
    }

    /**
     * 创建玩家近战武器模型（knife/axe）
     */
    static createPlayerMeleeMesh(weaponId: string): THREE.Group {
        const group = new THREE.Group();
        const metal = this.createWeaponMaterial();
        const wood = new MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0.05 });
        wood.colorNode = vec3(0.25, 0.18, 0.1);

        // Viewmodel base (keep geometry centered around origin; offset the group instead)
        group.position.set(0.3, -0.26, -0.62);
        group.rotation.set(0, 0, -0.18);

        if (weaponId === 'axe') {
            // Handle
            const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.62, 10), wood);
            handle.position.set(-0.05, -0.08, 0);
            handle.rotation.z = Math.PI / 2;
            handle.castShadow = true;
            group.add(handle);

            // Pommel
            const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 10), wood);
            pommel.position.set(-0.36, -0.08, 0);
            pommel.castShadow = true;
            group.add(pommel);

            // Axe head body
            const headBody = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.06), metal);
            headBody.position.set(0.18, -0.08, 0);
            headBody.castShadow = true;
            group.add(headBody);

            // Axe blade (simple wedge)
            const blade = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.16, 12), metal);
            blade.rotation.z = Math.PI / 2;
            blade.position.set(0.26, -0.08, 0);
            blade.castShadow = true;
            group.add(blade);
        } else if (weaponId === 'scythe') {
            // Scythe: long handle + curved blade
            const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.78, 10), wood);
            handle.position.set(-0.06, -0.10, 0);
            handle.rotation.z = Math.PI / 2;
            handle.castShadow = true;
            group.add(handle);

            const gripWrap = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 10), wood);
            gripWrap.position.set(-0.28, -0.10, 0);
            gripWrap.rotation.z = Math.PI / 2;
            gripWrap.castShadow = true;
            group.add(gripWrap);

            // Tang
            const tang = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.02), metal);
            tang.position.set(0.32, -0.10, 0);
            tang.castShadow = true;
            group.add(tang);

            // Curved blade (torus segment)
            const bladeArc = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 10, 18, Math.PI * 0.95), metal);
            bladeArc.rotation.z = Math.PI / 2;
            bladeArc.rotation.y = Math.PI / 2;
            bladeArc.position.set(0.38, 0.04, 0);
            bladeArc.castShadow = true;
            group.add(bladeArc);

            // Tip
            const tip = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.06, 10), metal);
            tip.rotation.z = Math.PI / 2;
            tip.position.set(0.50, 0.04, 0);
            tip.castShadow = true;
            group.add(tip);
        } else {
            // Knife: grip + guard + blade + tip
            const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.18, 10), wood);
            grip.position.set(-0.08, -0.11, 0);
            grip.rotation.z = Math.PI / 2;
            grip.castShadow = true;
            group.add(grip);

            const guard = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06), metal);
            guard.position.set(0.02, -0.11, 0);
            guard.castShadow = true;
            group.add(guard);

            const blade = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.02), metal);
            blade.position.set(0.18, -0.10, 0);
            blade.castShadow = true;
            group.add(blade);

            const tip = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.06, 10), metal);
            tip.rotation.z = -Math.PI / 2;
            tip.position.set(0.34, -0.10, 0);
            tip.castShadow = true;
            group.add(tip);
        }

        return group;
    }

    private static createPlayerBow(material: MeshStandardNodeMaterial): THREE.Group {
        const g = new THREE.Group();
        // 弓身（两个半圆弧）
        const limbGeo = new THREE.TorusGeometry(0.18, 0.01, 8, 18, Math.PI);
        const limb = new THREE.Mesh(limbGeo, material);
        limb.rotation.z = Math.PI / 2;
        limb.position.set(0.0, 0.0, -0.55);
        g.add(limb);

        // 握把
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.18, 8), material);
        grip.rotation.z = Math.PI / 2;
        grip.position.set(0.12, -0.02, -0.55);
        g.add(grip);

        // 弓弦（细线，用 cylinder 近似）
        const stringGeo = new THREE.CylinderGeometry(0.002, 0.002, 0.36, 6);
        const stringMat = new MeshBasicNodeMaterial();
        stringMat.colorNode = vec3(0.9, 0.9, 0.9);
        const bowString = new THREE.Mesh(stringGeo, stringMat);
        bowString.rotation.z = Math.PI / 2;
        bowString.position.set(-0.05, 0.0, -0.55);
        g.add(bowString);

        // 整体位置/缩放
        g.position.set(0.3, -0.25, 0);
        return g;
    }
    
    /**
     * 创建武器网格
     * 返回武器网格、瞄准镜组和枪口位置辅助点
     */
    static createWeaponMesh(): { mesh: THREE.Mesh, scopeMesh: THREE.Group, muzzlePoint: THREE.Object3D } {
        // 兼容旧逻辑：默认创建 rifle 风格
        const assets = this.createPlayerWeaponMesh('rifle');
        // 旧 API 需要 scopeMesh，这里提供一个空 group（ranged weapon 自己决定是否创建 scope）
        const scopeMesh = new THREE.Group();
        assets.mesh.add(scopeMesh);
        return { mesh: assets.mesh, scopeMesh, muzzlePoint: assets.muzzlePoint };
    }

    // 将枪口位置设置逻辑抽取出来
    private static updateMuzzlePosition(muzzlePoint: THREE.Object3D) {
        muzzlePoint.position.set(0, 0.02, -0.45); // 枪口相对于武器的位置
    }

    /**
     * 创建枪口火焰
     */
    static createMuzzleFlash(flashIntensity: any): THREE.Mesh {
        const geometry = new THREE.PlaneGeometry(0.15, 0.15);
        const material = this.createMuzzleFlashMaterial(flashIntensity);
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(0, 0.02, -0.45);
        mesh.visible = false;
        
        // 双面渲染
        const mesh2 = mesh.clone();
        mesh2.rotation.y = Math.PI / 2;
        mesh.add(mesh2);
        
        return mesh;
    }
    
    /**
     * 创建倍镜模型 - 红点瞄准镜风格
     */
    private static createScope(baseMaterial: MeshStandardNodeMaterial): THREE.Group {
        const scopeGroup = new THREE.Group();
        
        // 倍镜主体 - 圆筒形
        const tubeGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.12, 12);
        const tubeMesh = new THREE.Mesh(tubeGeo, baseMaterial);
        tubeMesh.rotation.x = Math.PI / 2;
        scopeGroup.add(tubeMesh);
        
        // 前镜片框
        const frontRingGeo = new THREE.TorusGeometry(0.025, 0.005, 8, 16);
        const frontRing = new THREE.Mesh(frontRingGeo, baseMaterial);
        frontRing.position.z = -0.06;
        scopeGroup.add(frontRing);
        
        // 后镜片框
        const backRingGeo = new THREE.TorusGeometry(0.022, 0.004, 8, 16);
        const backRing = new THREE.Mesh(backRingGeo, baseMaterial);
        backRing.position.z = 0.06;
        scopeGroup.add(backRing);
        
        // 镜片 - 半透明蓝色镜面
        const lensGeo = new THREE.CircleGeometry(0.022, 16);
        const lensMaterial = this.createLensMaterial();
        const frontLens = new THREE.Mesh(lensGeo, lensMaterial);
        frontLens.position.z = -0.058;
        scopeGroup.add(frontLens);
        
        // 红点照明 (模拟红点瞄准镜内部的红点)
        const redDotGeo = new THREE.CircleGeometry(0.003, 8);
        const redDotMaterial = this.createRedDotMaterial();
        const redDot = new THREE.Mesh(redDotGeo, redDotMaterial);
        redDot.position.z = 0.055;
        redDot.name = 'redDot';
        scopeGroup.add(redDot);
        
        // 倍镜底座/导轨
        const mountGeo = new THREE.BoxGeometry(0.015, 0.02, 0.08);
        const mount = new THREE.Mesh(mountGeo, baseMaterial);
        mount.position.y = -0.032;
        scopeGroup.add(mount);
        
        // 设置倍镜位置 (在枪身上方)
        scopeGroup.position.set(0, 0.095, -0.05);
        
        return scopeGroup;
    }
    
    /**
     * 镜片材质 - TSL 动态反射效果
     */
    private static createLensMaterial(): MeshBasicNodeMaterial {
        const material = new MeshBasicNodeMaterial();
        material.transparent = true;
        material.side = THREE.DoubleSide;
        
        const t = time;
        const uvCoord = uv();
        
        // 镜片基础颜色 - 淡蓝色
        const baseColor = vec3(0.3, 0.4, 0.6);
        
        // 径向渐变 (中心透明，边缘有色)
        const center = vec3(0.5, 0.5, 0);
        const dist = length(uvCoord.sub(center.xy));
        const edgeGlow = smoothstep(float(0.2), float(0.5), dist);
        
        // 动态反光效果
        const shimmer = sin(t.mul(2).add(uvCoord.x.mul(10))).mul(0.1).add(0.9);
        
        material.colorNode = baseColor.mul(edgeGlow).mul(shimmer);
        material.opacityNode = mix(float(0.1), float(0.4), edgeGlow);
        
        return material;
    }
    
    /**
     * 红点材质 - 发光的红点
     */
    private static createRedDotMaterial(): MeshBasicNodeMaterial {
        const material = new MeshBasicNodeMaterial();
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        
        const t = time;
        const uvCoord = uv();
        
        // 红点颜色
        const redColor = vec3(1.0, 0.1, 0.05);
        
        // 圆形渐变
        const center = vec3(0.5, 0.5, 0);
        const dist = length(uvCoord.sub(center.xy));
        const dotShape = smoothstep(float(0.5), float(0.2), dist);
        
        // 微弱脉动
        const pulse = sin(t.mul(3)).mul(0.15).add(0.85);
        
        material.colorNode = redColor.mul(pulse).mul(1.5);
        material.opacityNode = dotShape.mul(pulse);
        
        return material;
    }

    /**
     * 武器材质 - 金属质感
     */
    private static createWeaponMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.25,
            metalness: 0.95
        });

        const uvCoord = uv();
        
        // ========== 金属刷纹 ==========
        const brushFreq = float(200);
        const brushPattern = sin(uvCoord.x.mul(brushFreq)).mul(0.015);
        
        // ========== 基础颜色 ==========
        const baseColor = vec3(0.15, 0.14, 0.13);
        const highlightColor = vec3(0.25, 0.24, 0.22);
        
        // 高光区域
        const highlight = smoothstep(float(0.3), float(0.7), uvCoord.y);
        const metalColor = mix(baseColor, highlightColor, highlight);
        
        // 添加刷纹
        const finalColor = metalColor.add(brushPattern);
        
        material.colorNode = finalColor;
        
        // ========== 动态反射 ==========
        // 环境光反射
        material.envMapIntensity = 0.8;
        
        // 刷纹处略粗糙
        material.roughnessNode = mix(float(0.2), float(0.35), abs(brushPattern).mul(10));
        
        return material;
    }
    
    /**
     * 枪口火焰材质 - 动态火焰效果
     */
    private static createMuzzleFlashMaterial(intensity: any): MeshBasicNodeMaterial {
        const material = new MeshBasicNodeMaterial();
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.side = THREE.DoubleSide;

        const t = time;
        
        // 火焰颜色渐变
        const innerColor = vec3(1, 1, 0.9); // 白黄色中心
        const midColor = vec3(1, 0.8, 0.3); // 金色
        const outerColor = vec3(1, 0.4, 0.05); // 橙红色边缘
        
        // UV 坐标
        const uvCoord = uv().sub(vec2(0.5)); // 中心化 UV (-0.5 到 0.5)
        
        // 极坐标变换
        const dist = length(uvCoord);
        const angle = atan(uvCoord.y, uvCoord.x);
        
        // === 1. 星形核心 ===
        // 随机旋转
        const rot = t.mul(20.0);
        
        // 多个尖角的星形 (模拟枪口逸出的火焰气体)
        const spikes = 5.0; // 5个主尖峰
        // 增加高频噪声，使形状不规则
        const shapeNoise = sin(angle.mul(spikes).add(rot))
            .mul(0.15)
            .add(sin(angle.mul(13.0).sub(rot.mul(2.0))).mul(0.08)) // 次级尖峰
            .add(sin(angle.mul(29.0)).mul(0.03)); // 细碎边缘
            
        // 基础形状衰减
        const starShape = smoothstep(float(0.4), float(0.05), dist.add(shapeNoise.mul(dist)));
        
        // === 2. 核心辉光 (更亮更圆) ===
        const coreGlow = smoothstep(float(0.15), float(0.0), dist);
        
        // === 3. 随机发散的粒子感 (模拟火星) ===
        // 简单的噪声模拟
        const noise = sin(uvCoord.x.mul(50.0).add(t)).mul(sin(uvCoord.y.mul(50.0).add(t.mul(2.0))));
        const particles = smoothstep(float(0.8), float(1.0), noise).mul(smoothstep(float(0.4), float(0.2), dist));
        
        // === 合成 ===
        // 闪烁效果 (非常快)
        const flicker = sin(t.mul(150.0)).mul(0.15).add(0.95);
        
        // 颜色混合逻辑
        // 核心最白 -> 中间金 -> 边缘橙红
        // 基于距离和一点随机噪声
        const colorMix = dist.mul(3.5).add(shapeNoise.mul(1.5)); 
        const baseFire = mix(midColor, outerColor, smoothstep(float(0.0), float(1.0), colorMix));
        const finalColor = mix(innerColor, baseFire, smoothstep(float(0.0), float(0.2), dist));
        
        // 组合形状
        const combinedShape = starShape.add(coreGlow.mul(0.8)).add(particles.mul(0.5));
        
        // 最终输出
        // 强度控制：intensity 统一缩放整体亮度
        // 越边缘透明度越低
        material.colorNode = finalColor.mul(combinedShape).mul(intensity).mul(flicker).mul(2.5); // 提亮
        material.opacityNode = combinedShape.mul(intensity).clamp(0, 1);
        
        return material;
    }
}
