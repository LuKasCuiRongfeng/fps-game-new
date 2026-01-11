import type * as THREE from 'three';
// @ts-ignore - WebGPU types not fully available
import { PostProcessing } from 'three/webgpu';
// @ts-ignore - WebGPU types not fully available
import type { WebGPURenderer } from 'three/webgpu';
import {
    pass,
    uniform,
    time,
    sin,
    vec3,
    vec4,
    mix,
    float,
    smoothstep,
    screenUV,
} from 'three/tsl';

import type { UniformManager } from '../../shaders/TSLMaterials';

export type NumberUniform = { value: number };

export type PostFXPipeline = {
    postProcessing: PostProcessing;
    scopeAimProgress: NumberUniform;
};

export function createPostFXPipeline(opts: {
    renderer: WebGPURenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    uniforms: UniformManager;
}): PostFXPipeline {
    const pp = new PostProcessing(opts.renderer);

    const scopeAimProgressNode = uniform(0);

    // Scene render pass
    const scenePass = pass(opts.scene, opts.camera);
    const sceneColor = scenePass.getTextureNode('output');

    const damageOverlay = createDamageOverlay(sceneColor, opts.uniforms);
    const scopeOverlay = createScopeEffect(damageOverlay, scopeAimProgressNode);
    const vignette = createVignetteEffect(scopeOverlay);

    pp.outputNode = vignette;

    return { postProcessing: pp, scopeAimProgress: scopeAimProgressNode as unknown as NumberUniform };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createDamageOverlay(inputColor: any, uniforms: UniformManager) {
    const coord = screenUV;
    const damageAmount = uniforms.damageFlash;

    const damageColor = vec3(0.8, 0.1, 0.05);

    const center = vec3(0.5, 0.5, 0);
    const distFromCenter = coord.sub(center.xy).length();
    const edgeFade = smoothstep(float(0.3), float(0.8), distFromCenter);

    const t = time;
    const pulse = sin(t.mul(15)).mul(0.2).add(0.8);

    const damageStrength = damageAmount.mul(edgeFade).mul(pulse);

    const finalColor = mix(inputColor, vec4(damageColor, 1), damageStrength.mul(0.5));

    return finalColor;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createVignetteEffect(inputColor: any) {
    const coord = screenUV;

    const center = vec3(0.5, 0.5, 0);
    const dist = coord.sub(center.xy).length();

    const vignetteStrength = float(0.4);
    const vignetteRadius = float(0.8);
    const vignetteSoftness = float(0.5);

    const vignette = smoothstep(vignetteRadius, vignetteRadius.sub(vignetteSoftness), dist);

    const darkening = mix(float(1), vignette, vignetteStrength);
    const finalColor = inputColor.mul(darkening);

    return finalColor;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createScopeEffect(inputColor: any, scopeAimProgress: any) {
    const coord = screenUV;

    const aimProgress = scopeAimProgress;

    const aspect = float(16.0 / 9.0);

    const correctedCoord = vec3(coord.x.sub(0.5).mul(aspect), coord.y.sub(0.5), float(0));
    const dist = correctedCoord.length();

    const innerRadius = float(0.35);
    const outerRadius = float(0.38);
    const borderRadius = float(0.42);

    const borderMask = smoothstep(innerRadius, outerRadius, dist);
    const outerMask = smoothstep(outerRadius, borderRadius, dist);

    const borderColor = vec3(0.08, 0.08, 0.1);

    const crosshairThickness = float(0.002);
    const crosshairLength = float(0.15);
    const horizontalLine = smoothstep(crosshairThickness, float(0), correctedCoord.y.abs())
        .mul(
            smoothstep(
                crosshairLength,
                crosshairLength.sub(0.02),
                correctedCoord.x.abs()
            )
        )
        .mul(smoothstep(float(0.02), float(0.03), correctedCoord.x.abs()));

    const verticalLine = smoothstep(crosshairThickness, float(0), correctedCoord.x.abs())
        .mul(
            smoothstep(
                crosshairLength,
                crosshairLength.sub(0.02),
                correctedCoord.y.abs()
            )
        )
        .mul(smoothstep(float(0.02), float(0.03), correctedCoord.y.abs()));

    const crosshair = horizontalLine.add(verticalLine).clamp(0, 1);
    const crosshairColor = vec3(0, 0, 0);

    const dotRadius = float(0.008);
    const redDot = smoothstep(dotRadius, dotRadius.mul(0.5), dist);
    const redDotColor = vec3(1.0, 0.1, 0.05);

    let result = inputColor;

    result = mix(inputColor, vec4(borderColor, 1), borderMask.mul(aimProgress));
    result = mix(result, vec4(0, 0, 0, 1), outerMask.mul(aimProgress));

    const crosshairVisible = crosshair.mul(float(1).sub(borderMask)).mul(aimProgress);
    result = mix(result, vec4(crosshairColor, 1), crosshairVisible.mul(0.8));

    result = mix(result, vec4(redDotColor, 1), redDot.mul(aimProgress));

    const edgeHighlight = smoothstep(innerRadius.sub(0.02), innerRadius, dist).mul(
        smoothstep(outerRadius, innerRadius, dist)
    );
    const highlightColor = vec3(0.3, 0.4, 0.5);
    result = mix(
        result,
        result.add(vec4(highlightColor.mul(0.1), 0)),
        edgeHighlight.mul(aimProgress)
    );

    return result;
}
