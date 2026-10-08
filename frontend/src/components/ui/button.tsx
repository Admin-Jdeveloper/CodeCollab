import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-xs font-semibold tracking-normal transition-all duration-150 ease-out disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-[#A8D8FF]/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background active:scale-[0.98] cursor-pointer select-none",
  {
    variants: {
      variant: {
        primary:
          "bg-[#A8D8FF] hover:bg-[#7DB9E8] active:bg-[#68A5D4] text-[#0A0A0A] border border-[#7DB9E8] shadow-xs font-bold",
        secondary:
          "bg-[#FFFFFF] hover:bg-[#F2F2F0] active:bg-[#E4E4E0] text-[#18181B] border border-[#D4D4D4] dark:bg-[#18181B] dark:hover:bg-[#27272A] dark:active:bg-[#111111] dark:text-[#F5F5F5] dark:border-[#27272A] shadow-xs",
        outline:
          "bg-transparent hover:bg-[#F2F2F0] active:bg-[#E4E4E0] text-[#18181B] border border-[#D4D4D4] dark:bg-transparent dark:hover:bg-[#18181B] dark:active:bg-[#111111] dark:text-[#F5F5F5] dark:border-[#27272A] shadow-xs",
        ghost:
          "bg-transparent hover:bg-[#F2F2F0] active:bg-[#E4E4E0] text-[#18181B] dark:bg-transparent dark:hover:bg-[#18181B] dark:active:bg-[#111111] dark:text-[#F5F5F5]",
        destructive:
          "bg-[#EF4444]/15 hover:bg-[#EF4444]/25 active:bg-[#EF4444]/35 text-[#DC2626] dark:text-[#F87171] border border-[#EF4444]/30 shadow-xs",
        default:
          "bg-[#A8D8FF] hover:bg-[#7DB9E8] active:bg-[#68A5D4] text-[#0A0A0A] border border-[#7DB9E8] shadow-xs font-bold",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-[11px]",
        lg: "h-10 px-5 text-xs rounded-xl",
        icon: "size-9 p-0",
        "icon-sm": "size-8 p-0",
        "icon-lg": "size-10 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
