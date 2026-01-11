import type { GameStateService } from '../GameState';
import { GameStateService as GameStateServiceSingleton } from '../GameState';
import type { SoundManager } from '../SoundManager';
import { SoundManager as SoundManagerSingleton } from '../SoundManager';

export type GameServices = {
    state: GameStateService;
    sound: SoundManager;
};

export function getDefaultGameServices(): GameServices {
    return {
        state: GameStateServiceSingleton.getInstance(),
        sound: SoundManagerSingleton.getInstance(),
    };
}
