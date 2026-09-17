const { createClient } = require('@supabase/supabase-js');

let client = null;

/**
 * Service-role Supabase client for privileged operations (signed uploads,
 * storage cleanup, deleting auth users). Never expose it to request data.
 */
function getSupabaseAdmin() {
  if (!client) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return client;
}

module.exports = { getSupabaseAdmin };
