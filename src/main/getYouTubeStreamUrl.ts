import logger from './logger';
import { fetchStreamInfo, Codec, type AudioFormat } from './core/onlineSearch';
import {
  getCachedStreamInfo as getDbCachedStreamInfo,
  saveStreamInfoToCache as saveDbStreamInfoToCache
} from './db/queries/onlineSongs';

const cleanVideoId = (videoId: string): string => {
  if (!videoId) return '';
  return videoId.startsWith('MPED') ? videoId.substring(4) : videoId;
};

const selectBestFormat = (formats: AudioFormat[]): AudioFormat | null => {
  if (!formats?.length) return null;

  const sorted = [...formats].sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  return (
    sorted.find((format) => format.audioCodec === Codec.mp4a && !!format.url) ||
    sorted.find((format) => format.audioCodec === Codec.opus && !!format.url) ||
    sorted.find((format) => !!format.url) ||
    null
  );
};

export const getDirectStreamUrl = async (videoId: string): Promise<string | null> => {
  const cleanId = cleanVideoId(videoId);

  if (!cleanId) {
    logger.warn('[StreamProtocol] Invalid video ID received for direct stream lookup');
    return null;
  }

  try {
    let audioFormats = await getDbCachedStreamInfo(cleanId);

    if (!audioFormats || audioFormats.length === 0) {
      logger.info(`[StreamProtocol] Cache miss for ${cleanId}, fetching stream info`);
      const streamInfo = await fetchStreamInfo(cleanId);

      if (!streamInfo.playable || !streamInfo.audioFormats?.length) {
        logger.warn('[StreamProtocol] No playable formats returned', {
          videoId: cleanId,
          status: streamInfo.statusMSG
        });
        return null;
      }

      audioFormats = streamInfo.audioFormats;
      await saveDbStreamInfoToCache(cleanId, audioFormats);
    } else {
      logger.debug('[StreamProtocol] Using cached formats', {
        videoId: cleanId,
        formatCount: audioFormats.length
      });
    }

    const preferredFormat = selectBestFormat(audioFormats);

    if (!preferredFormat?.url) {
      logger.error('[StreamProtocol] Cached formats missing usable URL', { videoId: cleanId });
      return null;
    }

    return preferredFormat.url;
  } catch (error) {
    logger.error('[StreamProtocol] Failed to resolve direct stream URL', {
      videoId: cleanId,
      error
    });
    return null;
  }
};

export const getYouTubeStreamUrl = getDirectStreamUrl;

export const preloadStreamUrl = async (videoId: string): Promise<void> => {
  await getDirectStreamUrl(videoId);
};
