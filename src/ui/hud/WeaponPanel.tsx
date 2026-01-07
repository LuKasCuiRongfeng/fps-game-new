import React from 'react';
import { WeaponType } from '../../game/core/GameState';

interface WeaponPanelProps {
    currentWeapon: WeaponType;
    ammo: number;
    grenades: number;
}

export const WeaponPanel: React.FC<WeaponPanelProps> = ({ currentWeapon, ammo, grenades }) => {
    return (
        <div className="absolute bottom-8 right-8 text-white font-bold pointer-events-none select-none text-right">
            {/* 武器选择面板 */}
            <div className="mb-4 flex flex-col gap-2">
                {/* 枪 */}
                <div className={`flex items-center justify-end gap-3 px-3 py-2 rounded-lg transition-all ${
                    currentWeapon === 'gun' 
                        ? 'bg-white/20 border border-white/50' 
                        : 'bg-black/30 border border-white/10 opacity-60'
                }`}>
                    <span className="text-sm opacity-70">1</span>
                    <div className="flex items-center gap-2">
                        {/* 枪图标 */}
                        <svg className="w-8 h-5" viewBox="0 0 32 20" fill="currentColor">
                            <rect x="0" y="8" width="24" height="6" rx="1"/>
                            <rect x="18" y="6" width="8" height="10" rx="1"/>
                            <rect x="22" y="12" width="10" height="4" rx="1"/>
                            <rect x="6" y="14" width="4" height="6" rx="1"/>
                        </svg>
                        <span className="font-mono text-lg">{ammo}</span>
                    </div>
                </div>
                
                {/* 手榴弹 */}
                <div className={`flex items-center justify-end gap-3 px-3 py-2 rounded-lg transition-all ${
                    currentWeapon === 'grenade' 
                        ? 'bg-white/20 border border-white/50' 
                        : 'bg-black/30 border border-white/10 opacity-60'
                }`}>
                    <span className="text-sm opacity-70">2</span>
                    <div className="flex items-center gap-2">
                        {/* 手榴弹图标 */}
                        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                            <ellipse cx="12" cy="14" rx="7" ry="9"/>
                            <rect x="10" y="2" width="4" height="4" rx="1"/>
                            <circle cx="12" cy="3" r="2" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                        </svg>
                        <span className="font-mono text-lg">{grenades}</span>
                    </div>
                </div>
            </div>
            
            {/* 当前弹药 */}
            <div className="text-4xl flex items-end justify-end gap-2">
                <span>{currentWeapon === 'gun' ? ammo : grenades}</span>
                <span className="text-lg font-normal opacity-70 mb-1">
                    {currentWeapon === 'gun' ? 'AMMO' : 'GRENADES'}
                </span>
            </div>
        </div>
    );
};
