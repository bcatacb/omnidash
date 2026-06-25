import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || 'https://dummy.supabase.co'
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || 'dummy-key-for-dev'

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  console.warn('[supabase] Using dummy Supabase client for dev (no real data persistence)')
}

export const supabase = createClient(url, key)
