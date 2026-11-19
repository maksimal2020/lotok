/** @type {import('next').NextConfig} */
const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const nextConfig = {
  output: "standalone",
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  transpilePackages: ['@lotok/shared'],
  poweredByHeader: false,
  reactStrictMode: true,
  // В разработке веб проксирует API на тот же origin (cookie первой стороны, без CORS). В production это делает nginx.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API}/api/:path*` },
      { source: '/files/:path*', destination: `${API}/files/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
        ],
      },
    ];
  },
};

export default nextConfig;

