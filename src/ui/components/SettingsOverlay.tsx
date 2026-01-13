import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageToggle } from './LanguageToggle';

import type { RuntimeSettings } from '../../game/core/settings/RuntimeSettings';

function clamp(n: number, min: number, max: number) {
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="text-sm text-white/80 sm:max-w-[46%] wrap-break-word">{label}</div>
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

    type TabId = 'camera' | 'movement' | 'weapons';
    const tabs = useMemo(
        () =>
            [
                { id: 'camera' as const, label: t('settings.section.camera') },
                { id: 'movement' as const, label: t('settings.section.movement') },
                { id: 'weapons' as const, label: t('settings.section.weapons') },
            ] satisfies Array<{ id: TabId; label: string }>,
        [t]
    );

    const [activeTab, setActiveTab] = useState<TabId>('camera');

    useEffect(() => {
        if (open) setActiveTab('camera');
    }, [open]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-120 bg-black/70 text-white backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
        >
            <div
                className="relative mx-auto mt-6 max-h-[88vh] w-[min(920px,94vw)] overflow-hidden rounded-2xl border border-white/10 bg-black/85 shadow-2xl"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="sticky top-0 z-10 border-b border-white/10 bg-black/60 px-6 py-4">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <div className="text-xl font-semibold">{t('settings.title')}</div>
                            <div className="mt-1 text-sm text-white/60">{t('settings.hint')}</div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
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

                {/* Body */}
                <div className="grid max-h-[calc(88vh-128px)] grid-cols-1 overflow-hidden md:grid-cols-[220px_1fr]">
                    {/* Tabs */}
                    <div className="border-b border-white/10 bg-black/40 p-3 md:border-b-0 md:border-r">
                        <div className="flex gap-2 overflow-x-auto md:flex-col md:overflow-visible">
                            {tabs.map((tab) => {
                                const active = tab.id === activeTab;
                                return (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        className={
                                            'whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition ' +
                                            (active
                                                ? 'bg-white/12 text-white'
                                                : 'bg-black/20 text-white/70 hover:bg-black/30 hover:text-white')
                                        }
                                        onClick={() => setActiveTab(tab.id)}
                                    >
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Content */}
                    <div className="overflow-y-auto px-6 py-5">
                        {activeTab === 'camera' && (
                            <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                                <div className="text-sm font-semibold text-white/90">{t('settings.section.camera')}</div>
                                <div className="mt-3">
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
                        )}

                        {activeTab === 'movement' && (
                            <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                                <div className="text-sm font-semibold text-white/90">{t('settings.section.movement')}</div>
                                <div className="mt-3">
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
                        )}

                        {activeTab === 'weapons' && (
                            <div className="rounded-xl border border-white/10 bg-black/30 p-5">
                                <div className="text-sm font-semibold text-white/90">{t('settings.section.weapons')}</div>
                                <div className="mt-3">
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
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="sticky bottom-0 border-t border-white/10 bg-black/60 px-6 py-4">
                    <div className="flex items-center justify-between gap-3">
                        <button
                            className="rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm hover:bg-black/40"
                            type="button"
                            onClick={onReset}
                        >
                            {t('settings.reset')}
                        </button>
                        <div className="flex items-center gap-2">
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
    );
};
