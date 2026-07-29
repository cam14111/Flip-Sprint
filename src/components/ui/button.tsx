import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:pointer-events-none disabled:opacity-45 active:scale-[0.97]",
  {
    variants: {
      variant: {
        // The two board buttons carry the game: they are loud on purpose.
        go: "bg-gradient-to-b from-neon-cyan to-[#0b93b5] text-[#032430] shadow-lg shadow-cyan-500/25 hover:brightness-110",
        hold:
          "bg-gradient-to-b from-[#fbbf24] to-[#d9880c] text-[#2b1902] hover:brightness-110",
        primary:
          "bg-gradient-to-b from-neon-cyan to-[#0b93b5] text-[#032430] hover:brightness-110",
        ghost: "bg-white/5 text-white ring-1 ring-white/10 hover:bg-white/10",
        outline:
          "bg-transparent text-white ring-1 ring-white/20 hover:bg-white/10",
        danger: "bg-rose-600/85 text-white hover:bg-rose-600",
      },
      size: {
        sm: "h-9 px-3 text-sm",
        md: "h-11 px-4 text-base",
        lg: "h-14 px-5 text-lg",
        xl: "h-16 px-6 text-xl",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
