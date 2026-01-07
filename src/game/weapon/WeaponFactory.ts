import * as THREE from 'three';
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { 
    uniform, time, sin, vec2, vec3, mix, float, 
    smoothstep, uv, sub, abs, length, atan
} from 'three/tsl';

export class WeaponFactory {
    
    /**
     * 创建武器网格
     * 返回武器网格、瞄准镜组和枪口位置辅助点
     */
    static createWeaponMesh(): { mesh: THREE.Mesh, scopeMesh: THREE.Group, muzzlePoint: THREE.Object3D } {
        // 组合几何体创建枪形
        const bodyGeo = new THREE.BoxGeometry(0.08, 0.12, 0.5);
        const material = this.createWeaponMaterial();
        
        const mesh = new THREE.Mesh(bodyGeo, material);
        mesh.position.set(0.3, -0.25, -0.6);
        mesh.castShadow = true;
        
        // 添加枪管
        const barrelGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.3, 8);
        const barrelMesh = new THREE.Mesh(barrelGeo, material);
        barrelMesh.rotation.x = Math.PI / 2;
        barrelMesh.position.set(0, 0.02, -0.3);
        mesh.add(barrelMesh);
        
        // 添加瞄准器
        const sightGeo = new THREE.BoxGeometry(0.02, 0.04, 0.02);
        const sightMesh = new THREE.Mesh(sightGeo, material);
        sightMesh.position.set(0, 0.08, -0.1);
        mesh.add(sightMesh);
        
        // 添加倍镜
        const scopeMesh = this.createScope(material);
        mesh.add(scopeMesh);
        
        // 创建枪口位置辅助点
        const muzzlePoint = new THREE.Object3D();
        this.updateMuzzlePosition(muzzlePoint);
        mesh.add(muzzlePoint);
        
        return { mesh, scopeMesh, muzzlePoint };
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
