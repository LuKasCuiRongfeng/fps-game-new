import { useEffect, useRef, useState } from 'react';
import './App.css';
import { Game } from './game/core/Game';
import { GameStateService, GameState } from './game/core/GameState';
import { LoadingScreen } from './ui/components/LoadingScreen';
import { HUD } from './ui/hud/HUD';
import { GameOverScreen } from './ui/components/GameOverScreen';
import { SettingsOverlay, type RuntimeSettings } from './ui/components/SettingsOverlay';
import { PlayerConfig, WeaponConfig } from './game/core/GameConfig';
import { LanguageToggle } from './ui/components/LanguageToggle';

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettings>(() => {
    const defaults: RuntimeSettings = {
      cameraSensitivity: PlayerConfig.camera.sensitivity,
      cameraSmoothFactor: PlayerConfig.camera.smoothFactor,
      defaultFov: PlayerConfig.camera.defaultFov,
      aimFov: PlayerConfig.camera.aimFov,
      aimSensitivityMultiplier: PlayerConfig.camera.aimSensitivityMultiplier,
      fovLerpSpeed: PlayerConfig.camera.fovLerpSpeed,

      walkSpeed: PlayerConfig.movement.walkSpeed,
      runSpeed: PlayerConfig.movement.runSpeed,
      jumpHeight: PlayerConfig.movement.jumpHeight,
      gravity: PlayerConfig.movement.gravity,
      friction: PlayerConfig.movement.friction,

      weaponSwitchCooldownMs: WeaponConfig.switching.cooldown,
    };

    try {
      const raw = localStorage.getItem('runtimeSettings');
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Partial<RuntimeSettings>;
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  });
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
  const [loadingDesc, setLoadingDesc] = useState("i18n:loading.stage.init");
  
  // FPS 和延迟状态
  const [fps, setFps] = useState(0);
  const [ping, setPing] = useState(0);
  const frameTimesRef = useRef<number[]>([]);
  const lastFrameTimeRef = useRef(performance.now());

  const isPointerLocked = () => {
    const root = containerRef.current;
    const lockedEl = document.pointerLockElement;
    if (!root || !lockedEl) return false;
    return root === lockedEl || root.contains(lockedEl);
  };

  const applyRuntimeSettings = (s: RuntimeSettings) => {
    PlayerConfig.camera.sensitivity = s.cameraSensitivity;
    PlayerConfig.camera.smoothFactor = s.cameraSmoothFactor;
    PlayerConfig.camera.defaultFov = s.defaultFov;
    PlayerConfig.camera.aimFov = s.aimFov;
    PlayerConfig.camera.aimSensitivityMultiplier = s.aimSensitivityMultiplier;
    PlayerConfig.camera.fovLerpSpeed = s.fovLerpSpeed;

    PlayerConfig.movement.walkSpeed = s.walkSpeed;
    PlayerConfig.movement.runSpeed = s.runSpeed;
    PlayerConfig.movement.jumpHeight = s.jumpHeight;
    PlayerConfig.movement.gravity = s.gravity;
    PlayerConfig.movement.friction = s.friction;

    WeaponConfig.switching.cooldown = s.weaponSwitchCooldownMs;
  };

  const resetRuntimeSettings = () => {
    const defaults: RuntimeSettings = {
      cameraSensitivity: 0.002,
      cameraSmoothFactor: 0.15,
      defaultFov: 75,
      aimFov: 25,
      aimSensitivityMultiplier: 0.35,
      fovLerpSpeed: 10.0,

      walkSpeed: 60.0,
      runSpeed: 120.0,
      jumpHeight: 10.0,
      gravity: 30.0,
      friction: 10.0,

      weaponSwitchCooldownMs: 200,
    };
    setRuntimeSettings(defaults);
  };

  const requestResume = () => {
    // Close settings immediately and best-effort lock pointer.
    // If lock fails (gesture requirement), user can click the game to lock.
    setSettingsOpen(false);
    gameRef.current?.lockPointer();
  };

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
                      setLoadingDesc("i18n:loading.ready");
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

  useEffect(() => {
    applyRuntimeSettings(runtimeSettings);
    try {
      localStorage.setItem('runtimeSettings', JSON.stringify(runtimeSettings));
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeSettings]);

  useEffect(() => {
    // Prevent the game's click-to-lock handler from firing while UI overlays are active.
    if (isLoading || settingsOpen) {
      document.body.dataset.uiModalOpen = '1';
    } else {
      delete document.body.dataset.uiModalOpen;
    }
  }, [isLoading, settingsOpen]);

  useEffect(() => {
    const onPointerLockChange = () => {
      if (isLoading) return;
      if (gameState.isGameOver) return;

      if (isPointerLocked()) {
        setSettingsOpen(false);
      }
    };

    document.addEventListener('pointerlockchange', onPointerLockChange);
    return () => document.removeEventListener('pointerlockchange', onPointerLockChange);
  }, [isLoading, gameState.isGameOver]);

  useEffect(() => {
    if (isLoading) return;
    if (!gameRef.current) return;

    // Best-effort auto pointer lock on load.
    setTimeout(() => {
      gameRef.current?.lockPointer();
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isLoading) return;
      if (gameState.isGameOver) return;

      // If settings is open, Esc resumes (attempts to lock pointer).
      if (settingsOpen) {
        e.preventDefault();
        requestResume();
        return;
      }

      // If pointer is locked, Esc should unlock and open settings.
      if (isPointerLocked()) {
        e.preventDefault();
        gameRef.current?.unlockPointer();
        setSettingsOpen(true);
        return;
      }

      // If pointer isn't locked, Esc opens settings.
      e.preventDefault();
      setSettingsOpen(true);
    };

    // Use capture so inputs (range/number) inside Settings can't swallow Esc.
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true } as any);
  }, [isLoading, gameState.isGameOver, settingsOpen]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {isLoading && (
        <div className="fixed top-3 right-3 z-[130] pointer-events-auto">
          <LanguageToggle />
        </div>
      )}
      <LoadingScreen 
        isLoading={isLoading} 
        progress={loadingProgress} 
        description={loadingDesc} 
      />

      <SettingsOverlay
        open={settingsOpen}
        settings={runtimeSettings}
        onChange={setRuntimeSettings}
        onReset={resetRuntimeSettings}
        onClose={requestResume}
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
