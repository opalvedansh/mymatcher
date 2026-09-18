import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { MISSING_CONFIG } from './lib/supabase';
import { Shell } from './components/Shell';
import { Login, NotAdmin, ConfigMissing } from './pages/Login';
import Overview from './pages/Overview';
import Users from './pages/Users';
import UserDetail from './pages/UserDetail';
import Moderation from './pages/Moderation';
import Verifications from './pages/Verifications';
import Content from './pages/Content';
import Matches from './pages/Matches';
import Ratings from './pages/Ratings';
import Broadcast from './pages/Broadcast';
import SettingsPage from './pages/Settings';
import Admins from './pages/Admins';
import Audit from './pages/Audit';
import System from './pages/System';

export default function App() {
  const { state } = useAuth();

  if (MISSING_CONFIG) return <ConfigMissing />;

  if (state.status === 'loading') {
    return (
      <div className="login">
        <div className="sk" style={{ width: 180, height: 11 }} />
      </div>
    );
  }

  if (state.status === 'anonymous') return <Login />;

  // Signed in to Supabase but not staff. Its own screen, not a redirect back
  // to the form they just completed successfully.
  if (state.status === 'not-admin') return <NotAdmin email={state.email} />;

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/users" element={<Users />} />
        <Route path="/users/:userId" element={<UserDetail />} />
        <Route path="/moderation" element={<Moderation />} />
        <Route path="/verifications" element={<Verifications />} />
        <Route path="/content" element={<Content />} />
        <Route path="/matches" element={<Matches />} />
        <Route path="/ratings" element={<Ratings />} />
        <Route path="/broadcast" element={<Broadcast />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admins" element={<Admins />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="/system" element={<System />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
