// Application shell. The screens land in the next step; this placeholder keeps
// the scaffold deployable while the identity is put in place.

import { APP_NAME, TAGLINE } from "./game/copy";

const App = () => (
  <div className="app-bg flex min-h-[100dvh] flex-col items-center justify-center px-6 text-white">
    <h1 className="text-center text-5xl font-black italic tracking-tight">
      {APP_NAME.split(" ")[0]}{" "}
      <span className="text-neon-cyan">{APP_NAME.split(" ")[1]}</span>
    </h1>
    <p className="mt-3 text-center text-white/60">{TAGLINE}</p>
  </div>
);

export default App;
