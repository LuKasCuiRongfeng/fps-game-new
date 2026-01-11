import * as THREE from 'three';

import { setupLighting } from './LightingSetup';

export function createSceneAndCamera(): {
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    ambientLight: THREE.AmbientLight;
    sunLight: THREE.DirectionalLight;
} {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 100, 700);

    const { ambientLight, sunLight } = setupLighting(scene);

    const camera = new THREE.PerspectiveCamera(
        75,
        window.innerWidth / window.innerHeight,
        0.1,
        1500
    );
    camera.position.set(0, 1.6, 5);
    scene.add(camera);

    return { scene, camera, ambientLight, sunLight };
}
