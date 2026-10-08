import type { Metadata } from "next";
import "../../styles/globals.css";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "CodeCollab — Real-Time Collaborative Workspace",
  description: "Modern real-time collaborative code editor with instant synchronization, native decentralized code execution, version history, and interactive discussion.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground font-sans antialiased selection:bg-[#A8D8FF]/25 selection:text-[#0A0A0A] dark:selection:text-[#A8D8FF]">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange={false}
        >
          <AuthProvider>
            {children}
            <Toaster
              position="bottom-right"
              toastOptions={{
                className: "border border-[#D4D4D4] dark:border-[#27272A] bg-white dark:bg-[#111111] text-[#18181B] dark:text-[#F5F5F5] rounded-xl shadow-lg",
              }}
            />
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
