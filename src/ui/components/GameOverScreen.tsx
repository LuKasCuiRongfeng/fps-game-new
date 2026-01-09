import React from 'react';
import { GameStateService } from '../../game/core/GameState';
import { useTranslation } from 'react-i18next';

interface GameOverScreenProps {
    isGameOver: boolean;
    score: number;
}

export const GameOverScreen: React.FC<GameOverScreenProps> = ({ isGameOver, score }) => {
    const { t } = useTranslation();

    if (!isGameOver) return null;

    return (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-white z-50">
            <h1 className="text-6xl font-bold mb-4 text-red-500">{t('gameOver.title')}</h1>
            <p className="text-2xl mb-8">{t('gameOver.finalScore', { score })}</p>
            <button 
                className="px-6 py-3 bg-white text-black font-bold rounded hover:bg-gray-200 transition-colors cursor-pointer pointer-events-auto"
                onClick={() => {
                    GameStateService.getInstance().reset();
                    window.location.reload(); // Simple reload to restart for now
                }}
            >
                {t('gameOver.tryAgain')}
            </button>
        </div>
    );
};
