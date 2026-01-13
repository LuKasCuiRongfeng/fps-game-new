import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { getUserData } from '../types/GameUserData';
import type { System, FrameContext } from '../core/engine/System';

type TrailInstance = {
    group: THREE.Group;
    core: THREE.Mesh;
    inner: THREE.Mesh;
    outer: THREE.Mesh;
    coreMaterial: MeshBasicNodeMaterial;
    innerMaterial: MeshBasicNodeMaterial;
    outerMaterial: MeshBasicNodeMaterial;
    time: number;
    opacity: number;
};

export class EnemyTrailSystem implements System {
    public readonly name = 'trails';

    private readonly scene: THREE.Scene;

    private readonly enemyTrailFadeDelay = 0.08;
    private readonly enemyTrailFadeRate = 2.4;

    private enemyTrailPool: TrailInstance[] = [];
    private enemyTrailActive: TrailInstance[] = [];

    private enemyTrailCoreGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 6, 1);
    private enemyTrailInnerGeo = new THREE.CylinderGeometry(0.025, 0.02, 1, 8, 1);
    private enemyTrailOuterGeo = new THREE.CylinderGeometry(0.05, 0.04, 1, 8, 1);

    private tmpTrailDir = new THREE.Vector3();
    private tmpTrailMid = new THREE.Vector3();
    private tmpTrailQuat = new THREE.Quaternion();
    private readonly tmpUp = new THREE.Vector3(0, 1, 0);

    constructor(scene: THREE.Scene) {
        this.scene = scene;
    }

    update(frame: FrameContext): void {
        const delta = frame.delta;
        for (let i = this.enemyTrailActive.length - 1; i >= 0; i--) {
            const t = this.enemyTrailActive[i];
            t.time += delta;

            if (t.time < this.enemyTrailFadeDelay) continue;

            t.opacity -= this.enemyTrailFadeRate * delta;
            if (t.opacity > 0) {
                t.coreMaterial.opacity = t.opacity;
                t.innerMaterial.opacity = t.opacity * 0.7;
                t.outerMaterial.opacity = t.opacity * 0.35;
                continue;
            }

            this.scene.remove(t.group);
            this.enemyTrailActive.splice(i, 1);
            this.enemyTrailPool.push(t);
        }
    }

    spawnTrail(start: THREE.Vector3, end: THREE.Vector3): void {
        const direction = this.tmpTrailDir.subVectors(end, start);
        const length = direction.length();
        if (length < 0.1) return;
        direction.multiplyScalar(1 / length);

        const midpoint = this.tmpTrailMid.addVectors(start, end).multiplyScalar(0.5);
        const quaternion = this.tmpTrailQuat.setFromUnitVectors(this.tmpUp, direction);

        const trail = this.enemyTrailPool.pop() ?? this.allocateEnemyTrail();
        trail.time = 0;
        trail.opacity = 1;
        trail.group.position.copy(midpoint);
        trail.group.quaternion.copy(quaternion);
        trail.coreMaterial.opacity = 1.0;
        trail.innerMaterial.opacity = 0.7;
        trail.outerMaterial.opacity = 0.35;

        trail.core.scale.set(1, length, 1);
        trail.inner.scale.set(1, length, 1);
        trail.outer.scale.set(1, length, 1);

        this.scene.add(trail.group);
        this.enemyTrailActive.push(trail);
    }

    private allocateEnemyTrail(): TrailInstance {
        const trailGroup = new THREE.Group();
        getUserData(trailGroup).isBulletTrail = true;

        const coreMaterial = new MeshBasicNodeMaterial({
            color: 0xff6600,
            transparent: true,
            opacity: 1.0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const innerGlowMaterial = new MeshBasicNodeMaterial({
            color: 0xff3300,
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const outerGlowMaterial = new MeshBasicNodeMaterial({
            color: 0xff2200,
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });

        const core = new THREE.Mesh(this.enemyTrailCoreGeo, coreMaterial);
        const inner = new THREE.Mesh(this.enemyTrailInnerGeo, innerGlowMaterial);
        const outer = new THREE.Mesh(this.enemyTrailOuterGeo, outerGlowMaterial);
        trailGroup.add(core);
        trailGroup.add(inner);
        trailGroup.add(outer);

        return {
            group: trailGroup,
            core,
            inner,
            outer,
            coreMaterial,
            innerMaterial: innerGlowMaterial,
            outerMaterial: outerGlowMaterial,
            time: 0,
            opacity: 1,
        };
    }

    dispose(): void {
        for (const t of this.enemyTrailActive) {
            this.scene.remove(t.group);
            t.coreMaterial.dispose();
            t.innerMaterial.dispose();
            t.outerMaterial.dispose();
        }
        for (const t of this.enemyTrailPool) {
            t.coreMaterial.dispose();
            t.innerMaterial.dispose();
            t.outerMaterial.dispose();
        }
        this.enemyTrailActive = [];
        this.enemyTrailPool = [];
        this.enemyTrailCoreGeo.dispose();
        this.enemyTrailInnerGeo.dispose();
        this.enemyTrailOuterGeo.dispose();
    }
}
