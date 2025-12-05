import roundTo from '@common/roundTo';
import Button from '@renderer/components/Button';
import MostLovedArtists from '@renderer/components/HomePage/MostLovedArtists';
import MostLovedSongs from '@renderer/components/HomePage/MostLovedSongs';
import RecentlyAddedSongs from '@renderer/components/HomePage/RecentlyAddedSongs';
import RecentlyPlayedArtists from '@renderer/components/HomePage/RecentlyPlayedArtists';
import RecentlyPlayedSongs from '@renderer/components/HomePage/RecentlyPlayedSongs';
import MainContainer from '@renderer/components/MainContainer';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import useResizeObserver from '@renderer/hooks/useResizeObserver';
import storage from '@renderer/utils/localStorage';
import { createFileRoute } from '@tanstack/react-router';
import { lazy, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { queryClient } from '@renderer/index';
import { songQuery } from '@renderer/queries/songs';
import { artistQuery } from '@renderer/queries/aritsts';
import NavLink from '@renderer/components/NavLink';
import SecondaryContainer from '@renderer/components/SecondaryContainer';
import Img from '@renderer/components/Img';
import { useAudioPlayer } from '@renderer/hooks/useAudioPlayer';
import AddOnlineSongToPlaylistPrompt from '@renderer/components/SongsPage/AddOnlineSongToPlaylistPrompt';

import favoritesPlaylistCoverImage from '../../../assets/images/webp/favorites-playlist-icon.webp';
import historyPlaylistCoverImage from '../../../assets/images/webp/history-playlist-icon.webp';

// Types for Online Search
interface OnlineSearchResult {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  artworkUrl: string;
  downloadUrl: string;
  source: string;
  type: string;
}

type SearchFilter = 'songs' | 'videos' | 'albums' | 'artists' | 'playlists';

// TODO: Implement logic to fetch recently played songs from the backend or local storage.
const fetchRecentlyPlayedSongs = async (
  noOfRecentlyAddedSongCards: number
): Promise<SongData[]> => [];
// TODO: Implement logic to fetch recent song artists from the backend or local storage.
const fetchRecentSongArtists = async (
  noOfRecentlyAddedArtistCards: number
): Promise<Artist[]> => [];
const fetchMostLovedSongs = async (noOfMostLovedSongCards: number): Promise<AudioInfo[]> => [];

const recentlyPlayedSongQueryOptions = queryOptions({
  queryKey: ['recentlyPlayedSongs'],
  queryFn: () => fetchRecentlyPlayedSongs(30)
});
const recentSongArtistsQueryOptions = queryOptions({
  queryKey: ['recentSongArtists'],
  queryFn: () => fetchRecentSongArtists(30)
});
const mostLovedSongsQueryOptions = queryOptions({
  queryKey: ['mostLovedSongs'],
  queryFn: () => fetchMostLovedSongs(30)
});

export const Route = createFileRoute('/main-player/home/')({
  component: HomePage,
  loader: async () => {
    await queryClient.ensureQueryData(
      songQuery.all({ sortType: 'dateAddedDescending', start: 0, end: 30 })
    );
    await queryClient.ensureQueryData(recentlyPlayedSongQueryOptions);
    await queryClient.ensureQueryData(recentSongArtistsQueryOptions);
    await queryClient.ensureQueryData(mostLovedSongsQueryOptions);
    await queryClient.ensureQueryData(
      artistQuery.all({
        sortType: 'mostLovedDescending',
        filterType: 'notSelected',
        start: 0,
        end: 30
      })
    );
  }
});

const ErrorPrompt = lazy(() => import('@renderer/components/ErrorPrompt'));
const AddMusicFoldersPrompt = lazy(
  () => import('@renderer/components/MusicFoldersPage/AddMusicFoldersPrompt')
);

function HomePage() {
  const { updateContextMenuData, changePromptMenuData, addNewNotifications } =
    useContext(AppUpdateContext);
  const { t } = useTranslation();

  // Online Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<OnlineSearchResult[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState<SearchFilter>('songs');
  const [isSearching, setIsSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set()); // Track loading songs
  const [recommendations, setRecommendations] = useState<OnlineSearchResult[]>([]); // Recommended songs
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  const [showAllRecommendations, setShowAllRecommendations] = useState(false); // Show expanded view
  const [allRecommendations, setAllRecommendations] = useState<OnlineSearchResult[]>([]); // Full list for infinite scroll
  const [isLoadingMoreRecommendations, setIsLoadingMoreRecommendations] = useState(false);
  const [recommendationPage, setRecommendationPage] = useState(0);
  const recommendationsContainerRef = useRef<HTMLDivElement>(null);
  
  // Blocked songs/artists state (stored in localStorage) - must be before callbacks that use them
  const [blockedSongs, setBlockedSongs] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('nora-blocked-songs');
      if (stored) {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? new Set(parsed) : new Set();
      }
    } catch (e) {
      console.error('Error loading blocked songs:', e);
    }
    return new Set();
  });
  
  const [blockedArtists, setBlockedArtists] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('nora-blocked-artists');
      if (stored) {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? new Set(parsed) : new Set();
      }
    } catch (e) {
      console.error('Error loading blocked artists:', e);
    }
    return new Set();
  });
  
  // History of played online songs (stored in localStorage)
  const [playHistory, setPlayHistory] = useState<OnlineSearchResult[]>(() => {
    try {
      const stored = localStorage.getItem('nora-online-play-history');
      if (stored) {
        const parsed = JSON.parse(stored);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (e) {
      console.error('Error loading play history:', e);
    }
    return [];
  });
  const player = useAudioPlayer();

  const {
    data: { data: latestSongs }
  } = useSuspenseQuery(songQuery.all({ sortType: 'dateAddedDescending', start: 0, end: 30 }));
  const { data: recentlyPlayedSongs } = useSuspenseQuery(recentlyPlayedSongQueryOptions);

  const { data: recentSongArtists } = useSuspenseQuery(recentSongArtistsQueryOptions);

  const { data: mostLovedSongs } = useSuspenseQuery(mostLovedSongsQueryOptions);

  const {
    data: { data: mostLovedArtists }
  } = useSuspenseQuery(artistQuery.all({ sortType: 'aToZ', start: 0, end: 30 }));

  const SONG_CARD_MIN_WIDTH = 280;
  const ARTIST_WIDTH = 175;

  const recentlyAddedSongsContainerRef = useRef<HTMLDivElement>(null);
  const recentlyAddedSongsContainerDiamensions = useResizeObserver(recentlyAddedSongsContainerRef);
  const { noOfRecentlyAddedSongCards, noOfRecentandLovedArtists, noOfRecentandLovedSongCards } =
    useMemo(() => {
      const { width } = recentlyAddedSongsContainerDiamensions;

      return {
        noOfRecentlyAddedSongCards: Math.floor(width / SONG_CARD_MIN_WIDTH) * 2 || 5,
        noOfRecentandLovedSongCards: Math.floor(width / SONG_CARD_MIN_WIDTH) || 3,
        noOfRecentandLovedArtists: Math.floor(width / ARTIST_WIDTH) || 5
      };
    }, [recentlyAddedSongsContainerDiamensions]);

  // Track if we just performed a search (to avoid showing suggestions right after)
  const [justSearched, setJustSearched] = useState(false);

  // Search Logic - fetch suggestions as user types
  useEffect(() => {
    // Don't fetch suggestions if we just performed a search
    if (justSearched) return;
    
    const delayDebounceFn = setTimeout(async () => {
      if (searchQuery.trim().length > 1) {
        try {
          const results = await window.api.onlineSearch.getSuggestions(searchQuery);
          setSuggestions(results);
          setShowSuggestions(true);
        } catch (error) {
          console.error('Error fetching suggestions:', error);
        }
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, justSearched]);

  // Load recommendations on page load
  useEffect(() => {
    const loadRecommendations = async () => {
      setIsLoadingRecommendations(true);
      try {
        // Search for popular/trending music
        const trendingQueries = ['top hits 2024', 'popular songs', 'trending music', 'best songs'];
        const randomQuery = trendingQueries[Math.floor(Math.random() * trendingQueries.length)];
        const results = await window.api.onlineSearch.search(randomQuery, 'songs');
        // Get first 6 results and filter out blocked content
        const filtered = results.slice(0, 6).filter(r => {
          if (blockedSongs.has(r.id)) return false;
          if (blockedArtists.has(r.artist.toLowerCase())) return false;
          return true;
        });
        setRecommendations(filtered);
        // Prefetch the first few
        filtered.slice(0, 3).forEach(r => window.api.onlineSearch.prefetchSong(r.id));
      } catch (error) {
        console.error('Failed to load recommendations:', error);
      } finally {
        setIsLoadingRecommendations(false);
      }
    };
    
    loadRecommendations();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Queries for loading more recommendations
  const recommendationQueries = useMemo(() => [
    'top hits 2024', 'popular songs 2024', 'trending music', 'best songs ever',
    'viral songs', 'summer hits', 'party music', 'chill vibes', 'workout music',
    'road trip songs', 'acoustic covers', 'indie hits', 'rock classics', 'pop hits',
    'electronic dance', 'hip hop hits', 'latin hits', 'k-pop hits', 'jazz favorites',
    'classical music', 'love songs', 'sad songs', 'happy music', 'relaxing music'
  ], []);

  // Load more recommendations for infinite scroll
  const loadMoreRecommendations = useCallback(async (reset = false) => {
    if (isLoadingMoreRecommendations) return;
    
    setIsLoadingMoreRecommendations(true);
    try {
      const pageToLoad = reset ? 0 : recommendationPage;
      const query = recommendationQueries[pageToLoad % recommendationQueries.length];
      const results = await window.api.onlineSearch.search(query, 'songs');
      
      // Filter out blocked content and already loaded songs
      const existingIds = reset ? new Set<string>() : new Set(allRecommendations.map(r => r.id));
      const filtered = results.filter(r => {
        if (existingIds.has(r.id)) return false;
        if (blockedSongs.has(r.id)) return false;
        if (blockedArtists.has(r.artist.toLowerCase())) return false;
        return true;
      });
      
      if (reset) {
        setAllRecommendations(filtered);
        setRecommendationPage(1);
      } else {
        setAllRecommendations(prev => [...prev, ...filtered]);
        setRecommendationPage(prev => prev + 1);
      }
      
      // Prefetch first 3 new songs
      filtered.slice(0, 3).forEach(r => window.api.onlineSearch.prefetchSong(r.id));
    } catch (error) {
      console.error('Failed to load more recommendations:', error);
    } finally {
      setIsLoadingMoreRecommendations(false);
    }
  }, [isLoadingMoreRecommendations, recommendationPage, recommendationQueries, allRecommendations, blockedSongs, blockedArtists]);

  // Handle scroll for infinite loading
  const handleRecommendationsScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    
    // Load more when near bottom (within 200px), only if we already have some content
    if (scrollBottom < 200 && !isLoadingMoreRecommendations && allRecommendations.length > 0) {
      loadMoreRecommendations();
    }
  }, [loadMoreRecommendations, isLoadingMoreRecommendations, allRecommendations.length]);

  // Open expanded recommendations view
  const openAllRecommendations = useCallback(() => {
    setShowAllRecommendations(true);
    // Reset and load initial batch
    loadMoreRecommendations(true);
  }, [loadMoreRecommendations]);

  const handleSearch = async (query: string, filter: SearchFilter = activeFilter) => {
    if (!query.trim()) return;
    setIsSearching(true);
    setShowSuggestions(false);
    setJustSearched(true); // Prevent suggestions from reappearing
    setSearchQuery(query);
    try {
      const results = await window.api.onlineSearch.search(query, filter);
      setSearchResults(results);
    } catch (error) {
      console.error('Search failed:', error);
      addNewNotifications([{
        id: 'search-error',
        content: 'Search failed. Please try again.',
        iconName: 'error',
        type: 'DEFAULT'
      }]);
    } finally {
      setIsSearching(false);
    }
  };

  const handlePlay = async (song: OnlineSearchResult) => {
    if (!player) return;
    
    // Mark as loading
    setLoadingIds(prev => new Set(prev).add(song.id));
    
    try {
      // IMMEDIATELY show song info in player (before getting stream URL)
      // This gives instant feedback to the user
      const previewData: AudioPlayerData = {
        songId: song.id,
        title: song.title,
        artists: [{ artistId: 'unknown', name: song.artist }],
        album: { albumId: 'unknown', name: song.album },
        duration: song.duration,
        artworkPath: song.artworkUrl, // Use artworkPath for player UI
        path: '', // Empty path - will be set when stream is ready
        isAFavorite: false,
        isKnownSource: false,
        isBlacklisted: false
      };
      
      // Show loading state in player immediately
      player.setLoadingState(previewData);
      
      // Now fetch the actual stream URL
      const streamUrl = await window.api.onlineSearch.getStreamUrl(song.id);
      if (!streamUrl) {
        player.clearLoadingState();
        addNewNotifications([{
          id: 'play-error',
          content: 'Could not get stream URL',
          iconName: 'error',
          type: 'DEFAULT'
        }]);
        return;
      }

      const audioData: AudioPlayerData = {
        ...previewData,
        path: streamUrl
      };

      await player.playOnlineSong(audioData);
      
      // Add to play history (remove duplicates, keep last 20)
      setPlayHistory(prev => {
        const filtered = prev.filter(s => s.id !== song.id);
        const newHistory = [song, ...filtered].slice(0, 20);
        localStorage.setItem('nora-online-play-history', JSON.stringify(newHistory));
        return newHistory;
      });
    } catch (error) {
      console.error('Play failed:', error);
      player.clearLoadingState();
      addNewNotifications([{
        id: 'play-error',
        content: 'Failed to play song',
        iconName: 'error',
        type: 'DEFAULT'
      }]);
    } finally {
      setLoadingIds(prev => {
        const next = new Set(prev);
        next.delete(song.id);
        return next;
      });
    }
  };

  const handleDownload = async (song: OnlineSearchResult) => {
    console.log('[handleDownload] Starting download for:', {
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      downloadUrl: song.downloadUrl,
      idType: typeof song.id
    });
    
    if (downloadingIds.has(song.id)) return;
    
    setDownloadingIds(prev => new Set(prev).add(song.id));
    addNewNotifications([{
      id: `download-start-${song.id}`,
      content: `Downloading "${song.title}"...`,
      iconName: 'downloading',
      type: 'DEFAULT'
    }]);

    try {
      // Use song.id directly instead of downloadUrl to avoid issues
      console.log('[handleDownload] Calling API with id:', song.id);
      const result = await window.api.onlineSearch.download(
        song.id,
        song.title,
        song.artist,
        song.album,
        song.artworkUrl
      );
      console.log('[handleDownload] API result:', result);

      if (result.success) {
        addNewNotifications([{
          id: `download-success-${song.id}`,
          content: `Downloaded "${song.title}" successfully!`,
          iconName: 'check_circle',
          type: 'DEFAULT'
        }]);
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      console.error('Download failed:', error);
      addNewNotifications([{
        id: `download-error-${song.id}`,
        content: `Failed to download "${song.title}"`,
        iconName: 'error',
        type: 'DEFAULT'
      }]);
    } finally {
      setDownloadingIds(prev => {
        const next = new Set(prev);
        next.delete(song.id);
        return next;
      });
    }
  };

  // State for online song queue (songs waiting to play)
  const [onlineQueue, setOnlineQueue] = useState<OnlineSearchResult[]>([]);

  const handleAddToQueue = async (song: OnlineSearchResult) => {
    // Add to online queue
    setOnlineQueue(prev => {
      // Check if already in queue
      if (prev.some(s => s.id === song.id)) {
        addNewNotifications([{
          id: `queue-exists-${song.id}`,
          content: `"${song.title}" is already in the queue`,
          iconName: 'info',
          type: 'DEFAULT'
        }]);
        return prev;
      }
      
      // Add to the end of queue
      const newQueue = [...prev, song];
      
      // Save to localStorage for persistence
      localStorage.setItem('nora-online-queue', JSON.stringify(newQueue));
      
      addNewNotifications([{
        id: `queue-added-${song.id}`,
        content: `Added "${song.title}" to queue`,
        iconName: 'queue_music',
        type: 'DEFAULT'
      }]);
      
      return newQueue;
    });
    
    // Prefetch the song for faster playback
    window.api.onlineSearch.prefetchSong(song.id);
  };

  // Load online queue from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem('nora-online-queue');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setOnlineQueue(parsed);
        }
      }
    } catch (e) {
      console.error('Error loading online queue:', e);
    }
  }, []);

  const handleBlockSong = (song: OnlineSearchResult) => {
    setBlockedSongs(prev => {
      const next = new Set(prev).add(song.id);
      localStorage.setItem('nora-blocked-songs', JSON.stringify([...next]));
      return next;
    });
    // Remove from search results immediately
    setSearchResults(prev => prev.filter(r => r.id !== song.id));
    addNewNotifications([{
      id: `block-song-${song.id}`,
      content: `Blocked "${song.title}"`,
      iconName: 'block',
      type: 'DEFAULT'
    }]);
  };

  const handleBlockArtist = (artistName: string) => {
    setBlockedArtists(prev => {
      const next = new Set(prev).add(artistName.toLowerCase());
      localStorage.setItem('nora-blocked-artists', JSON.stringify([...next]));
      return next;
    });
    // Remove all songs by this artist from search results
    setSearchResults(prev => prev.filter(r => r.artist.toLowerCase() !== artistName.toLowerCase()));
    addNewNotifications([{
      id: `block-artist-${artistName}`,
      content: `Blocked artist "${artistName}"`,
      iconName: 'person_off',
      type: 'DEFAULT'
    }]);
  };

  // Filter search results to exclude blocked content
  const filteredSearchResults = useMemo(() => {
    return searchResults.filter(result => {
      if (blockedSongs.has(result.id)) return false;
      if (blockedArtists.has(result.artist.toLowerCase())) return false;
      return true;
    });
  }, [searchResults, blockedSongs, blockedArtists]);

  const addNewSongs = useCallback(() => {
    changePromptMenuData(
      true,
      <AddMusicFoldersPrompt />
    );
  }, [changePromptMenuData]);

  const importAppData = useCallback(
    (
      _: unknown,
      setIsDisabled: (state: boolean) => void,
      setIsPending: (state: boolean) => void
    ) => {
      setIsDisabled(true);
      setIsPending(true);

      return window.api.settingsHelpers
        .importAppData()
        .then((res) => {
          if (res) storage.setAllItems(res);
          return undefined;
        })
        .finally(() => {
          setIsDisabled(false);
          setIsPending(false);
        })
        .catch((err) => console.error(err));
    },
    []
  );

  const homePageContextMenus: ContextMenuItem[] = useMemo(
    () =>
      window.api.properties.isInDevelopment
        ? [
            {
              label: 'Alert Error',
              iconName: 'report',
              handlerFunction: () =>
                changePromptMenuData(
                  true,
                  <ErrorPrompt
                    reason="JUST_FOR_FUN"
                    message={
                      <>
                        Test Prompt
                      </>
                    }
                    showSendFeedbackBtn
                  />,
                  'error-alert-prompt'
                )
            }
          ]
        : [],
    [changePromptMenuData, addNewNotifications]
  );

  return (
    <MainContainer
      className="home-page relative h-full! overflow-y-auto pl-0! [scrollbar-gutter:stable]"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (homePageContextMenus.length > 0)
          updateContextMenuData(true, homePageContextMenus, e.pageX, e.pageY);
      }}
      ref={recentlyAddedSongsContainerRef}
    >
      <div className="flex flex-col gap-6 p-8">
        {/* Search Section */}
        <div className="flex flex-col gap-4">
          <div className="relative z-50">
            <div className="flex items-center gap-2 bg-background-color-2 dark:bg-dark-background-color-2 rounded-full px-4 py-2 shadow-md border border-transparent focus-within:border-font-color-highlight dark:focus-within:border-dark-font-color-highlight transition-colors">
              <button 
                onClick={() => handleSearch(searchQuery)}
                className="material-icons-round text-font-color-dimmed dark:text-dark-font-color-dimmed hover:text-font-color-highlight dark:hover:text-dark-font-color-highlight cursor-pointer"
              >
                search
              </button>
              <input
                type="text"
                className="w-full bg-transparent outline-none text-lg text-font-color-black dark:text-font-color-white placeholder-font-color-dimmed dark:placeholder-dark-font-color-dimmed"
                placeholder="Search songs, artists, albums..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setJustSearched(false); // Reset when user types something new
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch(searchQuery)}
                onFocus={() => !justSearched && suggestions.length > 0 && setShowSuggestions(true)}
              />
              {searchQuery && (
                <button 
                  onClick={() => {
                    setSearchQuery('');
                    setSearchResults([]);
                    setSuggestions([]);
                    setJustSearched(false);
                  }}
                  className="material-icons-round text-font-color-dimmed hover:text-font-color-highlight dark:text-dark-font-color-dimmed dark:hover:text-dark-font-color-highlight"
                >
                  close
                </button>
              )}
            </div>

            {/* Suggestions Dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-background-color-2 dark:bg-dark-background-color-2 rounded-xl shadow-xl overflow-hidden border border-background-color-3 dark:border-dark-background-color-3">
                {suggestions.map((suggestion, index) => (
                  <div
                    key={index}
                    className="px-4 py-3 hover:bg-background-color-3 dark:hover:bg-dark-background-color-3 cursor-pointer flex items-center gap-3"
                    onClick={() => handleSearch(suggestion)}
                  >
                    <span className="material-icons-round text-sm text-font-color-dimmed">search</span>
                    <span className="text-font-color-black dark:text-font-color-white">{suggestion}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Filters */}
          <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
            {(['songs', 'videos', 'albums', 'artists', 'playlists'] as SearchFilter[]).map((filter) => (
              <button
                key={filter}
                onClick={() => {
                  setActiveFilter(filter);
                  if (searchQuery) handleSearch(searchQuery, filter);
                }}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap ${
                  activeFilter === filter
                    ? 'bg-font-color-highlight text-white shadow-md'
                    : 'bg-background-color-2 dark:bg-dark-background-color-2 text-font-color-black dark:text-font-color-white hover:bg-background-color-3 dark:hover:bg-dark-background-color-3'
                }`}
              >
                {filter.charAt(0).toUpperCase() + filter.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Search Results */}
        {searchResults.length > 0 ? (
          <div className="flex flex-col gap-4">
            <h2 className="text-xl font-bold text-font-color-black dark:text-font-color-white">
              Search Results ({filteredSearchResults.length})
            </h2>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
              {filteredSearchResults.map((result) => (
                <div 
                  key={result.id} 
                  className="group relative bg-background-color-2 dark:bg-dark-background-color-2 rounded-xl p-3 hover:bg-background-color-3 dark:hover:bg-dark-background-color-3 transition-colors flex flex-col gap-2"
                  onMouseEnter={() => {
                    // Prefetch song when user hovers over it
                    window.api.onlineSearch.prefetchSong(result.id);
                  }}
                >
                  {/* Clickable image - plays the song */}
                  <div 
                    className="relative aspect-square rounded-lg overflow-hidden cursor-pointer"
                    onClick={() => !loadingIds.has(result.id) && handlePlay(result)}
                  >
                    <Img 
                      src={result.artworkUrl} 
                      className="w-full h-full object-cover" 
                      loading="lazy"
                    />
                    {/* Loading overlay - shows spinner when song is loading */}
                    {loadingIds.has(result.id) && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10">
                        <span className="material-icons-round animate-spin text-4xl text-white">refresh</span>
                      </div>
                    )}
                    {/* Hover overlay with play icon hint (hidden when loading) */}
                    {!loadingIds.has(result.id) && (
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="material-icons-round text-5xl text-white drop-shadow-lg">play_circle</span>
                      </div>
                    )}
                  </div>
                  {/* Song info with 3-dot menu */}
                  <div className="flex items-start justify-between gap-2">
                    <div 
                      className="flex flex-col gap-0.5 flex-1 min-w-0 cursor-pointer"
                      onClick={() => !loadingIds.has(result.id) && handlePlay(result)}
                    >
                      <span className="font-medium text-font-color-black dark:text-font-color-white truncate hover:underline" title={result.title}>
                        {result.title}
                      </span>
                      <span className="text-sm text-font-color-dimmed dark:text-dark-font-color-dimmed truncate" title={result.artist}>
                        {result.artist}
                      </span>
                      <span className="text-xs text-font-color-dimmed/70 dark:text-dark-font-color-dimmed/70 truncate">
                        {result.album !== 'Unknown Album' ? result.album : ''}
                      </span>
                    </div>
                    {/* 3-dot menu button */}
                    <button
                      className="p-1.5 rounded-full hover:bg-background-color-1 dark:hover:bg-dark-background-color-1 text-font-color-dimmed dark:text-dark-font-color-dimmed hover:text-font-color-black dark:hover:text-font-color-white transition-colors opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        const menuItems: ContextMenuItem[] = [
                          {
                            label: 'Play',
                            iconName: 'play_arrow',
                            handlerFunction: () => handlePlay(result)
                          },
                          {
                            label: 'Add to Queue',
                            iconName: 'queue_music',
                            handlerFunction: () => {
                              // Add online song to the current playback queue
                              handleAddToQueue(result);
                            }
                          },
                          {
                            label: 'Add to Favorites',
                            iconName: 'favorite_border',
                            handlerFunction: () => {
                              addNewNotifications([{
                                id: `favorite-${result.id}`,
                                content: `To add to favorites, download the song first`,
                                iconName: 'info',
                                type: 'DEFAULT'
                              }]);
                            }
                          },
                          {
                            label: 'Add to Playlist',
                            iconName: 'playlist_add',
                            handlerFunction: () => {
                              changePromptMenuData(
                                true,
                                <AddOnlineSongToPlaylistPrompt
                                  song={{
                                    id: result.id,
                                    title: result.title,
                                    artist: result.artist,
                                    album: result.album,
                                    duration: result.duration,
                                    artworkUrl: result.artworkUrl,
                                    source: result.source
                                  }}
                                />
                              );
                            }
                          },
                          {
                            label: 'Hr',
                            isContextMenuItemSeperator: true,
                            handlerFunction: () => true
                          },
                          {
                            label: downloadingIds.has(result.id) ? 'Downloading...' : 'Download',
                            iconName: downloadingIds.has(result.id) ? 'hourglass_top' : 'download',
                            handlerFunction: () => !downloadingIds.has(result.id) && handleDownload(result),
                            isDisabled: downloadingIds.has(result.id)
                          },
                          {
                            label: 'Hr',
                            isContextMenuItemSeperator: true,
                            handlerFunction: () => true
                          },
                          {
                            label: 'Block Song',
                            iconName: 'block',
                            handlerFunction: () => {
                              handleBlockSong(result);
                            }
                          },
                          {
                            label: 'Block Artist',
                            iconName: 'person_off',
                            handlerFunction: () => {
                              handleBlockArtist(result.artist);
                            }
                          }
                        ];
                        updateContextMenuData(true, menuItems, e.pageX, e.pageY);
                      }}
                      title="More options"
                    >
                      <span className="material-icons-round text-xl">more_vert</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : isSearching ? (
          <div className="flex justify-center py-12">
            <span className="material-icons-round animate-spin text-4xl text-font-color-highlight">refresh</span>
          </div>
        ) : searchQuery ? (
           <div className="text-center py-12 text-font-color-dimmed">
             No results found
           </div>
        ) : (
          /* Default Home Content (Only show when not searching) */
          <>
            {/* Recomendados Section */}
            <div className="flex flex-col gap-4 appear-from-bottom">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-font-color-highlight dark:text-dark-font-color-highlight">
                  Recomendados
                </h2>
                <div className="flex items-center gap-3">
                  <button 
                    className="text-sm text-font-color-dimmed hover:text-font-color-highlight transition-colors flex items-center gap-1"
                    onClick={() => {
                      // Reload recommendations
                      setIsLoadingRecommendations(true);
                      const queries = ['top hits 2024', 'popular songs', 'trending music', 'best songs', 'new releases'];
                      const randomQuery = queries[Math.floor(Math.random() * queries.length)];
                      window.api.onlineSearch.search(randomQuery, 'songs').then(results => {
                        const filtered = results.slice(0, 6).filter(r => !blockedSongs.has(r.id) && !blockedArtists.has(r.artist.toLowerCase()));
                        setRecommendations(filtered);
                        filtered.slice(0, 3).forEach(r => window.api.onlineSearch.prefetchSong(r.id));
                      }).finally(() => setIsLoadingRecommendations(false));
                    }}
                  >
                    <span className="material-icons-round text-base">refresh</span>
                    Actualizar
                  </button>
                  <button 
                    className="text-sm text-font-color-highlight dark:text-dark-font-color-highlight hover:underline transition-colors flex items-center gap-1"
                    onClick={openAllRecommendations}
                  >
                    Ver más
                    <span className="material-icons-round text-base">arrow_forward</span>
                  </button>
                </div>
              </div>
              
              {isLoadingRecommendations ? (
                <div className="flex justify-center py-8">
                  <span className="material-icons-round animate-spin text-3xl text-font-color-highlight">refresh</span>
                </div>
              ) : recommendations.length > 0 ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                  {recommendations.map((song) => (
                    <div 
                      key={song.id}
                      className="group bg-background-color-2 dark:bg-dark-background-color-2 rounded-lg p-2.5 hover:bg-background-color-3 dark:hover:bg-dark-background-color-3 transition-colors"
                      onMouseEnter={() => window.api.onlineSearch.prefetchSong(song.id)}
                    >
                      <div 
                        className="relative aspect-square rounded-md overflow-hidden mb-2 cursor-pointer"
                        onClick={() => !loadingIds.has(song.id) && handlePlay(song)}
                      >
                        <Img src={song.artworkUrl} className="w-full h-full object-cover" loading="lazy" />
                        {loadingIds.has(song.id) ? (
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                            <span className="material-icons-round animate-spin text-2xl text-white">refresh</span>
                          </div>
                        ) : (
                          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <span className="material-icons-round text-4xl text-white drop-shadow-lg">play_circle</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-start justify-between gap-1">
                        <div 
                          className="flex flex-col gap-0.5 flex-1 min-w-0 cursor-pointer"
                          onClick={() => !loadingIds.has(song.id) && handlePlay(song)}
                        >
                          <span className="font-medium text-sm text-font-color-black dark:text-font-color-white truncate" title={song.title}>
                            {song.title}
                          </span>
                          <span className="text-xs text-font-color-dimmed dark:text-dark-font-color-dimmed truncate" title={song.artist}>
                            {song.artist}
                          </span>
                        </div>
                        {/* 3-dot menu button */}
                        <button
                          className="p-1 rounded-full hover:bg-background-color-1 dark:hover:bg-dark-background-color-1 text-font-color-dimmed dark:text-dark-font-color-dimmed hover:text-font-color-black dark:hover:text-font-color-white transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            const menuItems: ContextMenuItem[] = [
                              {
                                label: 'Play',
                                iconName: 'play_arrow',
                                handlerFunction: () => handlePlay(song)
                              },
                              {
                                label: 'Add to Queue',
                                iconName: 'queue_music',
                                handlerFunction: () => handleAddToQueue(song)
                              },
                              {
                                label: 'Add to Favorites',
                                iconName: 'favorite_border',
                                handlerFunction: () => {
                                  addNewNotifications([{
                                    id: `favorite-${song.id}`,
                                    content: `To add to favorites, download the song first`,
                                    iconName: 'info',
                                    type: 'DEFAULT'
                                  }]);
                                }
                              },
                              {
                                label: 'Add to Playlist',
                                iconName: 'playlist_add',
                                handlerFunction: () => {
                                  changePromptMenuData(
                                    true,
                                    <AddOnlineSongToPlaylistPrompt
                                      song={{
                                        id: song.id,
                                        title: song.title,
                                        artist: song.artist,
                                        album: song.album,
                                        duration: song.duration,
                                        artworkUrl: song.artworkUrl,
                                        source: song.source
                                      }}
                                    />
                                  );
                                }
                              },
                              {
                                label: 'Hr',
                                isContextMenuItemSeperator: true,
                                handlerFunction: () => true
                              },
                              {
                                label: downloadingIds.has(song.id) ? 'Downloading...' : 'Download',
                                iconName: downloadingIds.has(song.id) ? 'hourglass_top' : 'download',
                                handlerFunction: () => !downloadingIds.has(song.id) && handleDownload(song),
                                isDisabled: downloadingIds.has(song.id)
                              },
                              {
                                label: 'Hr',
                                isContextMenuItemSeperator: true,
                                handlerFunction: () => true
                              },
                              {
                                label: 'Block Song',
                                iconName: 'block',
                                handlerFunction: () => handleBlockSong(song)
                              },
                              {
                                label: 'Block Artist',
                                iconName: 'person_off',
                                handlerFunction: () => handleBlockArtist(song.artist)
                              }
                            ];
                            updateContextMenuData(true, menuItems, e.pageX, e.pageY);
                          }}
                          title="More options"
                        >
                          <span className="material-icons-round text-lg">more_vert</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-font-color-dimmed">
                  <span className="material-icons-round text-4xl mb-2">music_note</span>
                  <p className="text-sm">Cargando recomendaciones...</p>
                </div>
              )}
            </div>

            {/* Lo último escuchado - Recently played online songs */}
            {playHistory.length > 0 && (
              <div className="flex flex-col gap-4 mt-6 appear-from-bottom" style={{ animationDelay: '100ms' }}>
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-font-color-highlight dark:text-dark-font-color-highlight">
                    Lo último escuchado
                  </h2>
                  <button 
                    className="text-sm text-font-color-dimmed hover:text-font-color-highlight transition-colors flex items-center gap-1"
                    onClick={() => {
                      setPlayHistory([]);
                      localStorage.removeItem('nora-online-play-history');
                      addNewNotifications([{
                        id: 'clear-history',
                        content: 'Historial borrado',
                        iconName: 'delete',
                        type: 'DEFAULT'
                      }]);
                    }}
                  >
                    <span className="material-icons-round text-base">delete_outline</span>
                    Borrar
                  </button>
                </div>
                
                <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                  {playHistory.slice(0, 6).map((song) => (
                    <div 
                      key={song.id}
                      className="group bg-background-color-2 dark:bg-dark-background-color-2 rounded-lg p-2.5 hover:bg-background-color-3 dark:hover:bg-dark-background-color-3 transition-colors"
                      onMouseEnter={() => window.api.onlineSearch.prefetchSong(song.id)}
                    >
                      <div 
                        className="relative aspect-square rounded-md overflow-hidden mb-2 cursor-pointer"
                        onClick={() => !loadingIds.has(song.id) && handlePlay(song)}
                      >
                        <Img src={song.artworkUrl} className="w-full h-full object-cover" loading="lazy" />
                        {loadingIds.has(song.id) ? (
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                            <span className="material-icons-round animate-spin text-2xl text-white">refresh</span>
                          </div>
                        ) : (
                          <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <span className="material-icons-round text-4xl text-white drop-shadow-lg">play_circle</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-start justify-between gap-1">
                        <div 
                          className="flex flex-col gap-0.5 flex-1 min-w-0 cursor-pointer"
                          onClick={() => !loadingIds.has(song.id) && handlePlay(song)}
                        >
                          <span className="font-medium text-sm text-font-color-black dark:text-font-color-white truncate" title={song.title}>
                            {song.title}
                          </span>
                          <span className="text-xs text-font-color-dimmed dark:text-dark-font-color-dimmed truncate" title={song.artist}>
                            {song.artist}
                          </span>
                        </div>
                        {/* 3-dot menu button */}
                        <button
                          className="p-1 rounded-full hover:bg-background-color-1 dark:hover:bg-dark-background-color-1 text-font-color-dimmed dark:text-dark-font-color-dimmed hover:text-font-color-black dark:hover:text-font-color-white transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            const menuItems: ContextMenuItem[] = [
                              {
                                label: 'Play',
                                iconName: 'play_arrow',
                                handlerFunction: () => handlePlay(song)
                              },
                              {
                                label: 'Add to Queue',
                                iconName: 'queue_music',
                                handlerFunction: () => handleAddToQueue(song)
                              },
                              {
                                label: 'Add to Favorites',
                                iconName: 'favorite_border',
                                handlerFunction: () => {
                                  addNewNotifications([{
                                    id: `favorite-${song.id}`,
                                    content: `To add to favorites, download the song first`,
                                    iconName: 'info',
                                    type: 'DEFAULT'
                                  }]);
                                }
                              },
                              {
                                label: 'Add to Playlist',
                                iconName: 'playlist_add',
                                handlerFunction: () => {
                                  changePromptMenuData(
                                    true,
                                    <AddOnlineSongToPlaylistPrompt
                                      song={{
                                        id: song.id,
                                        title: song.title,
                                        artist: song.artist,
                                        album: song.album,
                                        duration: song.duration,
                                        artworkUrl: song.artworkUrl,
                                        source: song.source
                                      }}
                                    />
                                  );
                                }
                              },
                              {
                                label: 'Hr',
                                isContextMenuItemSeperator: true,
                                handlerFunction: () => true
                              },
                              {
                                label: downloadingIds.has(song.id) ? 'Downloading...' : 'Download',
                                iconName: downloadingIds.has(song.id) ? 'hourglass_top' : 'download',
                                handlerFunction: () => !downloadingIds.has(song.id) && handleDownload(song),
                                isDisabled: downloadingIds.has(song.id)
                              },
                              {
                                label: 'Hr',
                                isContextMenuItemSeperator: true,
                                handlerFunction: () => true
                              },
                              {
                                label: 'Block Song',
                                iconName: 'block',
                                handlerFunction: () => handleBlockSong(song)
                              },
                              {
                                label: 'Block Artist',
                                iconName: 'person_off',
                                handlerFunction: () => handleBlockArtist(song.artist)
                              }
                            ];
                            updateContextMenuData(true, menuItems, e.pageX, e.pageY);
                          }}
                          title="More options"
                        >
                          <span className="material-icons-round text-lg">more_vert</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Access - Favorites & History */}
            <div className="flex flex-col gap-4 mt-6 appear-from-bottom" style={{ animationDelay: '200ms' }}>
              <h2 className="text-xl font-bold text-font-color-highlight dark:text-dark-font-color-highlight">
                Acceso Rápido
              </h2>
              <div className="flex gap-3 flex-wrap">
                <NavLink
                  to="/main-player/playlists/favorites"
                  className="bg-background-color-2/70 hover:bg-background-color-2! dark:bg-dark-background-color-2/70 dark:hover:bg-dark-background-color-2! text-font-color dark:text-dark-font-color flex h-16 min-w-48 items-center gap-3 rounded-xl px-4 py-3 transition-colors"
                >
                  <Img
                    src={favoritesPlaylistCoverImage}
                    className="aspect-square h-full w-auto rounded-lg"
                  />
                  <span className="text-base font-medium">Favoritos</span>
                </NavLink>
                <NavLink
                  to="/main-player/playlists/history"
                  className="bg-background-color-2/70 hover:bg-background-color-2! dark:bg-dark-background-color-2/70 dark:hover:bg-dark-background-color-2! text-font-color dark:text-dark-font-color flex h-16 min-w-48 items-center gap-3 rounded-xl px-4 py-3 transition-colors"
                >
                  <Img
                    src={historyPlaylistCoverImage}
                    className="aspect-square h-full w-auto rounded-lg"
                  />
                  <span className="text-base font-medium">Historial</span>
                </NavLink>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Expanded Recommendations Panel */}
      {showAllRecommendations && (
        <div 
          className="fixed inset-0 z-40 bg-background-color-1 dark:bg-dark-background-color-1 flex flex-col"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Header */}
          <div 
            className="flex items-center gap-4 px-6 py-4 border-b border-background-color-3 dark:border-dark-background-color-3 relative"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <button
              type="button"
              className="flex items-center gap-2 text-font-color-dimmed hover:text-font-color-highlight dark:hover:text-dark-font-color-highlight transition-colors cursor-pointer px-3 py-2 rounded-lg hover:bg-background-color-2 dark:hover:bg-dark-background-color-2"
              onClick={() => {
                console.log('Volver clicked');
                setShowAllRecommendations(false);
              }}
            >
              <span className="material-icons-round text-2xl">arrow_back</span>
              <span className="text-base font-medium">Volver</span>
            </button>
            <h2 className="text-2xl font-bold text-font-color-highlight dark:text-dark-font-color-highlight flex-1">
              Recomendados
            </h2>
            <button 
              className="text-sm text-font-color-dimmed hover:text-font-color-highlight transition-colors flex items-center gap-1 px-3 py-1.5 rounded-lg bg-background-color-2 dark:bg-dark-background-color-2"
              onClick={() => loadMoreRecommendations(true)}
              disabled={isLoadingMoreRecommendations}
            >
              <span className={`material-icons-round text-base ${isLoadingMoreRecommendations ? 'animate-spin' : ''}`}>refresh</span>
              Actualizar
            </button>
          </div>
          
          {/* Scrollable Content */}
          <div 
            ref={recommendationsContainerRef}
            className="flex-1 overflow-y-auto px-6 py-4"
            onScroll={handleRecommendationsScroll}
          >
            <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-4">
              {allRecommendations.map((song) => (
                <div 
                  key={song.id}
                  className="group bg-background-color-2 dark:bg-dark-background-color-2 rounded-lg p-3 hover:bg-background-color-3 dark:hover:bg-dark-background-color-3 transition-colors"
                  onMouseEnter={() => window.api.onlineSearch.prefetchSong(song.id)}
                >
                  <div 
                    className="relative aspect-square rounded-md overflow-hidden mb-2.5 cursor-pointer"
                    onClick={() => !loadingIds.has(song.id) && handlePlay(song)}
                  >
                    <Img src={song.artworkUrl} className="w-full h-full object-cover" loading="lazy" />
                    {loadingIds.has(song.id) ? (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <span className="material-icons-round animate-spin text-2xl text-white">refresh</span>
                      </div>
                    ) : (
                      <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="material-icons-round text-5xl text-white drop-shadow-lg">play_circle</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-start justify-between gap-1">
                    <div 
                      className="flex flex-col gap-0.5 flex-1 min-w-0 cursor-pointer"
                      onClick={() => !loadingIds.has(song.id) && handlePlay(song)}
                    >
                      <span className="font-medium text-sm text-font-color-black dark:text-font-color-white truncate" title={song.title}>
                        {song.title}
                      </span>
                      <span className="text-xs text-font-color-dimmed dark:text-dark-font-color-dimmed truncate" title={song.artist}>
                        {song.artist}
                      </span>
                    </div>
                    {/* 3-dot menu button */}
                    <button
                      className="p-1 rounded-full hover:bg-background-color-1 dark:hover:bg-dark-background-color-1 text-font-color-dimmed dark:text-dark-font-color-dimmed hover:text-font-color-black dark:hover:text-font-color-white transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        const menuItems: ContextMenuItem[] = [
                          {
                            label: 'Play',
                            iconName: 'play_arrow',
                            handlerFunction: () => handlePlay(song)
                          },
                          {
                            label: 'Add to Queue',
                            iconName: 'queue_music',
                            handlerFunction: () => handleAddToQueue(song)
                          },
                          {
                            label: 'Add to Playlist',
                            iconName: 'playlist_add',
                            handlerFunction: () => {
                              changePromptMenuData(
                                true,
                                <AddOnlineSongToPlaylistPrompt
                                  song={{
                                    id: song.id,
                                    title: song.title,
                                    artist: song.artist,
                                    album: song.album,
                                    duration: song.duration,
                                    artworkUrl: song.artworkUrl,
                                    source: song.source
                                  }}
                                />
                              );
                            }
                          },
                          {
                            label: 'Hr',
                            isContextMenuItemSeperator: true,
                            handlerFunction: () => true
                          },
                          {
                            label: downloadingIds.has(song.id) ? 'Downloading...' : 'Download',
                            iconName: downloadingIds.has(song.id) ? 'hourglass_top' : 'download',
                            handlerFunction: () => !downloadingIds.has(song.id) && handleDownload(song),
                            isDisabled: downloadingIds.has(song.id)
                          },
                          {
                            label: 'Hr',
                            isContextMenuItemSeperator: true,
                            handlerFunction: () => true
                          },
                          {
                            label: 'Block Song',
                            iconName: 'block',
                            handlerFunction: () => handleBlockSong(song)
                          },
                          {
                            label: 'Block Artist',
                            iconName: 'person_off',
                            handlerFunction: () => handleBlockArtist(song.artist)
                          }
                        ];
                        updateContextMenuData(true, menuItems, e.pageX, e.pageY);
                      }}
                      title="More options"
                    >
                      <span className="material-icons-round text-lg">more_vert</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
            
            {/* Loading indicator for infinite scroll */}
            {isLoadingMoreRecommendations && (
              <div className="flex justify-center py-8">
                <span className="material-icons-round animate-spin text-3xl text-font-color-highlight">refresh</span>
              </div>
            )}
            
            {/* Empty state */}
            {allRecommendations.length === 0 && !isLoadingMoreRecommendations && (
              <div className="flex flex-col items-center justify-center py-16 text-font-color-dimmed">
                <span className="material-icons-round text-5xl mb-3">music_note</span>
                <p>Cargando recomendaciones...</p>
              </div>
            )}
          </div>
        </div>
      )}
    </MainContainer>
  );
}
