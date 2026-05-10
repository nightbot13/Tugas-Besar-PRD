/** @type {import('next').NextConfig} */
const nextConfig = {
  // Serve the SIX ITB static CSS files from /public/css/
  // Copy all uploaded CSS files into: frontend/public/css/
  async headers() {
    return [
      {
        // Cache static SIX CSS assets aggressively
        source: "/css/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },

  // Proxy API requests to FastAPI during development
  // so the browser never needs to know the backend port
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;