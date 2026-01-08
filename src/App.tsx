import { useEffect, useRef, useState } from 'react';
import './App.css';
import { Game } from './game/core/Game';
import { GameStateService, GameState } from './game/core/GameState';
import { LoadingScreen } from './ui/components/LoadingScreen';
import { HUD } from './ui/hud/HUD';
import { GameOverScreen } from './ui/components/GameOverScreen';

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [gameState, setGameState] = useState<GameState>({
    health: 100,
    ammo: 300000,
    grenades: 1000,
    currentWeapon: 'rifle',
    chargeProgress: 0,
    stance: 'stand',
    score: 0,
    isGameOver: false,
    pickupHint: null
  });
  
  // 加载状态
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingDesc, setLoadingDesc] = useState("Initializing...");
  
  // FPS 和延迟状态
  const [fps, setFps] = useState(0);
  const [ping, setPing] = useState(0);
  const frameTimesRef = useRef<number[]>([]);
  const lastFrameTimeRef = useRef(performance.now());

  useEffect(() => {
    if (containerRef.current && !gameRef.current) {
        // 延迟初始化游戏，确保 React 先渲染出 Loading 界面
        setTimeout(() => {
            if (containerRef.current && !gameRef.current) {
                gameRef.current = new Game(
                    containerRef.current, 
                    () => {
                        // 当游戏第一帧渲染完成后，关闭 Loading
                        console.log("Game Loaded");
                        setLoadingProgress(100);
                        setLoadingDesc("Ready!");
                        setTimeout(() => setIsLoading(false), 500); // 稍微延迟一点消失，展示100%
                    },
                    (progress, desc) => {
                        setLoadingProgress(progress);
                        setLoadingDesc(desc);
                    }
                );
            }
        }, 50);
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
      <LoadingScreen 
        isLoading={isLoading} 
        progress={loadingProgress} 
        description={loadingDesc} 
      />

      <HUD 
        isLoading={isLoading} 
        gameState={gameState} 
        fps={fps} 
        ping={ping} 
      />

      <GameOverScreen 
        isGameOver={gameState.isGameOver} 
        score={gameState.score} 
      />
    </div>
  );
}

export default App;
