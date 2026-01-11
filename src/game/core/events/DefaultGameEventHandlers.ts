import type { GameServices } from '../services/GameServices';
import type { GameEventBus } from './GameEventBus';

export function attachDefaultGameEventHandlers(
    bus: GameEventBus,
    opts: {
        services: GameServices;
        setDamageFlashIntensity?: (v: number) => void;
    }
): () => void {
    const unsubs: Array<() => void> = [];

    unsubs.push(
        bus.on('state:updateHealth', (e) => opts.services.state.updateHealth(e.delta)),
        bus.on('state:updateAmmo', (e) => opts.services.state.updateAmmo(e.delta)),
        bus.on('state:updateScore', (e) => opts.services.state.updateScore(e.delta)),
        bus.on('state:updateGrenades', (e) => opts.services.state.updateGrenades(e.delta)),
        bus.on('state:setCurrentWeapon', (e) => opts.services.state.setCurrentWeapon(e.weapon)),
        bus.on('state:setChargeProgress', (e) => opts.services.state.setChargeProgress(e.progress)),
        bus.on('state:setStance', (e) => opts.services.state.setStance(e.stance)),
        bus.on('state:setPickupHint', (e) => opts.services.state.setPickupHint(e.hint)),
        bus.on('fx:damageFlash', (e) => opts.setDamageFlashIntensity?.(e.intensity)),
        bus.on('sound:play', (e) => {
            switch (e.sound) {
                case 'weaponSwitch':
                    opts.services.sound.playWeaponSwitch();
                    break;
                case 'shoot':
                    opts.services.sound.playShoot();
                    break;
                case 'sniperShoot':
                    opts.services.sound.playSniperShoot();
                    break;
                case 'hit':
                    opts.services.sound.playHit();
                    break;
                case 'damage':
                    opts.services.sound.playDamage();
                    break;
                case 'pickup':
                    opts.services.sound.playPickup();
                    break;
                case 'grenadeThrow':
                    opts.services.sound.playGrenadeThrow();
                    break;
                case 'hitImpact':
                    opts.services.sound.playHitImpact();
                    break;
                case 'explosion':
                    opts.services.sound.playExplosion();
                    break;
                case 'enemyDeath':
                    opts.services.sound.playEnemyDeath();
                    break;
            }
        })
    );

    return () => {
        for (const unsub of unsubs) unsub();
    };
}
