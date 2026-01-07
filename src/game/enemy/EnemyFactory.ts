import * as THREE from 'three';
import { EnemyMaterials } from './EnemyMaterials';
import { EnemyType, EnemyTypesConfig } from '../core/GameConfig';

export class EnemyFactory {
    
    // 静态几何体缓存，大幅减少 Draw Call 和内存占用
    private static geoCache: Map<string, THREE.BufferGeometry> = new Map();

    /**
     * 几何体合并辅助函数
     */
    private static mergeBuffGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
        const positions: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
        
        let vertexOffset = 0;
        
        geometries.forEach(geo => {
            const posAttr = geo.attributes.position;
            const normAttr = geo.attributes.normal;
            const uvAttr = geo.attributes.uv;
            const indexAttr = geo.index;
            
            // 确保都有 UV
            if (!uvAttr) { 
                // 如果没有 UV，生成默认的 0,0
                for(let k=0; k<posAttr.count; k++) { uvs.push(0, 0); }
            }
            
            for (let i = 0; i < posAttr.count; i++) {
                positions.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
                normals.push(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i));
                if (uvAttr) uvs.push(uvAttr.getX(i), uvAttr.getY(i));
            }
            
            if (indexAttr) {
                for (let i = 0; i < indexAttr.count; i++) {
                    indices.push(indexAttr.getX(i) + vertexOffset);
                }
            } else {
                 for (let i = 0; i < posAttr.count; i++) {
                    indices.push(i + vertexOffset);
                }
            }
            
            vertexOffset += posAttr.count;
            // 清理临时几何体，避免内存泄漏
            geo.dispose();
        });
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geometry.setIndex(indices);
        
        return geometry;
    }

    /**
     * 创建人形敌人模型
     */
    static createHumanoidEnemy(type: EnemyType, hitStrength: any): {
        group: THREE.Group,
        body: THREE.Mesh,
        head: THREE.Mesh,
        leftArm: THREE.Group,
        rightArm: THREE.Group,
        leftLeg: THREE.Group,
        rightLeg: THREE.Group,
        eyes: THREE.Mesh,
        headDetails: THREE.Group,
        weapon: THREE.Group,
        muzzlePoint: THREE.Object3D,
        muzzleFlash: THREE.Mesh
    } {
        const config = EnemyTypesConfig[type];
        const group = new THREE.Group();
        
        // 材质
        const bodyMaterial = EnemyMaterials.createBodyMaterial(config.color, hitStrength);
        const headMaterial = EnemyMaterials.createHeadMaterial(hitStrength);
        const eyeMaterial = EnemyMaterials.createEyeMaterial(type);
        const armorMaterial = EnemyMaterials.createArmorMaterial(config.color, hitStrength);
        
        // ========== 身体 (躯干) ==========
        const torsoKey = `torso_armor_${type}`;
        
        if (!this.geoCache.has(torsoKey)) {
            const geos: THREE.BufferGeometry[] = [];
            
            // 基础尺寸调整
            let torsoWidth = 0.6;
            let torsoDepth = 0.35;
            let shoulderSize = 0.25;
            
            if (type === 'heavy') {
                torsoWidth = 0.8;
                torsoDepth = 0.5;
                shoulderSize = 0.35;
            } else if (type === 'scout') {
                torsoWidth = 0.5;
                torsoDepth = 0.3;
                shoulderSize = 0.15;
            }

            // 主躯干
            const torsoGeo = new THREE.BoxGeometry(torsoWidth, 0.8, torsoDepth);
            geos.push(torsoGeo);
            
            // 左肩
            const lShoulder = new THREE.BoxGeometry(shoulderSize, 0.15, shoulderSize);
            lShoulder.rotateZ(-0.2);
            // 调整肩部位置
            const shoulderX = type === 'heavy' ? 0.55 : 0.45;
            lShoulder.translate(-shoulderX, 0.25, 0);
            geos.push(lShoulder);
            
            // 右肩
            const rShoulder = new THREE.BoxGeometry(shoulderSize, 0.15, shoulderSize);
            rShoulder.rotateZ(0.2);
            rShoulder.translate(shoulderX, 0.25, 0);
            geos.push(rShoulder);
            
            this.geoCache.set(torsoKey, this.mergeBuffGeometries(geos));
        }
        
        const body = new THREE.Mesh(this.geoCache.get(torsoKey), armorMaterial);
        body.position.y = 1.2;
        body.castShadow = true; 
        group.add(body);
        
        // 腹部 (独立，方便动画时的相对运动)
        if (!this.geoCache.has('abdomen')) {
            this.geoCache.set('abdomen', new THREE.BoxGeometry(0.5, 0.3, 0.3));
        }
        const abdomen = new THREE.Mesh(this.geoCache.get('abdomen'), bodyMaterial);
        abdomen.position.y = 0.7;
        abdomen.castShadow = false;
        group.add(abdomen);
        
        // ========== 头部 ==========
        const headGroup = new THREE.Group();
        headGroup.position.y = 1.75;
        
        // 头部主体
        if (!this.geoCache.has('head_main')) {
            const h = new THREE.SphereGeometry(0.22, 12, 10);
            h.scale(1, 1.1, 1);
            this.geoCache.set('head_main', h);
        }
        const head = new THREE.Mesh(this.geoCache.get('head_main'), headMaterial);
        head.castShadow = true;
        headGroup.add(head);
        
        // 头盔
        const helmetKey = `head_helmet_${type}`;
        if (!this.geoCache.has(helmetKey)) {
            let radius = 0.24;
            let phiLen = Math.PI * 0.6;
            
            if (type === 'heavy') {
                radius = 0.28;
                phiLen = Math.PI * 0.8;
            } else if (type === 'elite') {
                phiLen = Math.PI * 0.5;
            }

            const he = new THREE.SphereGeometry(radius, 12, 10, 0, Math.PI * 2, 0, phiLen);
            he.translate(0, 0.05, 0); // Bake offset
            this.geoCache.set(helmetKey, he);
        }
        const helmet = new THREE.Mesh(this.geoCache.get(helmetKey), armorMaterial);
        helmet.castShadow = false;
        headGroup.add(helmet);
        
        // --- LOD 细节组 ---
        const headDetails = new THREE.Group();
        headGroup.add(headDetails);

        // 眼睛
        if (!this.geoCache.has('head_eyes')) {
            const eyesArr: THREE.BufferGeometry[] = [];
            const eyeBase = new THREE.SphereGeometry(0.04, 8, 6);
            
            const left = eyeBase.clone();
            left.translate(-0.08, 0, 0.18);
            eyesArr.push(left);
            
            const right = eyeBase.clone();
            right.translate(0.08, 0, 0.18);
            eyesArr.push(right);
            
            this.geoCache.set('head_eyes', this.mergeBuffGeometries(eyesArr));
        }
        const eyes = new THREE.Mesh(this.geoCache.get('head_eyes'), eyeMaterial);
        eyes.castShadow = false;
        headDetails.add(eyes);
        
        // 面部护甲条
        if (!this.geoCache.has('head_visor')) {
            const v = new THREE.BoxGeometry(0.3, 0.04, 0.08);
            v.translate(0, -0.05, 0.18);
            this.geoCache.set('head_visor', v);
        }
        const visor = new THREE.Mesh(this.geoCache.get('head_visor'), armorMaterial);
        visor.castShadow = false;
        headDetails.add(visor);
        
        group.add(headGroup);
        
        // ========== 手臂 ==========
        const leftArm = this.createArm(bodyMaterial, armorMaterial);
        leftArm.position.set(-0.45, 1.3, 0);
        group.add(leftArm);
        
        const rightArm = this.createArm(bodyMaterial, armorMaterial);
        rightArm.position.set(0.45, 1.3, 0);
        group.add(rightArm);
        
        // ========== 武器 ==========
        const weaponData = this.createWeapon(type);
        const weapon = weaponData.group;
        rightArm.add(weapon);
        weapon.position.set(0, -0.65, 0.2);
        weapon.rotation.x = -Math.PI / 2;
        
        // ========== 腿部 ==========
        const leftLeg = this.createLeg(bodyMaterial, armorMaterial);
        leftLeg.position.set(-0.15, 0.55, 0);
        group.add(leftLeg);
        
        const rightLeg = this.createLeg(bodyMaterial, armorMaterial);
        rightLeg.position.set(0.15, 0.55, 0);
        group.add(rightLeg);
        
        // 设置所有子对象的 userData
        group.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.userData = { isEnemy: true }; // entity 引用需要在外部设置
                child.receiveShadow = true;
            }
        });
        
        return { 
            group, body, head, leftArm, rightArm, leftLeg, rightLeg, eyes, headDetails,
            weapon, muzzlePoint: weaponData.muzzlePoint, muzzleFlash: weaponData.muzzleFlash
        };
    }
    
    private static createArm(bodyMaterial: THREE.Material, armorMaterial: THREE.Material): THREE.Group {
        const arm = new THREE.Group();
        
        if (!this.geoCache.has('arm_body')) {
            const bodyGeos: THREE.BufferGeometry[] = [];
            
            const upperArmGeo = new THREE.CapsuleGeometry(0.08, 0.25, 4, 8);
            upperArmGeo.translate(0, -0.2, 0);
            bodyGeos.push(upperArmGeo);
            
            const forearmGeo = new THREE.CapsuleGeometry(0.06, 0.22, 4, 8);
            forearmGeo.translate(0, -0.5, 0);
            bodyGeos.push(forearmGeo);
            
            const handGeo = new THREE.SphereGeometry(0.06, 6, 6);
            handGeo.translate(0, -0.7, 0);
            bodyGeos.push(handGeo);
            
            this.geoCache.set('arm_body', this.mergeBuffGeometries(bodyGeos));
            
            const bracerGeo = new THREE.CylinderGeometry(0.09, 0.1, 0.15, 8);
            bracerGeo.translate(0, -0.2, 0);
            this.geoCache.set('arm_armor', bracerGeo);
        }
        
        const armBody = new THREE.Mesh(this.geoCache.get('arm_body'), bodyMaterial);
        armBody.castShadow = true;
        arm.add(armBody);
        
        const armArmor = new THREE.Mesh(this.geoCache.get('arm_armor'), armorMaterial);
        armArmor.castShadow = false;
        arm.add(armArmor);
        
        return arm;
    }
    
    private static createLeg(bodyMaterial: THREE.Material, armorMaterial: THREE.Material): THREE.Group {
        const leg = new THREE.Group();
        
        if (!this.geoCache.has('leg_body') || !this.geoCache.has('leg_armor')) {
            const bodyGeos: THREE.BufferGeometry[] = [];
            const thighGeo = new THREE.CapsuleGeometry(0.1, 0.28, 4, 8);
            thighGeo.translate(0, -0.2, 0);
            bodyGeos.push(thighGeo);
            
            const shinGeo = new THREE.CapsuleGeometry(0.07, 0.3, 4, 8);
            shinGeo.translate(0, -0.55, 0);
            bodyGeos.push(shinGeo);
            
            this.geoCache.set('leg_body', this.mergeBuffGeometries(bodyGeos));
            
            const armorGeos: THREE.BufferGeometry[] = [];
            const thighArmorGeo = new THREE.CylinderGeometry(0.11, 0.12, 0.2, 8);
            thighArmorGeo.translate(0, -0.15, 0);
            armorGeos.push(thighArmorGeo);
            
            const shinArmorGeo = new THREE.BoxGeometry(0.1, 0.25, 0.12);
            shinArmorGeo.translate(0, -0.5, 0.04);
            armorGeos.push(shinArmorGeo);
            
            const bootGeo = new THREE.BoxGeometry(0.12, 0.1, 0.2);
            bootGeo.translate(0, -0.8, 0.03);
            armorGeos.push(bootGeo);
            
            this.geoCache.set('leg_armor', this.mergeBuffGeometries(armorGeos));
        }
        
        const legBody = new THREE.Mesh(this.geoCache.get('leg_body'), bodyMaterial);
        legBody.castShadow = true;
        leg.add(legBody);
        
        const legArmor = new THREE.Mesh(this.geoCache.get('leg_armor'), armorMaterial);
        legArmor.castShadow = false;
        leg.add(legArmor);
        
        return leg;
    }

    private static createWeapon(type: EnemyType): { group: THREE.Group, muzzlePoint: THREE.Object3D, muzzleFlash: THREE.Mesh } {
        const weapon = new THREE.Group();
        const config = EnemyTypesConfig[type]; // used only for getting weapon type logic if needed, but type is passed
        const weaponType = config.weapon || 'rifle';
        
        const gunMaterial = EnemyMaterials.createGunMaterial();
        const metalMaterial = EnemyMaterials.createGunMetalMaterial();
        
        const bodyKey = `weapon_body_${weaponType}`;
        const metalKey = `weapon_metal_${weaponType}`;
        
        if (!this.geoCache.has(bodyKey) || !this.geoCache.has(metalKey)) {
            const bodyGeos: THREE.BufferGeometry[] = [];
            const metalGeos: THREE.BufferGeometry[] = [];
            
            if (weaponType === 'smg') {
                const body = new THREE.BoxGeometry(0.05, 0.08, 0.3);
                body.translate(0, 0, 0.05);
                bodyGeos.push(body);
                
                const mag = new THREE.BoxGeometry(0.03, 0.15, 0.04);
                mag.translate(0, -0.1, 0.05); 
                bodyGeos.push(mag);
                
                const grip = new THREE.BoxGeometry(0.04, 0.1, 0.04);
                grip.rotateX(0.2);
                grip.translate(0, -0.08, -0.1);
                bodyGeos.push(grip);

                const barrel = new THREE.CylinderGeometry(0.012, 0.012, 0.15, 8);
                barrel.rotateX(Math.PI / 2);
                barrel.translate(0, 0.02, 0.25);
                metalGeos.push(barrel);

            } else if (weaponType === 'shotgun') {
                const body = new THREE.BoxGeometry(0.07, 0.09, 0.5);
                body.translate(0, 0, 0.1);
                bodyGeos.push(body);
                
                const pump = new THREE.CylinderGeometry(0.025, 0.025, 0.2, 8);
                pump.rotateX(Math.PI / 2);
                pump.translate(0, -0.02, 0.35);
                bodyGeos.push(pump);
                
                const stock = new THREE.BoxGeometry(0.05, 0.06, 0.15);
                stock.translate(0, -0.02, -0.2);
                bodyGeos.push(stock);

                const barrel = new THREE.CylinderGeometry(0.02, 0.02, 0.45, 8);
                barrel.rotateX(Math.PI / 2);
                barrel.translate(0, 0.02, 0.4);
                metalGeos.push(barrel);

            } else if (weaponType === 'sniper') {
                const body = new THREE.BoxGeometry(0.06, 0.07, 0.4);
                body.translate(0, 0, 0);
                bodyGeos.push(body);
                
                const stock = new THREE.BoxGeometry(0.05, 0.08, 0.25);
                stock.translate(0, 0, -0.25);
                bodyGeos.push(stock);
                
                const scope = new THREE.CylinderGeometry(0.025, 0.03, 0.15, 8);
                scope.rotateX(Math.PI / 2);
                scope.translate(0, 0.08, 0.05);
                metalGeos.push(scope);

                const barrel = new THREE.CylinderGeometry(0.01, 0.012, 0.7, 8);
                barrel.rotateX(Math.PI / 2);
                barrel.translate(0, 0.02, 0.5);
                metalGeos.push(barrel);

                const stand = new THREE.BoxGeometry(0.02, 0.15, 0.02); 
                stand.translate(0, -0.05, 0.4);
                metalGeos.push(stand);

            } else {
                // Rifle
                const bodyGeo = new THREE.BoxGeometry(0.06, 0.08, 0.5);
                bodyGeo.translate(0, 0, 0.1);
                bodyGeos.push(bodyGeo);
                
                const magGeo = new THREE.BoxGeometry(0.04, 0.15, 0.06);
                magGeo.translate(0, -0.1, 0.05);
                bodyGeos.push(magGeo);
                
                const stockGeo = new THREE.BoxGeometry(0.05, 0.06, 0.15);
                stockGeo.translate(0, 0, -0.2);
                bodyGeos.push(stockGeo);
                
                const gripGeo = new THREE.BoxGeometry(0.04, 0.1, 0.04);
                gripGeo.rotateX(0.2);
                gripGeo.translate(0, -0.08, 0);
                bodyGeos.push(gripGeo);

                const barrelGeo = new THREE.CylinderGeometry(0.015, 0.018, 0.35, 8);
                barrelGeo.rotateX(Math.PI / 2);
                barrelGeo.translate(0, 0, 0.5);
                metalGeos.push(barrelGeo);
                
                const scopeGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.08, 8);
                scopeGeo.rotateX(Math.PI / 2);
                scopeGeo.translate(0, 0.06, 0.15);
                metalGeos.push(scopeGeo);
            }
            
            if (metalGeos.length === 0) {
                 const dummy = new THREE.BoxGeometry(0,0,0);
                 metalGeos.push(dummy);
            }
            
            this.geoCache.set(bodyKey, this.mergeBuffGeometries(bodyGeos));
            this.geoCache.set(metalKey, this.mergeBuffGeometries(metalGeos));
        }
        
        const gunMesh = new THREE.Mesh(this.geoCache.get(bodyKey), gunMaterial);
        gunMesh.castShadow = true;
        weapon.add(gunMesh);
        
        const metalMesh = new THREE.Mesh(this.geoCache.get(metalKey), metalMaterial);
        metalMesh.castShadow = false;
        weapon.add(metalMesh);
        
        let muzzleZ = 0.7;
        if (weaponType === 'smg') muzzleZ = 0.4;
        if (weaponType === 'shotgun') muzzleZ = 0.65;
        if (weaponType === 'sniper') muzzleZ = 0.9;
        
        // 枪口闪光
        const muzzleFlash = this.createMuzzleFlash();
        muzzleFlash.position.z = muzzleZ;
        muzzleFlash.visible = false;
        weapon.add(muzzleFlash);
        
        // 枪口位置点
        const muzzlePoint = new THREE.Object3D();
        muzzlePoint.position.z = muzzleZ;
        weapon.add(muzzlePoint);
        
        return { group: weapon, muzzlePoint, muzzleFlash };
    }

    private static createMuzzleFlash(): THREE.Mesh {
        const flashMaterial = EnemyMaterials.createMuzzleFlashMaterial();
        const flashGeo = new THREE.SphereGeometry(0.08, 8, 6);
        const flash = new THREE.Mesh(flashGeo, flashMaterial);
        flash.scale.set(1, 1, 2);
        return flash;
    }
}
