import type { StanceType, WeaponType } from '../GameState';

export type GameSound =
    | 'weaponSwitch'
    | 'shoot'
    | 'sniperShoot'
    | 'hit'
    | 'damage'
    | 'pickup'
    | 'grenadeThrow'
    | 'hitImpact'
    | 'explosion'
    | 'enemyDeath';

export type GameEvent =
    | { type: 'state:updateHealth'; delta: number }
    | { type: 'state:updateAmmo'; delta: number }
    | { type: 'state:updateScore'; delta: number }
    | { type: 'state:updateGrenades'; delta: number }
    | { type: 'state:setCurrentWeapon'; weapon: WeaponType }
    | { type: 'state:setChargeProgress'; progress: number }
    | { type: 'state:setStance'; stance: StanceType }
    | { type: 'state:setPickupHint'; hint: string | null }
    | { type: 'fx:damageFlash'; intensity: number }
    | { type: 'sound:play'; sound: GameSound };

export type GameEventType = GameEvent['type'];
