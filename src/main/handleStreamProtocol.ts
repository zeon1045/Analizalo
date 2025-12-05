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
import { pathToFileURL } from 'node:url';
import { getDirectStreamUrl } from './getYouTubeStreamUrl';
import logger from './logger';

export async function handleStreamProtocol(request: Request): Promise<Response> {
  const startTime = Date.now();

  try {
    const rawUrl = request.url;
    const cleanPath = rawUrl
      .replace('nora-stream://stream/', '')
      .replace('nora-stream://', '')
      .split('?')[0];
    const decodedPath = decodeURIComponent(cleanPath);

    if (!decodedPath) {
      logger.error('[StreamProtocol] Missing stream identifier');
      return new Response('Invalid stream identifier', { status: 400 });
    }

    const isYouTubeId = /^[a-zA-Z0-9_-]{11}$/.test(decodedPath);

    if (isYouTubeId) {
      console.log(`📡 [STREAM] Detectado ID Online: ${decodedPath}`);
      try {
        const directUrl = await getDirectStreamUrl(decodedPath);

        if (directUrl) {
          console.log(`✅ [STREAM] Redirigiendo a: ${directUrl.substring(0, 40)}...`);
          const elapsed = Date.now() - startTime;
          logger.info(`[StreamProtocol] ✅ Online stream ready in ${elapsed}ms`);
          return net.fetch(directUrl, {
            bypassCustomProtocolHandlers: true,
          });
        }
      } catch (error) {
        logger.error('[StreamProtocol] ❌ URL lookup failed', error as Error);
        return new Response('Error obteniendo stream', { status: 500 });
      }

      logger.error('[StreamProtocol] ❌ No URL returned for YouTube ID');
      return new Response('Audio no disponible', { status: 404 });
    }

    try {
      const normalizedLocalPath = decodedPath.replace(/^\/([a-zA-Z]:)/, '$1');
      const fileUrl = pathToFileURL(normalizedLocalPath).toString();
      console.log(`📁 [STREAM] Sirviendo archivo local: ${decodedPath}`);
      return net.fetch(fileUrl);
    } catch (error) {
      logger.error('[StreamProtocol] ❌ Local file streaming failed', error as Error);
      return new Response('Archivo no encontrado', { status: 404 });
    }
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ [Protocol] Error after ${elapsed}ms:`, error.message);
    logger.error(`[StreamProtocol] ❌ Error after ${elapsed}ms: ${error.message}`);
    return new Response('Internal error', { status: 500 });
  }
}
