/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['requiring-exposed-pencil-jewellery.trycloudflare.com'],
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      {
        source: '/dashboard/messages',
        destination: '/dashboard/unibox',
        permanent: true,
      },
    ]
  },
}

export default nextConfig
