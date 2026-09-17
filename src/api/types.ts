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
  worked_with?: string[];
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
}

export type ProfileUpdate = BrandProfileUpdate | InfluencerProfileUpdate;
