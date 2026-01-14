import * as THREE from 'three';

export function setupLighting(scene: THREE.Scene): {
    ambientLight: THREE.AmbientLight;
    sunLight: THREE.DirectionalLight;
} {
    // 环境光
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    // 主方向光 (太阳)
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.2);
    sunLight.position.set(50, 100, 50);
    sunLight.castShadow = true;

    // 阴影设置
    // 优化：缩小阴影相机范围，只覆盖玩家周围近处的物体
    const shadowSize = 80;
    sunLight.shadow.camera.top = shadowSize;
    sunLight.shadow.camera.bottom = -shadowSize;
    sunLight.shadow.camera.left = -shadowSize;
    sunLight.shadow.camera.right = shadowSize;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 150;

    // 降低阴影分辨率，因为使用了 PCFSoftShadowMap
    sunLight.shadow.mapSize.width = 1024;
    sunLight.shadow.mapSize.height = 1024;
    sunLight.shadow.bias = -0.0005;

    // IMPORTANT: We explicitly schedule shadow updates (see ShadowSystem).
    // Prevent three from re-rendering the shadow map every frame.
    sunLight.shadow.autoUpdate = false;
    sunLight.shadow.needsUpdate = true;

    scene.add(sunLight);

    // 填充光 (蓝色天空反射)
    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(-10, 10, -10);
    scene.add(fillLight);

    // 半球光 (天空和地面)
    const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x444444, 0.4);
    scene.add(hemiLight);

    return { ambientLight, sunLight };
}
