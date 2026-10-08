import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-xl border border-[#D4D4D4] dark:border-[#27272A] bg-white dark:bg-[#111111] px-3 py-1.5 text-xs text-[#18181B] dark:text-[#F5F5F5] placeholder:text-[#71717A] dark:placeholder:text-[#52525B] shadow-2xs transition-all duration-150 outline-none file:border-0 file:bg-transparent file:text-xs file:font-medium disabled:cursor-not-allowed disabled:opacity-40 focus:border-[#7DB9E8] dark:focus:border-[#A8D8FF] focus:ring-2 focus:ring-[#A8D8FF]/20",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
