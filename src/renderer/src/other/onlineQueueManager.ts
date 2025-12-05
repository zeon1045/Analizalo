/**
 * Online Queue Manager
 * 
 * Manages a global queue for online songs (from playlists or search).
 * This allows the play/pause/next/prev buttons to work correctly
 * even when the user navigates away from the playlist page.
 */

import type { OnlinePlaylistSong } from '../components/SongsPage/AddOnlineSongToPlaylistPrompt';
import type AudioPlayer from './player';
import type { AudioPlayerData } from './player';

// Extended type for online songs with additional source info
export interface OnlineQueueSong extends OnlinePlaylistSong {
  playlistId?: string;
  playlistName?: string;
}

class OnlineQueueManager {
  private queue: OnlineQueueSong[] = [];
  private currentIndex: number = -1;
  private isActive: boolean = false;
  private player: AudioPlayer | null = null;
  private playingId: string | null = null;

  // Callbacks
  private onSongChangeCallbacks: Set<(song: OnlineQueueSong | null, index: number) => void> = new Set();
  private onQueueChangeCallbacks: Set<(queue: OnlineQueueSong[], isActive: boolean) => void> = new Set();

  /**
   * Set the AudioPlayer instance
   */
  setPlayer(player: AudioPlayer): void {
    if (this.player) {
      // Remove old listeners
      this.player.off('playbackComplete', this.handlePlaybackComplete);
      this.player.off('skipForwardRequest', this.handleSkipForward);
      this.player.off('skipBackwardRequest', this.handleSkipBackward);
    }

    this.player = player;

    // Add new listeners
    this.player.on('playbackComplete', this.handlePlaybackComplete);
    this.player.on('skipForwardRequest', this.handleSkipForward);
    this.player.on('skipBackwardRequest', this.handleSkipBackward);
  }

  /**
   * Set queue and start playing from a specific index
   */
  async setQueueAndPlay(
    songs: OnlineQueueSong[],
    startIndex: number = 0,
    playlistId?: string,
    playlistName?: string
  ): Promise<void> {
    // Add playlist info to songs
    this.queue = songs.map(song => ({
      ...song,
      playlistId: playlistId || song.playlistId,
      playlistName: playlistName || song.playlistName
    }));
    this.currentIndex = startIndex;
    this.isActive = true;

    console.log('[OnlineQueueManager] Queue set:', {
      length: this.queue.length,
      startIndex,
      playlistName
    });

    this.notifyQueueChange();
    await this.playCurrentSong();
  }

  /**
   * Play a single song (clears queue, sets to single item)
   */
  async playSingle(song: OnlineQueueSong): Promise<void> {
    this.queue = [song];
    this.currentIndex = 0;
    this.isActive = true;

    console.log('[OnlineQueueManager] Playing single:', song.title);

    this.notifyQueueChange();
    await this.playCurrentSong();
  }

  /**
   * Play the current song in queue
   */
  private async playCurrentSong(): Promise<void> {
    if (!this.player || this.currentIndex < 0 || this.currentIndex >= this.queue.length) {
      return;
    }

    const song = this.queue[this.currentIndex];
    this.playingId = song.id;

    console.log('[OnlineQueueManager] Playing:', { index: this.currentIndex, title: song.title });

    try {
      // Create preview data for loading state
      const previewData: AudioPlayerData = {
        songId: song.id,
        title: song.title,
        artists: [{ artistId: 'unknown', name: song.artist }],
        album: { albumId: 'unknown', name: song.album },
        duration: song.duration,
        artworkPath: song.artworkUrl,
        path: '',
        isAFavorite: false,
        isKnownSource: false,
        isBlacklisted: false
      };

      this.player.setLoadingState(previewData);

      // Get stream URL
      const streamUrl = await window.api.onlineSearch.getStreamUrl(song.id);
      if (!streamUrl) {
        console.error('[OnlineQueueManager] Failed to get stream URL');
        this.player.clearLoadingState();
        return;
      }

      const audioData: AudioPlayerData = {
        ...previewData,
        path: streamUrl
      };

      await this.player.playOnlineSong(audioData);
      this.notifySongChange(song);

    } catch (error) {
      console.error('[OnlineQueueManager] Play error:', error);
      this.player?.clearLoadingState();
    }
  }

  /**
   * Handle playback complete event - auto-advance to next
   */
  private handlePlaybackComplete = (): void => {
    console.log('[OnlineQueueManager] Playback complete, isActive:', this.isActive);
    if (this.isActive) {
      this.skipToNext();
    }
  };

  /**
   * Handle skip forward request from player
   */
  private handleSkipForward = (): void => {
    console.log('[OnlineQueueManager] Skip forward request, isActive:', this.isActive);
    if (this.isActive) {
      this.skipToNext();
    }
  };

  /**
   * Handle skip backward request from player
   */
  private handleSkipBackward = (): void => {
    console.log('[OnlineQueueManager] Skip backward request, isActive:', this.isActive);
    if (this.isActive) {
      this.skipToPrevious();
    }
  };

  /**
   * Skip to next song
   */
  async skipToNext(): Promise<void> {
    if (!this.isActive || this.queue.length === 0) return;

    if (this.currentIndex < this.queue.length - 1) {
      this.currentIndex++;
      console.log('[OnlineQueueManager] Skip to next:', this.currentIndex);
      await this.playCurrentSong();
    } else {
      // End of queue
      console.log('[OnlineQueueManager] End of queue');
      this.stop();
    }
  }

  /**
   * Skip to previous song
   */
  async skipToPrevious(): Promise<void> {
    if (!this.isActive || this.queue.length === 0) return;

    // If more than 5 seconds in, restart current song
    if (this.player && this.player.audio.currentTime > 5) {
      this.player.audio.currentTime = 0;
      return;
    }

    if (this.currentIndex > 0) {
      this.currentIndex--;
      console.log('[OnlineQueueManager] Skip to previous:', this.currentIndex);
      await this.playCurrentSong();
    } else {
      // At start, restart first song
      console.log('[OnlineQueueManager] Restart first song');
      await this.playCurrentSong();
    }
  }

  /**
   * Jump to specific index in queue
   */
  async jumpToIndex(index: number): Promise<void> {
    if (!this.isActive || index < 0 || index >= this.queue.length) return;

    this.currentIndex = index;
    console.log('[OnlineQueueManager] Jump to index:', index);
    await this.playCurrentSong();
  }

  /**
   * Stop playback and deactivate queue
   */
  stop(): void {
    console.log('[OnlineQueueManager] Stopping');
    this.isActive = false;
    this.playingId = null;
    this.currentIndex = -1;
    this.notifySongChange(null);
    this.notifyQueueChange();
  }

  /**
   * Clear the queue completely
   */
  clear(): void {
    console.log('[OnlineQueueManager] Clearing queue');
    this.queue = [];
    this.currentIndex = -1;
    this.isActive = false;
    this.playingId = null;
    this.notifySongChange(null);
    this.notifyQueueChange();
  }

  // ========== GETTERS ==========

  get isQueueActive(): boolean {
    return this.isActive;
  }

  get currentSong(): OnlineQueueSong | null {
    if (this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
      return this.queue[this.currentIndex];
    }
    return null;
  }

  get currentPlayingId(): string | null {
    return this.playingId;
  }

  get position(): number {
    return this.currentIndex;
  }

  get length(): number {
    return this.queue.length;
  }

  get hasNext(): boolean {
    return this.currentIndex < this.queue.length - 1;
  }

  get hasPrevious(): boolean {
    return this.currentIndex > 0;
  }

  get allSongs(): OnlineQueueSong[] {
    return [...this.queue];
  }

  // ========== SUBSCRIPTIONS ==========

  /**
   * Subscribe to song changes
   */
  onSongChange(callback: (song: OnlineQueueSong | null, index: number) => void): () => void {
    this.onSongChangeCallbacks.add(callback);
    return () => {
      this.onSongChangeCallbacks.delete(callback);
    };
  }

  /**
   * Subscribe to queue changes
   */
  onQueueChange(callback: (queue: OnlineQueueSong[], isActive: boolean) => void): () => void {
    this.onQueueChangeCallbacks.add(callback);
    return () => {
      this.onQueueChangeCallbacks.delete(callback);
    };
  }

  private notifySongChange(song: OnlineQueueSong | null): void {
    this.onSongChangeCallbacks.forEach(cb => cb(song, this.currentIndex));
  }

  private notifyQueueChange(): void {
    this.onQueueChangeCallbacks.forEach(cb => cb(this.queue, this.isActive));
  }
}

// Singleton instance
export const onlineQueueManager = new OnlineQueueManager();
export default onlineQueueManager;
