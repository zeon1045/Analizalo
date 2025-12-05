import checkFolderForUnknownModifications from '../fs/checkFolderForUnknownContentModifications';
import logger from '../logger';
import { getAllFolders } from '@main/db/queries/folders';
import cleanUpOrphanedData from './cleanUpOrphanedData';

const checkForNewSongs = async () => {
  const folders = await getAllFolders();

  if (folders.length > 0) {
    for (const folder of folders) {
      try {
        await checkFolderForUnknownModifications(folder.path);
      } catch (error) {
        logger.error(`Failed to check for unknown modifications of a path.`, {
          error,
          path: folder.path
        });
      }
    }
  } else {
    logger.warn(`Music folders array is empty. Skipping folder checks.`, {
      folders
    });
  }

  await cleanUpOrphanedData();
};

export default checkForNewSongs;
