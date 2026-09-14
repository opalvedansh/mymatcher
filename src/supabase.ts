import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import { Platform } from 'react-native';
import { fetchWithTimeout } from './api/client';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://YOUR_SUPABASE_PROJECT.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

const createSupabaseClient = () => createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
  global: {
    fetch: fetchWithTimeout as any,
  }
});

let client: ReturnType<typeof createSupabaseClient>;
if (process.env.NODE_ENV === 'production') {
  client = createSupabaseClient();
} else {
  const g = globalThis as any;
  if (!g._supabaseClient) {
    g._supabaseClient = createSupabaseClient();
  }
  client = g._supabaseClient;
}

export const supabase = client;
