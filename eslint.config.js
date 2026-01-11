import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * ESLint (flat config)
 * - Enforces architectural boundaries for GPU-first design.
 * - Keeps domain code from importing concrete GPU implementations.
 */
export default [
    js.configs.recommended,
    {
        files: ['src/**/*.{ts,tsx}'],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
            'react-hooks': reactHooks,
        },
        rules: {
            // TypeScript provides globals and undef checking.
            'no-undef': 'off',

            // The repo is TS-first; prefer TS-aware unused vars handling.
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

            // React hook correctness (also prevents "rule not found" for existing disables).
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
        },
    },
    {
        // Domain layers must not depend on concrete GPU implementations.
        files: [
            'src/game/systems/**/*.{ts,tsx}',
            'src/game/weapon/**/*.{ts,tsx}',
            'src/game/entities/**/*.{ts,tsx}',
            'src/game/player/**/*.{ts,tsx}',
            'src/game/enemy/**/*.{ts,tsx}',
            'src/game/level/**/*.{ts,tsx}',
            'src/game/ui/**/*.{ts,tsx}',
        ],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['**/shaders/GPUCompute', '**/shaders/GPUParticles', '**/shaders/index'],
                            message:
                                'Do not import concrete GPU shader systems here. Depend on core/gpu/GpuSimulationFacade (EnemyComputeSimulation/ParticleSimulation) and inject via composition.',
                        },
                    ],
                },
            ],
        },
    },
];
