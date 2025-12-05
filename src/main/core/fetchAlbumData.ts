import { getAllAlbums } from '@main/db/queries/albums';
import logger from '../logger';
import { convertToAlbum } from '@main/utils/convert';
import { db } from '@main/db/db';
import { artworks, artworksSongs } from '@main/db/schema';
import { eq } from 'drizzle-orm';

const fetchAlbumData = async (
  albumTitlesOrIds: string[] = [],
  sortType?: AlbumSortTypes,
  start = 0,
  end = 0
): Promise<PaginatedResult<Album, AlbumSortTypes>> => {
  const result: PaginatedResult<Album, AlbumSortTypes> = {
    data: [],
    total: 0,
    sortType,
    start: 0,
    end: 0
  };

  if (albumTitlesOrIds) {
    logger.debug(`Requested albums data for ids`, { albumTitlesOrIds });
    const albums = await getAllAlbums({
      albumIds: albumTitlesOrIds.map((x) => Number(x)),
      sortType,
      start,
      end
    });

    for (const album of albums.data) {
      if (album.artworks.length === 0 && album.songs.length > 0) {
        const songId = album.songs[0].song.id;
        const songArtworks = await db
          .select()
          .from(artworks)
          .innerJoin(artworksSongs, eq(artworks.id, artworksSongs.artworkId))
          .where(eq(artworksSongs.songId, songId))
          .limit(1);

        if (songArtworks.length > 0) {
          album.artworks.push({ artwork: songArtworks[0].artworks });
        }
      }
    }

    const output = albums.data.map((x) => convertToAlbum(x));

    result.data = output;
    result.total = albums.data.length;
    result.start = albums.start;
    result.end = albums.end;
  }
  return result;
};

export default fetchAlbumData;
