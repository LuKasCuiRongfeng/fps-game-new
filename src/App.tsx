import { useEffect, useRef, useState } from 'react';
import './App.css';
import { Game } from './game/GameTSL';
import { GameStateService, GameState, WeaponType, StanceType } from './game/GameState';

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [gameState, setGameState] = useState<GameState>({
    health: 100,
    ammo: 300000,
    grenades: 1000,
    currentWeapon: 'gun',
    stance: 'stand',
    score: 0,
    isGameOver: false,
    pickupHint: null
  });
  
  // FPS 和延迟状态
  const [fps, setFps] = useState(0);
  const [ping, setPing] = useState(0);
  const frameTimesRef = useRef<number[]>([]);
  const lastFrameTimeRef = useRef(performance.now());

  useEffect(() => {
    if (containerRef.current && !gameRef.current) {
      gameRef.current = new Game(containerRef.current);
    }

    // Subscribe to game state
    const unsubscribe = GameStateService.getInstance().subscribe((state) => {
      setGameState(state);
    });
    
    // FPS 计算
    let animationId: number;
    const updateFps = () => {
      const now = performance.now();
      const delta = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;
      
      frameTimesRef.current.push(delta);
      // 保留最近 60 帧的数据
      if (frameTimesRef.current.length > 60) {
        frameTimesRef.current.shift();
      }
      
      // 每 10 帧更新一次显示
      if (frameTimesRef.current.length % 10 === 0) {
        const avgFrameTime = frameTimesRef.current.reduce((a, b) => a + b, 0) / frameTimesRef.current.length;
        setFps(Math.round(1000 / avgFrameTime));
        
        // 模拟延迟 (本地游戏没有真实网络延迟，显示帧时间作为参考)
        setPing(Math.round(avgFrameTime));
      }
      
      animationId = requestAnimationFrame(updateFps);
    };
    animationId = requestAnimationFrame(updateFps);

    return () => {
      unsubscribe();
      cancelAnimationFrame(animationId);
      if (gameRef.current) {
        gameRef.current.dispose();
        gameRef.current = null;
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {/* HUD */}
      <div className="absolute top-4 left-4 text-white font-bold pointer-events-none select-none">
        <div className="text-xl">SCORE: {gameState.score}</div>
        <div className="text-sm font-normal opacity-70">Click to Play | WASD Move | Scroll/1-2 Switch | G Grenade</div>
      </div>
      
      {/* FPS 和延迟显示 */}
      <div className="absolute top-4 right-4 text-white font-mono pointer-events-none select-none text-right">
        <div className={`text-lg ${fps >= 60 ? 'text-green-400' : fps >= 30 ? 'text-yellow-400' : 'text-red-400'}`}>
          {fps} FPS
        </div>
        <div className="text-sm opacity-70">
          {ping} ms
        </div>
      </div>

      <div className="absolute bottom-8 left-8 text-white font-bold pointer-events-none select-none">
        <div className="text-4xl flex items-end gap-2">
          <span>{gameState.health}</span>
          <span className="text-lg font-normal opacity-70 mb-1">HP</span>
        </div>
        
        {/* 姿态显示 */}
        <div className="mt-4 flex items-center gap-3">
          <div className="flex flex-col items-center gap-1">
            {/* 姿态图标 */}
            <div className="w-12 h-16 flex items-end justify-center">
              {gameState.stance === 'stand' && (
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
              {gameState.stance === 'crouch' && (
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
              {gameState.stance === 'prone' && (
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
              gameState.stance === 'stand' ? 'text-green-400' :
              gameState.stance === 'crouch' ? 'text-yellow-400' : 'text-orange-400'
            }`}>
              {gameState.stance === 'stand' ? 'STAND' :
               gameState.stance === 'crouch' ? 'CROUCH' : 'PRONE'}
            </span>
          </div>
          
          {/* 按键提示 */}
          <div className="text-xs opacity-50 font-normal">
            <div>C - Crouch</div>
            <div>Z - Prone</div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-8 right-8 text-white font-bold pointer-events-none select-none text-right">
        {/* 武器选择面板 */}
        <div className="mb-4 flex flex-col gap-2">
          {/* 枪 */}
          <div className={`flex items-center justify-end gap-3 px-3 py-2 rounded-lg transition-all ${
            gameState.currentWeapon === 'gun' 
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
              <span className="font-mono text-lg">{gameState.ammo}</span>
            </div>
          </div>
          
          {/* 手榴弹 */}
          <div className={`flex items-center justify-end gap-3 px-3 py-2 rounded-lg transition-all ${
            gameState.currentWeapon === 'grenade' 
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
              <span className="font-mono text-lg">{gameState.grenades}</span>
            </div>
          </div>
        </div>
        
        {/* 当前弹药 */}
        <div className="text-4xl flex items-end justify-end gap-2">
          <span>{gameState.currentWeapon === 'gun' ? gameState.ammo : gameState.grenades}</span>
          <span className="text-lg font-normal opacity-70 mb-1">
            {gameState.currentWeapon === 'gun' ? 'AMMO' : 'GRENADES'}
          </span>
        </div>
      </div>
      
      {/* Crosshair */}
      <div className="absolute top-1/2 left-1/2 w-4 h-4 -mt-2 -ml-2 pointer-events-none">
        <div className="w-full h-0.5 bg-white absolute top-1/2 transform -translate-y-1/2 shadow-sm"></div>
        <div className="h-full w-0.5 bg-white absolute left-1/2 transform -translate-x-1/2 shadow-sm"></div>
      </div>
      
      {/* 拾取提示 */}
      {gameState.pickupHint && (
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 mt-16 pointer-events-none select-none">
          <div className="bg-black/60 px-4 py-2 rounded-lg border border-white/30 backdrop-blur-sm">
            <div className="text-white text-center">
              <span className="text-yellow-300 font-bold">[F]</span>
              <span className="ml-2">{gameState.pickupHint}</span>
            </div>
          </div>
        </div>
      )}

      {/* Game Over Screen */}
      {gameState.isGameOver && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-white z-50">
          <h1 className="text-6xl font-bold mb-4 text-red-500">GAME OVER</h1>
          <p className="text-2xl mb-8">Final Score: {gameState.score}</p>
          <button 
            className="px-6 py-3 bg-white text-black font-bold rounded hover:bg-gray-200 transition-colors cursor-pointer pointer-events-auto"
            onClick={() => {
              GameStateService.getInstance().reset();
              window.location.reload(); // Simple reload to restart for now
            }}
          >
            TRY AGAIN
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
