import { storeArtworks, removeArtworks } from '../other/artworks';
import { dataUpdateEvent } from '../main';
import { resetArtworkCache } from '../fs/resolveFilePaths';
import logger from '../logger';
import { generateLocalArtworkBuffer } from '@main/updateSongId3Tags';
import { linkArtworkToPlaylist, getPlaylistArtworkIds, unlinkArtworksFromPlaylist } from '@main/db/queries/artworks';
import { db } from '@main/db/db';

// const removePreviousArtwork = async (playlistId: string) => {
//   const artworkPaths = getPlaylistArtworkPath(playlistId, true);
//   removeArtwork(artworkPaths, 'playlist');
//   return logger.debug('Successfully removed previous playlist artwork.');
// };

const addArtworkToAPlaylist = async (playlistId: string, artworkPath: string) => {
  try {
    if (!artworkPath) {
      logger.warn('No artwork path provided for playlist', { playlistId });
      return undefined;
    }
    
    const buffer = await generateLocalArtworkBuffer(artworkPath);
    if (!buffer) {
      logger.warn('Failed to generate artwork buffer', { playlistId, artworkPath });
      return undefined;
    }

    await db.transaction(async (trx) => {
      // Get and remove previous artworks
      const previousArtworkIds = await getPlaylistArtworkIds(Number(playlistId), trx);
      if (previousArtworkIds.length > 0) {
        await unlinkArtworksFromPlaylist(Number(playlistId), trx);
        // Remove old artwork files and records
        await removeArtworks(previousArtworkIds, trx);
      }
      
      // Create and link new artwork
      const artworks = await storeArtworks('playlist', buffer, trx);

      if (artworks && artworks.length > 0) {
        await linkArtworkToPlaylist(Number(playlistId), artworks[0].id, trx);
        logger.debug('Successfully linked artwork to playlist', { playlistId, artworkId: artworks[0].id });
      }
    });
    resetArtworkCache('playlistArtworks');
    dataUpdateEvent('playlists');

    return undefined;
  } catch (error) {
    logger.error('Failed to add an artwork to a playlist.', { error });
  }
};

export default addArtworkToAPlaylist;
