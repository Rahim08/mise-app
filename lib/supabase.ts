import { createBrowserClient } from '@supabase/ssr'
import { clearPendingDbReads } from './db'

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Never share a pending read across sign-in/sign-out or token changes.
supabase.auth.onAuthStateChange(() => { clearPendingDbReads() })
