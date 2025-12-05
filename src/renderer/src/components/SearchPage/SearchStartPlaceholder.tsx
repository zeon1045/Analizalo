import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Button from '../Button';
import Img from '../Img';
import RecentSearchResult from './RecentSearchResult';

import SearchSomethingImage from '../../assets/images/svg/Flying kite_Monochromatic.svg';
import NoSongsImage from '../../assets/images/svg/Empty Inbox _Monochromatic.svg';
import DefaultArtistCover from '../../assets/images/webp/artist_cover_default.webp';
import DefaultAlbumCover from '../../assets/images/webp/album_cover_default.webp';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { queryClient } from '@renderer/index';
import { searchQuery } from '@renderer/queries/search';
import { songQuery } from '@renderer/queries/songs';
import { artistQuery } from '@renderer/queries/aritsts';
import { albumQuery } from '@renderer/queries/albums';
import VirtualizedGrid from '../VirtualizedGrid';
import SongCard from '../SongsPage/SongCard';
import OnlineSongCard from '../SongsPage/OnlineSongCard';
import { getOnlinePlaylistSongs, type OnlinePlaylistSong } from '../SongsPage/AddOnlineSongToPlaylistPrompt';

type VisibleSong = 
  | { type: 'local'; data: SongData }
  | { type: 'online'; data: OnlinePlaylistSong };

type Props = {
  searchInput: string;
  updateSearchInput: (input: string) => void;
  activeFilter: SearchFilters;
  selectedArtistId?: string;
  selectedAlbumId?: string;
  onFilterChange: (_filter: SearchFilters) => void;
  onCascadeToAlbums: (_artistId: string) => void;
  onCascadeToSongs: (_albumId: string) => void;
  onClearArtistSelection: () => void;
  onClearAlbumSelection: () => void;
  onResetToSongs: () => void;
};

const SONG_GRID_ITEM_HEIGHT = 280;
const SONG_GRID_ITEM_WIDTH = 220;
const ARTIST_GRID_ITEM_HEIGHT = 280;
const ARTIST_GRID_ITEM_WIDTH = 220;
const ALBUM_GRID_ITEM_HEIGHT = 280;
const ALBUM_GRID_ITEM_WIDTH = 220;

const SearchStartPlaceholder = (props: Props) => {
  const { t } = useTranslation();

  const [onlineSongsUpdateTrigger, setOnlineSongsUpdateTrigger] = useState(0);

  useEffect(() => {
    const handleOnlineSongsUpdate = () => {
      setOnlineSongsUpdateTrigger((prev) => prev + 1);
    };
    window.addEventListener('onlinePlaylistSongsChange', handleOnlineSongsUpdate);
    return () => {
      window.removeEventListener('onlinePlaylistSongsChange', handleOnlineSongsUpdate);
    };
  }, []);

  const {
    searchInput,
    updateSearchInput,
    activeFilter,
    selectedArtistId,
    selectedAlbumId,
    onFilterChange,
    onCascadeToAlbums,
    onCascadeToSongs,
    onClearArtistSelection,
    onClearAlbumSelection,
    onResetToSongs
  } = props;

  const normalizedFilter = (activeFilter ?? 'All').toLowerCase() as Lowercase<SearchFilters>;

  const { data: recentSearchResults } = useSuspenseQuery(searchQuery.recentResults);
  
  // Get library songs
  const { data: librarySongs } = useSuspenseQuery(
    songQuery.all({
      sortType: 'aToZ',
      filterType: 'notSelected',
      start: 0,
      end: 0
    })
  );

  const {
    data: { data: allArtists }
  } = useSuspenseQuery(artistQuery.all({ sortType: 'aToZ', filterType: 'notSelected', start: 0, end: 0 }));

  const {
    data: { data: allAlbums }
  } = useSuspenseQuery(albumQuery.all({ sortType: 'aToZ', start: 0, end: 0 }));

  const { data: selectedArtistData } = useQuery({
    ...artistQuery.single({ artistId: selectedArtistId ?? '' }),
    enabled: Boolean(selectedArtistId),
    select: (data) => data.data[0]
  });

  const { data: selectedAlbumData } = useQuery({
    ...albumQuery.single({ albumId: selectedAlbumId ?? '' }),
    enabled: Boolean(selectedAlbumId),
    select: (data) => data.data[0]
  });

  const songsByAlbumSet = useMemo(() => {
    if (!selectedAlbumData?.songs) return undefined;
    return new Set(selectedAlbumData.songs.map((song) => song.songId));
  }, [selectedAlbumData?.songs]);

  const songsByArtistSet = useMemo(() => {
    if (!selectedArtistData?.songs) return undefined;
    return new Set(selectedArtistData.songs.map((song) => song.songId));
  }, [selectedArtistData?.songs]);

  const onlineData = useMemo(() => {
    const onlinePlaylistData = getOnlinePlaylistSongs();
    const songs: OnlinePlaylistSong[] = [];
    if (onlinePlaylistData) {
      Object.values(onlinePlaylistData)
        .flat()
        .forEach((song) => songs.push(song));
    }

    // Deduplicate songs by ID
    const uniqueSongs = new Map<string, OnlinePlaylistSong>();
    songs.forEach(s => uniqueSongs.set(s.id, s));
    const dedupedSongs = Array.from(uniqueSongs.values());

    const artistsMap = new Map<string, Artist>();
    const albumsMap = new Map<string, Album>();

    dedupedSongs.forEach(song => {
      const artistName = song.artist;
      const artistId = `online-artist-${artistName}`;
      
      if (!artistsMap.has(artistId)) {
        artistsMap.set(artistId, {
          artistId,
          name: artistName,
          songs: [],
          albums: [],
          isAFavorite: false,
          onlineArtworkPaths: {
            picture_medium: song.artworkUrl,
            picture_small: song.artworkUrl,
          },
          artworkPaths: {
            isDefaultArtwork: false,
            artworkPath: song.artworkUrl,
            optimizedArtworkPath: song.artworkUrl
          }
        });
      }
      const artist = artistsMap.get(artistId)!;
      // Avoid duplicate songs in artist
      if (!artist.songs.some(s => s.songId === song.id)) {
        artist.songs.push({ title: song.title, songId: song.id });
      }

      const albumTitle = song.album;
      const albumId = `online-album-${albumTitle}-${artistName}`;
      
      if (!albumsMap.has(albumId)) {
        albumsMap.set(albumId, {
          albumId,
          title: albumTitle,
          artists: [{ name: artistName, artistId }],
          songs: [],
          artworkPaths: {
            isDefaultArtwork: false,
            artworkPath: song.artworkUrl,
            optimizedArtworkPath: song.artworkUrl
          }
        });
      }
      const album = albumsMap.get(albumId)!;
      if (!album.songs.some(s => s.songId === song.id)) {
        album.songs.push({ title: song.title, songId: song.id });
      }
      // Safeguard: Ensure artists are set on the album
      if (!album.artists || album.artists.length === 0) {
        album.artists = [{ name: artistName, artistId }];
      }
      
      if (!artist.albums) artist.albums = [];
      if (!artist.albums.some(a => a.albumId === albumId)) {
        artist.albums.push({ title: albumTitle, albumId });
      }
    });

    return {
      artists: Array.from(artistsMap.values()),
      albums: Array.from(albumsMap.values()),
      songs: dedupedSongs
    };
  }, [onlineSongsUpdateTrigger]);

  const combinedArtists = useMemo(() => {
    const local = allArtists || [];
    const online = onlineData.artists;
    
    const localNames = new Map(local.map(a => [a.name.toLowerCase(), a]));
    const merged = local.map(a => ({ ...a })); // Shallow copy to avoid mutation issues
    const onlineToAdd: Artist[] = [];

    online.forEach(onlineArtist => {
      const localArtistIndex = merged.findIndex(a => a.name.toLowerCase() === onlineArtist.name.toLowerCase());
      if (localArtistIndex !== -1) {
        const localArtist = merged[localArtistIndex];
        merged[localArtistIndex] = {
            ...localArtist,
            songs: [...localArtist.songs, ...onlineArtist.songs],
            albums: [...(localArtist.albums || []), ...(onlineArtist.albums || [])]
        };
      } else {
        onlineToAdd.push(onlineArtist);
      }
    });

    return [...merged, ...onlineToAdd].sort((a, b) => a.name.localeCompare(b.name));
  }, [allArtists, onlineData.artists]);

  const combinedAlbums = useMemo(() => {
    const local = allAlbums || [];
    const online = onlineData.albums;
    
    const merged = local.map(a => ({ ...a }));
    const onlineToAdd: Album[] = [];

    online.forEach(onlineAlbum => {
      // Merge if title AND artist match? Or just title?
      // Local albums have artists array.
      const localAlbumIndex = merged.findIndex(a => 
        a.title.toLowerCase() === onlineAlbum.title.toLowerCase() &&
        a.artists?.some(art => onlineAlbum.artists?.some(oa => oa.name.toLowerCase() === art.name.toLowerCase()))
      );

      if (localAlbumIndex !== -1) {
        const localAlbum = merged[localAlbumIndex];
        merged[localAlbumIndex] = {
          ...localAlbum,
          songs: [...localAlbum.songs, ...onlineAlbum.songs]
        };
      } else {
        onlineToAdd.push(onlineAlbum);
      }
    });

    return [...merged, ...onlineToAdd].sort((a, b) => a.title.localeCompare(b.title));
  }, [allAlbums, onlineData.albums]);

  const resolvedSelectedArtistData = useMemo(() => {
    if (selectedArtistData) return selectedArtistData;
    if (selectedArtistId?.startsWith('online-artist-')) {
      return onlineData.artists.find(a => a.artistId === selectedArtistId);
    }
    return undefined;
  }, [selectedArtistData, selectedArtistId, onlineData.artists]);

  const resolvedSelectedAlbumData = useMemo(() => {
    if (selectedAlbumData) return selectedAlbumData;
    if (selectedAlbumId?.startsWith('online-album-')) {
      return onlineData.albums.find(a => a.albumId === selectedAlbumId);
    }
    return undefined;
  }, [selectedAlbumData, selectedAlbumId, onlineData.albums]);

  const artistAlbumIds = useMemo(
    () => resolvedSelectedArtistData?.albums?.map((album) => album.albumId) ?? [],
    [resolvedSelectedArtistData?.albums]
  );

  const { data: artistAlbums = [], isFetching: isFetchingArtistAlbums } = useQuery({
    ...albumQuery.all({ 
      albumIds: artistAlbumIds.filter(id => !id.startsWith('online-album-')), 
      sortType: 'aToZ', 
      start: 0, 
      end: 0 
    }),
    enabled: artistAlbumIds.some(id => !id.startsWith('online-album-')),
    select: (data) => data.data
  });

  const resolvedArtistAlbums = useMemo(() => {
    let albums = [...artistAlbums];
    const artistName = resolvedSelectedArtistData?.name;
    
    if (artistName) {
        const onlineArtist = onlineData.artists.find(a => a.name.toLowerCase() === artistName.toLowerCase());
        if (onlineArtist && onlineArtist.albums) {
             const onlineAlbums = onlineArtist.albums.map(a => onlineData.albums.find(alb => alb.albumId === a.albumId)).filter(Boolean) as Album[];
             // Filter out duplicates that are already in 'albums' (local)
             const uniqueOnlineAlbums = onlineAlbums.filter(oa => !albums.some(la => la.title.toLowerCase() === oa.title.toLowerCase()));
             albums = [...albums, ...uniqueOnlineAlbums];
        }
    }
    return albums.sort((a, b) => a.title.localeCompare(b.title));
  }, [artistAlbums, resolvedSelectedArtistData?.name, onlineData]);

  const visibleSongs = useMemo(() => {
    const baseSongs = librarySongs.data ?? [];
    const onlineSongs = onlineData.songs;

    // Combine
    const combinedSongs: VisibleSong[] = [
      ...baseSongs.map((s) => ({ type: 'local' as const, data: s })),
      ...onlineSongs.map((s) => ({ type: 'online' as const, data: s }))
    ];

    // Sort combined songs (A-Z by default for now)
    combinedSongs.sort((a, b) => {
      const titleA = a.type === 'local' ? a.data.title : a.data.title;
      const titleB = b.type === 'local' ? b.data.title : b.data.title;
      return titleA.localeCompare(titleB);
    });

    if (songsByAlbumSet && normalizedFilter !== 'artists' && normalizedFilter !== 'albums') {
      return combinedSongs.filter((song) => {
        if (song.type === 'local') {
          return songsByAlbumSet.has(song.data.songId);
        }
        // Online song filtering by album
        // Check if online song ID is in the set (if we selected an online album)
        // OR if the album title matches (if we selected a local album)
        return (
          songsByAlbumSet.has(song.data.id) ||
          (resolvedSelectedAlbumData?.title &&
          song.data.album.toLowerCase() === resolvedSelectedAlbumData.title.toLowerCase())
        );
      });
    }

    if (songsByArtistSet && normalizedFilter === 'songs') {
      return combinedSongs.filter((song) => {
        if (song.type === 'local') {
          return songsByArtistSet.has(song.data.songId);
        }
        // Online song filtering by artist
        return (
          songsByArtistSet.has(song.data.id) ||
          (resolvedSelectedArtistData?.name &&
          song.data.artist.toLowerCase() === resolvedSelectedArtistData.name.toLowerCase())
        );
      });
    }

    if (normalizedFilter === 'all' || normalizedFilter === 'songs') return combinedSongs;

    return combinedSongs;
  }, [
    librarySongs.data,
    songsByAlbumSet,
    songsByArtistSet,
    normalizedFilter,
    onlineData.songs,
    resolvedSelectedAlbumData?.title,
    resolvedSelectedArtistData?.name
  ]);

  useEffect(() => {
    const manageSearchResultsUpdatesInSearchPage = (e: Event) => {
      if ('detail' in e) {
        const dataEvents = (e as DetailAvailableEvent<DataUpdateEvent[]>).detail;
        for (let i = 0; i < dataEvents.length; i += 1) {
          const event = dataEvents[i];
          if (event.dataType === 'userData/recentSearches')
            queryClient.invalidateQueries(searchQuery.recentResults);
          if (event.dataType === 'songs' || event.dataType === 'songs/newSong')
            queryClient.invalidateQueries(songQuery.all({
              sortType: 'aToZ',
              filterType: 'notSelected',
              start: 0,
              end: 0
            }));
          if (event.dataType?.startsWith('artists'))
            queryClient.invalidateQueries(
              artistQuery.all({ sortType: 'aToZ', filterType: 'notSelected', start: 0, end: 0 })
            );
          if (event.dataType?.startsWith('albums'))
            queryClient.invalidateQueries(
              albumQuery.all({ sortType: 'aToZ', start: 0, end: 0 })
            );
        }
      }
    };
    document.addEventListener('app/dataUpdates', manageSearchResultsUpdatesInSearchPage);
    return () => {
      document.removeEventListener('app/dataUpdates', manageSearchResultsUpdatesInSearchPage);
    };
  }, []);

  const recentSearchResultComponents = useMemo(
    () =>
      recentSearchResults.length > 0
        ? recentSearchResults.map((result, index) => (
            <RecentSearchResult
              key={index}
              result={result}
              clickHandler={() => updateSearchInput(result)}
            />
          ))
        : [],
    [recentSearchResults, updateSearchInput]
  );

  if (searchInput.trim() !== '') return null;

  const cascadeActive = Boolean(resolvedSelectedArtistData) || Boolean(resolvedSelectedAlbumData);

  const renderSelectionControls = () => {
    if (!cascadeActive) return null;

    return (
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          className="!m-0 rounded-3xl bg-background-color-2/80 px-3 py-1 text-sm dark:bg-dark-background-color-2/80"
          iconName="restart_alt"
          label={t('common.goBack')}
          clickHandler={(_, setIsDisabled, setIsPending) => {
            setIsDisabled(false);
            setIsPending(false);
            onResetToSongs();
          }}
        />
        {resolvedSelectedArtistData && (
          <Button
            className="!m-0 rounded-3xl bg-background-color-2 px-3 py-1 text-sm dark:bg-dark-background-color-2"
            iconName="person"
            label={resolvedSelectedArtistData.name || t('common.unknownArtist')}
            clickHandler={(_, setIsDisabled, setIsPending) => {
              setIsDisabled(false);
              setIsPending(false);
              onFilterChange('Artists');
            }}
          />
        )}
        {resolvedSelectedArtistData && (
          <Button
            className="!m-0 rounded-3xl bg-background-color-2/80 px-3 py-1 text-sm dark:bg-dark-background-color-2/80"
            iconName="close"
            label={t('common.cancel')}
            clickHandler={(_, setIsDisabled, setIsPending) => {
              setIsDisabled(false);
              setIsPending(false);
              onClearArtistSelection();
            }}
          />
        )}
        {resolvedSelectedAlbumData && (
          <Button
            className="!m-0 rounded-3xl bg-background-color-2 px-3 py-1 text-sm dark:bg-dark-background-color-2"
            iconName="album"
            label={resolvedSelectedAlbumData.title}
            clickHandler={(_, setIsDisabled, setIsPending) => {
              setIsDisabled(false);
              setIsPending(false);
              onFilterChange('Albums');
            }}
          />
        )}
        {resolvedSelectedAlbumData && (
          <Button
            className="!m-0 rounded-3xl bg-background-color-2/80 px-3 py-1 text-sm dark:bg-dark-background-color-2/80"
            iconName="close"
            label={t('common.cancel')}
            clickHandler={(_, setIsDisabled, setIsPending) => {
              setIsDisabled(false);
              setIsPending(false);
              onClearAlbumSelection();
            }}
          />
        )}
      </div>
    );
  };

  const renderArtists = () => {
    if (combinedArtists.length === 0)
      return (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <Img src={SearchSomethingImage} alt="" className="mb-8 w-60" />
          <div className="description text-font-color-black dark:text-font-color-white text-xl">
            {t('searchPage.noResults')}
          </div>
        </div>
      );

    return (
      <VirtualizedGrid
        data={combinedArtists}
        fixedItemHeight={ARTIST_GRID_ITEM_HEIGHT}
        fixedItemWidth={ARTIST_GRID_ITEM_WIDTH}
        itemContent={(index, artist) => (
          <ArtistLibraryCard
            key={artist.artistId ?? `artist-${index}`}
            artist={artist}
            isSelected={artist.artistId === selectedArtistId}
            onSelect={() => onCascadeToAlbums(artist.artistId)}
          />
        )}
      />
    );
  };

  const renderAlbums = () => {
    const albumsToRender = selectedArtistId ? resolvedArtistAlbums : combinedAlbums;

    if (selectedArtistId && isFetchingArtistAlbums && !selectedArtistId.startsWith('online-artist-'))
      return (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <div className="description text-font-color-black dark:text-font-color-white text-xl">
            {t('common.loading')}
          </div>
        </div>
      );

    if (albumsToRender.length === 0)
      return (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <Img src={SearchSomethingImage} alt="" className="mb-8 w-60" />
          <div className="description text-font-color-black dark:text-font-color-white text-xl">
            {t('searchPage.noResults')}
          </div>
        </div>
      );

    return (
      <VirtualizedGrid
        data={albumsToRender}
        fixedItemHeight={ALBUM_GRID_ITEM_HEIGHT}
        fixedItemWidth={ALBUM_GRID_ITEM_WIDTH}
        itemContent={(index, album) => (
          <AlbumLibraryCard
            key={album.albumId ?? `album-${index}`}
            album={album}
            isSelected={album.albumId === selectedAlbumId}
            onSelect={() => onCascadeToSongs(album.albumId)}
          />
        )}
      />
    );
  };

  const renderSongs = () => {
    if (visibleSongs.length === 0)
      return (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <Img src={NoSongsImage} alt="" className="mb-8 w-60" />
          <div className="description text-font-color-black dark:text-font-color-white text-xl">
            {t('songsPage.empty')}
          </div>
          <div className="recent-search-results-container mt-4 flex w-[clamp(12.5rem,90%,50rem)] flex-wrap items-center justify-center">
            {recentSearchResultComponents}
          </div>
          {recentSearchResultComponents.length > 0 && (
            <Button
              label="clear search history"
              className="text-font-color-highlight! dark:text-dark-font-color-highlight/75! m-0! mt-4! rounded-none! border-0! p-0! outline-offset-1 hover:underline focus-visible:outline!"
              clickHandler={(_, setIsDisabled) => {
                setIsDisabled(true);
                window.api.search.clearSearchHistory().catch((err) => {
                  setIsDisabled(false);
                  console.warn(err);
                });
              }}
              pendingAnimationOnDisabled
              pendingClassName="mr-2"
            />
          )}
        </div>
      );

    return (
      <VirtualizedGrid
        data={visibleSongs}
        fixedItemHeight={SONG_GRID_ITEM_HEIGHT}
        fixedItemWidth={SONG_GRID_ITEM_WIDTH}
        itemContent={(index, song) => {
          if (song.type === 'local') {
            return (
              <SongCard
                key={song.data.songId}
                index={index}
                songId={song.data.songId}
                title={song.data.title}
                artworkPath={song.data.artworkPaths.artworkPath}
                artists={song.data.artists}
                album={song.data.album}
                palette={song.data.paletteData}
                isAFavorite={song.data.isAFavorite}
                path={song.data.path}
                isBlacklisted={song.data.isBlacklisted}
                className="w-full h-full"
              />
            );
          }
          return (
            <OnlineSongCard
              key={song.data.id}
              index={index}
              song={song.data}
              className="w-full h-full"
            />
          );
        }}
      />
    );
  };

  const content = (() => {
    if (normalizedFilter === 'artists') return renderArtists();
    if (normalizedFilter === 'albums') return renderAlbums();
    if (normalizedFilter === 'playlists' || normalizedFilter === 'genres')
      return (
        <div className="flex h-full flex-col items-center justify-center text-center">
          <Img src={SearchSomethingImage} alt="" className="mb-8 w-60" />
          <div className="description text-font-color-black dark:text-font-color-white text-xl">
            {t('searchPage.searchForAnything')}
          </div>
        </div>
      );
    return renderSongs();
  })();

  return (
    <div className="search-start-placeholder active appear-from-bottom relative flex h-full! w-full flex-col">
      {renderSelectionControls()}
      {content}
    </div>
  );
};

export default SearchStartPlaceholder;

type ArtistLibraryCardProps = {
  artist: Artist;
  isSelected: boolean;
  onSelect: () => void;
};

const ArtistLibraryCard = ({ artist, isSelected, onSelect }: ArtistLibraryCardProps) => {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className={`group flex h-full w-full flex-col items-center justify-between rounded-2xl border border-transparent p-4 text-center transition-all hover:bg-background-color-2/50 dark:hover:bg-dark-background-color-2/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-background-color-3 ${isSelected ? 'border-background-color-3 shadow-lg dark:border-dark-background-color-3 bg-background-color-2/50 dark:bg-dark-background-color-2/50' : ''}`}
      onClick={onSelect}
    >
      <div className="relative mb-3 flex h-32 w-32 items-center justify-center overflow-hidden rounded-full shadow-lg">
        <Img
          src={artist.onlineArtworkPaths?.picture_medium}
          fallbackSrc={artist.artworkPaths?.optimizedArtworkPath || DefaultArtistCover}
          alt={artist.name || t('common.unknownArtist')}
          className="h-full w-full object-cover"
        />
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="text-base font-semibold text-font-color-highlight dark:text-dark-font-color-highlight line-clamp-2 leading-tight">
          {artist.name && artist.name.trim().length > 0 ? artist.name : t('common.unknownArtist')}
        </span>
        <span className="text-sm text-font-color-highlight/70 dark:text-dark-font-color-highlight/70">
          {t('common.albumWithCount', { count: artist.albums?.length ?? 0 })}
        </span>
        <span className="text-sm text-font-color-highlight/70 dark:text-dark-font-color-highlight/70">
          {t('common.songWithCount', { count: artist.songs.length })}
        </span>
      </div>
    </button>
  );
};

type AlbumLibraryCardProps = {
  album: Album;
  isSelected: boolean;
  onSelect: () => void;
};

const AlbumLibraryCard = ({ album, isSelected, onSelect }: AlbumLibraryCardProps) => {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      className={`group flex h-full w-full flex-col overflow-hidden rounded-2xl border border-transparent p-2 text-left transition-all hover:bg-background-color-2/50 dark:hover:bg-dark-background-color-2/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-background-color-3 ${isSelected ? 'border-background-color-3 shadow-lg dark:border-dark-background-color-3 bg-background-color-2/50 dark:bg-dark-background-color-2/50' : ''}`}
      onClick={onSelect}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-xl shadow-md">
        <Img
          src={album.artworkPaths?.artworkPath}
          fallbackSrc={DefaultAlbumCover}
          alt={album.title}
          className="h-full w-full object-cover"
        />
      </div>
      <div className="mt-3 flex flex-1 flex-col gap-1 px-1">
        <span className="line-clamp-2 text-base font-semibold text-font-color-highlight dark:text-dark-font-color-highlight">
          {album.title}
        </span>
        <span className="line-clamp-2 text-sm text-font-color-highlight/70 dark:text-dark-font-color-highlight/70">
          {album.artists?.map((artist) => artist.name).join(', ') || t('common.unknownArtist')}
        </span>
        <span className="text-sm text-font-color-highlight/70 dark:text-dark-font-color-highlight/70">
          {t('common.songWithCount', { count: album.songs.length })}
        </span>
      </div>
    </button>
  );
};
