import React from 'react';
import { WeaponType } from '../../game/core/GameState';
import { getWeaponDisplayName } from '../../game/weapon/WeaponDefinitions';
import { useTranslation } from 'react-i18next';

function WeaponIcon({ weapon }: { weapon: WeaponType }) {
    const common = {
        className: 'w-14 h-14',
        viewBox: '0 0 64 64',
        'aria-hidden': true,
        focusable: false,
    } as const;

    switch (weapon) {
        case 'grenade':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M28 10h10" />
                    <path d="M25 14h16" />
                    <path d="M24 18c-6 6-7 19 0 27c7 8 21 8 28 0c7-8 6-20 0-27" />
                    <path d="M40 14c0 4 3 7 7 7" />
                    <path d="M31 24v16" />
                    <path d="M38 24v16" />
                </svg>
            );
        case 'knife':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    {/* blade */}
                    <path d="M18 40l24-24" />
                    <path d="M38 12l14 14" />
                    {/* spine */}
                    <path d="M22 44l24-24" />
                    {/* guard */}
                    <path d="M22 38l-6-6" />
                    <path d="M16 32l-4 4" />
                    {/* handle */}
                    <path d="M12 36l10 10" />
                    <path d="M14 34l12 12" />
                </svg>
            );
        case 'axe':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    {/* handle */}
                    <path d="M18 52L38 12" />
                    <path d="M16 50l6 4" />
                    {/* head */}
                    <path d="M36 16c10 0 16 7 16 16c-9 0-16-6-16-16z" />
                    <path d="M34 18c-10 0-16 7-16 16c9 0 16-6 16-16z" />
                    <path d="M34 18h4" />
                </svg>
            );
        case 'scythe':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    {/* long handle */}
                    <path d="M18 54L42 10" />
                    <path d="M16 52l8 6" />
                    {/* blade */}
                    <path d="M40 14c10 2 16 10 14 20c-10-1-16-8-14-20z" />
                    <path d="M38 16c-6 8-8 14-6 22" opacity={0.55} />
                    {/* tang */}
                    <path d="M38 16h6" />
                </svg>
            );
        case 'bow':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 10c10 10 10 34 0 44" />
                    <path d="M44 10c-10 10-10 34 0 44" />
                    <path d="M20 32h28" />
                    <path d="M44 28l6 4l-6 4" />
                    <path d="M20 10L44 54" opacity={0.35} />
                </svg>
            );
        case 'sniper':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    {/* barrel */}
                    <path d="M8 34h44" />
                    {/* receiver */}
                    <path d="M18 30h18" />
                    {/* scope */}
                    <path d="M22 24h22" />
                    <path d="M26 22v6" />
                    <path d="M40 22v6" />
                    {/* stock */}
                    <path d="M26 34l-4 12" />
                    <path d="M18 46h12" />
                </svg>
            );
        case 'shotgun':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    {/* barrel */}
                    <path d="M8 34h40" />
                    {/* pump */}
                    <path d="M20 30h14" />
                    <path d="M20 38h14" />
                    {/* stock */}
                    <path d="M28 34l-4 12" />
                    <path d="M18 46h12" />
                    {/* muzzle */}
                    <path d="M48 32l8-4" />
                </svg>
            );
        case 'smg':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 34h34" />
                    <path d="M16 30h14" />
                    <path d="M26 34l4 14" />
                    <path d="M30 48h8" />
                    <path d="M44 34l10-6" />
                </svg>
            );
        case 'pistol':
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    {/* slide */}
                    <path d="M14 26h26" />
                    <path d="M18 22h22" />
                    {/* barrel */}
                    <path d="M40 26l10 6" />
                    {/* grip */}
                    <path d="M24 26l-3 18" />
                    <path d="M18 44h14" />
                    {/* trigger guard */}
                    <path d="M26 30h8" />
                </svg>
            );
        case 'rifle':
        default:
            return (
                <svg {...common} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    {/* barrel */}
                    <path d="M8 34h44" />
                    {/* handguard */}
                    <path d="M18 30h18" />
                    <path d="M18 38h18" />
                    {/* magazine */}
                    <path d="M28 34l3 14" />
                    <path d="M30 48h8" />
                    {/* stock */}
                    <path d="M22 34l-6 12" />
                    <path d="M12 46h12" />
                    {/* muzzle */}
                    <path d="M52 32l8-4" />
                </svg>
            );
    }
}

interface WeaponPanelProps {
    currentWeapon: WeaponType;
    ammo: number;
    grenades: number;
    chargeProgress: number;
}

export const WeaponPanel: React.FC<WeaponPanelProps> = ({ currentWeapon, ammo, grenades, chargeProgress }) => {
    const { t } = useTranslation();
    const isGrenade = currentWeapon === 'grenade';
    const value = isGrenade ? grenades : ammo;
    const label = isGrenade ? t('hud.weapon.grenades') : t('hud.weapon.ammo');
    const weaponNameFallback = getWeaponDisplayName(currentWeapon);
    const weaponName = t(`weapon.${currentWeapon}`, { defaultValue: weaponNameFallback });

    const p = Math.max(0, Math.min(1, chargeProgress));
    // chargeProgress is 0 until throw-ready; any >0 means we're in the visible charging phase.
    const showCharge = (currentWeapon === 'knife' || currentWeapon === 'scythe') && p > 0.001;
    const isFullCharge = p >= 0.999;
    const hue = 120 * (1 - p); // 120=green -> 0=red
    const ringColor = `hsl(${hue} 90% 55%)`;
    const ringBg = 'rgba(255,255,255,0.18)';
    const r = 26;
    const c = 2 * Math.PI * r;
    const dash = c * p;

    return (
        <div className="absolute bottom-8 right-8 text-white font-bold pointer-events-none select-none text-right">
            <div className="mb-2 flex items-center justify-end gap-3">
                <div className="text-sm opacity-80">{weaponName}</div>
                <div className="relative p-1 rounded-md bg-black/25 border border-white/15">
                    <WeaponIcon weapon={currentWeapon} />

                    {showCharge && (
                        <svg
                            className={`absolute -inset-2 ${isFullCharge ? 'animate-pulse' : ''}`}
                            viewBox="0 0 64 64"
                            fill="none"
                            aria-hidden
                            focusable={false}
                        >
                            <circle
                                cx="32"
                                cy="32"
                                r={r}
                                stroke={ringBg}
                                strokeWidth="5"
                            />
                            <circle
                                cx="32"
                                cy="32"
                                r={r}
                                stroke={ringColor}
                                strokeWidth="5"
                                strokeLinecap="round"
                                strokeDasharray={`${dash} ${c}`}
                                transform="rotate(-90 32 32)"
                            />
                        </svg>
                    )}
                </div>
            </div>

            <div className="text-4xl flex items-end justify-end gap-2">
                <span>{value}</span>
                <span className="text-lg font-normal opacity-70 mb-1">{label}</span>
            </div>
        </div>
    );
};
