/**
 * Pickup - 真实风格的拾取物
 * 医疗包和弹药箱 - 漂浮、发光、按F拾取
 */
import * as THREE from 'three';
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { 
    uniform, time, sin, cos, vec3, mix, float, 
    smoothstep, uv, length, fract, floor,
    sub, abs, pow, step, normalize, max
} from 'three/tsl';
import { GameStateService } from './GameState';
import { SoundManager } from './SoundManager';
import { PickupConfig } from './GameConfig';

export type PickupType = 'health' | 'ammo';

export class Pickup {
    public mesh: THREE.Group;
    public type: PickupType;
    public isCollected: boolean = false;
    public isInRange: boolean = false;  // 玩家是否在拾取范围内
    
    // TSL Uniforms
    private collectProgress: any;
    private floatOffset: number;
    private glowMesh: THREE.Mesh | null = null;
    private glowRing: THREE.Mesh | null = null;  // 地面光环

    constructor(type: PickupType, position: THREE.Vector3) {
        this.type = type;
        this.floatOffset = Math.random() * 100;
        
        // TSL Uniforms
        this.collectProgress = uniform(0);

        // 创建拾取物模型
        this.mesh = type === 'health' 
            ? this.createHealthPack()
            : this.createAmmoBox();
        
        this.mesh.position.copy(position);
        this.mesh.position.y = PickupConfig.visual.floatHeight;  // 漂浮高度
        
        this.mesh.userData = { isPickup: true, type: type };
    }

    /**
     * 创建真实的医疗包
     */
    private createHealthPack(): THREE.Group {
        const group = new THREE.Group();
        
        // ========== 地面光环 ==========
        this.glowRing = this.createGroundGlow(0x00ff44);
        this.glowRing.position.y = -0.75;
        group.add(this.glowRing);
        
        // ========== 主体盒子 ==========
        const boxGeo = new THREE.BoxGeometry(0.6, 0.4, 0.35);
        const boxMaterial = this.createHealthBoxMaterial();
        const box = new THREE.Mesh(boxGeo, boxMaterial);
        group.add(box);
        
        // ========== 盒盖 ==========
        const lidGeo = new THREE.BoxGeometry(0.62, 0.05, 0.37);
        const lidMaterial = this.createHealthLidMaterial();
        const lid = new THREE.Mesh(lidGeo, lidMaterial);
        lid.position.y = 0.225;
        group.add(lid);
        
        // ========== 提手 ==========
        const handleGeo = new THREE.TorusGeometry(0.12, 0.02, 8, 16, Math.PI);
        const handleMaterial = new MeshStandardNodeMaterial({
            roughness: 0.3,
            metalness: 0.8
        });
        handleMaterial.colorNode = vec3(0.7, 0.7, 0.72);
        const handle = new THREE.Mesh(handleGeo, handleMaterial);
        handle.rotation.x = Math.PI;
        handle.rotation.z = Math.PI / 2;
        handle.position.set(0, 0.32, 0);
        group.add(handle);
        
        // ========== 锁扣 ==========
        const claspGeo = new THREE.BoxGeometry(0.08, 0.06, 0.05);
        const claspMaterial = new MeshStandardNodeMaterial({
            roughness: 0.25,
            metalness: 0.9
        });
        claspMaterial.colorNode = vec3(0.75, 0.75, 0.78);
        
        const clasp1 = new THREE.Mesh(claspGeo, claspMaterial);
        clasp1.position.set(0.2, 0, 0.2);
        group.add(clasp1);
        
        const clasp2 = new THREE.Mesh(claspGeo, claspMaterial);
        clasp2.position.set(-0.2, 0, 0.2);
        group.add(clasp2);
        
        // ========== 顶部发光指示器 ==========
        this.glowMesh = this.createGlowIndicator(0x00ff44);
        this.glowMesh.position.set(0, 0.32, 0);
        group.add(this.glowMesh);
        
        return group;
    }

    /**
     * 医疗包盒体材质 - 白色带红十字和轻微发光
     */
    private createHealthBoxMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.6,
            metalness: 0.1
        });
        
        const uvCoord = uv();
        const t = time;
        
        // 白色塑料基底
        const baseWhite = vec3(0.95, 0.95, 0.95);
        
        // ========== 红十字标志 ==========
        const crossWidth = float(0.12);
        const crossLength = float(0.35);
        
        const inHorizontal = step(abs(uvCoord.y.sub(0.5)), crossWidth.div(2))
            .mul(step(abs(uvCoord.x.sub(0.5)), crossLength.div(2)));
        const inVertical = step(abs(uvCoord.x.sub(0.5)), crossWidth.div(2))
            .mul(step(abs(uvCoord.y.sub(0.5)), crossLength.div(2)));
        const crossMask = max(inHorizontal, inVertical);
        
        const redCross = vec3(0.85, 0.1, 0.1);
        
        // 表面细节
        const surfaceNoise = sin(uvCoord.x.mul(100)).mul(sin(uvCoord.y.mul(100))).mul(0.02);
        
        // 组合
        const baseWithCross = mix(baseWhite, redCross, crossMask);
        const finalColor = baseWithCross.add(surfaceNoise);
        
        material.colorNode = finalColor;
        
        // ========== 轻微自发光 ==========
        const glowPulse = sin(t.mul(3)).mul(0.15).add(0.2);
        const emissiveColor = vec3(0.1, 0.4, 0.15).mul(glowPulse);
        material.emissiveNode = emissiveColor;
        
        return material;
    }
    
    /**
     * 医疗包盖子材质
     */
    private createHealthLidMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.55,
            metalness: 0.1
        });
        
        const uvCoord = uv();
        const t = time;
        
        const baseWhite = vec3(0.92, 0.92, 0.92);
        const noise = sin(uvCoord.x.mul(80)).mul(sin(uvCoord.y.mul(80))).mul(0.015);
        
        const finalColor = baseWhite.add(noise);
        material.colorNode = finalColor;
        
        // 轻微发光
        const glowPulse = sin(t.mul(3)).mul(0.1).add(0.15);
        material.emissiveNode = vec3(0.1, 0.35, 0.12).mul(glowPulse);
        
        return material;
    }

    /**
     * 创建真实的弹药箱
     */
    private createAmmoBox(): THREE.Group {
        const group = new THREE.Group();
        
        // ========== 地面光环 ==========
        this.glowRing = this.createGroundGlow(0xffaa00);
        this.glowRing.position.y = -0.75;
        group.add(this.glowRing);
        
        // ========== 主体金属箱 ==========
        const boxGeo = new THREE.BoxGeometry(0.55, 0.35, 0.3);
        const boxMaterial = this.createAmmoBoxMaterial();
        const box = new THREE.Mesh(boxGeo, boxMaterial);
        group.add(box);
        
        // ========== 加强筋 ==========
        const ribGeo = new THREE.BoxGeometry(0.02, 0.36, 0.32);
        const ribMaterial = new MeshStandardNodeMaterial({
            roughness: 0.4,
            metalness: 0.85
        });
        ribMaterial.colorNode = vec3(0.25, 0.28, 0.22);
        
        const rib1 = new THREE.Mesh(ribGeo, ribMaterial);
        rib1.position.x = 0.2;
        group.add(rib1);
        
        const rib2 = new THREE.Mesh(ribGeo, ribMaterial);
        rib2.position.x = -0.2;
        group.add(rib2);
        
        // ========== 提手 ==========
        const handleGeo = new THREE.BoxGeometry(0.35, 0.04, 0.04);
        const handleMaterial = new MeshStandardNodeMaterial({
            roughness: 0.35,
            metalness: 0.85
        });
        handleMaterial.colorNode = vec3(0.3, 0.32, 0.28);
        
        const handle = new THREE.Mesh(handleGeo, handleMaterial);
        handle.position.y = 0.2;
        group.add(handle);
        
        // 提手支架
        const bracketGeo = new THREE.BoxGeometry(0.04, 0.06, 0.04);
        const bracket1 = new THREE.Mesh(bracketGeo, handleMaterial);
        bracket1.position.set(0.15, 0.175, 0);
        group.add(bracket1);
        
        const bracket2 = new THREE.Mesh(bracketGeo, handleMaterial);
        bracket2.position.set(-0.15, 0.175, 0);
        group.add(bracket2);
        
        // ========== 锁扣 ==========
        const latchGeo = new THREE.BoxGeometry(0.06, 0.08, 0.03);
        const latchMaterial = new MeshStandardNodeMaterial({
            roughness: 0.3,
            metalness: 0.9
        });
        latchMaterial.colorNode = vec3(0.65, 0.63, 0.58);
        
        const latch = new THREE.Mesh(latchGeo, latchMaterial);
        latch.position.set(0, 0, 0.165);
        group.add(latch);
        
        // ========== 子弹装饰 ==========
        const bulletGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8);
        const bulletMaterial = new MeshStandardNodeMaterial({
            roughness: 0.2,
            metalness: 0.95
        });
        bulletMaterial.colorNode = vec3(0.85, 0.7, 0.3);
        
        for (let i = 0; i < 5; i++) {
            const bullet = new THREE.Mesh(bulletGeo, bulletMaterial);
            bullet.position.set(-0.12 + i * 0.06, 0.22, 0);
            bullet.rotation.x = Math.PI / 2;
            group.add(bullet);
        }
        
        // ========== 顶部发光指示器 ==========
        this.glowMesh = this.createGlowIndicator(0xffaa00);
        this.glowMesh.position.set(0, 0.25, 0);
        group.add(this.glowMesh);
        
        return group;
    }
    
    /**
     * 弹药箱材质 - 军绿色金属带发光
     */
    private createAmmoBoxMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.5,
            metalness: 0.75
        });
        
        const uvCoord = uv();
        const t = time;
        
        // 军绿色基底
        const baseGreen = vec3(0.22, 0.28, 0.18);
        const darkGreen = vec3(0.15, 0.2, 0.12);
        
        const largeNoise = sin(uvCoord.x.mul(8)).mul(sin(uvCoord.y.mul(6))).mul(0.5).add(0.5);
        const baseColor = mix(baseGreen, darkGreen, largeNoise.mul(0.3));
        
        // 划痕
        const scratchNoise = sin(uvCoord.x.mul(60).add(uvCoord.y.mul(5)));
        const scratchMask = smoothstep(float(0.92), float(0.98), scratchNoise.mul(0.5).add(0.5));
        const scratchColor = vec3(0.4, 0.42, 0.38);
        
        const withScratch = mix(baseColor, scratchColor, scratchMask.mul(0.5));
        
        // 标记区域
        const labelArea = step(float(0.3), uvCoord.x).mul(step(uvCoord.x, float(0.7)))
            .mul(step(float(0.35), uvCoord.y)).mul(step(uvCoord.y, float(0.65)));
        const labelBg = vec3(0.18, 0.22, 0.15);
        
        const finalColor = mix(withScratch, labelBg, labelArea.mul(0.4));
        material.colorNode = finalColor;
        
        // ========== 轻微自发光 ==========
        const glowPulse = sin(t.mul(3)).mul(0.12).add(0.18);
        const emissiveColor = vec3(0.4, 0.3, 0.05).mul(glowPulse);
        material.emissiveNode = emissiveColor;
        
        // 粗糙度和金属度
        material.roughnessNode = float(0.5);
        material.metalnessNode = float(0.75);
        
        return material;
    }
    
    /**
     * 创建地面光环效果
     */
    private createGroundGlow(color: number): THREE.Mesh {
        const geo = new THREE.RingGeometry(0.3, 0.6, 32);
        const material = new MeshBasicNodeMaterial({
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        
        const t = time;
        const offset = float(this.floatOffset);
        const baseColor = new THREE.Color(color);
        const glowColor = vec3(baseColor.r, baseColor.g, baseColor.b);
        
        // 脉动和旋转效果
        const pulse = sin(t.mul(2).add(offset)).mul(0.3).add(0.6);
        
        // 从中心向外渐变
        const uvCoord = uv();
        const dist = length(uvCoord.sub(vec3(0.5, 0.5, 0)));
        const fade = smoothstep(float(0.5), float(0.2), dist);
        
        material.colorNode = glowColor.mul(pulse);
        material.opacityNode = pulse.mul(0.5).mul(fade);
        
        const mesh = new THREE.Mesh(geo, material);
        mesh.rotation.x = -Math.PI / 2;
        return mesh;
    }
    
    /**
     * 创建发光指示器
     */
    private createGlowIndicator(color: number): THREE.Mesh {
        const geo = new THREE.SphereGeometry(0.06, 12, 12);
        const material = new MeshBasicNodeMaterial({
            transparent: true
        });
        
        const t = time;
        const offset = float(this.floatOffset);
        
        const pulse = sin(t.mul(4).add(offset)).mul(0.3).add(0.7);
        const baseColor = new THREE.Color(color);
        const glowColor = vec3(baseColor.r, baseColor.g, baseColor.b);
        
        material.colorNode = glowColor.mul(pulse).mul(1.8);
        material.opacityNode = pulse;
        
        const mesh = new THREE.Mesh(geo, material);
        return mesh;
    }

    /**
     * 更新 - 检测玩家距离并显示提示
     */
    public update(playerPos: THREE.Vector3, delta: number) {
        if (this.isCollected) return;

        const t = performance.now() * 0.001;
        
        // 漂浮动画
        this.mesh.position.y = PickupConfig.visual.floatHeight + Math.sin(t * PickupConfig.visual.bobSpeed + this.floatOffset) * PickupConfig.visual.bobHeight;
        
        // 缓慢旋转
        this.mesh.rotation.y = t * PickupConfig.visual.rotateSpeed + this.floatOffset;

        // 检测距离
        const dist = this.mesh.position.distanceTo(playerPos);
        
        if (dist < PickupConfig.interaction.range) {
            if (!this.isInRange) {
                this.isInRange = true;
                // 显示拾取提示
                const hintText = this.type === 'health' ? '拾取医疗包' : '拾取弹药';
                GameStateService.getInstance().setPickupHint(hintText);
            }
        } else {
            if (this.isInRange) {
                this.isInRange = false;
                GameStateService.getInstance().setPickupHint(null);
            }
        }
    }
    
    /**
     * 尝试拾取 (由外部按键触发)
     */
    public tryCollect(): boolean {
        if (this.isCollected || !this.isInRange) return false;
        
        this.collect();
        return true;
    }

    /**
     * 收集拾取物
     */
    private collect() {
        if (this.isCollected) return;
        this.isCollected = true;
        this.isInRange = false;
        
        // 清除提示
        GameStateService.getInstance().setPickupHint(null);
        
        SoundManager.getInstance().playPickup();

        // 应用效果
        if (this.type === 'health') {
            GameStateService.getInstance().updateHealth(PickupConfig.health.amount);
        } else {
            GameStateService.getInstance().updateAmmo(PickupConfig.ammo.amount);
        }

        // 收集动画
        const animateCollect = () => {
            if (this.collectProgress.value < 1) {
                this.collectProgress.value += 0.12;
                
                this.mesh.scale.multiplyScalar(0.88);
                this.mesh.position.y += 0.08;
                this.mesh.rotation.y += 0.5;
                
                requestAnimationFrame(animateCollect);
            } else {
                this.mesh.visible = false;
            }
        };
        animateCollect();
    }

    /**
     * 清理资源
     */
    public dispose() {
        if (this.isInRange) {
            GameStateService.getInstance().setPickupHint(null);
        }
        this.mesh.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            }
        });
    }
}
