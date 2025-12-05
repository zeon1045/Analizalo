import { db } from '@db/db';
import { playlistsSongs, songs } from '@db/schema';
import { eq, inArray } from 'drizzle-orm';

export const getSongsInAnyPlaylist = async (songPaths: string[], trx: DB | DBTransaction = db) => {
  if (songPaths.length === 0) return [];

  const songsInPlaylists = await trx
    .select({ path: songs.path })
    .from(songs)
    .innerJoin(playlistsSongs, eq(songs.id, playlistsSongs.songId))
    .where(inArray(songs.path, songPaths));

  return songsInPlaylists.map((s) => s.path);
};
