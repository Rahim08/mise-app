// Google-отзывы: синхронизация с Places API (New) — https://places.googleapis.com/v1/places/{placeId}
// Возвращает средний рейтинг, общее число отзывов и до 5 последних отзывов текстом (ограничение
// самого Google, не наше — полного архива через этот API не существует). Каждый вызов пишет
// снэпшот рейтинга и апсертит отзывы, так что список и график во времени растут сами по себе,
// начиная с первого sync.

type PlacesReview = {
  name?: string
  relativePublishTimeDescription?: string
  rating?: number
  text?: { text?: string; languageCode?: string }
  publishTime?: string
  authorAttribution?: { displayName?: string; photoUri?: string }
}

type PlacesResponse = {
  rating?: number
  userRatingCount?: number
  reviews?: PlacesReview[]
  error?: { message?: string }
}

export type SyncResult = { ok: boolean; rating?: number; ratingsTotal?: number; error?: string }

export async function syncRestaurantReviews(
  admin: any, restaurantId: string, placeId: string, apiKey: string,
): Promise<SyncResult> {
  let res: Response
  try {
    res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'rating,userRatingCount,reviews',
      },
    })
  } catch {
    return { ok: false, error: 'Сеть недоступна' }
  }

  let data: PlacesResponse
  try { data = await res.json() } catch { return { ok: false, error: 'Некорректный ответ Google' } }
  if (!res.ok) return { ok: false, error: data?.error?.message || `Google API: ${res.status}` }

  const now = new Date().toISOString()
  await admin.from('google_rating_snapshots').insert({
    restaurant_id: restaurantId, captured_at: now,
    rating: data.rating ?? null, ratings_total: data.userRatingCount ?? null,
  })

  const reviews = data.reviews || []
  if (reviews.length) {
    const rows = reviews.map(r => ({
      restaurant_id: restaurantId,
      google_review_id: r.name || `${r.authorAttribution?.displayName || ''}-${r.publishTime || ''}`,
      author_name: r.authorAttribution?.displayName || null,
      author_photo_url: r.authorAttribution?.photoUri || null,
      rating: r.rating ?? null,
      review_text: r.text?.text || null,
      relative_time: r.relativePublishTimeDescription || null,
      review_time: r.publishTime || null,
    }))
    await admin.from('google_reviews').upsert(rows, { onConflict: 'restaurant_id,google_review_id' })
  }

  return { ok: true, rating: data.rating, ratingsTotal: data.userRatingCount }
}
