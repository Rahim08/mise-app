import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://mise-app-omega.vercel.app'
  return [
    { url: base,                  lastModified: new Date(), changeFrequency: 'weekly',  priority: 1 },
    { url: `${base}/auth/login`,  lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/auth/register`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
  ]
}
