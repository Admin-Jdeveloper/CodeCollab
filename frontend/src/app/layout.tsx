import type { Metadata } from "next";
import "../../styles/globals.css";
import { AuthProvider } from "@/components/providers/AuthProvider";

export const metadata: Metadata = {
  title: "CodeCollab — Real-Time Collaborative IDE & Workspace",
  description: "Next-generation collaborative coding platform with instant real-time synchronization, Git-like version control, and localized secure execution.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Inter:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-[#0b0f19] text-[#e2e8f0] font-sans antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
