import { Component, ErrorInfo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { clearGame } from "@/game/persistence";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence. A crash on a phone is a dead end for the player, so the
 * fallback offers the one thing that reliably helps: drop the saved game (the
 * likeliest culprit after an update) and reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Flip Sprint a planté :", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-8 text-center text-white">
        <h1 className="text-2xl font-black italic">Fausse route</h1>
        <p className="text-sm text-white/60">
          Une erreur inattendue a interrompu la course. Repartir à zéro
          règle presque toujours le problème.
        </p>
        <Button
          variant="primary"
          size="lg"
          onClick={() => {
            clearGame();
            window.location.reload();
          }}
        >
          Recharger
        </Button>
        <pre className="max-w-full overflow-x-auto text-[10px] text-white/30">
          {this.state.error.message}
        </pre>
      </div>
    );
  }
}
