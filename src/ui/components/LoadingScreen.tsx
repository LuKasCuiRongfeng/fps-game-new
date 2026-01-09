import React from 'react';
import { useTranslation } from 'react-i18next';

interface LoadingScreenProps {
    isLoading: boolean;
    progress: number;
    description: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ isLoading, progress, description }) => {
    const { t } = useTranslation();

    const clampedProgress = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));

    const rawDesc = description?.trim() || 'i18n:loading.stage.init';
    const headline = rawDesc.startsWith('i18n:') ? t(rawDesc.slice('i18n:'.length)) : rawDesc;
    const percentText = `${Math.round(clampedProgress)}%`;

    if (!isLoading) return null;

    return (
        <div className="fixed inset-0 z-100 flex items-center justify-center bg-black text-white">
            <div className="w-[min(420px,92vw)] rounded-xl border border-white/10 bg-black/70 px-6 py-5">
                <div className="flex items-center justify-between gap-4">
                    <div>
                        <div className="text-lg font-semibold tracking-tight">{t('loading.title')}</div>
                        <div className="mt-1 text-sm text-white/70">{headline}</div>
                    </div>
                    <div className="text-right">
                        <div className="text-lg font-semibold tabular-nums">{percentText}</div>
                    </div>
                </div>

                <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                        className="h-full rounded-full bg-white/85 transition-[width] duration-300 ease-out"
                        style={{ width: `${clampedProgress}%` }}
                    />
                </div>
            </div>
        </div>
    );
};
