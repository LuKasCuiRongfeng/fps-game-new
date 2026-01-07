import React from 'react';
import { StanceType } from '../../game/core/GameState';

interface StatusPanelProps {
    health: number;
    stance: StanceType;
}

export const StatusPanel: React.FC<StatusPanelProps> = ({ health, stance }) => {
    return (
        <div className="absolute bottom-8 left-8 text-white font-bold pointer-events-none select-none">
            <div className="text-4xl flex items-end gap-2">
                <span>{health}</span>
                <span className="text-lg font-normal opacity-70 mb-1">HP</span>
            </div>
            
            {/* 姿态显示 */}
            <div className="mt-4 flex items-center gap-3">
                <div className="flex flex-col items-center gap-1">
                    {/* 姿态图标 */}
                    <div className="w-12 h-16 flex items-end justify-center">
                        {stance === 'stand' && (
                            <svg className="w-12 h-16" viewBox="0 0 48 64" fill="currentColor">
                                {/* 站立持枪人形 */}
                                {/* 头部 */}
                                <circle cx="20" cy="6" r="5"/>
                                {/* 身体 */}
                                <path d="M16 12 L24 12 L26 32 L14 32 Z"/>
                                {/* 左臂 (持枪) */}
                                <path d="M16 14 L8 20 L6 19 L14 12 Z"/>
                                <path d="M8 20 L8 26 L6 26 L6 19 Z"/>
                                {/* 右臂 (托枪) */}
                                <path d="M24 14 L30 22 L28 24 L22 16 Z"/>
                                {/* 枪 */}
                                <rect x="6" y="18" width="24" height="3" rx="1"/>
                                <rect x="26" y="16" width="8" height="7" rx="1"/>
                                <rect x="32" y="18" width="14" height="3" rx="1"/>
                                {/* 左腿 */}
                                <path d="M14 32 L12 52 L16 52 L18 32 Z"/>
                                {/* 右腿 */}
                                <path d="M22 32 L24 52 L28 52 L26 32 Z"/>
                                {/* 脚 */}
                                <rect x="10" y="52" width="8" height="3" rx="1"/>
                                <rect x="22" y="52" width="8" height="3" rx="1"/>
                            </svg>
                        )}
                        {stance === 'crouch' && (
                            <svg className="w-12 h-12" viewBox="0 0 48 48" fill="currentColor">
                                {/* 蹲下持枪人形 */}
                                {/* 头部 */}
                                <circle cx="16" cy="6" r="5"/>
                                {/* 身体 (弯曲) */}
                                <path d="M12 12 L20 12 L22 26 L10 26 Z"/>
                                {/* 左臂 */}
                                <path d="M12 14 L6 18 L6 22 L10 18 Z"/>
                                {/* 右臂 */}
                                <path d="M20 14 L28 20 L26 22 L18 16 Z"/>
                                {/* 枪 */}
                                <rect x="4" y="16" width="22" height="2.5" rx="1"/>
                                <rect x="24" y="14" width="6" height="6" rx="1"/>
                                <rect x="28" y="16" width="12" height="2.5" rx="1"/>
                                {/* 腿 (蹲姿) */}
                                <path d="M10 26 L4 38 L8 40 L14 28 Z"/>
                                <path d="M18 26 L24 38 L28 36 L22 26 Z"/>
                                {/* 脚 */}
                                <rect x="2" y="38" width="8" height="3" rx="1"/>
                                <rect x="22" y="34" width="8" height="3" rx="1"/>
                            </svg>
                        )}
                        {stance === 'prone' && (
                            <svg className="w-16 h-8" viewBox="0 0 64 32" fill="currentColor">
                                {/* 趴下持枪人形 */}
                                {/* 头部 */}
                                <circle cx="8" cy="10" r="4"/>
                                {/* 身体 (横躺) */}
                                <path d="M12 7 L36 7 L38 15 L12 15 Z"/>
                                {/* 手臂和手 */}
                                <path d="M12 8 L6 6 L4 8 L10 10 Z"/>
                                <path d="M14 14 L10 18 L12 20 L16 16 Z"/>
                                {/* 枪 */}
                                <rect x="1" y="4" width="18" height="2" rx="0.5"/>
                                <rect x="1" y="2" width="4" height="4" rx="0.5"/>
                                {/* 腿 */}
                                <path d="M36 8 L52 10 L52 14 L38 14 Z"/>
                                <path d="M36 14 L50 18 L50 22 L38 16 Z"/>
                                {/* 脚 */}
                                <rect x="50" y="8" width="6" height="4" rx="1"/>
                                <rect x="48" y="18" width="6" height="4" rx="1"/>
                            </svg>
                        )}
                    </div>
                     {/* 姿态文字 */}
                    <span className={`text-xs font-normal uppercase tracking-wider ${
                        stance === 'stand' ? 'text-green-400' :
                        stance === 'crouch' ? 'text-yellow-400' : 'text-orange-400'
                    }`}>
                        {stance === 'stand' ? 'STAND' :
                        stance === 'crouch' ? 'CROUCH' : 'PRONE'}
                    </span>
                </div>
                
                {/* 按键提示 */}
                <div className="text-xs opacity-50 font-normal">
                    <div>C - Crouch</div>
                    <div>Z - Prone</div>
                </div>
            </div>
        </div>
    );
};
