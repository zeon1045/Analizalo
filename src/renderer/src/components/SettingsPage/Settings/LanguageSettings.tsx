import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import Dropdown from '../../Dropdown';
import { AppUpdateContext } from '../../../contexts/AppUpdateContext';
import i18n, { supportedLanguagesDropdownOptions } from '../../../i18n';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsQuery } from '@renderer/queries/settings';

const LanguageSettings = () => {
  const { t } = useTranslation();
  const { data: userSettings } = useQuery(settingsQuery.all);
  const queryClient = useQueryClient();

  const { addNewNotifications } = useContext(AppUpdateContext);
  const appLang = userSettings?.language || 'en';

  return (
    <li
      className="main-container performance-settings-container mb-16"
      id="language-settings-container"
    >
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 flex items-center text-2xl font-medium">
        <span className="material-icons-round-outlined mr-2 leading-none">translate</span>
        <span>{t('settingsPage.language')}</span>
      </div>
      <ul className="marker:bg-background-color-3 dark:marker:bg-background-color-3 list-disc pl-6">
        <li className="seekbar-scroll-interval mb-4">
          <div className="description">{t('settingsPage.languageDescription')}</div>
          <Dropdown
            className="mt-4"
            name="supportedLanguagesDropdown"
            value={appLang}
            options={supportedLanguagesDropdownOptions}
            onChange={async (e) => {
              const val = e.currentTarget.value as LanguageCodes;

              i18n.reloadResources();
              try {
                await i18n.changeLanguage(val);
                await window.api.settings.saveUserSettings({ language: val });
                queryClient.setQueryData<typeof userSettings>(
                  settingsQuery.all.queryKey,
                  (prev) => (prev ? { ...prev, language: val } : prev)
                );
                addNewNotifications([
                  {
                    id: 'languageChanged',
                    content: t('notifications.languageChanged'),
                    iconName: 'translate'
                  }
                ]);
                window.api.appControls.restartRenderer(`App language changed to ${val}`);
              } catch (error) {
                console.warn('Failed to change app language', error);
              }
            }}
          />
        </li>
      </ul>
    </li>
  );
};

export default LanguageSettings;
