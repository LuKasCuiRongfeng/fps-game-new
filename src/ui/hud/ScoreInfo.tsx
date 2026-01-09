import React from 'react';
import { useTranslation } from 'react-i18next';

interface ScoreInfoProps {
    score: number;
}

export const ScoreInfo: React.FC<ScoreInfoProps> = ({ score }) => {
    const { t } = useTranslation();
    return (
        <div className="absolute top-4 left-4 text-white font-bold pointer-events-none select-none">
            <div className="text-xl">{t('hud.score')}: {score}</div>
            <div className="text-sm font-normal opacity-70">{t('hud.controls')}</div>
        </div>
    );
};
