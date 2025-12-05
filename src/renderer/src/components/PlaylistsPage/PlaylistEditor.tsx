/* eslint-disable jsx-a11y/no-autofocus */
import { useCallback, useContext, useMemo, useState } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { songQuery } from '../../queries/songs';
import { queryClient } from '../../index';

import Button from '../Button';
import Img from '../Img';
import Checkbox from '../Checkbox';

import PlaylistDefaultCover from '../../assets/images/webp/playlist_cover_default.webp';

// Import preset icons
import icon1 from '../../assets/images/playlist-icons/icono1.png';
import icon2 from '../../assets/images/playlist-icons/icono2.png';
import icon3 from '../../assets/images/playlist-icons/icono3.png';
import icon4 from '../../assets/images/playlist-icons/icono4.png';
import icon5 from '../../assets/images/playlist-icons/icono5.png';
import icon6 from '../../assets/images/playlist-icons/icono6.png';
import icon7 from '../../assets/images/playlist-icons/icono7.png';
import icon8 from '../../assets/images/playlist-icons/icono8.png';
import icon9 from '../../assets/images/playlist-icons/icono9.png';
import img1 from '../../assets/images/playlist-icons/img1.png';
import img2 from '../../assets/images/playlist-icons/img2.png';
import img3 from '../../assets/images/playlist-icons/img3.png';
import img4 from '../../assets/images/playlist-icons/img4.png';
import img5 from '../../assets/images/playlist-icons/img5.png';
import img6 from '../../assets/images/playlist-icons/img6.png';
import img7 from '../../assets/images/playlist-icons/img7.png';
import img8 from '../../assets/images/playlist-icons/img8.png';
import img9 from '../../assets/images/playlist-icons/img9.png';
import img10 from '../../assets/images/playlist-icons/img10.png';
import img11 from '../../assets/images/playlist-icons/img11.png';
import img12 from '../../assets/images/playlist-icons/img12.png';
import img13 from '../../assets/images/playlist-icons/img13.png';
import img14 from '../../assets/images/playlist-icons/img14.png';
import img15 from '../../assets/images/playlist-icons/img15.png';
import img16 from '../../assets/images/playlist-icons/img16.png';
import img17 from '../../assets/images/playlist-icons/img17.png';
import img18 from '../../assets/images/playlist-icons/img18.png';
import img19 from '../../assets/images/playlist-icons/img19.png';

// Map of preset icon display paths to their file names
const PRESET_ICONS_MAP: { displayPath: string; fileName: string }[] = [
  { displayPath: icon1, fileName: 'icono1.png' },
  { displayPath: icon2, fileName: 'icono2.png' },
  { displayPath: icon3, fileName: 'icono3.png' },
  { displayPath: icon4, fileName: 'icono4.png' },
  { displayPath: icon5, fileName: 'icono5.png' },
  { displayPath: icon6, fileName: 'icono6.png' },
  { displayPath: icon7, fileName: 'icono7.png' },
  { displayPath: icon8, fileName: 'icono8.png' },
  { displayPath: icon9, fileName: 'icono9.png' },
  { displayPath: img1, fileName: 'img1.png' },
  { displayPath: img2, fileName: 'img2.png' },
  { displayPath: img3, fileName: 'img3.png' },
  { displayPath: img4, fileName: 'img4.png' },
  { displayPath: img5, fileName: 'img5.png' },
  { displayPath: img6, fileName: 'img6.png' },
  { displayPath: img7, fileName: 'img7.png' },
  { displayPath: img8, fileName: 'img8.png' },
  { displayPath: img9, fileName: 'img9.png' },
  { displayPath: img10, fileName: 'img10.png' },
  { displayPath: img11, fileName: 'img11.png' },
  { displayPath: img12, fileName: 'img12.png' },
  { displayPath: img13, fileName: 'img13.png' },
  { displayPath: img14, fileName: 'img14.png' },
  { displayPath: img15, fileName: 'img15.png' },
  { displayPath: img16, fileName: 'img16.png' },
  { displayPath: img17, fileName: 'img17.png' },
  { displayPath: img18, fileName: 'img18.png' },
  { displayPath: img19, fileName: 'img19.png' }
];

type TabType = 'icons' | 'covers' | 'library';
type IconSourceType = 'preset' | 'cover' | 'custom' | null;

// Helper to extract real file path from nora:// URL
const extractRealPath = (noraUrl: string): string => {
  return noraUrl
    .replace(/^nora:\/\/localfiles\/?/, '')
    .replace(/\?ts=\d+$/, '');
};

interface PlaylistEditorProps {
  // For editing existing playlist
  existingPlaylist?: Playlist;
  onPlaylistCreated?: () => void;
  onPlaylistUpdated?: () => void;
}

const PlaylistEditor = (props: PlaylistEditorProps) => {
  const { existingPlaylist, onPlaylistCreated, onPlaylistUpdated } = props;
  const { changePromptMenuData, addNewNotifications } = useContext(AppUpdateContext);

  const isEditMode = !!existingPlaylist;

  // State - songs is a string array in Playlist type
  const [playlistName, setPlaylistName] = useState(existingPlaylist?.name || '');
  const [selectedIconDisplay, setSelectedIconDisplay] = useState<string | null>(
    existingPlaylist?.artworkPaths?.artworkPath || null
  );
  const [selectedPresetFileName, setSelectedPresetFileName] = useState<string | null>(null);
  const [customIconPath, setCustomIconPath] = useState<string | null>(null);
  const [iconSourceType, setIconSourceType] = useState<IconSourceType>(null);
  const [activeTab, setActiveTab] = useState<TabType>('icons');
  const [selectedSongIds, setSelectedSongIds] = useState<Set<string>>(
    new Set(existingPlaylist?.songs || [])
  );
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch all songs from library
  const { data: allSongsResult } = useSuspenseQuery(
    songQuery.all({ sortType: 'aToZ', start: 0, end: 10000 })
  );

  const allSongs = useMemo(() => {
    if (!allSongsResult?.data) return [];
    return allSongsResult.data.map((song) => ({
      songId: String(song.songId),
      title: song.title,
      artists: song.artists || [],
      artworkPath: song.artworkPaths?.artworkPath,
      isSelected: selectedSongIds.has(String(song.songId))
    }));
  }, [allSongsResult, selectedSongIds]);

  // Filter songs by search
  const filteredSongs = useMemo(() => {
    if (!searchQuery.trim()) return allSongs;
    const query = searchQuery.toLowerCase();
    return allSongs.filter(
      song =>
        song.title.toLowerCase().includes(query) ||
        song.artists.some(a => a.name.toLowerCase().includes(query))
    );
  }, [allSongs, searchQuery]);

  // Get unique artwork paths for covers tab
  const uniqueCovers = useMemo(() => {
    const covers = new Set<string>();
    allSongs.forEach(song => {
      if (song.artworkPath) {
        covers.add(song.artworkPath);
      }
    });
    return Array.from(covers);
  }, [allSongs]);

  // Handle icon selection from file system
  const handleSelectCustomIcon = useCallback(async () => {
    try {
      const result = await window.api.songUpdates.getImgFileLocation();
      if (result) {
        setCustomIconPath(result);
        setSelectedIconDisplay(`nora://localfiles/${result}`);
        setIconSourceType('custom');
        setSelectedPresetFileName(null);
      }
    } catch (error) {
      console.error('Error selecting icon:', error);
    }
  }, []);

  // Handle preset icon selection
  const handleSelectPresetIcon = useCallback((displayPath: string, fileName: string) => {
    setSelectedIconDisplay(displayPath);
    setSelectedPresetFileName(fileName);
    setIconSourceType('preset');
    setCustomIconPath(null);
  }, []);

  // Handle cover selection from library
  const handleSelectCover = useCallback((coverPath: string) => {
    // coverPath from song already has nora://localfiles/ prefix, use it directly for display
    setSelectedIconDisplay(coverPath);
    // Extract the real file path for saving to backend
    setCustomIconPath(extractRealPath(coverPath));
    setIconSourceType('cover');
    setSelectedPresetFileName(null);
  }, []);

  // Toggle song selection
  const toggleSongSelection = useCallback((songId: string) => {
    setSelectedSongIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(songId)) {
        newSet.delete(songId);
      } else {
        newSet.add(songId);
      }
      return newSet;
    });
  }, []);

  // Select/Deselect all songs
  const selectAllSongs = useCallback(() => {
    setSelectedSongIds(new Set(filteredSongs.map(s => s.songId)));
  }, [filteredSongs]);

  const deselectAllSongs = useCallback(() => {
    setSelectedSongIds(new Set());
  }, []);

  // Create or Update playlist
  const handleSave = useCallback(async () => {
    if (!playlistName.trim()) {
      addNewNotifications([{
        id: 'playlistNameEmpty',
        duration: 3000,
        iconName: 'error',
        content: 'El nombre de la playlist no puede estar vacío'
      }]);
      return;
    }

    try {
      const songIds = Array.from(selectedSongIds);
      
      // Determine artwork path based on icon source type
      let artworkPath: string | undefined;
      
      if (iconSourceType === 'preset' && selectedPresetFileName) {
        // For preset icons, get the real path from the main process
        const realPath = await window.api.playlistsData.getPlaylistPresetIconPath(selectedPresetFileName);
        if (realPath) {
          artworkPath = realPath;
        }
      } else if (iconSourceType === 'cover' || iconSourceType === 'custom') {
        // For covers and custom icons, use the path directly
        artworkPath = customIconPath || undefined;
      }
      
      if (isEditMode && existingPlaylist) {
        // Update existing playlist
        // First rename if needed
        if (playlistName !== existingPlaylist.name) {
          await window.api.playlistsData.renameAPlaylist(
            existingPlaylist.playlistId,
            playlistName.trim()
          );
        }

        // Update artwork if changed
        if (artworkPath) {
          await window.api.playlistsData.addArtworkToAPlaylist(
            existingPlaylist.playlistId,
            artworkPath
          );
        }

        // Update songs - remove old ones and add new ones
        const existingSongIds = new Set<string>(existingPlaylist.songs || []);
        const newSongIds = new Set<string>(songIds);

        // Songs to remove (keep as strings for the API)
        const songsToRemove = Array.from(existingSongIds).filter(id => !newSongIds.has(id));
        for (const songId of songsToRemove) {
          await window.api.playlistsData.removeSongFromPlaylist(
            existingPlaylist.playlistId,
            songId
          );
        }

        // Songs to add (filter only new ones)
        const songsToAdd = songIds.filter(id => !existingSongIds.has(id));
        if (songsToAdd.length > 0) {
          await window.api.playlistsData.addSongsToPlaylist(
            existingPlaylist.playlistId,
            songsToAdd
          );
        }

        addNewNotifications([{
          id: 'playlistUpdated',
          duration: 3000,
          iconName: 'check',
          content: `Playlist "${playlistName}" actualizada`
        }]);

        onPlaylistUpdated?.();
      } else {
        // Create new playlist
        const result = await window.api.playlistsData.addNewPlaylist(
          playlistName.trim(),
          songIds.length > 0 ? songIds : undefined,
          artworkPath
        );

        // If we have a preset icon and the playlist was created, update the artwork
        if (result.success && result.playlist && artworkPath) {
          // Artwork is already set via addNewPlaylist
        }

        addNewNotifications([{
          id: 'playlistCreated',
          duration: 3000,
          iconName: 'playlist_add',
          content: `Playlist "${playlistName}" creada`
        }]);

        onPlaylistCreated?.();
      }

      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      changePromptMenuData(false);
    } catch (error) {
      console.error('Error saving playlist:', error);
      addNewNotifications([{
        id: 'playlistSaveError',
        duration: 3000,
        iconName: 'error',
        content: 'Error al guardar la playlist'
      }]);
    }
  }, [
    playlistName,
    selectedSongIds,
    customIconPath,
    selectedPresetFileName,
    iconSourceType,
    isEditMode,
    existingPlaylist,
    addNewNotifications,
    changePromptMenuData,
    onPlaylistCreated,
    onPlaylistUpdated
  ]);

  // Get display icon
  const displayIcon = useMemo(() => {
    if (selectedIconDisplay) {
      return selectedIconDisplay;
    }
    return PlaylistDefaultCover;
  }, [selectedIconDisplay]);

  return (
    <div className="playlist-editor flex flex-col w-full max-w-4xl max-h-[80vh]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-font-color-highlight dark:text-dark-font-color-highlight">
          {isEditMode ? 'Editar Playlist' : 'Nueva Playlist'}
        </h2>
        <button
          onClick={() => changePromptMenuData(false)}
          className="text-font-color-dimmed hover:text-font-color-black dark:text-dark-font-color-dimmed dark:hover:text-font-color-white"
        >
          <span className="material-icons-round text-2xl">close</span>
        </button>
      </div>

      {/* Main content */}
      <div className="flex gap-6 flex-1 min-h-0">
        {/* Left side - Preview and Name */}
        <div className="flex flex-col items-center w-48 shrink-0">
          <div className="relative w-40 h-40 mb-4">
            <Img
              src={displayIcon}
              alt="Playlist cover"
              className="w-full h-full object-cover rounded-xl shadow-lg"
            />
            <button
              onClick={handleSelectCustomIcon}
              className="absolute -right-2 -bottom-2 w-10 h-10 bg-font-color-highlight dark:bg-dark-font-color-highlight rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform"
              title="Seleccionar imagen desde PC"
            >
              <span className="material-icons-round text-font-color-black text-xl">edit</span>
            </button>
          </div>

          <input
            type="text"
            value={playlistName}
            onChange={(e) => setPlaylistName(e.target.value)}
            placeholder="Nombre de la playlist"
            className="w-full px-4 py-2 text-center bg-background-color-2 dark:bg-dark-background-color-2 rounded-lg text-font-color-black dark:text-font-color-white outline-none focus:ring-2 focus:ring-font-color-highlight dark:focus:ring-dark-font-color-highlight"
            autoFocus
          />

          <div className="mt-4 text-sm text-font-color-dimmed dark:text-dark-font-color-dimmed">
            {selectedSongIds.size} canciones seleccionadas
          </div>
        </div>

        {/* Right side - Tabs */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Tab buttons */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setActiveTab('icons')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === 'icons'
                  ? 'bg-font-color-highlight dark:bg-dark-font-color-highlight text-font-color-black'
                  : 'bg-background-color-2 dark:bg-dark-background-color-2 text-font-color-dimmed dark:text-dark-font-color-dimmed hover:text-font-color-black dark:hover:text-font-color-white'
              }`}
            >
              <span className="material-icons-round text-sm mr-1 align-middle">palette</span>
              Iconos
            </button>
            <button
              onClick={() => setActiveTab('covers')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === 'covers'
                  ? 'bg-font-color-highlight dark:bg-dark-font-color-highlight text-font-color-black'
                  : 'bg-background-color-2 dark:bg-dark-background-color-2 text-font-color-dimmed dark:text-dark-font-color-dimmed hover:text-font-color-black dark:hover:text-font-color-white'
              }`}
            >
              <span className="material-icons-round text-sm mr-1 align-middle">album</span>
              Portadas
            </button>
            <button
              onClick={() => setActiveTab('library')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                activeTab === 'library'
                  ? 'bg-font-color-highlight dark:bg-dark-font-color-highlight text-font-color-black'
                  : 'bg-background-color-2 dark:bg-dark-background-color-2 text-font-color-dimmed dark:text-dark-font-color-dimmed hover:text-font-color-black dark:hover:text-font-color-white'
              }`}
            >
              <span className="material-icons-round text-sm mr-1 align-middle">library_music</span>
              Música
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto bg-background-color-2/50 dark:bg-dark-background-color-2/50 rounded-xl p-4">
            {/* Icons Tab */}
            {activeTab === 'icons' && (
              <div className="grid grid-cols-6 gap-3">
                {PRESET_ICONS_MAP.map((icon, index) => (
                  <button
                    key={index}
                    onClick={() => handleSelectPresetIcon(icon.displayPath, icon.fileName)}
                    className={`aspect-square rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                      selectedIconDisplay === icon.displayPath
                        ? 'border-font-color-highlight dark:border-dark-font-color-highlight ring-2 ring-font-color-highlight/50'
                        : 'border-transparent hover:border-font-color-dimmed/50'
                    }`}
                  >
                    <img
                      src={icon.displayPath}
                      alt={`Icon ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
                
                {/* Custom icon button */}
                <button
                  onClick={handleSelectCustomIcon}
                  className="aspect-square rounded-lg border-2 border-dashed border-font-color-dimmed/50 flex flex-col items-center justify-center text-font-color-dimmed dark:text-dark-font-color-dimmed hover:border-font-color-highlight dark:hover:border-dark-font-color-highlight hover:text-font-color-highlight dark:hover:text-dark-font-color-highlight transition-colors"
                >
                  <span className="material-icons-round text-2xl">add_photo_alternate</span>
                  <span className="text-xs mt-1">Personalizado</span>
                </button>
              </div>
            )}

            {/* Covers Tab */}
            {activeTab === 'covers' && (
              <div>
                {uniqueCovers.length > 0 ? (
                  <div className="grid grid-cols-6 gap-3">
                    {uniqueCovers.map((cover, index) => (
                      <button
                        key={index}
                        onClick={() => handleSelectCover(cover)}
                        className={`aspect-square rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                          selectedIconDisplay === cover
                            ? 'border-font-color-highlight dark:border-dark-font-color-highlight ring-2 ring-font-color-highlight/50'
                            : 'border-transparent hover:border-font-color-dimmed/50'
                        }`}
                      >
                        <Img
                          src={cover}
                          alt={`Cover ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-font-color-dimmed dark:text-dark-font-color-dimmed">
                    <span className="material-icons-round text-4xl mb-2">album</span>
                    <p>No hay portadas disponibles</p>
                    <p className="text-sm">Agrega música a tu biblioteca para ver las portadas</p>
                  </div>
                )}
              </div>
            )}

            {/* Library Tab */}
            {activeTab === 'library' && (
              <div className="flex flex-col h-full">
                {/* Search and actions */}
                <div className="flex gap-2 mb-4">
                  <div className="flex-1 relative">
                    <span className="material-icons-round absolute left-3 top-1/2 -translate-y-1/2 text-font-color-dimmed">
                      search
                    </span>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Buscar canciones..."
                      className="w-full pl-10 pr-4 py-2 bg-background-color-1 dark:bg-dark-background-color-1 rounded-lg text-font-color-black dark:text-font-color-white outline-none"
                    />
                  </div>
                  <button
                    onClick={selectAllSongs}
                    className="px-3 py-2 bg-background-color-1 dark:bg-dark-background-color-1 rounded-lg text-sm text-font-color-dimmed hover:text-font-color-black dark:hover:text-font-color-white"
                  >
                    Seleccionar todo
                  </button>
                  <button
                    onClick={deselectAllSongs}
                    className="px-3 py-2 bg-background-color-1 dark:bg-dark-background-color-1 rounded-lg text-sm text-font-color-dimmed hover:text-font-color-black dark:hover:text-font-color-white"
                  >
                    Deseleccionar todo
                  </button>
                </div>

                {/* Songs list */}
                <div className="flex-1 overflow-y-auto space-y-1">
                  {filteredSongs.length > 0 ? (
                    filteredSongs.map((song) => (
                      <div
                        key={song.songId}
                        onClick={() => toggleSongSelection(song.songId)}
                        className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${
                          selectedSongIds.has(song.songId)
                            ? 'bg-font-color-highlight/20 dark:bg-dark-font-color-highlight/20'
                            : 'hover:bg-background-color-1 dark:hover:bg-dark-background-color-1'
                        }`}
                      >
                        <div className="w-10 h-10 rounded overflow-hidden shrink-0">
                          <Img
                            src={song.artworkPath || PlaylistDefaultCover}
                            alt={song.title}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-font-color-black dark:text-font-color-white truncate">
                            {song.title}
                          </div>
                          <div className="text-xs text-font-color-dimmed dark:text-dark-font-color-dimmed truncate">
                            {song.artists.map(a => a.name).join(', ') || 'Artista desconocido'}
                          </div>
                        </div>
                        <Checkbox
                          id={`song-${song.songId}`}
                          isChecked={selectedSongIds.has(song.songId)}
                          checkedStateUpdateFunction={() => toggleSongSelection(song.songId)}
                          className="pointer-events-none"
                        />
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-font-color-dimmed dark:text-dark-font-color-dimmed">
                      <span className="material-icons-round text-4xl mb-2">music_off</span>
                      <p>No se encontraron canciones</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-3 mt-6">
        <Button
          label="Cancelar"
          iconName="close"
          clickHandler={() => changePromptMenuData(false)}
        />
        <Button
          label={isEditMode ? 'Guardar cambios' : 'Crear playlist'}
          iconName={isEditMode ? 'save' : 'playlist_add'}
          clickHandler={handleSave}
          className="bg-font-color-highlight! text-font-color-black! dark:bg-dark-font-color-highlight! px-6"
        />
      </div>
    </div>
  );
};

export default PlaylistEditor;
