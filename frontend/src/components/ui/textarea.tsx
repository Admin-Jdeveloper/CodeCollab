import * as React from "react";
import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border border-[#D4D4D4] dark:border-[#27272A] bg-white dark:bg-[#111111] text-[#18181B] dark:text-[#F5F5F5] placeholder:text-[#71717A] dark:placeholder:text-[#52525B] focus-visible:border-[#7DB9E8] dark:focus-visible:border-[#A8D8FF] focus-visible:ring-2 focus-visible:ring-[#A8D8FF]/20 flex min-h-16 w-full rounded-xl px-3 py-2 text-xs shadow-2xs transition-all duration-150 outline-none disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
