import { useState } from 'react';
import { AlertTriangle, LogOut } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';

export function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-brand">
          <div className="rail-mark" style={{ width: 26, height: 26, fontSize: 14 }}>M</div>
          <div>
            <div className="login-title">Matchr Console</div>
            <div className="login-sub">Staff access</div>
          </div>
        </div>

        <form className="login-form" onSubmit={submit}>
          <div className="field">
            <label className="field-label" htmlFor="email">Email</label>
            <input
              id="email" className="input" type="email" value={email} autoComplete="username"
              onChange={(e) => setEmail(e.target.value)} required autoFocus spellCheck={false}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="password">Password</label>
            <input
              id="password" className="input" type="password" value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} required
            />
          </div>

          {error && (
            <div className="consequence">
              <AlertTriangle size={14} />
              <div>{error}</div>
            </div>
          )}

          <button className="btn primary" type="submit" disabled={busy} style={{ height: 34 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="tiny muted">
          Every action in this console is recorded against your account.
        </div>
      </div>
    </div>
  );
}

export function NotAdmin({ email }: { email: string }) {
  return (
    <div className="login">
      <div className="login-card">
        <div className="login-brand">
          <div className="rail-mark" style={{ width: 26, height: 26, fontSize: 14 }}>M</div>
          <div className="login-title">Matchr Console</div>
        </div>

        <div className="consequence neutral">
          <AlertTriangle size={14} />
          <div>
            <div style={{ marginBottom: 3 }}>
              <b>{email}</b> is signed in, but it is not a staff account.
            </div>
            Ask a superadmin to grant access, then sign in again.
          </div>
        </div>

        <button className="btn" onClick={() => supabase.auth.signOut()}>
          <LogOut size={14} /> Sign out
        </button>
      </div>
    </div>
  );
}

/**
 * The panel is served by the API, which injects Supabase config at
 * /admin/env.js. If that is empty the bundle cannot authenticate at all, and
 * a login form that can never succeed is worse than saying so.
 */
export function ConfigMissing() {
  return (
    <div className="login">
      <div className="login-card">
        <div className="login-title">Console not configured</div>
        <div className="consequence">
          <AlertTriangle size={14} />
          <div>
            <code className="mono">/admin/env.js</code> returned no Supabase URL or anon key.
            Set <code className="mono">SUPABASE_URL</code> and <code className="mono">SUPABASE_ANON_KEY</code> on
            the API service and redeploy.
          </div>
        </div>
      </div>
    </div>
  );
}
