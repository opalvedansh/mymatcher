// ─── API Response & Model Types ──────────────────────────────────

export type UserRole = 'brand' | 'influencer';
export type SwipeDirection = 'like' | 'reject' | 'super_like';
export type MatchStatus = 'active' | 'archived';

export interface ApiUser {
  id: string;        // Firebase UID
  email: string;
  role: UserRole | null;
  created_at: string;
}

export type PaymentMode = 'bank_transfer' | 'upi' | 'cheque' | 'paypal';
export type VerificationStatus = 'none' | 'pending' | 'approved' | 'rejected';

// ── Profile types ─────────────────────────────────────────────────

export interface BrandProfile {
  user_id: string;
  name: string | null;
  logo_url: string | null;
  cover_url: string | null;
  bio: string | null;
  categories: string[];
  location: string | null;
  lat: number | null;
  lng: number | null;
  budget_min: number;
  budget_max: number;
  campaign_days?: number;
  /** What the brand asks for per collaboration. 0 means they have not said. */
  deliverable_reels?: number;
  deliverable_stories?: number;
  deliverable_posts?: number;
  /** Terms the brand states itself. Matchr does not hold or guarantee payment. */
  payment_mode?: PaymentMode | null;
  payment_days?: number;
  /** Averages come from creators who matched with the brand; null until rated. */
  rating_avg?: string | number | null;
  rating_count?: number;
  /** Owner-only: a visitor sees `verified` and nothing about the review. */
  verification_status?: VerificationStatus;
  verification_business_name?: string | null;
  verification_note?: string | null;
  campaign_types: string[];
  vibes: string[];
  photos?: string[];
  platforms?: string[];
  website: string | null;
  verified: boolean;
  worked_with?: string[];
  email: string;
  role: 'brand';
  member_since: string;
}

/** A LinkedIn recommendation the influencer added; links back to LinkedIn as proof. */
export interface LinkedinReview {
  id: string;
  quote: string;
  reviewer_name: string;
  reviewer_title: string | null;
  linkedin_url: string;
  added_at: string;
}

export interface InfluencerProfile {
  user_id: string;
  name: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  bio: string | null;
  categories: string[];
  location: string | null;
  lat: number | null;
  lng: number | null;
  age: number | null;
  gender: string | null;
  instagram_handle?: string | null;
  platforms: string[];
  photos?: string[];
  reels?: {id: string, url: string, views: string, thumbnail_url?: string}[];
  followers: number;
  engagement_rate: number;
  avg_views: number;
  price_min: number;
  price_max: number;
  verified: boolean;
  /**
   * True when the follower figures came from an Instagram sync. Absent on a
   * profile fetch; the feed sets it, and swipe cards only show numbers when
   * it is true, so hand-entered figures cannot pass as measurements.
   */
  stats_verified?: boolean;
  worked_with?: string[];
  linkedin_reviews?: LinkedinReview[];
  email: string;
  role: 'influencer';
  member_since: string;
}

export type AnyProfile = BrandProfile | InfluencerProfile;

// ── Feed ──────────────────────────────────────────────────────────

export interface FeedResponse {
  data: (AnyProfile & { relevance_score?: number })[];
  count: number;
  next_cursor_score: number | null;
  next_cursor_id: string | null;
  scoring?: {
    weights: Record<string, number>;
    description: string;
  };
}

// ── Swipe ─────────────────────────────────────────────────────────

export interface SwipeRecord {
  id: string;
  swiper_id: string;
  swiped_id: string;
  direction: SwipeDirection;
  created_at: string;
  swiped_role: UserRole;
}

export interface SwipeResponse {
  swipe: SwipeRecord;
  matched: boolean;
  match?: MatchRecord | null;
}

// ── Match ─────────────────────────────────────────────────────────

export interface MatchRecord {
  match_id: string;
  status: MatchStatus;
  matched_at: string;
  // Brand side
  brand_id: string;
  brand_name: string | null;
  brand_logo: string | null;
  brand_cover: string | null;
  brand_bio: string | null;
  brand_categories: string[];
  brand_location: string | null;
  budget_min: number;
  budget_max: number;
  campaign_types: string[];
  vibes: string[];
  brand_verified: boolean;
  // Influencer side
  influencer_id: string;
  influencer_name: string | null;
  influencer_avatar: string | null;
  influencer_cover: string | null;
  influencer_bio: string | null;
  influencer_categories: string[];
  influencer_location: string | null;
  followers: number;
  engagement_rate: number;
  avg_views: number;
  platforms: string[];
  price_min: number;
  price_max: number;
  influencer_verified: boolean;
  // Inbox data
  last_message?: string;
  last_message_at?: string;
  last_message_sender?: string;
  last_message_read_at?: string;
}

/** GET /api/matches returns a page, not a bare list. */
export interface MatchListResponse {
  data: MatchRecord[];
  next_cursor: string | null;
}

/** GET /api/matches/stats. Postgres sends COUNT(*) as a string, so coerce with Number(). */
export interface MatchStats {
  total_active: string | number;
  total_archived: string | number;
  avg_relevance_score: number | null;
  top_relevance_score: number | null;
  top_categories: { category: string; count: string | number }[];
}

/**
 * GET /api/profiles/me/responsiveness — how fast you answer the people you
 * match with, measured from your chat history. The rates are null until
 * `conversations` reaches `min_sample`.
 */
export interface Responsiveness {
  conversations: number;
  replied: number;
  min_sample: number;
  response_rate: number | null;
  median_reply_seconds: number | null;
}

/** GET/PUT /api/ratings/:brandId */
export interface BrandRating {
  count: number;
  average: number | null;
  recommend_count?: number;
  /** The signed-in creator's own score, if they have left one. */
  my_score: number | null;
  /** True only for a creator who has matched with this brand. */
  can_rate: boolean;
}

/** POST /api/profiles/me/verification */
export interface VerificationRequestResult {
  verification_status: VerificationStatus;
  verification_business_name: string | null;
  verification_submitted_at: string;
}

// ── Chat ──────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  read_at: string | null;
  client_msg_id?: string | null;
}

export interface ChatResponse {
  data: ChatMessage[];
  next_cursor: string | null;
}

// ── Profile update bodies ─────────────────────────────────────────

export interface BrandProfileUpdate {
  name?: string;
  logo_url?: string;
  cover_url?: string;
  bio?: string;
  categories?: string[];
  location?: string;
  lat?: number;
  lng?: number;
  budget_min?: number;
  budget_max?: number;
  campaign_days?: number;
  deliverable_reels?: number;
  deliverable_stories?: number;
  deliverable_posts?: number;
  /** '' clears the stated mode. */
  payment_mode?: PaymentMode | '';
  payment_days?: number;
  campaign_types?: string[];
  vibes?: string[];
  photos?: string[];
  platforms?: string[];
  website?: string;
  verified?: boolean;
  worked_with?: string[];
}

export interface InfluencerProfileUpdate {
  name?: string;
  avatar_url?: string;
  cover_url?: string;
  bio?: string;
  categories?: string[];
  location?: string;
  lat?: number;
  lng?: number;
  age?: number;
  gender?: string;
  instagram_handle?: string;
  platforms?: string[];
  photos?: string[];
  reels?: {id: string, url: string, views: string, thumbnail_url?: string}[];
  followers?: number;
  engagement_rate?: number;
  avg_views?: number;
  price_min?: number;
  price_max?: number;
  verified?: boolean;
  worked_with?: string[];
  linkedin_reviews?: LinkedinReview[];
}

export type ProfileUpdate = BrandProfileUpdate | InfluencerProfileUpdate;

// ── Notifications ─────────────────────────────────────────────────

export type NotificationType = 'new_match' | 'new_like' | 'new_message';

export interface AppNotification {
  id: string;
  type: NotificationType;
  match_id: string | null;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
  /** Always null for likes: who liked you is a premium feature. */
  actor_id: string | null;
  actor_name: string | null;
  actor_avatar: string | null;
}

export interface NotificationsResponse {
  data: AppNotification[];
  next_before: string | null;
}
