import React from 'react';
import { useTranslation } from 'react-i18next';

interface PerformanceStatsProps {
    fps: number;
    ping: number;
}

export const PerformanceStats: React.FC<PerformanceStatsProps> = ({ fps, ping }) => {
    const { t } = useTranslation();
    return (
        <div className="absolute top-4 right-4 text-white font-mono pointer-events-none select-none text-right">
            <div className={`text-lg ${fps >= 60 ? 'text-green-400' : fps >= 30 ? 'text-yellow-400' : 'text-red-400'}`}>
                {fps} {t('hud.perf.fps')}
            </div>
            <div className="text-sm opacity-70">
                {ping} {t('hud.perf.ms')}
            </div>
        </div>
    );
};
