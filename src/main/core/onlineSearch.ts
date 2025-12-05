/**
 * Online Search and Streaming Service
 * Based on Harmony Music's implementation (https://github.com/anandnet/Harmony-Music)
 * 
 * Uses Piped API (YouTube proxy) to get direct stream URLs - same approach Harmony supports
 * See: lib/services/background_task.dart in Harmony for Piped implementation
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import logger from '../logger';
import { getUserSettings } from '../db/queries/settings';
import { saveFolderStructures } from '../fs/parseFolderStructuresForSongPaths';
import { getFolderFromPath } from '../db/queries/folders';
import { dataUpdateEvent } from '../main';
import { db } from '../db/db';
import { saveSong, isSongWithPathAvailable } from '../db/queries/songs';
import { storeArtworks } from '../other/artworks';
import { linkArtworksToSong } from '../db/queries/artworks';
import manageArtistsOfParsedSong from '../parseSong/manageArtistsOfParsedSong';
import manageAlbumsOfParsedSong from '../parseSong/manageAlbumsOfParsedSong';
import youtubedl from 'youtube-dl-exec';

export interface OnlineSearchResult {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  artworkUrl: string;
  downloadUrl: string;
  source: string;
  type: string;
}

export type SearchFilter = 'songs' | 'videos' | 'albums' | 'artists' | 'playlists';

// Cache directory for temporary audio files
const CACHE_DIR = path.join(app.getPath('temp'), 'nora-audio-cache');

// Cache configuration - OPTIMIZED FOR USER EXPERIENCE
// Larger cache = less waiting, playlist songs = never deleted
const MAX_CACHE_SIZE_MB = 4096;  // 4GB cache for maximum speed
const MAX_CACHE_AGE_DAYS = 20;   // Delete non-playlist songs after 20 days of no use
const CACHE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Run cleanup every hour

// Protected song IDs (songs in playlists) - these are NEVER deleted from cache
// This is populated by the renderer process via IPC
let protectedSongIds: Set<string> = new Set();

/**
 * Update the list of protected song IDs (songs in playlists)
 * Called from renderer when playlist data changes
 */
export function updateProtectedSongIds(songIds: string[]): void {
  protectedSongIds = new Set(songIds.map(id => {
    // Clean the ID (remove MPED prefix if present)
    return id.startsWith('MPED') ? id.substring(4) : id;
  }));
  logger.info(`[Cache] Updated protected songs: ${protectedSongIds.size} songs in playlists will never be deleted`);
}

/**
 * Get list of currently protected song IDs
 */
export function getProtectedSongIds(): string[] {
  return Array.from(protectedSongIds);
}

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Clean up old cache files - SMART CLEANUP
 * - NEVER deletes songs that are in playlists (protectedSongIds)
 * - Removes non-playlist files older than MAX_CACHE_AGE_DAYS
 * - If still over MAX_CACHE_SIZE_MB, removes oldest non-protected files
 */
function cleanupCache(): void {
  try {
    const files = fs.readdirSync(CACHE_DIR);
    const now = Date.now();
    const maxAge = MAX_CACHE_AGE_DAYS * 24 * 60 * 60 * 1000; // Convert days to ms
    
    // Get file info with stats
    const fileInfos = files
      .map(file => {
        const filePath = path.join(CACHE_DIR, file);
        try {
          const stats = fs.statSync(filePath);
          // Extract video ID from filename (remove extension)
          const videoId = path.basename(file, path.extname(file));
          const isProtected = protectedSongIds.has(videoId);
          return { 
            path: filePath, 
            name: file, 
            videoId,
            mtime: stats.mtimeMs, 
            atime: stats.atimeMs, // Last access time (when played)
            size: stats.size,
            isProtected
          };
        } catch {
          return null;
        }
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);
    
    let deletedCount = 0;
    let freedBytes = 0;
    let protectedCount = 0;
    
    // First pass: delete NON-PROTECTED files older than MAX_CACHE_AGE_DAYS
    for (const file of fileInfos) {
      if (file.isProtected) {
        protectedCount++;
        continue; // NEVER delete playlist songs
      }
      
      // Use last access time (atime) to determine if file was recently played
      const lastUsed = Math.max(file.mtime, file.atime);
      if (now - lastUsed > maxAge) {
        try {
          fs.unlinkSync(file.path);
          deletedCount++;
          freedBytes += file.size;
          logger.debug(`[Cache] Deleted old file: ${file.name} (not used in ${MAX_CACHE_AGE_DAYS} days)`);
        } catch { /* ignore */ }
      }
    }
    
    // Second pass: if still over size limit, delete oldest NON-PROTECTED files
    const remainingFiles = fileInfos
      .filter(f => fs.existsSync(f.path))
      .sort((a, b) => {
        // Protected files go to the end (never deleted first)
        if (a.isProtected && !b.isProtected) return 1;
        if (!a.isProtected && b.isProtected) return -1;
        // Sort by last used time (oldest first)
        const aLastUsed = Math.max(a.mtime, a.atime);
        const bLastUsed = Math.max(b.mtime, b.atime);
        return aLastUsed - bLastUsed;
      });
    
    let totalSize = remainingFiles.reduce((sum, f) => sum + f.size, 0);
    const maxBytes = MAX_CACHE_SIZE_MB * 1024 * 1024;
    
    while (totalSize > maxBytes && remainingFiles.length > 0) {
      const oldest = remainingFiles[0];
      
      // Stop if we've reached protected files
      if (oldest.isProtected) {
        logger.info(`[Cache] At size limit but only protected files remain. Keeping ${remainingFiles.length} playlist songs.`);
        break;
      }
      
      remainingFiles.shift();
      try {
        fs.unlinkSync(oldest.path);
        totalSize -= oldest.size;
        deletedCount++;
        freedBytes += oldest.size;
        logger.debug(`[Cache] Deleted for space: ${oldest.name}`);
      } catch { /* ignore */ }
    }
    
    const totalSizeMB = Math.round(totalSize / 1024 / 1024);
    const protectedSizeMB = Math.round(
      remainingFiles.filter(f => f.isProtected).reduce((sum, f) => sum + f.size, 0) / 1024 / 1024
    );
    
    if (deletedCount > 0 || protectedCount > 0) {
      logger.info(
        `[Cache] Cleanup: deleted ${deletedCount} files (${Math.round(freedBytes / 1024 / 1024)}MB freed), ` +
        `${protectedCount} playlist songs protected (${protectedSizeMB}MB), ` +
        `total cache: ${totalSizeMB}MB / ${MAX_CACHE_SIZE_MB}MB`
      );
    }
  } catch (error) {
    logger.debug('[Cache] Cleanup error:', error as object);
  }
}

// Run initial cleanup on module load
cleanupCache();

// Schedule periodic cleanup
setInterval(cleanupCache, CACHE_CLEANUP_INTERVAL_MS);

// ============================================================================
// Piped API Configuration
// Same approach as Harmony Music's background_task.dart
// OPTIMIZED: Parallel requests + instance caching for faster response
// ============================================================================

// List of Piped instances - ordered by reliability (most reliable first)
const PIPED_INSTANCES = [
  'https://pipedapi.in.projectsegfau.lt',  // Most reliable in testing
  'https://pipedapi.darkness.services',
  'https://api.piped.yt',
  'https://pipedapi.adminforge.de', 
  'https://pipedapi.kavin.rocks'           // Often returns 521 errors
];

// Cache the last working instance to try it first
let lastWorkingInstance: string | null = null;

// Request timeout in milliseconds (shorter = faster failover)
const PIPED_TIMEOUT_MS = 5000;

// ============================================================================
// Prefetch System - Download songs in background for instant playback
// ============================================================================

// Track which videos are currently being prefetched (to avoid duplicates)
const prefetchInProgress = new Set<string>();

// Track prefetch queue
const prefetchQueue: string[] = [];
const MAX_CONCURRENT_PREFETCH = 2;
let activePrefetches = 0;

// ============================================================================
// Audio Format Types (equivalent to Harmony's Audio class in stream_service.dart)
// ============================================================================

export const Codec = {
  mp4a: 'mp4a',
  opus: 'opus'
} as const;

export type CodecType = typeof Codec[keyof typeof Codec];

export interface AudioFormat {
  itag: number;
  audioCodec: CodecType;
  bitrate: number;
  duration: number;
  url: string;
  size: number;
  mimeType: string;
  quality: string;
}

// ============================================================================
// StreamProvider (equivalent to Harmony's StreamProvider in stream_service.dart)
// Uses Piped API instead of youtube_explode_dart
// ============================================================================

export interface StreamProviderResult {
  playable: boolean;
  statusMSG: string;
  audioFormats: AudioFormat[] | null;
}

/**
 * Fetches audio stream information using Piped API
 * This is equivalent to Harmony's getSongUrlFromPiped() in background_task.dart
 * 
 * OPTIMIZED: Uses parallel requests to all instances with Promise.race
 * Also caches the last working instance to try it first
 */
export async function fetchStreamInfo(videoId: string): Promise<StreamProviderResult> {
  // Clean videoId if it has MPED prefix (like Harmony does)
  if (videoId.startsWith('MPED')) {
    videoId = videoId.substring(4);
  }
  
  logger.info(`[StreamProvider] Fetching stream info for: ${videoId}`);
  
  // Helper function to fetch from a single instance with timeout
  const fetchFromInstance = async (pipedUrl: string): Promise<{ instance: string; data: any } | null> => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PIPED_TIMEOUT_MS);
    
    try {
      const response = await fetch(`${pipedUrl}/streams/${videoId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        logger.debug(`[StreamProvider] ${pipedUrl} returned ${response.status}`);
        return null;
      }
      
      const data = await response.json();
      
      if (data.error) {
        logger.debug(`[StreamProvider] ${pipedUrl} error: ${data.error}`);
        return null;
      }
      
      const audioStreams = data.audioStreams as any[];
      if (!audioStreams || audioStreams.length === 0) {
        logger.debug(`[StreamProvider] ${pipedUrl} no audio streams`);
        return null;
      }
      
      // Success!
      return { instance: pipedUrl, data };
      
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        logger.debug(`[StreamProvider] ${pipedUrl} timed out`);
      } else {
        logger.debug(`[StreamProvider] ${pipedUrl} error: ${error.message}`);
      }
      return null;
    }
  };
  
  // Build list of instances to try, with last working instance first
  let instancesToTry = [...PIPED_INSTANCES];
  if (lastWorkingInstance && instancesToTry.includes(lastWorkingInstance)) {
    // Move last working instance to front
    instancesToTry = [
      lastWorkingInstance,
      ...instancesToTry.filter(i => i !== lastWorkingInstance)
    ];
  }
  
  logger.info(`[StreamProvider] Racing ${instancesToTry.length} Piped instances (timeout: ${PIPED_TIMEOUT_MS}ms)`);
  
  // Strategy: Try last working instance first (if any), then race all others
  if (lastWorkingInstance) {
    logger.debug(`[StreamProvider] Trying last working instance first: ${lastWorkingInstance}`);
    const result = await fetchFromInstance(lastWorkingInstance);
    if (result) {
      return processStreamData(result.data, result.instance);
    }
    // Last working instance failed, remove from cache
    logger.debug(`[StreamProvider] Last working instance failed, trying others in parallel`);
    lastWorkingInstance = null;
  }
  
  // Race all instances in parallel - first successful response wins
  const racePromises = instancesToTry.map(instance => 
    fetchFromInstance(instance).then(result => {
      if (result) return result;
      // Return a promise that never resolves for failed attempts
      return new Promise<never>(() => {});
    })
  );
  
  // Add a timeout promise that rejects after all individual timeouts
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('All instances timed out')), PIPED_TIMEOUT_MS + 1000);
  });
  
  try {
    const winner = await Promise.race([...racePromises, timeoutPromise]);
    return processStreamData(winner.data, winner.instance);
  } catch (error) {
    // All instances failed, try Innertube fallback
    logger.warn(`[StreamProvider] All Piped instances failed for ${videoId}, trying Innertube fallback...`);
    return await fetchStreamInfoFromInnertube(videoId);
  }
}

/**
 * Fallback: Fetch stream info using yt-dlp (youtube-dl-exec)
 * Used when all Piped instances fail
 * 
 * CRITICAL: This is the ONLY reliable method to get YouTube stream URLs
 * yt-dlp handles all signature deciphering, throttling bypass, and format extraction
 * This is the same approach used by Harmony Music and other successful apps
 */
async function fetchStreamInfoFromInnertube(videoId: string): Promise<StreamProviderResult> {
  try {
    logger.debug(`[StreamProvider] yt-dlp: Fetching formats for ${videoId}`);
    
    // Use yt-dlp to extract all formats (this handles signature deciphering automatically)
    const info = await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      addHeader: ['referer:youtube.com', 'user-agent:googlebot']
    });

    if (!info || !info.formats || info.formats.length === 0) {
      logger.error(`[StreamProvider] yt-dlp: No formats found for ${videoId}`);
      return { playable: false, statusMSG: 'No formats available', audioFormats: null };
    }

    // Filter audio-only formats (no video)
    const audioOnlyFormats = info.formats.filter((f: any) => 
      f.acodec && f.acodec !== 'none' && 
      (!f.vcodec || f.vcodec === 'none') &&
      f.url && typeof f.url === 'string' && f.url.startsWith('http')
    );

    if (audioOnlyFormats.length === 0) {
      logger.error(`[StreamProvider] yt-dlp: No audio-only formats with valid URLs`);
      return { playable: false, statusMSG: 'No audio formats available', audioFormats: null };
    }

    // Sort by bitrate (highest first)
    audioOnlyFormats.sort((a: any, b: any) => {
      const bitrateA = a.tbr || a.abr || 0;
      const bitrateB = b.tbr || b.abr || 0;
      return bitrateB - bitrateA;
    });

    // Convert to our AudioFormat interface
    const audioFormats: AudioFormat[] = audioOnlyFormats.slice(0, 3).map((f: any) => ({
      itag: f.format_id ? parseInt(f.format_id, 10) : 0,
      audioCodec: (f.acodec || '').includes('mp4a') || (f.ext || '').includes('m4a') 
        ? Codec.mp4a 
        : Codec.opus,
      bitrate: Math.floor((f.tbr || f.abr || 0) * 1000), // Convert kbps to bps
      duration: Math.floor(info.duration || 0),
      url: f.url, // ✅ Direct playable URL from yt-dlp
      size: f.filesize || f.filesize_approx || 0,
      mimeType: f.ext === 'm4a' ? 'audio/mp4' : 'audio/webm',
      quality: `${Math.floor(f.tbr || f.abr || 0)}kbps`
    }));

    logger.info(`[StreamProvider] ✅ yt-dlp SUCCESS: ${audioFormats.length} formats for ${videoId}`);
    audioFormats.forEach(f => {
      logger.debug(`  - itag ${f.itag}: ${f.quality} (${f.audioCodec})`);
    });

    return {
      playable: true,
      statusMSG: 'OK',
      audioFormats
    };

  } catch (error: any) {
    logger.error(`[StreamProvider] yt-dlp fallback failed: ${error.message}`, { error });
    return { playable: false, statusMSG: 'All streaming sources unavailable', audioFormats: null };
  }
}

/**
 * Process stream data from Piped API response
 */
function processStreamData(data: any, instance: string): StreamProviderResult {
  const audioStreams = data.audioStreams as any[];
  
  // Map to our AudioFormat interface (like Harmony's Audio class)
  const audioFormats: AudioFormat[] = audioStreams
    .filter(s => s.url) // Only streams with URLs
    .map(s => ({
      itag: s.itag || 0,
      audioCodec: (s.codec || s.mimeType || '').includes('mp4') || (s.codec || s.mimeType || '').includes('m4a') 
        ? Codec.mp4a 
        : Codec.opus,
      bitrate: s.bitrate || 0,
      duration: data.duration || 0,
      url: s.url,
      size: s.contentLength || 0,
      mimeType: s.mimeType || '',
      quality: s.quality || ''
    }));
  
  if (audioFormats.length === 0) {
    logger.warn(`[StreamProvider] No valid audio formats after filtering`);
    return { playable: false, statusMSG: 'No valid audio formats', audioFormats: null };
  }
  
  // Cache the working instance for next time
  lastWorkingInstance = instance;
  logger.info(`[StreamProvider] Success from ${instance} - ${audioFormats.length} audio formats`);
  
  return {
    playable: true,
    statusMSG: 'OK',
    audioFormats
  };
}

/**
 * Get the highest quality audio format
 * Equivalent to Harmony's highestQualityAudio getter
 * Prefers itag 251 (opus high) or 140 (m4a high)
 */
export function getHighestQualityAudio(formats: AudioFormat[]): AudioFormat | null {
  if (!formats || formats.length === 0) return null;
  
  // First try to find itag 251 (opus) or 140 (m4a) - these are highest quality
  const preferred = formats.find(f => f.itag === 251 || f.itag === 140);
  if (preferred) return preferred;
  
  // Otherwise sort by bitrate and return highest
  const sorted = [...formats].sort((a, b) => b.bitrate - a.bitrate);
  return sorted[0];
}

/**
 * Get low quality audio format  
 * Equivalent to Harmony's lowQualityAudio getter
 * Prefers itag 249 (opus low) or 139 (m4a low)
 */
export function getLowQualityAudio(formats: AudioFormat[]): AudioFormat | null {
  if (!formats || formats.length === 0) return null;
  
  const lowQuality = formats.find(f => f.itag === 249 || f.itag === 139);
  if (lowQuality) return lowQuality;
  
  // Return lowest bitrate
  const sorted = [...formats].sort((a, b) => a.bitrate - b.bitrate);
  return sorted[0];
}

// ============================================================================
// Search Functions (using YouTube Music API via youtubei.js for search only)
// ============================================================================

import { Innertube, UniversalCache } from 'youtubei.js';

let yt: Innertube | null = null;

async function getInnertube() {
  if (!yt) {
    logger.info('[Innertube] Creating new instance for search...');
    yt = await Innertube.create({ 
      cache: new UniversalCache(false),
      generate_session_locally: true,
    });
    logger.info('[Innertube] Instance created successfully');
  }
  return yt;
}

export async function getSuggestions(query: string): Promise<string[]> {
  try {
    const youtube = await getInnertube();
    const suggestions = await youtube.getSearchSuggestions(query);
    return suggestions;
  } catch (error) {
    logger.error('[getSuggestions] Error:', error as any);
    return [];
  }
}

export async function searchOnline(query: string, filter: SearchFilter = 'songs'): Promise<OnlineSearchResult[]> {
  try {
    const youtube = await getInnertube();
    
    const filterMap: Record<SearchFilter, string | undefined> = {
      'songs': 'song',
      'videos': 'video', 
      'albums': 'album',
      'artists': 'artist',
      'playlists': 'playlist'
    };
    
    const result = await youtube.music.search(query, {
      type: filterMap[filter] as any
    });

    if (!result.contents) return [];

    const items: OnlineSearchResult[] = [];
    const contents = result.contents as any;

    const extractItem = (item: any): OnlineSearchResult | null => {
      const id = item.id || item.videoId;
      if (!item || !id) return null;
      
      let title = 'Unknown Title';
      if (typeof item.title === 'string') title = item.title;
      else if (item.title?.text) title = item.title.text;
      else if (item.title?.runs?.[0]?.text) title = item.title.runs[0].text;
      else if (item.name) title = item.name;
      
      let artist = 'Unknown Artist';
      if (item.artists && Array.isArray(item.artists) && item.artists.length > 0) {
        artist = item.artists.map((a: any) => a.name || a.text || a.runs?.[0]?.text || '').filter(Boolean).join(', ');
      } else if (item.author) {
        artist = item.author.name || item.author.text || 'Unknown Artist';
      } else if (item.subtitle) {
        if (typeof item.subtitle === 'string') artist = item.subtitle;
        else if (item.subtitle?.text) artist = item.subtitle.text;
        else if (item.subtitle?.runs?.[0]?.text) artist = item.subtitle.runs[0].text;
      }

      let album = 'Unknown Album';
      if (item.album) {
        album = item.album.name || item.album.text || item.album.runs?.[0]?.text || 'Unknown Album';
      }

      let duration = 0;
      if (item.duration) {
        if (typeof item.duration === 'number') duration = item.duration;
        else if (item.duration.seconds) duration = item.duration.seconds;
        else if (typeof item.duration === 'string') {
          const parts = item.duration.split(':').map(Number);
          if (parts.length === 2) duration = parts[0] * 60 + parts[1];
          else if (parts.length === 3) duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
        }
      }

      // High quality thumbnail (like Harmony's Thumbnail class)
      let artworkUrl = '';
      
      // Debug: log the item structure to understand thumbnail format
      logger.debug(`[extractItem] Item keys: ${Object.keys(item).join(', ')}`);
      if (item.thumbnail) {
        logger.debug(`[extractItem] thumbnail type: ${typeof item.thumbnail}, isArray: ${Array.isArray(item.thumbnail)}`);
        if (typeof item.thumbnail === 'object') {
          logger.debug(`[extractItem] thumbnail keys: ${Object.keys(item.thumbnail).join(', ')}`);
        }
      }
      if (item.thumbnails) {
        logger.debug(`[extractItem] thumbnails type: ${typeof item.thumbnails}, isArray: ${Array.isArray(item.thumbnails)}, length: ${item.thumbnails?.length}`);
      }
      
      // Try different thumbnail sources (youtubei.js can have different structures)
      let thumbnails = item.thumbnails || item.thumbnail?.contents || item.thumbnail;
      
      // If thumbnails is a Thumbnail object with url property
      if (thumbnails && typeof thumbnails === 'object' && !Array.isArray(thumbnails)) {
        if (thumbnails.url) {
          thumbnails = [thumbnails];
        } else if (thumbnails.contents) {
          thumbnails = thumbnails.contents;
        }
      }
      
      if (thumbnails && Array.isArray(thumbnails) && thumbnails.length > 0) {
        // Get the highest quality thumbnail
        const thumb = thumbnails[thumbnails.length - 1];
        const thumbUrl = typeof thumb === 'string' ? thumb : thumb.url;
        
        logger.debug(`[extractItem] Found thumbnail URL: ${thumbUrl}`);
        
        if (thumbUrl) {
          if (thumbUrl.includes('=')) {
            artworkUrl = thumbUrl.split('=')[0] + '=w544-h544-l90-rj';
          } else if (thumbUrl.includes('?')) {
            // YouTube thumbnail URLs like https://i.ytimg.com/vi/xxx/maxresdefault.jpg?xxx
            artworkUrl = thumbUrl.split('?')[0];
          } else {
            artworkUrl = thumbUrl;
          }
        }
      }
      
      // Fallback: generate thumbnail URL from video ID
      if (!artworkUrl && id) {
        artworkUrl = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        logger.debug(`[extractItem] Using fallback thumbnail for ${id}: ${artworkUrl}`);
      }
      
      logger.debug(`[extractItem] Final artworkUrl: ${artworkUrl}`);

      return {
        id,
        title,
        artist,
        album,
        duration,
        artworkUrl,
        downloadUrl: `https://music.youtube.com/watch?v=${id}`,
        source: 'YouTube Music',
        type: filter
      };
    };

    if (Array.isArray(contents)) {
      contents.forEach((section: any) => {
        if (section.contents && Array.isArray(section.contents)) {
          section.contents.forEach((item: any) => {
            const extracted = extractItem(item);
            if (extracted) items.push(extracted);
          });
        } else {
          const extracted = extractItem(section);
          if (extracted) items.push(extracted);
        }
      });
    }

    // AUTO-PREFETCH: Start downloading first 6 songs in background for instant playback
    if (filter === 'songs' && items.length > 0) {
      const songIds = items.slice(0, 6).map(item => item.id);
      logger.info(`[searchOnline] Auto-prefetching first ${songIds.length} results`);
      // Use setImmediate to not block the search response
      setImmediate(() => prefetchVideos(songIds));
    }

    return items;

  } catch (error) {
    logger.error('[searchOnline] Error:', error as any);
    return [];
  }
}

// ============================================================================
// Stream URL Function (Main entry point for playing songs)
// Using Piped API - same as Harmony Music's approach
// OPTIMIZED: Faster initial response with progressive download
// ============================================================================

/**
 * Get stream URL for a video ID
 * OPTIMIZED: Downloads first chunk quickly, then continues in background
 * Returns URL as soon as initial chunk is ready for faster playback start
 */
export async function getStreamUrl(videoId: string): Promise<string | null> {
  const startTime = Date.now();
  
  try {
    logger.info(`[getStreamUrl] Getting stream for: ${videoId}`);
    
    // Clean videoId
    let cleanVideoId = videoId;
    if (cleanVideoId.startsWith('MPED')) {
      cleanVideoId = cleanVideoId.substring(4);
    }
    
    // Check cache first (try both m4a and opus extensions)
    for (const ext of ['.m4a', '.opus', '.webm']) {
      const cachedFile = path.join(CACHE_DIR, `${cleanVideoId}${ext}`);
      if (fs.existsSync(cachedFile)) {
        const stats = fs.statSync(cachedFile);
        // Use cache if less than 1 hour old and has reasonable size (at least 100KB)
        if (Date.now() - stats.mtimeMs < 3600000 && stats.size > 100000) {
          const elapsed = Date.now() - startTime;
          logger.info(`[getStreamUrl] Using cached file (${elapsed}ms): ${cleanVideoId}`);
          return `nora://localfiles/${cachedFile.replace(/\\/g, '/')}`;
        }
      }
    }
    
    // Use Piped API to get stream URLs
    const streamInfo = await fetchStreamInfo(cleanVideoId);
    
    if (!streamInfo.playable || !streamInfo.audioFormats) {
      logger.error(`[getStreamUrl] Not playable: ${streamInfo.statusMSG}`);
      return null;
    }
    
    const bestAudio = getHighestQualityAudio(streamInfo.audioFormats);
    
    if (!bestAudio || !bestAudio.url) {
      logger.error('[getStreamUrl] No valid audio URL found');
      return null;
    }
    
    const fetchInfoTime = Date.now() - startTime;
    logger.info(`[getStreamUrl] Stream info in ${fetchInfoTime}ms - itag=${bestAudio.itag}, bitrate=${bestAudio.bitrate}`);
    
    // Determine file extension based on codec
    const extension = bestAudio.audioCodec === Codec.mp4a ? '.m4a' : '.webm';
    const cachedFile = path.join(CACHE_DIR, `${cleanVideoId}${extension}`);
    
    // Fast download with timeout
    const downloadStartTime = Date.now();
    
    const controller = new AbortController();
    const downloadTimeout = setTimeout(() => controller.abort(), 30000); // 30s max download
    
    try {
      // Normal HTTP fetch - yt-dlp provides direct playable URLs
      const response = await fetch(bestAudio.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
          'Range': 'bytes=0-'
        },
        signal: controller.signal
      });
      
      clearTimeout(downloadTimeout);
      
      if (!response.ok) {
        logger.error(`[getStreamUrl] Download failed: ${response.status}`);
        return null;
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      if (buffer.length === 0) {
        logger.error('[getStreamUrl] Downloaded empty buffer');
        return null;
      }
      
      fs.writeFileSync(cachedFile, buffer);
      
      const totalTime = Date.now() - startTime;
      const downloadTime = Date.now() - downloadStartTime;
      logger.info(`[getStreamUrl] Complete in ${totalTime}ms (fetch: ${fetchInfoTime}ms, download: ${downloadTime}ms, size: ${buffer.length} bytes)`);
      
      return `nora://localfiles/${cachedFile.replace(/\\/g, '/')}`;
      
    } catch (downloadError: any) {
      clearTimeout(downloadTimeout);
      if (downloadError.name === 'AbortError') {
        logger.error('[getStreamUrl] Download timed out after 15s');
      } else {
        logger.error('[getStreamUrl] Download error:', downloadError.message);
      }
      return null;
    }
    
  } catch (error) {
    logger.error('[getStreamUrl] Error:', error as any);
    return null;
  }
}

// ============================================================================
// Download Function
// ============================================================================

export async function downloadSong(
  videoId: string, 
  title: string, 
  artist: string, 
  album: string, 
  _artworkUrl?: string
): Promise<{ success: boolean; path?: string; error?: string }> {
  logger.info('[downloadSong] Starting download:', { videoId, title, artist });
  
  try {
    // Get configured downloads folder or use default
    const settings = await getUserSettings();
    let downloadsFolder: string = (settings.musicDownloadsFolder as string) || '';
    
    if (!downloadsFolder) {
      // Default to app's Downloads folder
      downloadsFolder = path.join(app.getPath('userData'), 'Downloads');
    }
    
    // Ensure downloads folder exists
    if (!fs.existsSync(downloadsFolder)) {
      fs.mkdirSync(downloadsFolder, { recursive: true });
    }
    
    const safeArtist = artist.replace(/[^a-z0-9\s]/gi, '_').trim() || 'Unknown Artist';
    const safeAlbum = album.replace(/[^a-z0-9\s]/gi, '_').trim() || 'Unknown Album';
    const safeTitle = title.replace(/[^a-z0-9\s]/gi, '_').trim() || 'Unknown Title';
    
    const songFolder = path.join(downloadsFolder, safeArtist, safeAlbum);
    
    if (!fs.existsSync(songFolder)) {
      fs.mkdirSync(songFolder, { recursive: true });
    }

    // Clean videoId
    let actualVideoId = videoId;
    if (actualVideoId.startsWith('MPED')) {
      actualVideoId = actualVideoId.substring(4);
    }
    const videoIdMatch = videoId.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/);
    if (videoIdMatch) {
      actualVideoId = videoIdMatch[1];
    }

    logger.info(`[downloadSong] Fetching stream info for: ${actualVideoId}`);
    
    // Fetch stream info using our StreamProvider
    const streamInfo = await fetchStreamInfo(actualVideoId);
    
    if (!streamInfo.playable || !streamInfo.audioFormats) {
      throw new Error(streamInfo.statusMSG || 'Failed to get stream info');
    }
    
    // Get highest quality audio
    const bestAudio = getHighestQualityAudio(streamInfo.audioFormats);
    
    if (!bestAudio || !bestAudio.url) {
      throw new Error('No valid audio stream found');
    }
    
    logger.info(`[downloadSong] Downloading: itag=${bestAudio.itag}, bitrate=${bestAudio.bitrate}`);
    
    // Determine extension based on codec
    const extension = bestAudio.audioCodec === Codec.mp4a ? '.m4a' : '.opus';
    const fileName = `${safeTitle}${extension}`;
    const filePath = path.join(songFolder, fileName);

    // Download
    const response = await fetch(bestAudio.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Accept-Encoding': 'identity',
        'Range': `bytes=0-${bestAudio.size || ''}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    if (buffer.length === 0) {
      throw new Error('Downloaded empty buffer');
    }
    
    fs.writeFileSync(filePath, buffer);
    
    logger.info(`[downloadSong] Success! Saved to: ${filePath}, size: ${buffer.length} bytes`);
    
    // Check if this song already exists in the database (avoid duplicates)
    const songExists = await isSongWithPathAvailable(filePath);
    if (songExists) {
      logger.info(`[downloadSong] Song already exists in library, skipping database insert: ${filePath}`);
      return { success: true, path: filePath };
    }
    
    // Add the downloaded song to the library with proper metadata
    try {
      // First, ensure the downloads folder is registered as a music folder
      let folder = await getFolderFromPath(downloadsFolder);
      
      if (!folder) {
        // Register the downloads folder as a music folder
        const folderStats = fs.statSync(downloadsFolder);
        const folderStructure: FolderStructure = {
          path: downloadsFolder,
          stats: {
            lastModifiedDate: folderStats.mtime,
            lastChangedDate: folderStats.ctime,
            fileCreatedDate: folderStats.birthtime,
            lastParsedDate: new Date()
          },
          subFolders: []
        };
        
        const { addedFolders } = await saveFolderStructures([folderStructure], true);
        folder = addedFolders[0];
        logger.info(`[downloadSong] Registered downloads folder as music folder: ${downloadsFolder}`);
        dataUpdateEvent('userData/musicFolder');
      }
      
      // Download artwork if available
      let artworkBuffer: Buffer | undefined;
      if (_artworkUrl) {
        try {
          const artworkResponse = await fetch(_artworkUrl);
          if (artworkResponse.ok) {
            const artworkArrayBuffer = await artworkResponse.arrayBuffer();
            artworkBuffer = Buffer.from(artworkArrayBuffer);
            logger.info(`[downloadSong] Downloaded artwork: ${artworkBuffer.length} bytes`);
          }
        } catch (artworkError) {
          logger.warn('[downloadSong] Failed to download artwork:', artworkError as any);
        }
      }
      
      // Get file stats for duration estimate
      const fileStats = fs.statSync(filePath);
      
      // Add song directly to database with proper metadata
      const res = await db.transaction(async (trx) => {
        // Get duration from audio format (it's in seconds)
        const durationInSeconds = bestAudio.duration || 0;
        
        // Save song with metadata
        const songInfo = {
          title: title || 'Unknown Title',
          duration: durationInSeconds.toFixed(2),
          path: filePath,
          year: new Date().getFullYear(),
          folderId: folder?.id,
          fileCreatedAt: fileStats.birthtime,
          fileModifiedAt: fileStats.mtime,
          bitRate: bestAudio.bitrate
        };
        
        const songData = await saveSong(songInfo, trx);
        
        // Store artwork
        const artworkData = await storeArtworks('songs', artworkBuffer, trx);
        
        // Link artwork to song
        await linkArtworksToSong(
          artworkData.map((artwork) => ({ songId: songData.id, artworkId: artwork.id })),
          trx
        );
        
        // Add artist
        const artistNames = artist ? [artist] : [];
        const { newArtists, relevantArtists } = await manageArtistsOfParsedSong(
          {
            artworkId: artworkData[0]?.id,
            songId: songData.id,
            songArtists: artistNames
          },
          trx
        );
        
        // Add album
        const { relevantAlbum, newAlbum } = await manageAlbumsOfParsedSong(
          {
            songId: songData.id,
            artworkId: artworkData[0]?.id,
            songYear: songData.year,
            artists: artistNames,
            albumArtists: artistNames,
            albumName: album || undefined
          },
          trx
        );
        
        return { songData, newArtists, relevantArtists, newAlbum, relevantAlbum };
      });
      
      logger.info(`[downloadSong] Song added to library: ${res.songData.title} (ID: ${res.songData.id})`);
      
      // Fire data update events
      dataUpdateEvent('songs/newSong', [res.songData.id.toString()]);
      if (res.newArtists.length > 0) {
        dataUpdateEvent('artists/newArtist', res.newArtists.map((a) => a.id.toString()));
      }
      if (res.relevantArtists.length > 0) {
        dataUpdateEvent('artists', res.relevantArtists.map((a) => a.id.toString()));
      }
      if (res.newAlbum) {
        dataUpdateEvent('albums/newAlbum', [res.newAlbum.id.toString()]);
      }
      if (res.relevantAlbum) {
        dataUpdateEvent('albums', [res.relevantAlbum.id.toString()]);
      }
      
    } catch (libraryError) {
      logger.error('[downloadSong] Failed to add song to library (but file was saved):', libraryError as any);
      // Don't fail the download, the file was saved successfully
    }
    
    return { success: true, path: filePath };
    
  } catch (error) {
    logger.error('[downloadSong] Error:', error as any);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

// ============================================================================
// Prefetch Functions - Pre-download songs for instant playback
// ============================================================================

/**
 * Check if a video is already cached
 */
function isVideoCached(videoId: string): boolean {
  let cleanVideoId = videoId;
  if (cleanVideoId.startsWith('MPED')) {
    cleanVideoId = cleanVideoId.substring(4);
  }
  
  for (const ext of ['.m4a', '.opus', '.webm']) {
    const cachedFile = path.join(CACHE_DIR, `${cleanVideoId}${ext}`);
    if (fs.existsSync(cachedFile)) {
      const stats = fs.statSync(cachedFile);
      if (Date.now() - stats.mtimeMs < 3600000 && stats.size > 100000) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Prefetch a single video in the background (non-blocking)
 * This downloads the audio to cache so playback is instant when user clicks play
 */
async function prefetchSingle(videoId: string): Promise<void> {
  let cleanVideoId = videoId;
  if (cleanVideoId.startsWith('MPED')) {
    cleanVideoId = cleanVideoId.substring(4);
  }
  
  // Skip if already cached or in progress
  if (isVideoCached(cleanVideoId) || prefetchInProgress.has(cleanVideoId)) {
    return;
  }
  
  prefetchInProgress.add(cleanVideoId);
  activePrefetches++;
  
  try {
    logger.info(`[Prefetch] Starting background download for: ${cleanVideoId}`);
    
    const streamInfo = await fetchStreamInfo(cleanVideoId);
    
    if (!streamInfo.playable || !streamInfo.audioFormats) {
      logger.debug(`[Prefetch] ${cleanVideoId} not playable, skipping`);
      return;
    }
    
    const bestAudio = getHighestQualityAudio(streamInfo.audioFormats);
    if (!bestAudio || !bestAudio.url) {
      return;
    }
    
    const extension = bestAudio.audioCodec === Codec.mp4a ? '.m4a' : '.webm';
    const cachedFile = path.join(CACHE_DIR, `${cleanVideoId}${extension}`);
    
    // Download with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s max for prefetch
    
    try {
      const response = await fetch(bestAudio.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*',
          'Accept-Encoding': 'identity',
          'Range': 'bytes=0-'
        },
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      if (response.ok) {
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        if (buffer.length > 0) {
          fs.writeFileSync(cachedFile, buffer);
          logger.info(`[Prefetch] Cached ${cleanVideoId} (${Math.round(buffer.length / 1024)}KB)`);
        }
      }
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name !== 'AbortError') {
        logger.debug(`[Prefetch] Download failed for ${cleanVideoId}: ${err.message}`);
      }
    }
    
  } finally {
    prefetchInProgress.delete(cleanVideoId);
    activePrefetches--;
    processNextPrefetch();
  }
}

/**
 * Process next item in prefetch queue
 */
function processNextPrefetch(): void {
  if (prefetchQueue.length === 0 || activePrefetches >= MAX_CONCURRENT_PREFETCH) {
    return;
  }
  
  const nextVideoId = prefetchQueue.shift();
  if (nextVideoId) {
    prefetchSingle(nextVideoId);
  }
}

/**
 * Queue videos for prefetching
 * Call this with search results to pre-download the first few songs
 */
export function prefetchVideos(videoIds: string[]): void {
  // Add to queue (avoid duplicates)
  for (const videoId of videoIds) {
    let cleanId = videoId;
    if (cleanId.startsWith('MPED')) {
      cleanId = cleanId.substring(4);
    }
    
    if (!isVideoCached(cleanId) && 
        !prefetchInProgress.has(cleanId) && 
        !prefetchQueue.includes(cleanId)) {
      prefetchQueue.push(cleanId);
    }
  }
  
  // Start processing if not already
  while (activePrefetches < MAX_CONCURRENT_PREFETCH && prefetchQueue.length > 0) {
    processNextPrefetch();
  }
  
  logger.info(`[Prefetch] Queued ${videoIds.length} videos, ${prefetchQueue.length} in queue, ${activePrefetches} active`);
}

/**
 * Clear prefetch queue (call when user navigates away from search)
 */
export function clearPrefetchQueue(): void {
  prefetchQueue.length = 0;
  logger.debug('[Prefetch] Queue cleared');
}

/**
 * Get prefetch status
 */
export function getPrefetchStatus(): { queued: number; active: number; cached: string[] } {
  return {
    queued: prefetchQueue.length,
    active: activePrefetches,
    cached: Array.from(prefetchInProgress)
  };
}
