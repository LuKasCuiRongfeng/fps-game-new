import type { GameEvent, GameEventType } from './GameEvents';

export type GameEventHandler<T extends GameEventType = GameEventType> = (
    event: Extract<GameEvent, { type: T }>
) => void;

export class GameEventBus {
    private handlers: Map<GameEventType, Set<GameEventHandler<any>>> = new Map();

    public on<T extends GameEventType>(type: T, handler: GameEventHandler<T>): () => void {
        let set = this.handlers.get(type);
        if (!set) {
            set = new Set();
            this.handlers.set(type, set);
        }
        set.add(handler as GameEventHandler<any>);
        return () => {
            const current = this.handlers.get(type);
            current?.delete(handler as GameEventHandler<any>);
            if (current && current.size === 0) this.handlers.delete(type);
        };
    }

    public emit(event: GameEvent): void {
        const set = this.handlers.get(event.type);
        if (!set || set.size === 0) return;
        // Snapshot to allow handlers to unsubscribe safely during emit.
        const snapshot = Array.from(set);
        for (const handler of snapshot) handler(event as any);
    }
}
