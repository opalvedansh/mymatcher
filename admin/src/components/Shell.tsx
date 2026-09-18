import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, BarChart3, Bell, FileText, Flag, Image, LayoutDashboard, LogOut,
  MessagesSquare, Search, Settings, ShieldCheck, Star, Users, UserCog,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api } from '../lib/api';
import { DEPLOY_ENV } from '../lib/supabase';
import type { Permission, Stats } from '../lib/types';
import { CommandPalette } from './CommandPalette';

interface NavDef {
  to: string;
  label: string;
  icon: ReactNode;
  permission: Permission;
  /** Reads a pending count off /stats so a queue with work in it says so. */
  badge?: (s: Stats) => number;
  group: string;
}

const NAV: NavDef[] = [
  { group: 'Overview', to: '/', label: 'Overview', icon: <LayoutDashboard size={15} />, permission: 'metrics:read' },

  { group: 'Queues', to: '/moderation', label: 'Moderation', icon: <Flag size={15} />, permission: 'reports:read', badge: (s) => s.open_reports },
  { group: 'Queues', to: '/verifications', label: 'Verifications', icon: <ShieldCheck size={15} />, permission: 'verifications:read', badge: (s) => s.pending_verifications },

  { group: 'People', to: '/users', label: 'Users', icon: <Users size={15} />, permission: 'users:read' },
  { group: 'People', to: '/matches', label: 'Matches', icon: <MessagesSquare size={15} />, permission: 'matches:read' },
  { group: 'People', to: '/ratings', label: 'Ratings', icon: <Star size={15} />, permission: 'ratings:read' },
  { group: 'People', to: '/content', label: 'Content', icon: <Image size={15} />, permission: 'content:read' },

  { group: 'Operate', to: '/broadcast', label: 'Broadcast', icon: <Bell size={15} />, permission: 'broadcast:send' },
  { group: 'Operate', to: '/settings', label: 'Settings', icon: <Settings size={15} />, permission: 'settings:read' },
  { group: 'Operate', to: '/admins', label: 'Admins', icon: <UserCog size={15} />, permission: 'admins:read' },
  { group: 'Operate', to: '/audit', label: 'Audit log', icon: <FileText size={15} />, permission: 'audit:read' },
  { group: 'Operate', to: '/system', label: 'System', icon: <Activity size={15} />, permission: 'system:read' },
];

export function Shell({ children }: { children: ReactNode }) {
  const { me, signOut, can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Queue counts, so the rail tells you there is work without opening it.
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => api.get<Stats>('/stats'),
    enabled: can('metrics:read'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The nav renders from the permission list the server returned, so a support
  // admin never sees Broadcast at all rather than seeing it and getting a 403.
  const allowed = NAV.filter((n) => can(n.permission));
  const groups = [...new Set(allowed.map((n) => n.group))];
  const current = allowed.find((n) => n.to === location.pathname)
    ?? allowed.find((n) => n.to !== '/' && location.pathname.startsWith(n.to));

  return (
    <div className="shell">
      <nav className="rail">
        <div className="rail-brand">
          <div className="rail-mark">M</div>
          <div className="rail-name">Matchr</div>
          {DEPLOY_ENV !== 'production' && <div className="rail-env">{DEPLOY_ENV}</div>}
        </div>

        <div className="rail-nav">
          {groups.map((group) => (
            <div key={group}>
              <div className="rail-group">{group}</div>
              {allowed.filter((n) => n.group === group).map((n) => {
                const count = stats && n.badge ? n.badge(stats) : 0;
                return (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.to === '/'}
                    className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                  >
                    {n.icon}
                    {n.label}
                    {count > 0 && <span className="nav-count alert">{count}</span>}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </div>

        <div className="rail-foot">
          <div className="rail-user">
            <div className="avatar" aria-hidden>{me?.email?.[0]?.toUpperCase() ?? '?'}</div>
            <div className="rail-user-meta">
              <div className="rail-user-email" title={me?.email}>{me?.email}</div>
              <div className="rail-user-role">{me?.role}</div>
            </div>
            <button className="btn icon sm ghost" onClick={signOut} title="Sign out" aria-label="Sign out">
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </nav>

      <main className="main">
        <header className="topbar">
          <div className="crumb">{current?.label ?? 'Matchr'}</div>
          <div className="spacer" />
          <button className="btn sm ghost" onClick={() => setPaletteOpen(true)}>
            <Search size={14} />
            Jump to
            <kbd style={{ marginLeft: 4 }}>⌘K</kbd>
          </button>
        </header>

        <div className="content">{children}</div>
      </main>

      {paletteOpen && (
        <CommandPalette
          items={allowed.map((n) => ({ to: n.to, label: n.label, group: n.group, icon: n.icon }))}
          onClose={() => setPaletteOpen(false)}
          onNavigate={(to) => { navigate(to); setPaletteOpen(false); }}
        />
      )}
    </div>
  );
}

export function PageBody({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return <div className={`content-inner${wide ? ' wide' : ''}`}>{children}</div>;
}

export { BarChart3 };
