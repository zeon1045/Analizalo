import { eq, lt } from 'drizzle-orm';
import { db } from '../db';
import { streamUrlCache } from '../schema';
import logger from '@main/logger';
import type { AudioFormat } from '@main/core/onlineSearch';

/**
 * Get cached stream info for a video ID
 * Returns null if not cached or if URLs have expired
 */
export async function getCachedStreamInfo(videoId: string): Promise<AudioFormat[] | null> {
  try {
    const [cached] = await db
      .select()
      .from(streamUrlCache)
      .where(eq(streamUrlCache.videoId, videoId))
      .limit(1);

    if (!cached) {
      logger.debug('[StreamCache] No cached info found', { videoId });
      return null;
    }

    // Check if URLs have expired
    const now = new Date();
    if (now >= cached.expiresAt) {
      logger.debug('[StreamCache] Cached info expired, deleting', { 
        videoId, 
        expiresAt: cached.expiresAt 
      });
      await deleteCachedStreamInfo(videoId);
      return null;
    }

    logger.info('[StreamCache] Using cached info', { 
      videoId, 
      expiresAt: cached.expiresAt,
      title: cached.title 
    });
    return cached.audioFormats as AudioFormat[];
  } catch (error) {
    logger.error('[StreamCache] Error getting cached info', { videoId, error });
    return null;
  }
}

/**
 * Get raw cached stream info for a video ID (returns audioFormats as string)
 * Used by the stream protocol handler
 */
export async function getRawCachedStreamInfo(videoId: string): Promise<{ audioFormats: string } | null> {
  try {
    const [cached] = await db
      .select()
      .from(streamUrlCache)
      .where(eq(streamUrlCache.videoId, videoId))
      .limit(1);

    if (!cached) {
      return null;
    }

    // Check if URLs have expired
    const now = new Date();
    if (now >= cached.expiresAt) {
      await deleteCachedStreamInfo(videoId);
      return null;
    }

    // Return audioFormats as JSON string for the protocol handler
    return {
      audioFormats: typeof cached.audioFormats === 'string' 
        ? cached.audioFormats 
        : JSON.stringify(cached.audioFormats)
    };
  } catch (error) {
    logger.error('[StreamCache] Error getting raw cached info', { videoId, error });
    return null;
  }
}

/**
 * Save stream info to cache with automatic expiration calculation
 * @param videoId - YouTube video ID
 * @param audioFormats - Array of audio format objects with URLs
 * @param title - Optional video title
 * @param duration - Optional duration in seconds
 */
export async function saveStreamInfoToCache(
  videoId: string,
  audioFormats: AudioFormat[],
  title?: string,
  duration?: number
): Promise<void> {
  try {
    // Calculate expiration from the first URL's expire parameter
    let expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000); // Default: 6 hours

    if (audioFormats.length > 0 && audioFormats[0].url) {
      try {
        const urlObj = new URL(audioFormats[0].url);
        const expireParam = urlObj.searchParams.get('expire');
        if (expireParam) {
          const expireTime = parseInt(expireParam) * 1000;
          // Set expiration 5 minutes before actual URL expiration
          expiresAt = new Date(expireTime - 5 * 60 * 1000);
        }
      } catch (urlError) {
        logger.warn('[StreamCache] Failed to parse URL for expiration', { videoId, urlError });
      }
    }

    await db
      .insert(streamUrlCache)
      .values({
        videoId,
        audioFormats: audioFormats as any,
        expiresAt,
        title,
        duration
      })
      .onConflictDoUpdate({
        target: streamUrlCache.videoId,
        set: {
          audioFormats: audioFormats as any,
          expiresAt,
          title,
          duration,
          cachedAt: new Date()
        }
      });

    logger.info('[StreamCache] Saved to database', { 
      videoId, 
      expiresAt, 
      formatCount: audioFormats.length,
      title 
    });
  } catch (error) {
    logger.error('[StreamCache] Error saving to database', { videoId, error });
  }
}

/**
 * Delete cached stream info for a specific video
 */
export async function deleteCachedStreamInfo(videoId: string): Promise<void> {
  try {
    await db.delete(streamUrlCache).where(eq(streamUrlCache.videoId, videoId));
    logger.debug('[StreamCache] Deleted cached info', { videoId });
  } catch (error) {
    logger.error('[StreamCache] Error deleting cached info', { videoId, error });
  }
}

/**
 * Clean up expired stream cache entries
 * Should be called periodically (e.g., on app startup or hourly)
 */
export async function cleanupExpiredStreamCache(): Promise<number> {
  try {
    const now = new Date();
    const result = await db
      .delete(streamUrlCache)
      .where(lt(streamUrlCache.expiresAt, now))
      .returning({ videoId: streamUrlCache.videoId });

    const deletedCount = result.length;
    if (deletedCount > 0) {
      logger.info('[StreamCache] Cleaned up expired entries', { deletedCount });
    }
    return deletedCount;
  } catch (error) {
    logger.error('[StreamCache] Error cleaning up expired entries', { error });
    return 0;
  }
}

/**
 * Get cache statistics
 */
export async function getStreamCacheStats(): Promise<{
  total: number;
  expired: number;
  valid: number;
}> {
  try {
    const allEntries = await db.select().from(streamUrlCache);
    const now = new Date();
    
    const expired = allEntries.filter(entry => now >= entry.expiresAt).length;
    const total = allEntries.length;
    const valid = total - expired;

    return { total, expired, valid };
  } catch (error) {
    logger.error('[StreamCache] Error getting cache stats', { error });
    return { total: 0, expired: 0, valid: 0 };
  }
}
