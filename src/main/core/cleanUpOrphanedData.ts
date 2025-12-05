import { db } from '../db/db';
import { albums, artists, genres, albumsSongs, artistsSongs, genresSongs } from '../db/schema';
import { eq, notExists } from 'drizzle-orm';
import logger from '../logger';

const cleanUpOrphanedData = async () => {
  logger.info('Starting cleanup of orphaned data (empty albums, artists, genres)...');
  try {
    await db.transaction(async (trx) => {
      // Delete albums with no songs
      const deletedAlbums = await trx
        .delete(albums)
        .where(
          notExists(
            trx
              .select()
              .from(albumsSongs)
              .where(eq(albumsSongs.albumId, albums.id))
          )
        )
        .returning({ id: albums.id, title: albums.title });

      if (deletedAlbums.length > 0) {
        logger.info(`Deleted ${deletedAlbums.length} orphaned albums.`, {
          albums: deletedAlbums.map((a) => a.title)
        });
      }

      // Delete artists with no songs
      const deletedArtists = await trx
        .delete(artists)
        .where(
          notExists(
            trx
              .select()
              .from(artistsSongs)
              .where(eq(artistsSongs.artistId, artists.id))
          )
        )
        .returning({ id: artists.id, name: artists.name });

      if (deletedArtists.length > 0) {
        logger.info(`Deleted ${deletedArtists.length} orphaned artists.`, {
          artists: deletedArtists.map((a) => a.name)
        });
      }

      // Delete genres with no songs
      const deletedGenres = await trx
        .delete(genres)
        .where(
          notExists(
            trx
              .select()
              .from(genresSongs)
              .where(eq(genresSongs.genreId, genres.id))
          )
        )
        .returning({ id: genres.id, name: genres.name });

      if (deletedGenres.length > 0) {
        logger.info(`Deleted ${deletedGenres.length} orphaned genres.`, {
          genres: deletedGenres.map((a) => a.name)
        });
      }
    });
    logger.info('Orphaned data cleanup completed.');
  } catch (error) {
    logger.error('Failed to clean up orphaned data.', { error });
  }
};

export default cleanUpOrphanedData;
