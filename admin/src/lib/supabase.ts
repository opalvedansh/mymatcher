import { createClient } from '@supabase/supabase-js';

/**
 * Config comes from /admin/env.js, which the API generates from its own
 * environment. Nothing is baked into the bundle, so one Docker image works in
 * every environment. Both values are public — they already ship inside the
 * mobile app.
 */
const env = window.__ADMIN_ENV__;

export const MISSING_CONFIG = !env?.supabaseUrl || !env?.supabaseAnonKey;

export const BUILD_COMMIT = env?.commit ?? '';
export const DEPLOY_ENV = env?.env ?? 'development';

export const supabase = createClient(
  env?.supabaseUrl || 'http://localhost',
  env?.supabaseAnonKey || 'missing',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The panel is not an OAuth redirect target; parsing the URL would only
      // ever misread a route.
      detectSessionInUrl: false,
      storageKey: 'matchr-admin-auth',
    },
  },
);
