import { cardHelp, cardName } from "@/game/copy";
import { numberCopies } from "@/game/deck";
import {
  BONUS_10,
  BONUS_2,
  BURST,
  CardCode,
  PERFECT_BONUS,
  PERFECT_COUNT,
  SECOND_WIND,
  TURBO,
  WHISTLE,
} from "@/game/types";
import { Card } from "../Card";

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section className="mb-6">
    <h3 className="mb-2 text-xs font-black uppercase tracking-widest text-neon-cyan">
      {title}
    </h3>
    <div className="space-y-2 text-sm leading-relaxed text-white/75">
      {children}
    </div>
  </section>
);

const CardRow = ({ code }: { code: CardCode }) => (
  <div className="flex items-start gap-3 rounded-xl bg-white/[0.04] p-2.5">
    <Card code={code} size="sm" />
    <div className="min-w-0 flex-1">
      <p className="text-sm font-bold text-white">{cardName(code)}</p>
      <p className="mt-0.5 text-[13px] leading-snug text-white/60">
        {cardHelp(code)}
      </p>
    </div>
  </div>
);

export const Rules = () => (
  <div className="mx-auto max-w-md">
    <Section title="Le principe">
      <p>
        À ton tour, tu choisis : <strong className="text-white">Accélérer</strong>{" "}
        pour prendre une carte de plus, ou{" "}
        <strong className="text-white">Souffler</strong> pour encaisser tes
        points et sortir de la course.
      </p>
      <p>
        Le piège : si tu tires un numéro que tu as{" "}
        <strong className="text-white">déjà</strong>, c'est la{" "}
        <strong className="text-rose-300">crampe</strong> — tu perds tout ce que
        tu avais accumulé pour cette course.
      </p>
    </Section>

    <Section title="Le sprint parfait">
      <p>
        {PERFECT_COUNT} numéros différents dans ton couloir : la course s'arrête
        immédiatement pour tout le monde et tu empoches{" "}
        <strong className="text-amber-300">+{PERFECT_BONUS} points</strong>.
        Les autres gardent ce qu'ils avaient.
      </p>
      <div className="flex flex-wrap gap-1 pt-1">
        {[2, 5, 9, 11, 0, 7, 12].map((code) => (
          <Card key={code} code={code} size="xs" />
        ))}
      </div>
    </Section>

    <Section title="Le paquet — 94 cartes">
      <p>
        Il y a <strong className="text-white">un seul 1, deux 2, trois 3</strong>{" "}
        … et <strong className="text-white">douze 12</strong>. C'est toute la
        tension du jeu : les gros numéros rapportent le plus et sont ceux qui te
        cramponnent le plus souvent.
      </p>
      <div className="grid grid-cols-7 gap-1 pt-1 text-center">
        {[1, 4, 7, 10, 12].map((value) => (
          <div key={value} className="col-span-1">
            <Card code={value} size="xs" />
            <p className="mt-0.5 text-[10px] text-white/40">
              ×{numberCopies(value)}
            </p>
          </div>
        ))}
      </div>
    </Section>

    <Section title="Les cartes action">
      <CardRow code={WHISTLE} />
      <CardRow code={BURST} />
      <CardRow code={SECOND_WIND} />
      <p className="pt-1 text-[13px] text-white/55">
        Un sifflet ou une rafale se donnent à n'importe quel coureur encore en
        course — toi compris. Tirés{" "}
        <em className="not-italic text-white/75">pendant</em> une rafale, ils
        sont mis de côté et distribués seulement à la fin — et perdus si tu
        crampes entre-temps.
      </p>
    </Section>

    <Section title="Les modificateurs">
      <CardRow code={TURBO} />
      <CardRow code={BONUS_2} />
      <p className="pt-1 text-[13px] text-white/55">
        Ils ne comptent pas dans les {PERFECT_COUNT} numéros du sprint parfait,
        et une crampe les emporte aussi.
      </p>
    </Section>

    <Section title="Le calcul">
      <p className="rounded-xl bg-white/[0.04] p-3 font-mono text-[13px] text-white/80">
        (somme des numéros × turbo) + bonus + {PERFECT_BONUS} si sprint parfait
      </p>
      <p className="text-[13px] text-white/55">
        Exemple : <Inline code={3} /> <Inline code={7} /> <Inline code={TURBO} />{" "}
        <Inline code={BONUS_10} /> → (3 + 7) × 2 + 10 ={" "}
        <strong className="text-white">30 points</strong>.
      </p>
    </Section>

    <Section title="Gagner">
      <p>
        On enchaîne les courses jusqu'à ce qu'un coureur franchisse la ligne
        d'arrivée. En cas d'égalité en tête, on rejoue une course pour
        départager.
      </p>
    </Section>
  </div>
);

const Inline = ({ code }: { code: CardCode }) => (
  <span className="mx-0.5 inline-block rounded bg-white/10 px-1.5 py-px text-[11px] font-bold text-white">
    {cardName(code)}
  </span>
);
