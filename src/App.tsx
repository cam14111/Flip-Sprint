import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "./components/ui/button";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { UI } from "./game/copy";
import { MAX_RUNNERS } from "./game/engine";
import { clearGame, loadGame } from "./game/persistence";
import {
  displayName,
  loadSettings,
  localName,
  RACE_MODES,
  saveSettings,
  Settings,
} from "./game/settings";
import { loadStats, resetStats, Stats } from "./game/stats";
import { useGame } from "./hooks/useGame";
import { setHapticsEnabled } from "./lib/haptics";
import { primeAudio, setSoundEnabled } from "./lib/sound";
import { GameScreen } from "./ui/GameScreen";
import { Overlays } from "./ui/Overlays";
import { Home } from "./ui/screens/Home";
import { Panel } from "./ui/screens/Panel";
import { Rules } from "./ui/screens/Rules";
import { SettingsScreen } from "./ui/screens/SettingsScreen";
import { StatsScreen } from "./ui/screens/StatsScreen";

type Screen = "home" | "game";
type PanelKind = "rules" | "stats" | "settings" | "menu" | null;

/** Turns the home-screen settings into engine options. */
const gameOptions = (settings: Settings) => {
  const spec = RACE_MODES[settings.raceMode];
  const me = displayName(settings.playerName);

  if (settings.mode === "solo") {
    const count = Math.min(MAX_RUNNERS, 1 + settings.soloOpponents);
    return {
      mode: "solo" as const,
      names: [
        me,
        ...Array.from({ length: count - 1 }, (_, i) => `Rival ${i + 1}`),
      ],
      aiSeats: Array.from({ length: count - 1 }, (_, i) => i + 1),
      difficulty: settings.difficulty,
      scoreLimit: spec.scoreLimit,
      roundLimit: spec.roundLimit,
    };
  }

  return {
    mode: "local" as const,
    names: Array.from({ length: settings.localPlayers }, (_, seat) =>
      seat === 0 && settings.playerName.trim()
        ? me
        : localName(settings.localNames, seat)
    ),
    aiSeats: [],
    scoreLimit: spec.scoreLimit,
    roundLimit: spec.roundLimit,
  };
};

const AppInner = () => {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const restored = useMemo(() => loadGame(), []);
  const [screen, setScreen] = useState<Screen>("home");
  const [panel, setPanel] = useState<PanelKind>(null);
  const [panelOrigin, setPanelOrigin] = useState<"home" | "menu">("home");
  const [hasSaved, setHasSaved] = useState(restored !== null);
  const [statsView, setStatsView] = useState<Stats>(() => loadStats());

  // In solo the device belongs to seat 0; in local play every seat is someone
  // in the room, so no single seat owns the statistics.
  const humanSeat = settings.mode === "solo" ? 0 : null;
  const { game, stats, aiThinking, dispatch, newGame, nextRound } = useGame(
    restored,
    humanSeat,
    // Freeze the AI while the board is off screen or behind a panel.
    screen !== "game" || panel !== null
  );

  // The board uses a fixed dark surface — pin the token set so every Radix
  // surface (switches, dialogs) matches.
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  useEffect(() => {
    setSoundEnabled(settings.sound);
    setHapticsEnabled(settings.haptics);
    saveSettings(settings);
  }, [settings]);

  useEffect(() => setStatsView(stats), [stats]);

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const startGame = useCallback(() => {
    primeAudio();
    newGame(gameOptions(settings));
    setPanel(null);
    setHasSaved(true);
    setScreen("game");
  }, [newGame, settings]);

  const goHome = useCallback(() => {
    setPanel(null);
    setStatsView(loadStats());
    setHasSaved(loadGame() !== null);
    setScreen("home");
  }, []);

  const openPanel = useCallback((kind: PanelKind, origin: "home" | "menu") => {
    setStatsView(loadStats());
    setPanelOrigin(origin);
    setPanel(kind);
  }, []);

  const closeSubPanel = useCallback(() => {
    setPanel(panelOrigin === "menu" ? "menu" : null);
  }, [panelOrigin]);

  return (
    <>
      {screen === "home" ? (
        <Home
          settings={settings}
          onChange={patchSettings}
          hasSavedGame={hasSaved && game.phase !== "gameOver"}
          onPlay={startGame}
          onResume={() => {
            primeAudio();
            setScreen("game");
          }}
          onOpen={(kind) => openPanel(kind, "home")}
        />
      ) : (
        <>
          <GameScreen
            game={game}
            dispatch={dispatch}
            onOpenMenu={() => setPanel("menu")}
            showRisk={settings.showRisk}
            busy={aiThinking}
          />
          <Overlays
            game={game}
            humanSeat={humanSeat}
            onNextRound={nextRound}
            onNewGame={startGame}
            onHome={goHome}
          />
        </>
      )}

      {panel === "menu" && (
        <Panel title={UI.menu} onClose={() => setPanel(null)}>
          <div className="mx-auto max-w-md space-y-2">
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={() => setPanel(null)}
            >
              {UI.resume}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="w-full"
              onClick={() => openPanel("rules", "menu")}
            >
              {UI.rules}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="w-full"
              onClick={() => openPanel("settings", "menu")}
            >
              {UI.settings}
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="w-full"
              onClick={() => openPanel("stats", "menu")}
            >
              {UI.stats}
            </Button>
            <Button
              variant="danger"
              size="lg"
              className="w-full"
              onClick={() => {
                clearGame();
                goHome();
              }}
            >
              {UI.quit}
            </Button>
          </div>
        </Panel>
      )}

      {panel === "rules" && (
        <Panel title={UI.rules} onClose={closeSubPanel}>
          <Rules />
        </Panel>
      )}
      {panel === "settings" && (
        <Panel title={UI.settings} onClose={closeSubPanel}>
          <SettingsScreen settings={settings} onChange={patchSettings} />
        </Panel>
      )}
      {panel === "stats" && (
        <Panel title={UI.stats} onClose={closeSubPanel}>
          <StatsScreen
            stats={statsView}
            onReset={() => setStatsView(resetStats())}
          />
        </Panel>
      )}
    </>
  );
};

const App = () => (
  <ErrorBoundary>
    <AppInner />
  </ErrorBoundary>
);

export default App;
