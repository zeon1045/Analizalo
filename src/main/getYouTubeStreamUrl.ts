/**
 * YouTube Stream URL Service - HARMONY MUSIC STYLE
 * 
 * Obtiene URLs directas de streaming de YouTube usando youtubei.js (Innertube).
 * La URL se pasa directamente al elemento <audio> - SIN descarga, SIN buffering.
 */

import { Innertube } from 'youtubei.js';
import logger from './logger';

// ============================================================================
// SINGLETON INNERTUBE INSTANCE
// ============================================================================
let youtube: Innertube | null = null;

async function initYoutube(): Promise<Innertube> {
  if (youtube) return youtube;
  
  logger.info('[Innertube] 🚀 Initializing...');
  const startTime = Date.now();
  
  youtube = await Innertube.create({
    generate_session_locally: true,
    lang: 'en',
    location: 'US',
    retrieve_player: true,
  });
  
  const elapsed = Date.now() - startTime;
  logger.info(`[Innertube] ✅ Ready in ${elapsed}ms`);
  
  return youtube;
}

// Pre-warm at module load
initYoutube().catch(err => logger.warn('[Innertube] Pre-warm failed:', err));

// ============================================================================
// URL CACHE (URLs valid for ~6 hours, we cache for 30 min to be safe)
// ============================================================================
interface CachedUrl {
  url: string;
  cachedAt: number;
}

const urlCache = new Map<string, CachedUrl>();
const URL_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Cleanup old URLs periodically
setInterval(() => {
  const now = Date.now();
  for (const [videoId, data] of urlCache.entries()) {
    if (now - data.cachedAt > URL_CACHE_TTL) {
      urlCache.delete(videoId);
      logger.debug(`[StreamURL] Cache cleanup: ${videoId}`);
    }
  }
}, 5 * 60 * 1000);

// ============================================================================
// HELPER: Try to get audio URL with a specific client type
// ============================================================================
type ClientType = 'ANDROID' | 'WEB' | 'IOS';

async function tryGetAudioWithClient(
  yt: Innertube, 
  videoId: string, 
  clientType: ClientType
): Promise<string | null> {
  try {
    console.log(`[StreamURL] Trying ${clientType} client for ${videoId}...`);
    
    // @ts-ignore - Valid client types in youtubei.js
    const info = await yt.getBasicInfo(videoId, clientType);
    
    // Check playability
    const playability = (info as any).playability_status;
    if (playability?.status === 'ERROR' || playability?.status === 'LOGIN_REQUIRED') {
      console.log(`[StreamURL] ${clientType}: Playability blocked - ${playability.reason || playability.status}`);
      return null;
    }
    
    // Log streaming data info
    console.log(`[StreamURL] ${clientType}: streaming_data=${!!info.streaming_data}, formats=${info.streaming_data?.adaptive_formats?.length || 0}`);
    
    // Try chooseFormat
    const format = info.chooseFormat({ type: 'audio', quality: 'best' });
    
    if (!format) {
      console.log(`[StreamURL] ${clientType}: No audio format available`);
      return null;
    }
    
    console.log(`[StreamURL] ${clientType}: Found format itag=${format.itag}, mime=${format.mime_type}`);
    
    // SOLUCIÓN AL ERROR DE TYPESCRIPT 'NEVER':
    // Usamos variable intermedia con tipo explícito y cast a any
    let finalUrl: string | undefined = undefined;
    const formatAny = format as any;
    
    // Strategy 1: Try decipher first (most music videos need this)
    if (formatAny.signatureCipher || formatAny.signature_cipher || formatAny.cipher) {
      try {
        // Cast el resultado a unknown primero, luego verificamos
        const deciphered: unknown = format.decipher(yt.session.player);
        if (deciphered && typeof deciphered === 'string' && (deciphered as string).startsWith('http')) {
          finalUrl = deciphered as string;
          console.log(`[StreamURL] ${clientType}: ✅ Deciphered URL obtained`);
        }
      } catch (e: any) {
        console.log(`[StreamURL] ${clientType}: Decipher failed - ${e.message}`);
      }
    }
    
    // Strategy 2: Direct URL if decipher failed or wasn't needed
    if (!finalUrl && formatAny.url && typeof formatAny.url === 'string') {
      finalUrl = formatAny.url;
      console.log(`[StreamURL] ${clientType}: ✅ Direct URL obtained`);
    }
    
    if (finalUrl && finalUrl.startsWith('http')) {
      return finalUrl;
    }
    
    // Strategy 3: Try other audio formats
    const streamingData = info.streaming_data as any;
    const formats = streamingData?.adaptive_formats || [];
    const audioFormats = formats.filter((f: any) => 
      f.mime_type && f.mime_type.startsWith('audio/')
    );
    
    console.log(`[StreamURL] ${clientType}: Checking ${audioFormats.length} alternative audio formats...`);
    
    for (const altFormat of audioFormats) {
      // Direct URL
      if (altFormat.url && typeof altFormat.url === 'string' && altFormat.url.startsWith('http')) {
        console.log(`[StreamURL] ${clientType}: ✅ Found direct URL in format itag=${altFormat.itag}`);
        return altFormat.url;
      }
      
      // Try decipher
      if (altFormat.signatureCipher || altFormat.signature_cipher || altFormat.cipher) {
        try {
          const url: unknown = altFormat.decipher(yt.session.player);
          if (url && typeof url === 'string' && (url as string).startsWith('http')) {
            console.log(`[StreamURL] ${clientType}: ✅ Deciphered alternative format itag=${altFormat.itag}`);
            return url as string;
          }
        } catch {
          continue;
        }
      }
    }
    
    console.log(`[StreamURL] ${clientType}: All strategies failed`);
    return null;
    
  } catch (error: any) {
    console.log(`[StreamURL] ${clientType}: Exception - ${error.message}`);
    return null;
  }
}

// ============================================================================
// MAIN FUNCTION: Get Direct Stream URL with cascading fallback
// ============================================================================
export async function getYouTubeStreamUrl(videoId: string): Promise<string | null> {
  const startTime = Date.now();
  
  console.log(`\n========================================`);
  console.log(`[StreamURL] 🎵 getYouTubeStreamUrl: ${videoId}`);
  console.log(`========================================\n`);
  
  try {
    // Check cache first (INSTANT)
    const cached = urlCache.get(videoId);
    if (cached && Date.now() - cached.cachedAt < URL_CACHE_TTL) {
      const elapsed = Date.now() - startTime;
      console.log(`[StreamURL] ⚡ CACHE HIT: ${videoId} in ${elapsed}ms`);
      return cached.url;
    }
    
    const yt = await initYoutube();
    
    // ========================================================================
    // CASCADING FALLBACK: Try multiple clients until one works
    // Order: ANDROID (fastest) → WEB (most compatible) → IOS (backup)
    // ========================================================================
    
    let url: string | null = null;
    
    // Attempt 1: ANDROID client (fastest, best for music)
    url = await tryGetAudioWithClient(yt, videoId, 'ANDROID');
    
    // Attempt 2: WEB client (most compatible with copyrighted content)
    if (!url) {
      console.log(`[StreamURL] ⚠️ ANDROID failed, trying WEB...`);
      url = await tryGetAudioWithClient(yt, videoId, 'WEB');
    }
    
    // Attempt 3: IOS client (last resort)
    if (!url) {
      console.log(`[StreamURL] ⚠️ WEB failed, trying IOS...`);
      url = await tryGetAudioWithClient(yt, videoId, 'IOS');
    }
    
    // All clients failed
    if (!url) {
      const elapsed = Date.now() - startTime;
      console.log(`[StreamURL] ❌ ALL CLIENTS FAILED for ${videoId} after ${elapsed}ms`);
      logger.error(`[StreamURL] ❌ ALL CLIENTS FAILED for ${videoId} after ${elapsed}ms`);
      return null;
    }
    
    // Cache the successful URL
    urlCache.set(videoId, { url, cachedAt: Date.now() });
    
    const elapsed = Date.now() - startTime;
    console.log(`[StreamURL] ✅ SUCCESS: ${videoId} in ${elapsed}ms`);
    logger.info(`[StreamURL] ✅ ${videoId}: Success in ${elapsed}ms`);
    
    return url;
    
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.log(`[StreamURL] ❌ EXCEPTION: ${error.message}`);
    logger.error(`[StreamURL] ❌ ${videoId} failed after ${elapsed}ms: ${error.message}`);
    return null;
  }
}

// ============================================================================
// PRELOAD FUNCTION: Get URL for hover preload (fire and forget)
// ============================================================================
export async function preloadStreamUrl(videoId: string): Promise<void> {
  getYouTubeStreamUrl(videoId).catch(() => {});
}

// ============================================================================
// EXPORT for IPC - Alias para compatibilidad
// ============================================================================
export const getDirectStreamUrl = getYouTubeStreamUrl;
