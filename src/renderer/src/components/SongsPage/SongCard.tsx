/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { lazy, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';

import Img from '../Img';
import MultipleSelectionCheckbox from '../MultipleSelectionCheckbox';
import SongArtist from './SongArtist';
import Button from '../Button';

const AddSongsToPlaylistsPrompt = lazy(() => import('./AddSongsToPlaylistsPrompt'));
const BlacklistSongConfrimPrompt = lazy(() => import('./BlacklistSongConfirmPrompt'));
const DeleteSongsFromSystemConfrimPrompt = lazy(
  () => import('./DeleteSongsFromSystemConfrimPrompt')
);

import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';
import { useStore } from '@tanstack/react-store';
import { store } from '../../store/store';
import { useNavigate } from '@tanstack/react-router';
import NavLink from '../NavLink';

interface SongCardProp {
  index: number;
  songId: string;
  artworkPath: string;
  path: string;
  title: string;
  artists?: { name: string; artistId: string }[];
  album?: { name: string; albumId: string };
  palette?: NodeVibrantPalette;
  isAFavorite: boolean;
  className?: string;
  isBlacklisted: boolean;
  selectAllHandler?: (_upToId?: string) => void;
}

const SongCard = (props: SongCardProp) => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const queue = useStore(store, (state) => state.localStorage.queue);
  const doNotShowBlacklistSongConfirm = useStore(
    store,
    (state) => state.localStorage.preferences.doNotShowBlacklistSongConfirm
  );
  const isCurrentSongPlaying = useStore(store, (state) => state.player.isCurrentSongPlaying);
  const isMultipleSelectionEnabled = useStore(
    store,
    (state) => state.multipleSelectionsData.isEnabled
  );
  const multipleSelectionsData = useStore(store, (state) => state.multipleSelectionsData);

  const {
    playSong,
    updateContextMenuData,
    updateQueueData,
    addNewNotifications,
    changePromptMenuData,
    toggleIsFavorite,
    toggleMultipleSelections,
    updateMultipleSelections,
    createQueue
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();
  const navigate = useNavigate();

  const {
    title,
    artworkPath,
    index,
    isAFavorite,
    path,
    songId,
    artists,
    album,
    className,
    isBlacklisted,
    palette,
    selectAllHandler
  } = props;

  const [isSongAFavorite, setIsSongAFavorite] = useState(
    songId === currentSongData.songId ? currentSongData.isAFavorite : isAFavorite
  );
  const [isSongPlaying, setIsSongPlaying] = useState(
    currentSongData ? currentSongData.songId === songId && isCurrentSongPlaying : false
  );
  useEffect(() => {
    setIsSongPlaying(() => {
      if (currentSongData) return currentSongData.songId === songId && isCurrentSongPlaying;
      return false;
    });
    setIsSongAFavorite((prevState) => {
      if (currentSongData?.songId === songId) return currentSongData.isAFavorite;
      return prevState;
    });
  }, [currentSongData, isCurrentSongPlaying, songId]);

  const handlePlayBtnClick = useCallback(() => {
    playSong(songId);
  }, [playSong, songId]);

  const isAMultipleSelection = useMemo(() => {
    if (!multipleSelectionsData.isEnabled) return false;
    if (multipleSelectionsData.selectionType !== 'songs') return false;
    if (multipleSelectionsData.multipleSelections.length <= 0) return false;
    if (multipleSelectionsData.multipleSelections.some((selectionId) => selectionId === songId))
      return true;
    return false;
  }, [multipleSelectionsData, songId]);

  const contextMenuItemData =
    isMultipleSelectionEnabled &&
    multipleSelectionsData.selectionType === 'songs' &&
    isAMultipleSelection
      ? {
          title: t('song.selectedSongCount', {
            count: multipleSelectionsData.multipleSelections.length
          }),
          artworkPath: DefaultSongCover
        }
      : {
          title: title || t('common.unknownTitle'),
          subTitle: artists?.map((artist) => artist.name).join(', ') ?? t('common.unknownArtist'),
          artworkPath
        };

  const handleLikeButtonClick = useCallback(() => {
    window.api.playerControls
      .toggleLikeSongs([songId], !isSongAFavorite)
      .then((res) => {
        if (res && res.likes.length + res.dislikes.length > 0) {
          if (currentSongData.songId === songId)
            toggleIsFavorite(!currentSongData.isAFavorite, true);
          return setIsSongAFavorite((prevData) => !prevData);
        }
        return undefined;
      })
      .catch((err) => console.error(err));
  }, [
    currentSongData.isAFavorite,
    currentSongData.songId,
    isSongAFavorite,
    songId,
    toggleIsFavorite
  ]);

  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    const isMultipleSelectionsEnabled =
      multipleSelectionsData.selectionType === 'songs' &&
      multipleSelectionsData.multipleSelections.length !== 1 &&
      isAMultipleSelection;

    const { multipleSelections: songIds } = multipleSelectionsData;

    const items: ContextMenuItem[] = [
      {
        label: t('common.play'),
        handlerFunction: () => {
          handlePlayBtnClick();
          toggleMultipleSelections(false);
        },
        iconName: 'play_arrow',
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('common.createAQueue'),
        handlerFunction: () => {
          createQueue(songIds, 'songs', false, undefined, true);
          toggleMultipleSelections(false);
        },
        iconName: 'queue_music',
        isDisabled: !isMultipleSelectionsEnabled
      },

      {
        label: t(`common.${isMultipleSelectionsEnabled ? 'playNextAll' : 'playNext'}`),
        iconName: 'shortcut',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) {
            let currentSongIndex =
              queue.currentSongIndex ?? queue.queue.indexOf(currentSongData.songId);
            const duplicateIds: string[] = [];

            const newQueue = queue.queue.filter((id) => {
              const isADuplicate = songIds.includes(id);
              if (isADuplicate) duplicateIds.push(id);

              return !isADuplicate;
            });

            for (const duplicateId of duplicateIds) {
              const duplicateIdPosition = queue.queue.indexOf(duplicateId);

              if (
                duplicateIdPosition !== -1 &&
                duplicateIdPosition < currentSongIndex &&
                currentSongIndex - 1 >= 0
              )
                currentSongIndex -= 1;
            }

            newQueue.splice(currentSongIndex + 1, 0, ...songIds);

            updateQueueData(currentSongIndex, newQueue, undefined, false);
            addNewNotifications([
              {
                id: `${title}PlayNext`,
                content: t('notifications.playingNextSongsWithCount', {
                  count: songIds.length
                }),
                iconName: 'shortcut'
              }
            ]);
          } else {
            const newQueue = queue.queue.filter((id) => id !== songId);
            newQueue.splice(newQueue.indexOf(currentSongData.songId) + 1 || 0, 0, songId);

            const duplicateSongIndex = queue.queue.indexOf(songId);

            const currentSongIndex =
              queue.currentSongIndex &&
              duplicateSongIndex !== -1 &&
              duplicateSongIndex < queue.currentSongIndex
                ? queue.currentSongIndex - 1
                : undefined;

            updateQueueData(currentSongIndex, newQueue, undefined, false);
            addNewNotifications([
              {
                id: `${title}PlayNext`,
                content: t('notifications.playingNext', { title }),
                iconName: 'shortcut'
              }
            ]);
          }
          toggleMultipleSelections(false);
        }
      },
      {
        label: t('common.addToQueue'),
        iconName: 'queue',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) {
            updateQueueData(undefined, [...queue.queue, ...songIds], false);
            addNewNotifications([
              {
                id: `${songIds.length}AddedToQueueFromMultiSelection`,
                content: t('notifications.addedToQueue', {
                  count: songIds.length
                }),
                iconName: 'add'
              }
            ]);
          } else {
            updateQueueData(undefined, [...queue.queue, songId], false);
            addNewNotifications([
              {
                id: `${title}AddedToQueue`,
                content: t('notifications.addedToQueue', {
                  count: 1
                }),
                icon: <Img src={artworkPath} loading="lazy" alt="Song Artwork" />
              }
            ]);
          }
          toggleMultipleSelections(false);
        }
      },
      {
        label: isMultipleSelectionsEnabled
          ? t('song.toggleLikeSongs')
          : t(`song.${isSongAFavorite ? 'unlikeSong' : 'likeSong'}`),
        iconName: `favorite`,
        iconClassName: isMultipleSelectionsEnabled
          ? 'material-icons-round-outlined mr-4 text-xl'
          : isSongAFavorite
            ? 'material-icons-round mr-4 text-xl'
            : 'material-icons-round-outlined mr-4 text-xl',
        handlerFunction: () => {
          window.api.playerControls
            .toggleLikeSongs(isMultipleSelectionsEnabled ? [...songIds] : [songId])
            .then((res) => {
              if (res && res.likes.length + res.dislikes.length > 0) {
                if (isMultipleSelectionsEnabled) {
                  for (let i = 0; i < songIds.length; i += 1) {
                    const id = songIds[i];
                    if (currentSongData.songId === id)
                      toggleIsFavorite(!currentSongData.isAFavorite);
                    if (id === songId) setIsSongAFavorite((prevState) => !prevState);
                  }
                } else {
                  if (currentSongData.songId === songId)
                    toggleIsFavorite(!currentSongData.isAFavorite);
                  return setIsSongAFavorite((prevData) => !prevData);
                }
              }
              return undefined;
            })
            .catch((err) => console.error(err));
          toggleMultipleSelections(false);
        }
      },
      {
        label: t('song.addToPlaylists'),
        iconName: 'playlist_add',
        handlerFunction: () => {
          changePromptMenuData(
            true,
            <AddSongsToPlaylistsPrompt
              songIds={isAMultipleSelection ? songIds : [songId]}
              title={title}
            />
          );
          toggleMultipleSelections(false);
        }
      },
      {
        label: t(`common.${isAMultipleSelection ? 'unselect' : 'select'}`),
        iconName: 'checklist',
        handlerFunction: () => {
          if (isMultipleSelectionEnabled) {
            return updateMultipleSelections(
              songId,
              'songs',
              isAMultipleSelection ? 'remove' : 'add'
            );
          }
          return toggleMultipleSelections(!isAMultipleSelection, 'songs', [songId]);
        }
      },
      // {
      //   label: 'Select/Unselect All',
      //   iconName: 'checklist',
      //   isDisabled: !selectAllHandler,
      //   handlerFunction: () => selectAllHandler && selectAllHandler(),
      // },
      {
        label: 'Hr',
        isContextMenuItemSeperator: true,
        handlerFunction: () => true,
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('song.showInFileExplorer'),
        class: 'reveal-file-explorer',
        iconName: 'folder_open',
        handlerFunction: () => window.api.songUpdates.revealSongInFileExplorer(songId),
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('common.info'),
        class: 'info',
        iconName: 'info',
        handlerFunction: () => navigate({ to: '/main-player/songs/$songId', params: { songId } }),
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('song.goToAlbum'),
        iconName: 'album',
        handlerFunction: () =>
          album &&
          navigate({
            to: '/main-player/albums/$albumId',
            params: { albumId: album.albumId }
          }),
        isDisabled: !album
      },
      {
        label: t('song.editSongTags'),
        class: 'edit',
        iconName: 'edit',
        handlerFunction: () => {
          // TODO: Implement song tags editor page navigation
          // changeCurrentActivePage('SongTagsEditor', {
          //   songId,
          //   songArtworkPath: artworkPath,
          //   songPath: path
          // });
        },
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('song.reparseSong'),
        class: 'sync',
        iconName: 'sync',
        handlerFunction: () => window.api.songUpdates.reParseSong(path),
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: 'Hr',
        isContextMenuItemSeperator: true,
        handlerFunction: () => true,
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t(`song.${isBlacklisted ? 'deblacklist' : 'blacklistSong'}`, {
          count: 1
        }),
        iconName: isBlacklisted ? 'settings_backup_restore' : 'block',
        handlerFunction: () => {
          if (isBlacklisted)
            window.api.audioLibraryControls
              .restoreBlacklistedSongs([songId])
              .catch((err) => console.error(err));
          else if (doNotShowBlacklistSongConfirm)
            window.api.audioLibraryControls
              .blacklistSongs([songId])
              .then(() =>
                addNewNotifications([
                  {
                    id: `${title}Blacklisted`,
                    duration: 5000,
                    content: t('notifications.songBlacklisted', { title }),
                    iconName: 'block'
                  }
                ])
              )
              .catch((err) => console.error(err));
          else
            changePromptMenuData(
              true,
              <BlacklistSongConfrimPrompt title={title} songIds={[songId]} />
            );
          return toggleMultipleSelections(false);
        },
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('song.delete'),
        iconName: 'delete',
        handlerFunction: () => {
          changePromptMenuData(
            true,
            <DeleteSongsFromSystemConfrimPrompt
              songIds={isMultipleSelectionsEnabled ? songIds : [songId]}
            />
          );
          toggleMultipleSelections(false);
        }
      }
    ];
    return items;
  }, [
    multipleSelectionsData,
    isAMultipleSelection,
    t,
    isSongAFavorite,
    album,
    isBlacklisted,
    handlePlayBtnClick,
    toggleMultipleSelections,
    createQueue,
    queue.position,
    queue.songIds,
    currentSongData.songId,
    currentSongData.isAFavorite,
    updateQueueData,
    addNewNotifications,
    title,
    songId,
    artworkPath,
    toggleIsFavorite,
    changePromptMenuData,
    isMultipleSelectionEnabled,
    updateMultipleSelections,
    navigate,
    path,
    doNotShowBlacklistSongConfirm
  ]);

  const songArtistComponents = useMemo(() => {
    if (Array.isArray(artists) && artists.length > 0) {
      return artists
        .map((artist, i) => {
          const arr = [
            <SongArtist
              key={artist.artistId}
              artistId={artist.artistId}
              name={artist.name}
              className="text-font-color-highlight/70 dark:text-dark-font-color-highlight/70 hover:underline"
            />
          ];

          if ((artists?.length ?? 1) - 1 !== i)
            arr.push(
              <span className="mr-1 text-font-color-highlight/70 dark:text-dark-font-color-highlight/70" key={`${artists[i].name}=>${artists[i + 1].name}`}>
                ,
              </span>
            );

          return arr;
        })
        .flat();
    }
    return <span className="text-xs font-normal">{t('common.unknownArtist')}</span>;
  }, [artists, t]);

  return (
    <div
      style={{
        animationDelay: `${50 * (index + 1)}ms`
      }}
      className={`song song-card appear-from-bottom ${songId} ${
        currentSongData.songId === songId && 'current-song'
      } ${
        isSongPlaying && 'playing'
      } group/songCard relative flex flex-col overflow-hidden rounded-2xl p-2 transition-colors hover:bg-background-color-2/50 dark:hover:bg-dark-background-color-2/50 ${
        className || ''
      } ${
        isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'songs' && 'border-2 border-transparent'
      } ${
        isAMultipleSelection &&
        '!border-font-color-highlight dark:!border-dark-font-color-highlight bg-background-color-2/50 dark:bg-dark-background-color-2/50'
      }`}
      data-song-id={songId}
      onDoubleClick={handlePlayBtnClick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        updateContextMenuData(true, contextMenuItems, e.pageX, e.pageY, contextMenuItemData);
      }}
      onClick={(e) => {
        e.preventDefault();
        if (e.getModifierState('Shift') === true && selectAllHandler) selectAllHandler(songId);
        else if (e.getModifierState('Control') === true && !isMultipleSelectionEnabled)
          toggleMultipleSelections(!isAMultipleSelection, 'songs', [songId]);
        else if (isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'songs')
          updateMultipleSelections(songId, 'songs', isAMultipleSelection ? 'remove' : 'add');
      }}
      title={isBlacklisted ? `'${title}' is blacklisted.` : undefined}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-xl shadow-md">
        <Img
          src={artworkPath}
          loading="eager"
          alt="Song cover"
          className={`h-full w-full object-cover object-center transition-[filter] ${
            isBlacklisted && 'brightness-50! dark:brightness-[.40]!'
          }`}
          enableImgFadeIns={!isMultipleSelectionEnabled}
        />
        
        {/* Play Button Overlay */}
        <div className={`absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover/songCard:opacity-100 ${isSongPlaying ? 'opacity-100' : ''}`}>
            {isMultipleSelectionEnabled ? (
              multipleSelectionsData.selectionType === 'songs' && (
                <MultipleSelectionCheckbox id={songId} selectionType="songs" />
              )
            ) : (
              <Button
                className="!m-0 !rounded-full !border-0 bg-background-color-1/80 !p-2 backdrop-blur-sm hover:bg-background-color-1 dark:bg-dark-background-color-1/80 dark:hover:bg-dark-background-color-1"
                iconName={isSongPlaying ? 'pause' : 'play_arrow'}
                iconClassName="text-3xl text-font-color-highlight dark:text-dark-font-color-highlight"
                clickHandler={(e) => {
                  e.stopPropagation();
                  handlePlayBtnClick();
                }}
              />
            )}
        </div>

        {/* Favorite Button (Top Right) */}
        <div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover/songCard:opacity-100">
             <Button
              className="!m-0 !rounded-full !border-0 bg-black/20 !p-1.5 backdrop-blur-sm hover:bg-black/40"
              iconName="favorite"
              iconClassName={`${
                isSongAFavorite ? 'material-icons-round text-red-500' : 'material-icons-round-outlined text-white'
              } !text-xl !leading-none`}
              tooltipLabel={isSongAFavorite ? t('song.likedThisSong') : undefined}
              clickHandler={(e) => {
                e.stopPropagation();
                handleLikeButtonClick();
              }}
            />
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1 px-1">
        <div className="flex items-center justify-between">
            <NavLink
              to="/main-player/songs/$songId"
              params={{ songId }}
              preload={isMultipleSelectionEnabled ? false : undefined}
              className={`truncate text-base font-semibold text-font-color-highlight dark:text-dark-font-color-highlight hover:underline focus-visible:outline!`}
              title={title}
              tabIndex={0}
              disabled={isMultipleSelectionEnabled}
            >
              {title}
            </NavLink>
        </div>
        <div
          className="truncate text-sm text-font-color-highlight/70 dark:text-dark-font-color-highlight/70"
          title={artists ? artists.map((x) => x.name).join(', ') : t('common.unknownArtist')}
        >
          {songArtistComponents}
        </div>
      </div>
    </div>
  );
};

export default SongCard;
