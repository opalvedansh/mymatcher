/**
 * Types for the admin API.
 *
 * The domain enums mirror src/api/types.ts in the mobile app — the same values
 * the database CHECK constraints enforce. Keeping them spelled out here rather
 * than importing across the workspace boundary keeps the panel buildable on
 * its own; they are small and change rarely.
 */

export type UserRole = 'brand' | 'influencer';
export type SwipeDirection = 'like' | 'reject' | 'super_like';
export type MatchStatus = 'active' | 'archived';
export type VerificationStatus = 'none' | 'pending' | 'approved' | 'rejected';
export type PaymentMode = 'bank_transfer' | 'upi' | 'cheque' | 'paypal';
export type ReportTargetType = 'user' | 'post' | 'story' | 'message';
export type ReportReason = 'spam' | 'inappropriate' | 'harassment' | 'fake_profile' | 'other';
export type ReportStatus = 'open' | 'actioned' | 'dismissed';
export type AdminRole = 'superadmin' | 'moderator' | 'support' | 'analyst';

export type Permission =
  | 'metrics:read'
  | 'users:read' | 'users:write' | 'users:ban' | 'users:delete' | 'users:export'
  | 'reports:read' | 'reports:write'
  | 'content:read' | 'content:delete'
  | 'verifications:read' | 'verifications:write'
  | 'ratings:read' | 'ratings:delete'
  | 'matches:read' | 'messages:read'
  | 'settings:read' | 'settings:write'
  | 'broadcast:send'
  | 'admins:read' | 'admins:write'
  | 'audit:read'
  | 'system:read';

export interface Me {
  id: string;
  email: string;
  role: AdminRole;
  /** Expanded server-side, so the panel never hardcodes the role→permission map. */
  permissions: Permission[];
  all_permissions: Permission[];
  roles: { role: AdminRole; permissions: Permission[] }[];
}

export interface Stats {
  total_users: number;
  total_brands: number;
  total_influencers: number;
  banned_users: number;
  deleted_users: number;
  active_matches: number;
  archived_matches: number;
  total_swipes: number;
  total_messages: number;
  pending_verifications: number;
  open_reports: number;
  signups_24h: number;
  matches_24h: number;
  messages_24h: number;
  swipes_24h: number;
}

export interface SeriesPoint {
  day: string;
  signups: number;
  brand_signups: number;
  influencer_signups: number;
  swipes: number;
  likes: number;
  matches: number;
  messages: number;
  active_senders: number;
  reports: number;
}

export interface Timeseries {
  tz: string;
  from: string;
  to: string;
  series: SeriesPoint[];
}

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
  pct_of_start: number;
  pct_of_prev: number;
}

export interface Funnel {
  from: string;
  to: string;
  role: UserRole | null;
  cohort_size: number;
  stages: FunnelStage[];
  /** Reported beside the funnel, not inside it — the product gates nothing on it. */
  profile_complete: { count: number; pct_of_start: number };
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  role: UserRole | null;
  banned: boolean;
  banned_at: string | null;
  banned_reason: string | null;
  deleted_at: string | null;
  created_at: string;
  verified: boolean;
  verification_status: VerificationStatus | null;
  match_count: number;
  /** Only whether one exists — a push token is a device address. */
  has_push_token: boolean;
}

export interface UserDetail {
  user: AdminUserRow & { updated_at: string; banned_by: string | null; admin_role: AdminRole | null };
  profile: Record<string, unknown> | null;
  counts: Record<string, number | string | null>;
  recent: {
    swipes: { swiped_id: string; direction: SwipeDirection; created_at: string; target_name: string | null }[];
    matches: { id: string; status: MatchStatus; matched_at: string; other_name: string | null }[];
    reports_filed: ReportRow[];
    reports_against: ReportRow[];
    ratings: { id: string; influencer_id: string; score: number; created_at: string; rater_name: string | null }[];
    admin_actions: AuditRow[];
  };
}

export type ResolvedTarget =
  | { deleted: true }
  | { id: string; name?: string | null; email?: string; banned?: boolean; avatar_url?: string | null; bio?: string | null; created_at?: string }
  | { id: string; user_id: string; image_url: string; caption: string | null; likes_count: number; created_at: string }
  | { id: string; user_id: string; media_url: string; created_at: string; expires_at: string; expired: boolean }
  | { id: string; match_id: string; sender_id: string; created_at: string; content: null; content_available: true };

export interface ReportRow {
  id: string;
  reporter_id: string | null;
  target_type: ReportTargetType;
  target_id: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  prior_reports_against_target?: number;
  reporter?: { id: string; name: string | null; avatar_url: string | null; banned: boolean } | null;
  target?: ResolvedTarget;
}

export type ReportAction =
  | 'dismiss' | 'delete_content' | 'ban_target' | 'ban_reporter' | 'warn_target' | 'actioned_no_change';

export interface VerificationRow {
  user_id: string;
  name: string | null;
  website: string | null;
  logo_url: string | null;
  bio: string | null;
  location: string | null;
  categories: string[];
  verified: boolean;
  verification_status: VerificationStatus;
  verification_business_name: string | null;
  verification_reg_number: string | null;
  verification_submitted_at: string | null;
  verification_reviewed_at: string | null;
  verification_reviewed_by: string | null;
  verification_note: string | null;
  email: string;
  user_created_at: string;
  banned: boolean;
  report_count: number;
}

export interface PostRow {
  id: string;
  user_id: string;
  author_name: string | null;
  image_url: string;
  caption: string | null;
  likes_count: number;
  created_at: string;
  report_count: number;
}

export interface StoryRow {
  id: string;
  user_id: string;
  author_name: string | null;
  media_url: string;
  created_at: string;
  expires_at: string;
  expired: boolean;
  view_count: number;
  report_count: number;
}

export interface MatchRow {
  id: string;
  brand_id: string;
  influencer_id: string;
  brand_name: string | null;
  influencer_name: string | null;
  status: MatchStatus;
  relevance_score: string | null;
  matched_at: string;
  message_count: number;
  last_message_at: string | null;
  reported: boolean;
}

/** Shape of a conversation, with no content in it. */
export interface TimelineEntry {
  id: string;
  sender_id: string;
  created_at: string;
  read_at: string | null;
  cipher_length: number;
}

export interface DecryptedMessage {
  id: string;
  sender_id: string;
  created_at: string;
  read_at?: string | null;
  is_target?: boolean;
  content: string;
}

export interface RatingRow {
  id: string;
  brand_id: string;
  influencer_id: string;
  brand_name: string | null;
  influencer_name: string | null;
  match_id: string | null;
  score: number;
  created_at: string;
  updated_at: string;
}

export interface SettingRow {
  key: string;
  value: unknown;
  type: string;
  description: string | null;
  schema: Record<string, string> | null;
  editable: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

export interface AlgorithmWeights {
  CATEGORY_OVERLAP: number;
  BUDGET_FIT: number;
  LOCATION_MATCH: number;
  COMPLETENESS: number;
}

export interface MaintenanceMode {
  enabled: boolean;
  message: string;
  allow_admins: boolean;
}

export interface AdminRow {
  user_id: string;
  email: string | null;
  role: AdminRole;
  note: string | null;
  created_by: string | null;
  created_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
  last_action_at: string | null;
  permissions: Permission[];
}

export interface AuditRow {
  id: string;
  admin_id: string;
  admin_email: string | null;
  admin_role?: AdminRole | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  user_agent?: string | null;
  status: number | null;
  created_at: string;
}

export interface BroadcastSegment {
  role?: UserRole;
  banned?: boolean;
  verified?: boolean;
  verification_status?: VerificationStatus;
  has_push_token?: boolean;
  categories?: string[];
  location?: string;
  created_from?: string;
  created_to?: string;
  user_ids?: string[];
}

export interface BroadcastPreview {
  recipients: number;
  with_push_token: number;
  sample: { id: string; role: UserRole | null; name: string | null }[];
}

export interface BroadcastRow {
  id: string;
  admin_id: string;
  admin_email: string | null;
  title: string;
  body: string;
  segment: BroadcastSegment;
  recipient_count: number;
  created_at: string;
}

export interface SystemHealth {
  build: {
    commit: string; started_at: string; uptime_s: number; node_env: string;
    node_version: string; service: string; sockets_enabled: boolean; workers_enabled: boolean;
  };
  database: { ok: boolean; latency_ms: number; error?: string; pool?: Record<string, number> };
  redis: { ok: boolean; latency_ms: number; error?: string; configured?: boolean; status?: string };
  queues: {
    ok: boolean; latency_ms: number; error?: string; configured?: boolean;
    queues?: { name: string; ok: boolean; error?: string; [k: string]: unknown }[];
  };
  migrations: {
    ok: boolean; error?: string;
    latest_applied?: string | null; applied_at?: string | null; applied_count?: number;
    latest_on_disk?: string | null; up_to_date?: boolean | null;
  };
}

export interface Paged<T> {
  data: T[];
  next_cursor: string | null;
  has_more?: boolean;
  pagination?: 'keyset' | 'offset';
  total?: number;
}
