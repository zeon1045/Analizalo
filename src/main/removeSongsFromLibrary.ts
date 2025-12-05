import path from 'path';
import { dataUpdateEvent, sendMessageToRenderer } from './main';
import logger from './logger';
import { unlinkSongFromArtist } from './db/queries/artists';
import { unlinkSongFromAlbum } from './db/queries/albums';
import { unlinkSongFromGenre } from './db/queries/genres';
import { deleteArtworks, getArtworkIdsOfSong } from './db/queries/artworks';
import { db } from './db/db';
import { getSongByPath, removeSongById } from './db/queries/songs';
import { convertToSongData } from './utils/convert';
import { albums, albumsSongs, artists, artistsSongs, genres, genresSongs } from './db/schema';
import { eq } from 'drizzle-orm';

export const removeDeletedArtistDataOfSong = async (song: SavableSongData, trx: DBTransaction) => {
  let isArtistRemoved = false;

  if (Array.isArray(song.artists) && song.artists.length > 0) {
    for (let i = 0; i < song.artists.length; i += 1) {
      const songArtist = song.artists[i];

      await unlinkSongFromArtist(Number(songArtist.artistId), Number(song.songId), trx);

      const artistSongsCount = await trx.$count(
        artistsSongs,
        eq(artistsSongs.artistId, Number(songArtist.artistId))
      );

      if (artistSongsCount === 0) {
        await trx.delete(artists).where(eq(artists.id, Number(songArtist.artistId)));
        isArtistRemoved = true;
      }
    }
  }
  return { isArtistRemoved };
};

export const removeDeletedAlbumDataOfSong = async (song: SavableSongData, trx: DBTransaction) => {
  let isAlbumRemoved = false;

  const albumId = song.album?.albumId;
  if (albumId == null) return { isAlbumRemoved };

  await unlinkSongFromAlbum(Number(albumId), Number(song.songId), trx);

  const albumSongsCount = await trx.$count(
    albumsSongs,
    eq(albumsSongs.albumId, Number(albumId))
  );

  if (albumSongsCount === 0) {
    await trx.delete(albums).where(eq(albums.id, Number(albumId)));
    isAlbumRemoved = true;
  }

  return { isAlbumRemoved };
};

// export const removeDeletedPlaylistDataOfSong = (song: SavableSongData) => {
//   let isPlaylistRemoved = false;
//   if (
//     Array.isArray(playlists) &&
//     playlists.length > 0 &&
//     playlists.some((playlist) => playlist.songs.some((str) => str === song.songId))
//   ) {
//     for (let x = 0; x < playlists.length; x += 1) {
//       if (playlists[x].songs.length > 0 && playlists[x].songs.some((y) => y === song.songId)) {
//         playlists[x].songs.splice(playlists[x].songs.indexOf(song.songId), 1);
//         logger.debug(
//           `Data related to '${song.title}' in playlist '${playlists[x].name}' removed.`,
//           {
//             songId: song.songId,
//             playlistId: playlists[x].playlistId
//           }
//         );
//       } else {
//         logger.debug(`Playlist '${playlists[x].name}' removed because it doesn't have any songs.`, {
//           playlistId: playlists[x].playlistId
//         });
//         isPlaylistRemoved = true;
//       }
//     }
//   }
//   return { isPlaylistRemoved };
// };

export const removeDeletedGenreDataOfSong = async (song: SavableSongData, trx: DBTransaction) => {
  let isGenreRemoved = false;
  if (Array.isArray(song.genres) && song.genres.length > 0) {
    for (let i = 0; i < song.genres.length; i += 1) {
      const songGenre = song.genres[i];

      await unlinkSongFromGenre(Number(songGenre.genreId), Number(song.songId), trx);

      const genreSongsCount = await trx.$count(
        genresSongs,
        eq(genresSongs.genreId, Number(songGenre.genreId))
      );

      if (genreSongsCount === 0) {
        await trx.delete(genres).where(eq(genres.id, Number(songGenre.genreId)));
        isGenreRemoved = true;
      }
    }
  }
  return { isGenreRemoved };
};

export const removeDeletedArtworkDataOfSong = async (song: SavableSongData, trx: DBTransaction) => {
  const artworkIds = await getArtworkIdsOfSong(Number(song.songId), trx);

  if (artworkIds.length === 0) return;

  await deleteArtworks(
    artworkIds.map((a) => a.artworkId),
    trx
  );
};

// const removeDeletedListeningDataOfSong = async (song: SavableSongData, trx: DBTransaction) => {
//   await deleteSongPlayEvents(Number(song.songId), trx);
//   await deleteSongSeekEvents(Number(song.songId), trx);
//   await deleteSongSkipEvents(Number(song.songId), trx);
// };

const removeSong = async (song: SavableSongData) => {
  logger.debug(`Started the deletion process of the song '${path.basename(song.path)}'`, {
    songId: song.songId,
    path: song.path
  });

  await db.transaction(async (trx) => {
    // Remove associated data (Artists, Albums, Genres) if they become empty
    await removeDeletedArtistDataOfSong(song, trx);
    await removeDeletedAlbumDataOfSong(song, trx);
    await removeDeletedGenreDataOfSong(song, trx);

    // Artwork data are handled with an associate table with ON DELETE CASCADE, but they won't be deleted from the artworks table.
    // This is because one song can only have one artwork.
    await removeDeletedArtworkDataOfSong(song, trx);

    await removeSongById(Number(song.songId), trx);
  });

  logger.debug(`'${path.basename(song.path)}' song removed from the library.`);
  return { song };
};

const removeSongsFromLibrary = async (
  songPaths: string[],
  abortSignal: AbortSignal
): PromiseFunctionReturn => {
  for (let i = 0; i < songPaths.length; i += 1) {
    const songPath = songPaths[i];

    if (abortSignal?.aborted) {
      logger.warn('Removing songs in the music folder aborted by an abortController signal.', {
        reason: abortSignal?.reason
      });
      break;
    }

    const song = await getSongByPath(songPath);
    if (song == null) continue;

    const songData = convertToSongData(song);

    const data = await removeSong(songData);
    if (!data) {
      return {
        success: false,
        message: `Error occurred when trying to remove the song '${path.basename(song.path)}' from the library.`
      };
    }

    sendMessageToRenderer({
      messageCode: 'SONG_REMOVE_PROCESS_UPDATE',
      data: { total: songPaths.length, value: i }
    });
  }

  dataUpdateEvent('songs/deletedSong');
  dataUpdateEvent('artists/deletedArtist');
  dataUpdateEvent('albums/deletedAlbum');
  dataUpdateEvent('genres/deletedGenre');
  dataUpdateEvent('playlists/deletedPlaylist');

  return {
    success: true,
    message: `${songPaths.length} songs removed and updated artists, albums, playlists and genres related to them.`
  };
};

export default removeSongsFromLibrary;
