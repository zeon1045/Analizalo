import path from 'path';
import fs from 'fs/promises';
import { supportedMusicExtensions } from '../filesystem';
import logger from '../logger';
import removeSongsFromLibrary from '../removeSongsFromLibrary';
import { tryToParseSong } from '../parseSong/parseSong';
import { saveAbortController } from './controlAbortControllers';
import { generatePalettes } from '../other/generatePalette';
import { getSongsRelativeToFolder } from '@main/db/queries/songs';
import { getFolderFromPath } from '@main/db/queries/folders';
import { getSongsInAnyPlaylist } from '@main/db/queries/playlistSongs';

const abortController = new AbortController();
saveAbortController('checkFolderForUnknownContentModifications', abortController);

const getSongPathsRelativeToFolder = async (folderPath: string) => {
  const relevantSongs = await getSongsRelativeToFolder(folderPath, {
    skipBlacklistedFolders: true,
    skipBlacklistedSongs: true
  });

  const relevantSongPaths = relevantSongs.map((song) => song.path);

  return relevantSongPaths;
};

const getFullPathsOfFolderDirsRecursive = async (folderPath: string): Promise<string[]> => {
  const results: string[] = [];

  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subResults = await getFullPathsOfFolderDirsRecursive(fullPath);
        results.push(...subResults);
      } else if (entry.isFile() && supportedMusicExtensions.includes(path.extname(entry.name))) {
        results.push(fullPath);
      }
    }
  } catch (error) {
    logger.error(`Failed to read directory.`, { error, folderPath });
  }

  return results;
};

const removeDeletedSongsFromLibrary = async (
  deletedSongPaths: string[],
  abortSignal: AbortSignal
) => {
  try {
    await removeSongsFromLibrary(deletedSongPaths, abortSignal);
  } catch (error) {
    logger.error(`Failed to remove deleted songs from library.`, { error, deletedSongPaths });
  }
};

const addNewlyAddedSongsToLibrary = async (
  folderPath: string,
  newlyAddedSongPaths: string[],
  abortSignal: AbortSignal
) => {
  const folder = await getFolderFromPath(folderPath);

  for (let i = 0; i < newlyAddedSongPaths.length; i += 1) {
    const newlyAddedSongPath = newlyAddedSongPaths[i];

    if (abortSignal?.aborted) {
      logger.warn('Parsing songs in the music folder aborted by an abortController signal.', {
        reason: abortSignal?.reason,
        newlyAddedSongPath
      });
      break;
    }

    try {
      await tryToParseSong(newlyAddedSongPath, folder?.id, false, false);
      logger.debug(`${path.basename(newlyAddedSongPath)} song added.`, {
        songPath: newlyAddedSongPath
      });
    } catch (error) {
      logger.error(`Failed to parse song added before application launch`, {
        error,
        newlyAddedSongPath
      });
    }
  }
  if (newlyAddedSongPaths.length > 0) setTimeout(generatePalettes, 1500);
};

const arePathsEqual = (path1: string, path2: string) => {
  if (process.platform === 'win32') {
    return path1.toLowerCase() === path2.toLowerCase();
  }
  return path1 === path2;
};

const checkFolderForUnknownModifications = async (folderPath: string) => {
  const relevantFolderSongPaths = await getSongPathsRelativeToFolder(folderPath);

  if (relevantFolderSongPaths.length > 0) {
    const dirs = await getFullPathsOfFolderDirsRecursive(folderPath);

    if (dirs) {
      // checks for newly added songs that got added before application launch
      const newlyAddedSongPaths = dirs.filter(
        (dir) => !relevantFolderSongPaths.some((songPath) => arePathsEqual(songPath, dir))
      );
      // checks for deleted songs that got deleted before application launch
      const deletedSongPaths = relevantFolderSongPaths.filter(
        (songPath) => !dirs.some((dir) => arePathsEqual(dir, songPath))
      );

      logger.debug(`New song additions/deletions detected.`, {
        newlyAddedSongPathsCount: newlyAddedSongPaths.length,
        deletedSongPathsCount: deletedSongPaths.length,
        newlyAddedSongPaths,
        deletedSongPaths,
        folderPath
      });

      // Prioritises deleting songs before adding new songs to prevent data clashes.
      if (deletedSongPaths.length > 0) {
        // deleting songs from the library that got deleted before application launch
        const playlistSongs = await getSongsInAnyPlaylist(deletedSongPaths);
        const songsToDelete = deletedSongPaths.filter(
          (path) => !playlistSongs.some((playlistSongPath) => arePathsEqual(playlistSongPath, path))
        );

        if (songsToDelete.length > 0) {
          await removeDeletedSongsFromLibrary(songsToDelete, abortController.signal);
        }

        if (playlistSongs.length > 0) {
          logger.info(
            `Prevented ${playlistSongs.length} songs from being removed because they are in playlists.`,
            { playlistSongs }
          );
        }
      }

      if (newlyAddedSongPaths.length > 0) {
        // parses new songs that added before application launch
        await addNewlyAddedSongsToLibrary(folderPath, newlyAddedSongPaths, abortController.signal);
      }
    }
  }
};

export default checkFolderForUnknownModifications;
