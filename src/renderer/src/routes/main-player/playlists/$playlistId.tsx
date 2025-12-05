import MainContainer from '@renderer/components/MainContainer';
import PlaylistInfoAndImgContainer from '@renderer/components/PlaylistsInfoPage/PlaylistInfoAndImgContainer';
import Song from '@renderer/components/SongsPage/Song';
import { songFilterOptions, songSortOptions } from '@renderer/components/SongsPage/SongOptions';
import TitleContainer from '@renderer/components/TitleContainer';
import VirtualizedList from '@renderer/components/VirtualizedList';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import useSelectAllHandler from '@renderer/hooks/useSelectAllHandler';
import { queryClient } from '@renderer/index';
import { playlistQuery } from '@renderer/queries/playlists';
import { songQuery } from '@renderer/queries/songs';
import { store } from '@renderer/store/store';
import { songSearchSchema } from '@renderer/utils/zod/songSchema';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useStore } from '@tanstack/react-store';
import { zodValidator } from '@tanstack/zod-adapter';
import { lazy, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getOnlineSongsForPlaylist,
  removeOnlineSongFromPlaylist
} from '@renderer/components/SongsPage/AddOnlineSongToPlaylistPrompt';
import Img from '@renderer/components/Img';
import { onlineQueueManager } from '@renderer/other/onlineQueueManager';

// Type for online songs stored in playlists (duplicated here to avoid import issues)
interface OnlinePlaylistSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  artworkUrl: string;
  source: string;
  addedAt: number;
}

const SensitiveActionConfirmPrompt = lazy(
  () => import('@renderer/components/SensitiveActionConfirmPrompt')
);

// Type for unified playlist item (can be local or online)
type UnifiedPlaylistItem =
  | { type: 'local'; data: AudioInfo }
  | { type: 'online'; data: OnlinePlaylistSong };

// Component to render an online song in playlist
interface OnlineSongItemProps {
  song: OnlinePlaylistSong;
  index: number;
  isIndexingSongs: boolean;
  onPlayClick: (song: OnlinePlaylistSong, startQueue?: boolean, queueSongs?: OnlinePlaylistSong[]) => void;
  onRemoveClick: (songId: string) => void;
  onDownloadClick: (song: OnlinePlaylistSong) => void;
  isPlaying: boolean;
  isLoading: boolean;
  isDownloading: boolean;
  allOnlineSongs: OnlinePlaylistSong[];
}

const OnlineSongItem = (props: OnlineSongItemProps) => {
  const { song, index, isIndexingSongs, onPlayClick, onRemoveClick, onDownloadClick, isPlaying, isLoading, isDownloading, allOnlineSongs } = props;
  const { updateContextMenuData } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Handler to play this song and set up queue from this position
  const handlePlay = () => {
    onPlayClick(song, true, allOnlineSongs);
  };

  return (
    <div
      className={`song appear-from-bottom group flex h-[60px] items-center rounded-md px-4 transition-colors ${
        isPlaying
          ? 'bg-font-color-highlight/20 dark:bg-dark-font-color-highlight/20'
          : 'hover:bg-background-color-2 dark:hover:bg-dark-background-color-2'
      }`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        updateContextMenuData(
          true,
          [
            {
              label: t('common.play'),
              iconName: 'play_arrow',
              handlerFunction: handlePlay
            },
            {
              label: isDownloading ? 'Descargando...' : 'Descargar',
              iconName: isDownloading ? 'downloading' : 'download',
              handlerFunction: () => !isDownloading && onDownloadClick(song),
              isDisabled: isDownloading
            },
            {
              label: t('playlistsPage.removeFromThisPlaylist'),
              iconName: 'playlist_remove',
              handlerFunction: () => onRemoveClick(song.id)
            }
          ],
          e.pageX,
          e.pageY
        );
      }}
    >
      {/* Index */}
      {isIndexingSongs && (
        <div className="mr-4 w-8 text-center text-sm text-font-color-dimmed dark:text-dark-font-color-dimmed">
          {index + 1}
        </div>
      )}

      {/* Artwork + Play button */}
      <div className="relative mr-4 h-10 w-10 shrink-0">
        <Img
          src={song.artworkUrl}
          className="h-full w-full rounded-md object-cover"
          alt={song.title}
        />
        <button
          className="absolute inset-0 flex items-center justify-center rounded-md bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={handlePlay}
          disabled={isLoading}
        >
          <span className="material-icons-round text-white">
            {isLoading ? 'hourglass_empty' : isPlaying ? 'pause' : 'play_arrow'}
          </span>
        </button>
      </div>

      {/* Title & Artist */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span
            className={`truncate font-medium ${
              isPlaying
                ? 'text-font-color-highlight dark:text-dark-font-color-highlight'
                : 'text-font-color-black dark:text-font-color-white'
            }`}
          >
            {song.title}
          </span>
          {/* Online indicator */}
          <span className="material-icons-round text-font-color-highlight dark:text-dark-font-color-highlight text-sm">
            cloud
          </span>
        </div>
        <span className="truncate text-sm text-font-color-dimmed dark:text-dark-font-color-dimmed">
          {song.artist}
        </span>
      </div>

      {/* Album */}
      <div className="hidden w-1/4 truncate px-4 text-sm text-font-color-dimmed dark:text-dark-font-color-dimmed md:block">
        {song.album}
      </div>

      {/* Duration */}
      <div className="w-16 text-right text-sm text-font-color-dimmed dark:text-dark-font-color-dimmed">
        {formatDuration(song.duration)}
      </div>

      {/* 3-dot menu */}
      <button
        className="ml-4 flex h-8 w-8 items-center justify-center rounded-full text-font-color-dimmed opacity-0 transition-opacity hover:bg-background-color-2 group-hover:opacity-100 dark:text-dark-font-color-dimmed dark:hover:bg-dark-background-color-2"
        onClick={(e) => {
          e.stopPropagation();
          updateContextMenuData(
            true,
            [
              {
                label: t('common.play'),
                iconName: 'play_arrow',
                handlerFunction: handlePlay
              },
              {
                label: isDownloading ? 'Descargando...' : 'Descargar',
                iconName: isDownloading ? 'downloading' : 'download',
                handlerFunction: () => !isDownloading && onDownloadClick(song),
                isDisabled: isDownloading
              },
              {
                label: t('playlistsPage.removeFromThisPlaylist'),
                iconName: 'playlist_remove',
                handlerFunction: () => onRemoveClick(song.id)
              }
            ],
            e.pageX,
            e.pageY
          );
        }}
      >
        <span className="material-icons-round text-xl">more_vert</span>
      </button>
    </div>
  );
};

export const Route = createFileRoute('/main-player/playlists/$playlistId')({
  validateSearch: zodValidator(songSearchSchema),
  component: PlaylistInfoPage,
  loader: async ({ params }) => {
    await queryClient.ensureQueryData(playlistQuery.single({ playlistId: params.playlistId }));
  }
});

function PlaylistInfoPage() {
  const { playlistId } = Route.useParams();
  const { scrollTopOffset } = Route.useSearch();

  const queue = useStore(store, (state) => state.localStorage.queue);
  const playlistSortingState = useStore(
    store,
    (state) => state.localStorage.sortingStates?.songsPage || 'addedOrder'
  );
  const preferences = useStore(store, (state) => state.localStorage.preferences);
  const { updateQueueData, changePromptMenuData, addNewNotifications, createQueue, playSong } =
    useContext(AppUpdateContext);
  const { t } = useTranslation();
  const { sortingOrder = playlistSortingState, filteringOrder = 'notSelected' } = Route.useSearch();
  const navigate = useNavigate({ from: '/main-player/playlists/$playlistId' });

  // State for online songs loading
  const [loadingOnlineId, setLoadingOnlineId] = useState<string | null>(null);
  const [playingOnlineId, setPlayingOnlineId] = useState<string | null>(null);
  // State for online songs (to trigger re-render when removed)
  const [onlineSongsVersion, setOnlineSongsVersion] = useState(0);
  // State for downloading songs
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());

  // Subscribe to online queue manager for playing state updates
  useEffect(() => {
    const unsubscribe = onlineQueueManager.onSongChange((song, _index) => {
      setPlayingOnlineId(song?.id || null);
      setLoadingOnlineId(null);
    });
    return unsubscribe;
  }, []);

  const { data: playlistData } = useSuspenseQuery({
    ...playlistQuery.single({ playlistId: playlistId }),
    select: (data) => data.data[0]
  });
  const { data: playlistSongs = [] } = useQuery({
    ...songQuery.allSongInfo({
      songIds: playlistData.songs,
      sortType: sortingOrder,
      filterType: filteringOrder
    }),
    enabled: Array.isArray(playlistData.songs)
  });

  // Get online songs for this playlist
  const onlineSongs = useMemo(() => {
    // Include onlineSongsVersion to trigger recalculation when songs are removed
    return getOnlineSongsForPlaylist(playlistId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId, onlineSongsVersion]);

  // Combine local and online songs into unified list
  const unifiedSongs: UnifiedPlaylistItem[] = useMemo(() => {
    const localItems: UnifiedPlaylistItem[] = playlistSongs.map((song) => ({
      type: 'local' as const,
      data: song
    }));
    const onlineItems: UnifiedPlaylistItem[] = onlineSongs.map((song) => ({
      type: 'online' as const,
      data: song
    }));
    // Local songs first, then online songs
    return [...localItems, ...onlineItems];
  }, [playlistSongs, onlineSongs]);

  const totalSongsCount = playlistSongs.length + onlineSongs.length;

  const selectAllHandler = useSelectAllHandler(playlistSongs, 'songs', 'songId');

  const handleSongPlayBtnClick = useCallback(
    (currSongId: string) => {
      const queueSongIds = playlistSongs
        .filter((song) => !song.isBlacklisted)
        .map((song) => song.songId);
      createQueue(queueSongIds, 'playlist', false, playlistData.playlistId, false);
      playSong(currSongId, true);
    },
    [createQueue, playSong, playlistData.playlistId, playlistSongs]
  );

  // Handle online song playback using the global online queue manager
  const handleOnlineSongPlay = useCallback(
    async (song: OnlinePlaylistSong, startQueue = false, queueSongs?: OnlinePlaylistSong[]) => {
      setLoadingOnlineId(song.id);

      try {
        if (startQueue && queueSongs && queueSongs.length > 0) {
          // Use the online queue manager to set up the queue and play
          const startIndex = queueSongs.findIndex((s) => s.id === song.id);
          await onlineQueueManager.setQueueAndPlay(
            queueSongs,
            startIndex >= 0 ? startIndex : 0,
            playlistId,
            playlistData.name
          );
        } else {
          // Play single song
          await onlineQueueManager.playSingle({
            ...song,
            playlistId,
            playlistName: playlistData.name
          });
        }
      } catch (error) {
        console.error('Play failed:', error);
        addNewNotifications([
          {
            id: 'play-error',
            content: 'Error al reproducir la canción',
            iconName: 'error',
            type: 'DEFAULT'
          }
        ]);
      } finally {
        setLoadingOnlineId(null);
      }
    },
    [playlistId, playlistData.name, addNewNotifications]
  );

  // Handle removing online song from playlist
  const handleRemoveOnlineSong = useCallback(
    (songId: string) => {
      const song = onlineSongs.find((s) => s.id === songId);
      removeOnlineSongFromPlaylist(playlistId, songId);
      setOnlineSongsVersion((v) => v + 1); // Trigger re-render
      if (song) {
        addNewNotifications([
          {
            id: `${songId}Removed`,
            duration: 5000,
            content: t('playlistsPage.removeSongFromPlaylistSuccess', {
              title: song.title,
              playlistName: playlistData.name
            })
          }
        ]);
      }
    },
    [playlistId, playlistData.name, onlineSongs, addNewNotifications, t]
  );

  // Handle downloading online song
  const handleDownloadOnlineSong = useCallback(
    async (song: OnlinePlaylistSong) => {
      if (downloadingIds.has(song.id)) return;

      setDownloadingIds((prev) => new Set(prev).add(song.id));
      addNewNotifications([
        {
          id: `download-start-${song.id}`,
          content: `Descargando "${song.title}"...`,
          iconName: 'downloading',
          type: 'DEFAULT'
        }
      ]);

      try {
        const result = await window.api.onlineSearch.download(
          song.id,
          song.title,
          song.artist,
          song.album,
          song.artworkUrl
        );

        if (result.success) {
          addNewNotifications([
            {
              id: `download-success-${song.id}`,
              content: `"${song.title}" descargada correctamente`,
              iconName: 'check_circle',
              type: 'DEFAULT'
            }
          ]);
        } else {
          throw new Error(result.error);
        }
      } catch (error) {
        console.error('Download failed:', error);
        addNewNotifications([
          {
            id: `download-error-${song.id}`,
            content: `Error al descargar "${song.title}"`,
            iconName: 'error',
            type: 'DEFAULT'
          }
        ]);
      } finally {
        setDownloadingIds((prev) => {
          const next = new Set(prev);
          next.delete(song.id);
          return next;
        });
      }
    },
    [downloadingIds, addNewNotifications]
  );

  const clearSongHistory = useCallback(() => {
    changePromptMenuData(
      true,
      <SensitiveActionConfirmPrompt
        title={t('settingsPage.confirmSongHistoryDeletion')}
        content={t('settingsPage.songHistoryDeletionDisclaimer')}
        confirmButton={{
          label: t('settingsPage.clearHistory'),
          clickHandler: () =>
            window.api.audioLibraryControls
              .clearSongHistory()
              .then(
                (res) =>
                  res.success &&
                  addNewNotifications([
                    {
                      id: 'queueCleared',
                      duration: 5000,
                      content: t('settingsPage.songHistoryDeletionSuccess')
                    }
                  ])
              )
              .catch((err) => console.error(err))
        }}
      />
    );
  }, [addNewNotifications, changePromptMenuData, t]);

  const addSongsToQueue = useCallback(() => {
    const validSongIds = playlistSongs
      .filter((song) => !song.isBlacklisted)
      .map((song) => song.songId);
    updateQueueData(undefined, [...queue.queue, ...validSongIds]);
    addNewNotifications([
      {
        id: `addedToQueue`,
        duration: 5000,
        content: t('notifications.addedToQueue', {
          count: validSongIds.length
        })
      }
    ]);
  }, [addNewNotifications, playlistSongs, queue.queue, t, updateQueueData]);

  const shuffleAndPlaySongs = useCallback(() => {
    // Clear any existing online queue state when starting new playback
    onlineQueueManager.clear();
    
    // If we have local songs, play them
    if (playlistSongs.length > 0) {
      createQueue(
        playlistSongs.filter((song) => !song.isBlacklisted).map((song) => song.songId),
        'playlist',
        true,
        playlistData.playlistId,
        true
      );
    } else if (onlineSongs.length > 0) {
      // If only online songs, shuffle and play with queue
      const shuffled = [...onlineSongs].sort(() => Math.random() - 0.5);
      handleOnlineSongPlay(shuffled[0], true, shuffled);
    }
  }, [createQueue, playlistData.playlistId, playlistSongs, onlineSongs, handleOnlineSongPlay]);

  const playAllSongs = useCallback(() => {
    // Clear any existing online queue state when starting new playback
    onlineQueueManager.clear();
    
    // If we have local songs, play them
    if (playlistSongs.length > 0) {
      createQueue(
        playlistSongs.filter((song) => !song.isBlacklisted).map((song) => song.songId),
        'playlist',
        false,
        playlistData.playlistId,
        true
      );
    } else if (onlineSongs.length > 0) {
      // If only online songs, play with queue for sequential playback
      handleOnlineSongPlay(onlineSongs[0], true, onlineSongs);
    }
  }, [createQueue, playlistData.playlistId, playlistSongs, onlineSongs, handleOnlineSongPlay]);

  return (
    <MainContainer
      className="main-container playlist-info-page-container h-full! px-8 pr-0! pb-0!"
      focusable
      onKeyDown={(e) => {
        if (e.ctrlKey && e.key === 'a') {
          e.stopPropagation();
          selectAllHandler();
        }
      }}
    >
      <TitleContainer
        title={playlistData.name}
        className="pr-4"
        buttons={[
          {
            label: t('settingsPage.clearHistory'),
            iconName: 'clear',
            clickHandler: clearSongHistory,
            isVisible: playlistData.playlistId === 'History',
            isDisabled: totalSongsCount === 0
          },
          {
            label: t('common.playAll'),
            iconName: 'play_arrow',
            clickHandler: playAllSongs,
            isDisabled: totalSongsCount === 0
          },
          {
            tooltipLabel: t('common.shuffleAndPlay'),
            iconName: 'shuffle',
            clickHandler: shuffleAndPlaySongs,
            isDisabled: totalSongsCount === 0
          },
          {
            tooltipLabel: t('common.addToQueue'),
            iconName: 'add',
            clickHandler: addSongsToQueue,
            isDisabled: playlistSongs.length === 0
          }
        ]}
        dropdowns={[
          {
            name: 'songsPageFilterDropdown',
            type: `${t('common.filterBy')} :`,
            value: filteringOrder,
            options: songFilterOptions,
            onChange: (e) => {
              const order = e.currentTarget.value as SongFilterTypes;
              navigate({ search: (prev) => ({ ...prev, filteringOrder: order }) });
            }
          },
          {
            name: 'PlaylistPageSortDropdown',
            type: `${t('common.sortBy')} :`,
            value: sortingOrder,
            options: songSortOptions,
            onChange: (e) => {
              const order = e.currentTarget.value as SongSortTypes;
              navigate({ search: (prev) => ({ ...prev, sortingOrder: order }) });
            },
            isDisabled: playlistSongs.length === 0
          }
        ]}
      />

      {/* Stats bar showing local and online counts */}
      {(playlistSongs.length > 0 || onlineSongs.length > 0) && (
        <div className="stats-bar mb-4 flex items-center gap-4 pr-4 text-sm text-font-color-dimmed dark:text-dark-font-color-dimmed">
          <span>
            {totalSongsCount} {totalSongsCount === 1 ? 'canción' : 'canciones'}
          </span>
          {playlistSongs.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="material-icons-round text-sm">folder</span>
              {playlistSongs.length} local{playlistSongs.length !== 1 ? 'es' : ''}
            </span>
          )}
          {onlineSongs.length > 0 && (
            <span className="flex items-center gap-1 text-font-color-highlight dark:text-dark-font-color-highlight">
              <span className="material-icons-round text-sm">cloud</span>
              {onlineSongs.length} online
            </span>
          )}
        </div>
      )}

      <VirtualizedList
        data={unifiedSongs}
        fixedItemHeight={60}
        scrollTopOffset={scrollTopOffset}
        components={{
          Header: () => (
            <PlaylistInfoAndImgContainer
              playlist={{
                ...playlistData,
                // Show combined count
                songs: [
                  ...(playlistData.songs || []),
                  ...onlineSongs.map((s) => s.id)
                ]
              }}
              songs={playlistSongs}
            />
          )
        }}
        itemContent={(index, item) => {
          if (item.type === 'local') {
            return (
              <Song
                key={`local-${index}`}
                index={index}
                isIndexingSongs={preferences.isSongIndexingEnabled}
                onPlayClick={handleSongPlayBtnClick}
                selectAllHandler={selectAllHandler}
                {...item.data}
                trackNo={undefined}
                additionalContextMenuItems={[
                  {
                    label: t('playlistsPage.removeFromThisPlaylist'),
                    iconName: 'playlist_remove',
                    handlerFunction: () =>
                      window.api.playlistsData
                        .removeSongFromPlaylist(playlistData.playlistId, item.data.songId)
                        .then(
                          (res) =>
                            res.success &&
                            addNewNotifications([
                              {
                                id: `${item.data.songId}Removed`,
                                duration: 5000,
                                content: t('playlistsPage.removeSongFromPlaylistSuccess', {
                                  title: item.data.title,
                                  playlistName: playlistData.name
                                })
                              }
                            ])
                        )
                        .catch((err) => console.error(err))
                  }
                ]}
              />
            );
          } else {
            // Online song
            return (
              <OnlineSongItem
                key={`online-${item.data.id}`}
                song={item.data}
                index={index}
                isIndexingSongs={preferences.isSongIndexingEnabled}
                onPlayClick={handleOnlineSongPlay}
                onRemoveClick={handleRemoveOnlineSong}
                onDownloadClick={handleDownloadOnlineSong}
                isPlaying={playingOnlineId === item.data.id}
                isLoading={loadingOnlineId === item.data.id}
                isDownloading={downloadingIds.has(item.data.id)}
                allOnlineSongs={onlineSongs}
              />
            );
          }
        }}
      />
      {totalSongsCount === 0 && (
        <div className="no-songs-container appear-from-bottom text-font-color-black dark:text-font-color-white relative flex h-full grow flex-col items-center justify-center text-center text-lg font-light opacity-80!">
          <span className="material-icons-round-outlined mb-4 text-5xl">brightness_empty</span>
          {t('playlist.empty')}
        </div>
      )}
    </MainContainer>
  );
}
