import { useMutation, useQuery } from '@tanstack/react-query';
import { settingsQuery } from '@renderer/queries/settings';
import { queryClient } from '@renderer/index';
import Button from '../../Button';

const DownloadsSettings = () => {
  const { data: userSettings } = useQuery(settingsQuery.all);

  const { data: currentDownloadsFolder } = useQuery({
    queryKey: ['musicDownloadsFolder'],
    queryFn: () => window.api.settings.getMusicDownloadsFolder()
  });

  const { mutate: updateMusicDownloadsFolder } = useMutation({
    mutationFn: (location: string) =>
      window.api.settings.updateMusicDownloadsFolder(location),
    onSettled: () => {
      queryClient.invalidateQueries(settingsQuery.all);
      queryClient.invalidateQueries({ queryKey: ['musicDownloadsFolder'] });
    }
  });

  const openDownloadsFolder = () => {
    if (currentDownloadsFolder) {
      window.api.folderData.revealFolderInFileExplorer(currentDownloadsFolder);
    }
  };

  return (
    <li className="main-container downloads-settings-container mb-16" id="downloads-settings-container">
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 flex items-center text-2xl font-medium">
        <span className="material-icons-round-outlined mr-2">download</span>
        Descargas
      </div>
      <p className="mb-4 text-sm opacity-80">
        Configura dónde se guardan las canciones descargadas desde la búsqueda online.
      </p>
      
      <ul className="marker:bg-font-color-highlight dark:marker:bg-dark-font-color-highlight list-disc pl-6">
        <li className="downloads-folder-location mb-4">
          <div className="description">
            Carpeta de descargas de música
          </div>
          <div className="mt-4 ml-2 flex-row text-sm">
            <span>Ubicación actual: </span>
            <span className="text-font-color-highlight dark:text-dark-font-color-highlight mr-4 break-all">
              {currentDownloadsFolder || 'Cargando...'}
            </span>
          </div>
          <div className="mt-4 flex flex-row items-center gap-2 flex-wrap">
            <Button
              label="Cambiar carpeta"
              iconName="folder_open"
              iconClassName="material-icons-round-outlined"
              clickHandler={() =>
                window.api.settingsHelpers
                  .getFolderLocation()
                  .then((folderPath) => {
                    if (folderPath) {
                      updateMusicDownloadsFolder(folderPath);
                    }
                  })
                  .catch((err) => console.warn(err))
              }
            />
            <Button
              label="Abrir carpeta"
              iconName="launch"
              iconClassName="material-icons-round-outlined"
              clickHandler={openDownloadsFolder}
            />
            <Button
              label="Restaurar predeterminado"
              iconName="restart_alt"
              iconClassName="material-icons-round-outlined"
              clickHandler={() => updateMusicDownloadsFolder('')}
            />
          </div>
        </li>
      </ul>
    </li>
  );
};

export default DownloadsSettings;
