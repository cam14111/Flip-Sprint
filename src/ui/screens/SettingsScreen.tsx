import { Switch } from "@/components/ui/switch";
import { Settings } from "@/game/settings";

const Toggle = ({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) => (
  <label className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-3">
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-semibold text-white">{label}</span>
      <span className="mt-0.5 block text-[12px] leading-snug text-white/50">
        {hint}
      </span>
    </span>
    <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
  </label>
);

export const SettingsScreen = ({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) => (
  <div className="mx-auto max-w-md space-y-2">
    <Toggle
      label="Jauge de risque"
      hint="Affiche la probabilité exacte de crampe avant chaque carte."
      checked={settings.showRisk}
      onChange={(showRisk) => onChange({ showRisk })}
    />
    <Toggle
      label="Sons"
      hint="Effets synthétisés, aucun fichier audio téléchargé."
      checked={settings.sound}
      onChange={(sound) => onChange({ sound })}
    />
    <Toggle
      label="Vibrations"
      hint="Retour haptique sur les crampes et les coups de sifflet."
      checked={settings.haptics}
      onChange={(haptics) => onChange({ haptics })}
    />

    <p className="px-1 pt-4 text-[12px] leading-relaxed text-white/40">
      Les réglages, les statistiques et la course en cours sont conservés
      uniquement sur cet appareil. Rien n'est envoyé nulle part en solo ou à
      plusieurs sur un même appareil.
    </p>
  </div>
);
