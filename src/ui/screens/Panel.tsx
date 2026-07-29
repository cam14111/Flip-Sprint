import { X } from "lucide-react";
import { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Full-screen sheet used for the rules, settings, stats and in-game menu. */
export const Panel = ({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) => (
  <div
    className="fixed inset-0 z-40 flex flex-col bg-[#12082e]/97 backdrop-blur"
    style={{
      paddingTop: "env(safe-area-inset-top)",
      paddingBottom: "env(safe-area-inset-bottom)",
    }}
    role="dialog"
    aria-modal="true"
    aria-label={title}
  >
    <header className="flex shrink-0 items-center gap-2 px-4 py-3">
      <h2 className="text-xl font-black italic tracking-tight text-white">
        {title}
      </h2>
      <Button
        variant="ghost"
        size="icon"
        className="ml-auto"
        onClick={onClose}
        aria-label="Fermer"
      >
        <X size={18} />
      </Button>
    </header>
    <div className="no-scrollbar flex-1 overflow-y-auto px-4 pb-6 text-white">
      {children}
    </div>
  </div>
);
