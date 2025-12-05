/* eslint-disable promise/catch-or-return */

import { lazy, useCallback, useContext, useEffect, useMemo, useState, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';

import Checkbox from '../Checkbox';
import Button from '../Button';
import Img from '../Img';
import { useSuspenseQuery } from '@tanstack/react-query';
import { playlistQuery } from '@renderer/queries/playlists';
import { queryClient } from '@renderer/index';
import SuspenseLoader from '../SuspenseLoader';

const PlaylistEditor = lazy(
  () => import('../PlaylistsPage/PlaylistEditor')
);

// Type for online song data
export interface OnlineSongData {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  artworkUrl: string;
  source: string;
}

// Type for online songs stored in playlists
export interface OnlinePlaylistSong extends OnlineSongData {
  addedAt: number;
}

// Type for online playlist storage
export interface OnlinePlaylistData {
  [playlistId: string]: OnlinePlaylistSong[];
}

// Helper functions for managing online songs in playlists
export const getOnlinePlaylistSongs = (): OnlinePlaylistData => {
  try {
    const stored = localStorage.getItem('nora-online-playlist-songs');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Error loading online playlist songs:', e);
  }
  return {};
};

/**
 * Get all unique song IDs from all playlists
 * Used to tell main process which songs to protect from cache cleanup
 */
export const getAllOnlinePlaylistSongIds = (): string[] => {
  const data = getOnlinePlaylistSongs();
  const allIds = new Set<string>();
  
  for (const playlistId in data) {
    for (const song of data[playlistId]) {
      allIds.add(song.id);
    }
  }
  
  return Array.from(allIds);
};

/**
 * Sync protected song IDs with main process
 * Call this after any modification to playlist songs
 */
export const syncProtectedSongsWithMain = (): void => {
  const allSongIds = getAllOnlinePlaylistSongIds();
  window.api.onlineSearch.updateProtectedSongIds(allSongIds);
  console.log(`[Cache] Synced ${allSongIds.length} protected song IDs with main process`);
};

export const saveOnlinePlaylistSongs = (data: OnlinePlaylistData): void => {
  localStorage.setItem('nora-online-playlist-songs', JSON.stringify(data));
  // Sync protected IDs with main process whenever playlist data changes
  syncProtectedSongsWithMain();
  // Dispatch event for UI updates
  window.dispatchEvent(new Event('onlinePlaylistSongsChange'));
};

export const addOnlineSongToPlaylist = (playlistId: string, song: OnlineSongData): boolean => {
  const data = getOnlinePlaylistSongs();
  if (!data[playlistId]) {
    data[playlistId] = [];
  }
  
  // Check if song already exists
  if (data[playlistId].some(s => s.id === song.id)) {
    return false; // Already exists
  }
  
  data[playlistId].push({
    ...song,
    addedAt: Date.now()
  });
  
  saveOnlinePlaylistSongs(data);
  return true;
};

export const removeOnlineSongFromPlaylist = (playlistId: string, songId: string): void => {
  const data = getOnlinePlaylistSongs();
  if (data[playlistId]) {
    data[playlistId] = data[playlistId].filter(s => s.id !== songId);
    saveOnlinePlaylistSongs(data);
  }
};

export const getOnlineSongsForPlaylist = (playlistId: string): OnlinePlaylistSong[] => {
  const data = getOnlinePlaylistSongs();
  return data[playlistId] || [];
};

interface AddOnlineSongToPlaylistProp {
  song: OnlineSongData;
}

interface SelectablePlaylistProp extends Playlist {
  isChecked: boolean;
  onlineSongsCount: number;
  playlistCheckedStateUpdateFunc: (_state: boolean) => void;
}

const SelectablePlaylist = (props: SelectablePlaylistProp) => {
  const { t } = useTranslation();

  const { playlistId, artworkPaths, name, songs, onlineSongsCount, playlistCheckedStateUpdateFunc, isChecked } =
    props;

  const totalSongs = songs.length + onlineSongsCount;

  return (
    <div
      className={`playlist appear-from-bottom group ${playlistId} text-font-color-black dark:text-font-color-white mr-4 mb-6 flex h-52 w-[9.5rem] cursor-pointer flex-col justify-between rounded-xl p-4 transition-colors ${
        isChecked
          ? 'bg-font-color-highlight/30 ring-2 ring-font-color-highlight dark:bg-dark-font-color-highlight/30 dark:ring-dark-font-color-highlight'
          : 'hover:bg-background-color-2 dark:hover:bg-dark-background-color-2'
      }`}
      onClick={() => playlistCheckedStateUpdateFunc(!isChecked)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          playlistCheckedStateUpdateFunc(!isChecked);
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="playlist-cover-and-checkbox-container relative h-[70%] overflow-hidden">
        <Checkbox
          id={playlistId}
          checkedStateUpdateFunction={playlistCheckedStateUpdateFunc}
          isChecked={isChecked}
          className="absolute right-3 bottom-3 z-10 pointer-events-none"
        />
        <div className="playlist-cover-container h-full cursor-pointer overflow-hidden rounded-lg">
          <Img
            src={artworkPaths.artworkPath}
            alt="Playlist Cover"
            loading="lazy"
            className="h-full"
          />
        </div>
      </div>
      <div className="playlist-info-container">
        <div
          className="title playlist-title w-full overflow-hidden text-xl text-ellipsis whitespace-nowrap"
          title={name}
        >
          {name}
        </div>
        <div className="playlist-no-of-songs text-sm font-light">
          {totalSongs} {totalSongs === 1 ? 'canción' : 'canciones'}
          {onlineSongsCount > 0 && (
            <span className="text-font-color-highlight dark:text-dark-font-color-highlight ml-1">
              ({onlineSongsCount} online)
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

interface SelectPlaylist extends Playlist {
  isSelected: boolean;
  onlineSongsCount: number;
}

const AddOnlineSongToPlaylistPrompt = (props: AddOnlineSongToPlaylistProp) => {
  const { changePromptMenuData, addNewNotifications } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { song } = props;
  const { data: fetchedPlaylists } = useSuspenseQuery({
    ...playlistQuery.all({ sortType: 'aToZ' }),
    select: (data) => data.data
  });

  // Get online songs data
  const onlinePlaylistData = useMemo(() => getOnlinePlaylistSongs(), []);

  // State for creating new playlist - show full editor
  const [showPlaylistEditor, setShowPlaylistEditor] = useState(false);

  // Local state for playlists with selection tracking
  const [playlists, setPlaylists] = useState<SelectPlaylist[]>(() => 
    fetchedPlaylists.map(playlist => ({
      ...playlist,
      isSelected: false,
      onlineSongsCount: onlinePlaylistData[playlist.playlistId]?.length || 0
    }))
  );

  // Update local state when fetched playlists change
  useEffect(() => {
    const currentOnlineData = getOnlinePlaylistSongs();
    setPlaylists(prev => {
      const selectedIds = new Set(prev.filter(p => p.isSelected).map(p => p.playlistId));
      return fetchedPlaylists.map(playlist => ({
        ...playlist,
        isSelected: selectedIds.has(playlist.playlistId),
        onlineSongsCount: currentOnlineData[playlist.playlistId]?.length || 0
      }));
    });
  }, [fetchedPlaylists]);

  const handleCreateNewPlaylist = useCallback(() => {
    setShowPlaylistEditor(true);
  }, []);

  const addSongToPlaylists = useCallback(() => {
    const selectedPlaylists = playlists.filter((playlist) => playlist.isSelected);
    if (selectedPlaylists.length === 0) return;
    
    let addedCount = 0;
    let alreadyExistsCount = 0;
    
    selectedPlaylists.forEach((playlist) => {
      const added = addOnlineSongToPlaylist(playlist.playlistId, song);
      if (added) {
        addedCount++;
      } else {
        alreadyExistsCount++;
      }
    });

    if (addedCount > 0) {
      addNewNotifications([{
        id: 'onlineSongAddedToPlaylists',
        duration: 5000,
        iconName: 'playlist_add',
        content: `"${song.title}" agregada a ${addedCount} playlist${addedCount > 1 ? 's' : ''}`
      }]);
    }
    
    if (alreadyExistsCount > 0) {
      addNewNotifications([{
        id: 'onlineSongAlreadyExists',
        duration: 3000,
        iconName: 'info',
        content: `La canción ya existe en ${alreadyExistsCount} playlist${alreadyExistsCount > 1 ? 's' : ''}`
      }]);
    }

    changePromptMenuData(false);
  }, [playlists, song, addNewNotifications, changePromptMenuData]);

  const playlistComponents = useMemo(
    () =>
      playlists.length > 0
        ? playlists.map((playlist) => {
            return (
              <SelectablePlaylist
                name={playlist.name}
                createdDate={playlist.createdDate}
                playlistId={playlist.playlistId}
                songs={playlist.songs}
                artworkPaths={playlist.artworkPaths}
                isArtworkAvailable={playlist.isArtworkAvailable}
                isChecked={playlist.isSelected}
                onlineSongsCount={playlist.onlineSongsCount}
                playlistCheckedStateUpdateFunc={(state) => {
                  setPlaylists((prevData) => {
                    return prevData.map((data) => {
                      if (data.playlistId === playlist.playlistId)
                        return { ...data, isSelected: state };
                      return data;
                    });
                  });
                }}
                key={playlist.playlistId}
              />
            );
          })
        : [],
    [playlists]
  );

  const noOfSelectedPlaylists = useMemo(
    () => playlists.filter((playlist) => playlist.isSelected).length,
    [playlists]
  );

  // If showing playlist editor, render it instead
  if (showPlaylistEditor) {
    return (
      <Suspense fallback={<SuspenseLoader />}>
        <PlaylistEditor
          onPlaylistCreated={() => {
            setShowPlaylistEditor(false);
            queryClient.invalidateQueries({ queryKey: ['playlists'] });
          }}
        />
      </Suspense>
    );
  }

  return (
    <>
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 flex items-center pr-4 text-3xl font-medium">
        Agregar a playlist
      </div>
      
      {/* Song preview */}
      <div className="song-preview mb-4 flex items-center gap-3 rounded-lg bg-background-color-2 dark:bg-dark-background-color-2 p-3">
        <Img 
          src={song.artworkUrl} 
          className="h-12 w-12 rounded-md object-cover" 
          alt={song.title}
        />
        <div className="flex flex-col overflow-hidden">
          <span className="font-medium text-font-color-black dark:text-font-color-white truncate">
            {song.title}
          </span>
          <span className="text-sm text-font-color-dimmed dark:text-dark-font-color-dimmed truncate">
            {song.artist}
          </span>
        </div>
        <span className="ml-auto flex items-center gap-1 text-xs text-font-color-dimmed dark:text-dark-font-color-dimmed">
          <span className="material-icons-round text-sm">cloud</span>
          Online
        </span>
      </div>

      <div className="playlists-container mt-4 flex h-full flex-wrap">
        {playlistComponents}
        {/* Create new playlist button */}
        <div
          className="create-playlist-btn appear-from-bottom text-font-color-dimmed dark:text-dark-font-color-dimmed hover:text-font-color-highlight dark:hover:text-dark-font-color-highlight mr-4 mb-6 flex h-52 w-[9.5rem] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-font-color-dimmed/30 p-4 transition-colors hover:border-font-color-highlight dark:border-dark-font-color-dimmed/30 dark:hover:border-dark-font-color-highlight"
          onClick={handleCreateNewPlaylist}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleCreateNewPlaylist();
            }
          }}
          role="button"
          tabIndex={0}
          title="Crear nueva playlist"
        >
          <span className="material-icons-round text-5xl">add</span>
          <span className="mt-2 text-sm font-medium">Nueva Playlist</span>
        </div>
      </div>
      <div className="buttons-and-other-info-container flex items-center justify-end">
        <span className="text-font-color-highlight dark:text-dark-font-color-highlight mr-12">
          {noOfSelectedPlaylists} seleccionada{noOfSelectedPlaylists !== 1 ? 's' : ''}
        </span>
        <div className="buttons-container flex">
          <Button
            label="Cancelar"
            iconName="close"
            clickHandler={() => changePromptMenuData(false)}
          />
          <Button
            label="Agregar"
            iconName="playlist_add"
            clickHandler={addSongToPlaylists}
            className={`px-6 ${
              noOfSelectedPlaylists > 0
                ? 'bg-background-color-3! text-font-color-black dark:bg-dark-background-color-3! dark:text-font-color-black!'
                : 'opacity-50 cursor-not-allowed'
            }`}
            isDisabled={noOfSelectedPlaylists === 0}
          />
        </div>
      </div>
    </>
  );
};

export default AddOnlineSongToPlaylistPrompt;
