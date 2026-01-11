import React from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageToggle } from './LanguageToggle';

import type { RuntimeSettings } from '../../game/core/settings/RuntimeSettings';

function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="text-sm text-white/80 sm:max-w-[46%] break-words">{label}</div>
            <div className="w-full sm:w-[320px]">{children}</div>
        </div>
    );
}

function Slider({
    value,
    min,
    max,
    step,
    onChange,
}: {
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (v: number) => void;
}) {
    return (
        <div className="flex items-center gap-3">
            <input
                className="w-full"
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
            />
            <input
                className="w-20 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-right text-xs text-white/80"
                type="number"
                min={min}
                max={max}
                step={step}
                value={Number.isFinite(value) ? value : 0}
                onChange={(e) => onChange(Number(e.target.value))}
            />
        </div>
    );
}

export const SettingsOverlay: React.FC<{
    open: boolean;
    settings: RuntimeSettings;
    onChange: (next: RuntimeSettings) => void;
    onReset: () => void;
    onClose: () => void;
}> = ({ open, settings, onChange, onReset, onClose }) => {
    const { t } = useTranslation();

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[120] bg-black/70 text-white">
            <div className="relative mx-auto mt-6 max-h-[88vh] w-[min(820px,94vw)] overflow-hidden rounded-xl border border-white/10 bg-black/80">
                <div className="p-6">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="text-xl font-semibold">{t('settings.title')}</div>
                        <div className="mt-1 text-sm text-white/60">{t('settings.hint')}</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <LanguageToggle />
                        <button
                            className="rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
                            type="button"
                            onClick={onClose}
                        >
                            {t('settings.close')}
                        </button>
                    </div>
                </div>

                </div>
                <div className="max-h-[calc(88vh-96px)] overflow-y-auto px-6 pb-6">
                <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
                    <div className="rounded-lg border border-white/10 bg-black/30 p-4">
                        <div className="text-sm font-semibold text-white/90">{t('settings.section.camera')}</div>
                        <div className="mt-2">
                            <FieldRow label={t('settings.camera.sensitivity')}>
                                <Slider
                                    value={settings.cameraSensitivity}
                                    min={0.0003}
                                    max={0.01}
                                    step={0.0001}
                                    onChange={(v) =>
                                        onChange({
                                            ...settings,
                                            cameraSensitivity: clamp(v, 0.0001, 0.02),
                                        })
                                    }
                                />
                            </FieldRow>
                            <FieldRow label={t('settings.camera.smooth')}>
                                <Slider
                                    value={settings.cameraSmoothFactor}
                                    min={0}
                                    max={0.5}
                                    step={0.01}
                                    onChange={(v) =>
                                        onChange({
                                            ...settings,
                                            cameraSmoothFactor: clamp(v, 0, 1),
                                        })
                                    }
                                />
                            </FieldRow>
                            <FieldRow label={t('settings.camera.defaultFov')}>
                                <Slider
                                    value={settings.defaultFov}
                                    min={50}
                                    max={120}
                                    step={1}
                                    onChange={(v) => onChange({ ...settings, defaultFov: clamp(v, 30, 140) })}
                                />
                            </FieldRow>
                            <FieldRow label={t('settings.camera.aimFov')}>
                                <Slider
                                    value={settings.aimFov}
                                    min={15}
                                    max={90}
                                    step={1}
                                    onChange={(v) => onChange({ ...settings, aimFov: clamp(v, 5, 120) })}
                                />
                            </FieldRow>
                            <FieldRow label={t('settings.camera.aimMultiplier')}>
                                <Slider
                                    value={settings.aimSensitivityMultiplier}
                                    min={0.1}
                                    max={1}
                                    step={0.01}
                                    onChange={(v) =>
                                        onChange({
                                            ...settings,
                                            aimSensitivityMultiplier: clamp(v, 0.05, 1),
                                        })
                                    }
                                />
                            </FieldRow>
                            <FieldRow label={t('settings.camera.fovLerp')}>
                                <Slider
                                    value={settings.fovLerpSpeed}
                                    min={1}
                                    max={30}
                                    step={0.5}
                                    onChange={(v) => onChange({ ...settings, fovLerpSpeed: clamp(v, 0.5, 60) })}
                                />
                            </FieldRow>
                        </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-black/30 p-4">
                        <div className="text-sm font-semibold text-white/90">{t('settings.section.movement')}</div>
                        <div className="mt-2">
                            <FieldRow label={t('settings.movement.walkSpeed')}>
                                <Slider
                                    value={settings.walkSpeed}
                                    min={10}
                                    max={300}
                                    step={1}
                                    onChange={(v) => onChange({ ...settings, walkSpeed: clamp(v, 1, 999) })}
                                />
                            </FieldRow>
                            <FieldRow label={t('settings.movement.runSpeed')}>
                                <Slider
                                    value={settings.runSpeed}
                                    min={10}
                                    max={500}
                                    step={1}
                                    onChange={(v) => onChange({ ...settings, runSpeed: clamp(v, 1, 999) })}
                                />
                            </FieldRow>
                            <FieldRow label={t('settings.movement.jump')}>
                                <Slider
                                    value={settings.jumpHeight}
                                    min={0}
                                    max={40}
                                    step={0.5}
                                    onChange={(v) => onChange({ ...settings, jumpHeight: clamp(v, 0, 200) })}
                                />
                            </FieldRow>
                            <FieldRow label={t('settings.movement.gravity')}>
                                <Slider
                                    value={settings.gravity}
                                    min={0}
                                    max={120}
                                    step={1}
                                    onChange={(v) => onChange({ ...settings, gravity: clamp(v, 0, 500) })}
                                />
                            </FieldRow>
                            <FieldRow label={t('settings.movement.friction')}>
                                <Slider
                                    value={settings.friction}
                                    min={0}
                                    max={40}
                                    step={0.5}
                                    onChange={(v) => onChange({ ...settings, friction: clamp(v, 0, 200) })}
                                />
                            </FieldRow>
                        </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-black/30 p-4 md:col-span-2">
                        <div className="text-sm font-semibold text-white/90">{t('settings.section.weapons')}</div>
                        <div className="mt-2">
                            <FieldRow label={t('settings.weapons.switchCooldown')}>
                                <Slider
                                    value={settings.weaponSwitchCooldownMs}
                                    min={0}
                                    max={1000}
                                    step={10}
                                    onChange={(v) =>
                                        onChange({
                                            ...settings,
                                            weaponSwitchCooldownMs: clamp(v, 0, 5000),
                                        })
                                    }
                                />
                            </FieldRow>
                        </div>
                        <div className="mt-3 flex justify-end gap-2">
                            <button
                                className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm hover:bg-black/40"
                                type="button"
                                onClick={onReset}
                            >
                                {t('settings.reset')}
                            </button>
                            <button
                                className="rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
                                type="button"
                                onClick={onClose}
                            >
                                {t('settings.resume')}
                            </button>
                        </div>
                    </div>
                </div>
                </div>
            </div>
        </div>
    );
};
