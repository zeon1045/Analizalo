/* eslint-disable promise/catch-or-return */

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';

import Checkbox from '../Checkbox';
import Button from '../Button';
import Img from '../Img';
import { useSuspenseQuery } from '@tanstack/react-query';
import { playlistQuery } from '@renderer/queries/playlists';
import { queryClient } from '@renderer/index';

interface AddSongsToPlaylistProp {
  songIds: string[];
  title?: string;
}

interface SelectablePlaylistProp extends Playlist {
  isChecked: boolean;
  playlistCheckedStateUpdateFunc: (_state: boolean) => void;
}

const SelectablePlaylist = (props: SelectablePlaylistProp) => {
  const { t } = useTranslation();

  const { playlistId, artworkPaths, name, songs, playlistCheckedStateUpdateFunc, isChecked } =
    props;

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
          {t('common.songWithCount', { count: songs.length })}
        </div>
      </div>
    </div>
  );
};

interface SelectPlaylist extends Playlist {
  isSelected: boolean;
}

const AddSongsToPlaylistsPrompt = (props: AddSongsToPlaylistProp) => {
  const { changePromptMenuData, addNewNotifications } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { songIds } = props;
  const { data: fetchedPlaylists } = useSuspenseQuery({
    ...playlistQuery.all({ sortType: 'aToZ' }),
    select: (data) => data.data
  });

  // Local state for playlists with selection tracking
  const [playlists, setPlaylists] = useState<SelectPlaylist[]>(() => 
    fetchedPlaylists.map(playlist => ({ ...playlist, isSelected: false }))
  );

  // Update local state when fetched playlists change
  useEffect(() => {
    setPlaylists(prev => {
      // Preserve selection state when playlists are refetched
      const selectedIds = new Set(prev.filter(p => p.isSelected).map(p => p.playlistId));
      return fetchedPlaylists.map(playlist => ({
        ...playlist,
        isSelected: selectedIds.has(playlist.playlistId)
      }));
    });
  }, [fetchedPlaylists]);

  const handleCreateNewPlaylist = useCallback(async () => {
    const playlistName = prompt(t('playlistsPage.enterPlaylistName') || 'Enter playlist name:');
    if (playlistName && playlistName.trim()) {
      try {
        await window.api.playlistsData.addNewPlaylist(playlistName.trim());
        // Invalidate playlist query to refetch
        queryClient.invalidateQueries({ queryKey: ['playlists'] });
        addNewNotifications([{
          id: 'playlistCreated',
          duration: 3000,
          iconName: 'playlist_add',
          content: `Playlist "${playlistName}" created`
        }]);
      } catch (error) {
        console.error('Failed to create playlist:', error);
        addNewNotifications([{
          id: 'playlistCreateError',
          duration: 3000,
          iconName: 'error',
          content: 'Failed to create playlist'
        }]);
      }
    }
  }, [t, addNewNotifications]);

  const addSongsToPlaylists = useCallback(() => {
    const selectedPlaylists = playlists.filter((playlist) => playlist.isSelected);
    if (selectedPlaylists.length === 0) return;
    
    const promises = selectedPlaylists.map(async (playlist) => {
      if (playlist.playlistId === 'Favorites')
        return window.api.playerControls
          .toggleLikeSongs(songIds, true)
          .catch((err) => console.error(err));
      return window.api.playlistsData
        .addSongsToPlaylist(playlist.playlistId, songIds)
        .catch((err) => console.error(err));
    });
    Promise.all(promises)
      .then((res) => {
        console.log(res);
        return addNewNotifications([
          {
            id: 'songAddedtoPlaylists',
            duration: 5000,
            iconName: 'playlist_add',
            content: t('addSongsToPlaylistsPrompt.songsAddedToPlaylists', {
              count: songIds.length,
              playlistCount: selectedPlaylists.length
            })
          }
        ]);
      })
      .catch((err) => console.error(err))
      .finally(() => {
        changePromptMenuData(false);
      });
  }, [playlists, songIds, addNewNotifications, t, changePromptMenuData]);

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

  return (
    <>
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 flex items-center pr-4 text-3xl font-medium">
        {t('addSongsToPlaylistsPrompt.selectPlaylistsToAdd', { count: songIds.length })}
      </div>
      {songIds.length > 1 && <p>&bull; {t('addSongsToPlaylistsPrompt.duplicationNotice')}</p>}
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
          title={t('playlistsPage.newPlaylist') || 'Crear nueva playlist'}
        >
          <span className="material-icons-round text-5xl">add</span>
          <span className="mt-2 text-sm font-medium">Nueva Playlist</span>
        </div>
      </div>
      <div className="buttons-and-other-info-container flex items-center justify-end">
        <span className="text-font-color-highlight dark:text-dark-font-color-highlight mr-12">
          {t('common.selectionWithCount', { count: noOfSelectedPlaylists })}
        </span>
        <div className="buttons-container flex">
          <Button
            label="Cancel"
            iconName="close"
            clickHandler={() => changePromptMenuData(false)}
          />
          <Button
            label={t('song.addToPlaylists')}
            iconName="playlist_add"
            clickHandler={addSongsToPlaylists}
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

export default AddSongsToPlaylistsPrompt;
