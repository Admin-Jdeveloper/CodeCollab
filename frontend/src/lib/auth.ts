import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_SECRET || "",
    }),
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "developer@codecollab.io" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = String(credentials.email).trim().toLowerCase();
        const password = String(credentials.password);

        try {
          const backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:3000";
          const res = await fetch(`${backendUrl}/api/auth/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.success && data.user) {
              return {
                id: data.user.id,
                name: data.user.name || email.split("@")[0],
                email: data.user.email,
                image: data.user.image || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(email)}`,
              };
            }
          }
        } catch (err) {
          console.warn("Backend auth verification warning:", err);
        }

        return null;
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        try {
          const backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:3000";
          const res = await fetch(`${backendUrl}/api/auth/oauth-sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: account.provider,
              providerAccountId: account.providerAccountId,
              email: user.email || (profile as any)?.email,
              name: user.name || (profile as any)?.name,
              image: user.image || (profile as any)?.picture,
              emailVerified: (profile as any)?.email_verified ? new Date() : null,
              oauthData: {
                type: account.type,
                access_token: account.access_token,
                refresh_token: account.refresh_token,
                expires_at: account.expires_at,
                token_type: account.token_type,
                scope: account.scope,
                id_token: account.id_token,
                session_state: account.session_state,
              },
            }),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.success && data.user) {
              // Bind database User ID to the NextAuth user object
              user.id = data.user.id;
              user.name = data.user.name;
              user.email = data.user.email;
              user.image = data.user.image;
              return true;
            }
          } else {
            console.error("[Auth] OAuth sync failed with status:", res.status);
          }
        } catch (err) {
          console.error("[Auth] OAuth sync network error:", err);
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.name = user.name;
        token.email = user.email;
        token.picture = user.image;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token) {
        session.user.id = token.id as string;
        session.user.name = token.name as string;
        session.user.email = token.email as string;
        session.user.image = token.picture as string;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      // 1. If relative path, resolve against baseUrl to guarantee a valid absolute URL
      if (url.startsWith("/")) {
        if (url.startsWith("//") || url.startsWith("/\\")) return baseUrl;
        return `${baseUrl.replace(/\/$/, "")}${url}`;
      }
      // 2. If already an absolute URL, only permit if it shares origin with baseUrl
      try {
        const parsedUrl = new URL(url);
        const parsedBase = new URL(baseUrl);
        if (parsedUrl.origin === parsedBase.origin) {
          return url;
        }
      } catch {
        // Fallback on invalid URL
      }
      return baseUrl;
    },
  },
  pages: {
    signIn: "/login",
  },
  trustHost: true,
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "codecollab-ultra-secure-secret-key-32-chars-long",
});
