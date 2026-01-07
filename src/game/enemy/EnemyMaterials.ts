import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { 
    vec3, mix, float, sin, time
} from 'three/tsl';

export class EnemyMaterials {

    static createGunMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.6,
            metalness: 0.2
        });
        
        const baseColor = vec3(0.08, 0.08, 0.1);
        material.colorNode = baseColor;
        
        return material;
    }

    static createGunMetalMaterial(): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.3,
            metalness: 0.9
        });
        
        const metalColor = vec3(0.2, 0.2, 0.22);
        material.colorNode = metalColor;
        
        return material;
    }

    static createMuzzleFlashMaterial(): MeshStandardNodeMaterial {
        const flashMaterial = new MeshStandardNodeMaterial({
            transparent: true,
            depthWrite: false
        });
        
        const t = time;
        const flashColor = vec3(1.0, 0.8, 0.3);
        const pulse = sin(t.mul(50)).mul(0.3).add(0.7);
        
        flashMaterial.colorNode = flashColor;
        flashMaterial.emissiveNode = flashColor.mul(pulse).mul(3);
        flashMaterial.opacityNode = float(0.9);
        
        return flashMaterial;
    }

    static createBodyMaterial(color: string | number | THREE.Color, hitStrength: any): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.7,
            metalness: 0.1
        });
        
        // 基于配置颜色的深色紧身衣
        const c = new THREE.Color(color);
        // 降低亮度作为紧身衣颜色 (保持色调但更暗)
        const darkFactor = 0.4;
        const r = c.r * darkFactor;
        const g = c.g * darkFactor;
        const b = c.b * darkFactor;
        
        const baseColor = vec3(r, g, b);
        
        // 受击闪烁 - 白色
        const hitColor = vec3(1, 1, 1);
        const finalColor = mix(baseColor, hitColor, hitStrength);
        
        material.colorNode = finalColor;
        
        return material;
    }

    static createHeadMaterial(hitStrength: any): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.6,
            metalness: 0.2
        });
        
        // 灰绿色皮肤 (异星人感)
        const skinColor = vec3(0.35, 0.4, 0.38);
        const hitColor = vec3(1, 1, 1);
        const finalColor = mix(skinColor, hitColor, hitStrength);
        
        material.colorNode = finalColor;
        
        return material;
    }

    static createEyeMaterial(type: string): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.2,
            metalness: 0.5
        });
        
        const t = time;
        
        // 根据类型区分眼睛颜色
        let r=1.0, g=0.8, b=0.1; // Default Yellow
        
        if (type === 'heavy') {
            r=1.0; g=0.1; b=0.1; // Red (Aggressive)
        } else if (type === 'scout') {
            r=0.2; g=1.0; b=0.5; // Green (Agile)
        } else if (type === 'elite') {
            r=0.8; g=0.2; b=1.0; // Purple (Special)
        } else {
            // Soldier - Cyan (Tech)
             r=0.1; g=0.8; b=1.0;
        }

        const eyeColor = vec3(r, g, b);
        
        // 脉动
        const pulse = sin(t.mul(4)).mul(0.2).add(0.8);
        
        material.colorNode = eyeColor.mul(pulse);
        material.emissiveNode = eyeColor.mul(pulse).mul(3); // Increase brightness
        
        return material;
    }

    static createArmorMaterial(color: string | number | THREE.Color, hitStrength: any): MeshStandardNodeMaterial {
        const material = new MeshStandardNodeMaterial({
            roughness: 0.4, // 稍微降低光滑度，让颜色更明显
            metalness: 0.6  // 降低金属感，避免颜色被环境反射冲淡
        });
        
        const t = time;
        
        // 使用配置颜色
        const c = new THREE.Color(color);
        const armorBase = vec3(c.r, c.g, c.b);
        // 高光部分保留一点白色混合，但主要还是基于原色变亮
        const highlightArmor = vec3(
            Math.min(1, c.r * 1.5 + 0.1), 
            Math.min(1, c.g * 1.5 + 0.1), 
            Math.min(1, c.b * 1.5 + 0.1)
        );
        
        // 脉动效果
        const pulse = sin(t.mul(3)).mul(0.1).add(0.9);
        const pulsedColor = mix(armorBase, highlightArmor, pulse.sub(0.9).mul(2));
        
        // 受击效果 - 白色闪烁
        const hitColor = vec3(1, 1, 1);
        const finalColor = mix(pulsedColor, hitColor, hitStrength);
        
        material.colorNode = finalColor;
        
        // 自发光效果 - 淡蓝色
        const emissiveColor = vec3(0.05, 0.1, 0.2);
        material.emissiveNode = mix(emissiveColor.mul(pulse), vec3(0.8, 0.9, 1.0), hitStrength);
        
        // 受击时更亮
        material.metalnessNode = mix(float(0.85), float(1.0), hitStrength);
        
        return material;
    }
}
