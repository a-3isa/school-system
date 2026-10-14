/** @type {import('next').NextConfig} */
// A full Content-Security-Policy needs nonces with Next.js, so it is left for later.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config = {
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

// ANALYZE=1 npm run build opens a map of what each page's JavaScript is made of.
export default process.env.ANALYZE === '1' ? (await import('@next/bundle-analyzer')).default({ enabled: true })(config) : config;
