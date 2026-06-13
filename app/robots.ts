import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/auth/login', '/auth/register'],
        disallow: ['/dashboard', '/manager', '/analytics', '/tobacco', '/people', '/admin', '/api/'],
      },
    ],
    sitemap: 'https://mise-app-omega.vercel.app/sitemap.xml',
  }
}
