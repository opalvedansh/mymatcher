/**
 * In-process LRU-style TTL Cache.
 *
 * Provides a simple key-value store with automatic expiration.
 * Ideal for caching DB lookups (profiles, own-profile in feed)
 * without requiring external infrastructure like Redis.
 *
 * When you scale to multiple server instances, swap this for Redis.
 */
class CacheStore {
  constructor(defaultTtlMs = 60_000, maxEntries = 10_000) {
    this._store = new Map();
    this._defaultTtl = defaultTtlMs;
    this._maxEntries = maxEntries;

    // Periodic cleanup every 30 seconds to prevent memory leaks
    this._cleanupInterval = setInterval(() => this._cleanup(), 30_000);
    // Allow Node to exit even if the interval is active
    if (this._cleanupInterval.unref) this._cleanupInterval.unref();
  }

  /**
   * Get a cached value by key. Returns undefined on miss or expiry.
   */
  get(key) {
    const entry = this._store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return undefined;
    }

    return entry.value;
  }

  /**
   * Set a key with optional custom TTL (defaults to constructor default).
   */
  set(key, value, ttlMs) {
    const ttl = ttlMs ?? this._defaultTtl;
    this._store.delete(key);
    if (this._store.size >= this._maxEntries) {
      // Maps iterate in insertion order, so the first key is the oldest write.
      this._store.delete(this._store.keys().next().value);
    }
    this._store.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * Delete a specific key (cache invalidation).
   */
  del(key) {
    this._store.delete(key);
  }

  /**
   * Flush all entries.
   */
  flush() {
    this._store.clear();
  }

  /**
   * Internal: remove expired entries.
   */
  _cleanup() {
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (now > entry.expiresAt) {
        this._store.delete(key);
      }
    }
  }

  /** Current cache size (for monitoring/admin stats). */
  get size() {
    return this._store.size;
  }
}

// Singleton instances
const profileCache = new CacheStore(60_000);  // 60s TTL for profiles
const feedCache    = new CacheStore(30_000);  // 30s TTL for feed self-lookups

module.exports = { CacheStore, profileCache, feedCache };
