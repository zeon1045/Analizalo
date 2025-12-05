/**
 * Stream Protocol Handler - HARMONY MUSIC STYLE
 *
 * Handles nora-stream:// protocol for YouTube audio streaming
 * 
 * STRATEGY: 
 * 1. Get the real streaming URL from YouTube via Innertube
 * 2. Use net.fetch() as a PROXY - NO downloading, NO buffering in memory
 * 3. Electron streams the audio directly from Google's CDN to the <audio> element
 * 
 * This eliminates the Buffer type error and is much more efficient.
 */

import { net } from 'electron';
import { getYouTubeStreamUrl } from './getYouTubeStreamUrl';
import logger from './logger';

// ============================================================================
// MAIN PROTOCOL HANDLER - PROXY STYLE (like Harmony Music)
// ============================================================================
export async function handleStreamProtocol(request: Request): Promise<Response> {
  const startTime = Date.now();

  try {
    // La URL viene como nora-stream://stream/VIDEO_ID?ts=...
    const urlObj = new URL(request.url);
    
    // Extraemos el ID. Formato: nora-stream://stream/ID_VIDEO o nora-stream://ID_VIDEO
    const pathParts = urlObj.pathname.split('/').filter(Boolean);
    // pathParts puede ser ['stream', 'VIDEO_ID'] o ['VIDEO_ID']
    const videoId = pathParts[pathParts.length - 1];

    console.log(`📡 [Protocol] Request for ID: ${videoId}`);
    logger.info(`[StreamProtocol] 🎵 Request for: ${videoId}`);

    if (!videoId || videoId.length < 10) {
      logger.error('[StreamProtocol] Invalid video ID');
      return new Response('Invalid video ID', { status: 400 });
    }

    // ========================================================================
    // STEP 1: Get the real Google CDN URL via our Innertube service
    // ========================================================================
    const directUrl = await getYouTubeStreamUrl(videoId);

    if (!directUrl) {
      const elapsed = Date.now() - startTime;
      console.log(`❌ [Protocol] Failed to get URL for ${videoId} after ${elapsed}ms`);
      logger.error(`[StreamProtocol] ❌ Failed to get URL for ${videoId} after ${elapsed}ms`);
      return new Response('Audio not found', { status: 404 });
    }

    // ========================================================================
    // STEP 2: PROXY - Redirect traffic to Google's CDN
    // This is the KEY difference: we don't download the file, we just redirect
    // Electron's net.fetch handles all the streaming automatically
    // ========================================================================
    console.log(`✅ [Protocol] Redirecting to GoogleVideo for ${videoId}`);
    logger.info(`[StreamProtocol] ✅ Proxying to GoogleVideo`);
    
    const elapsed = Date.now() - startTime;
    console.log(`⚡ [Protocol] URL obtained in ${elapsed}ms, starting stream...`);
    
    // bypassCustomProtocolHandlers: true ensures this fetch goes to the internet
    // and doesn't get caught in an infinite loop by our protocol handler
    return net.fetch(directUrl, {
      bypassCustomProtocolHandlers: true,
    });

  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ [Protocol] Error after ${elapsed}ms:`, error.message);
    logger.error(`[StreamProtocol] ❌ Error after ${elapsed}ms: ${error.message}`);
    return new Response('Internal error', { status: 500 });
  }
}
