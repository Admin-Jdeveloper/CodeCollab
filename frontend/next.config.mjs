/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Prevents duplicate socket connections and Monaco double initialization in development
  transpilePackages: ["@monaco-editor/react"],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
