import React from 'react';
import { GameState } from '../../game/core/GameState';
import { ScoreInfo } from './ScoreInfo';
import { PerformanceStats } from './PerformanceStats';
import { StatusPanel } from './StatusPanel';
import { WeaponPanel } from './WeaponPanel';
import { Crosshair } from '../components/Crosshair';
import { PickupHint } from '../components/PickupHint';

interface HUDProps {
    isLoading: boolean;
    gameState: GameState;
    fps: number;
    ping: number;
}

export const HUD: React.FC<HUDProps> = ({ isLoading, gameState, fps, ping }) => {
    return (
        <div className={`transition-opacity duration-1000 ${isLoading ? 'opacity-0' : 'opacity-100'}`}>
            <ScoreInfo score={gameState.score} />
            <PerformanceStats fps={fps} ping={ping} />
            <StatusPanel health={gameState.health} stance={gameState.stance} />
            <WeaponPanel 
                currentWeapon={gameState.currentWeapon} 
                ammo={gameState.ammo} 
                grenades={gameState.grenades} 
            />
            <Crosshair />
            <PickupHint hint={gameState.pickupHint} />
        </div>
    );
};
