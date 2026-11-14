import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://www.misesuite.com'
  return [
    { url: base,                  lastModified: new Date(), changeFrequency: 'weekly',  priority: 1 },
    { url: `${base}/auth/login`,  lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/auth/register`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    ...['about', 'support', 'contact', 'privacy', 'terms'].map(p => (
      { url: `${base}/${p}.html`, lastModified: new Date(), changeFrequency: 'yearly' as const, priority: 0.3 })),
  ]
}
