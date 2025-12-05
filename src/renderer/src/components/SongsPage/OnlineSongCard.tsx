import { useCallback, useContext, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import Img from '../Img';
import Button from '../Button';
import { onlineQueueManager } from '@renderer/other/onlineQueueManager';
import type { OnlinePlaylistSong } from './AddOnlineSongToPlaylistPrompt';

interface OnlineSongCardProps {
  index: number;
  song: OnlinePlaylistSong;
  className?: string;
}

const OnlineSongCard = (props: OnlineSongCardProps) => {
  const { song, index, className } = props;
  const { updateContextMenuData, addNewNotifications } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    const unsubscribe = onlineQueueManager.onSongChange((currentSong) => {
      setIsPlaying(currentSong?.id === song.id);
      if (currentSong?.id === song.id) setIsLoading(false);
    });
    return unsubscribe;
  }, [song.id]);

  const handlePlay = useCallback(async () => {
    setIsLoading(true);
    try {
      await onlineQueueManager.playSingle({
        ...song,
        playlistId: 'online-search',
        playlistName: 'Online Search'
      });
    } catch (error) {
      console.error('Play failed:', error);
      setIsLoading(false);
    }
  }, [song]);

  const handleDownload = useCallback(async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    
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
      setIsDownloading(false);
    }
  }, [song, isDownloading, addNewNotifications]);

  const contextMenuItems = [
    {
      label: t('common.play'),
      iconName: 'play_arrow',
      handlerFunction: handlePlay
    },
    {
      label: isDownloading ? 'Descargando...' : 'Descargar',
      iconName: isDownloading ? 'downloading' : 'download',
      handlerFunction: handleDownload,
      isDisabled: isDownloading
    }
  ];

  return (
    <div
      style={{ animationDelay: `${50 * (index + 1)}ms` }}
      className={`song song-card appear-from-bottom group/songCard relative flex flex-col overflow-hidden rounded-2xl p-2 transition-colors hover:bg-background-color-2/50 dark:hover:bg-dark-background-color-2/50 ${className || ''} ${isPlaying ? 'bg-background-color-2/50 dark:bg-dark-background-color-2/50' : ''}`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        updateContextMenuData(true, contextMenuItems, e.pageX, e.pageY);
      }}
      onDoubleClick={handlePlay}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-xl shadow-md">
        <Img
          src={song.artworkUrl}
          loading="eager"
          alt={song.title}
          className="h-full w-full object-cover object-center transition-[filter]"
        />
        
        {/* Play Button Overlay */}
        <div className={`absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover/songCard:opacity-100 ${isPlaying ? 'opacity-100' : ''}`}>
          <Button
            className="!m-0 !rounded-full !border-0 bg-background-color-1/80 !p-2 backdrop-blur-sm hover:bg-background-color-1 dark:bg-dark-background-color-1/80 dark:hover:bg-dark-background-color-1"
            iconName={isLoading ? 'hourglass_empty' : isPlaying ? 'pause' : 'play_arrow'}
            iconClassName="text-3xl text-font-color-highlight dark:text-dark-font-color-highlight"
            clickHandler={(e) => {
              e.stopPropagation();
              handlePlay();
            }}
          />
        </div>

        {/* Online Indicator (Top Right) */}
        <div className="absolute top-2 right-2 rounded-full bg-black/40 p-1 backdrop-blur-sm">
          <span className="material-icons-round text-white text-sm">cloud</span>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-1 px-1">
        <div className="flex items-center justify-between">
          <span className="truncate text-base font-semibold text-font-color-highlight dark:text-dark-font-color-highlight" title={song.title}>
            {song.title}
          </span>
        </div>
        <div className="truncate text-sm text-font-color-highlight/70 dark:text-dark-font-color-highlight/70" title={song.artist}>
          {song.artist}
        </div>
      </div>
    </div>
  );
};

export default OnlineSongCard;
