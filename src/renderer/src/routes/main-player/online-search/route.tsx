import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import Button from '@renderer/components/Button';

export const Route = createFileRoute('/main-player/online-search')({
  component: OnlineSearchPage
});

function OnlineSearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      const data = await window.api.onlineSearch.search(query);
      setResults(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (item: any) => {
    setDownloading(item.id);
    try {
      const result = await window.api.onlineSearch.download(item.downloadUrl, item.title, item.artist, item.album, item.artworkUrl);
      if (result.success) {
        // Ideally use a toast notification here
        console.log(`Downloaded: ${result.path}`);
      } else {
        console.error(`Error: ${result.error}`);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto p-8">
      <h1 className="text-3xl font-bold mb-6 text-font-color-black dark:text-font-color-white">Online Search</h1>
      
      <form onSubmit={handleSearch} className="flex gap-4 mb-8">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for songs..."
          className="flex-1 p-3 rounded-lg bg-background-color-2 dark:bg-dark-background-color-2 text-font-color-black dark:text-font-color-white border border-gray-300 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-theme-color"
        />
        <Button 
            label="Search" 
            clickHandler={(e) => handleSearch(e as any)}
            isDisabled={loading} 
            iconName="search"
        />
      </form>

      {loading && <div className="text-center text-font-color-black dark:text-font-color-white">Searching...</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {results.map((item) => (
          <div key={item.id} className="flex gap-4 p-4 rounded-lg bg-background-color-2 dark:bg-dark-background-color-2 hover:bg-background-color-3 dark:hover:bg-dark-background-color-3 transition-colors">
            <img src={item.artworkUrl} alt={item.title} className="w-20 h-20 rounded-md object-cover" />
            <div className="flex-1 min-w-0">
              <h3 className="font-bold text-font-color-black dark:text-font-color-white truncate" title={item.title}>{item.title}</h3>
              <p className="text-sm text-font-color-black dark:text-font-color-white opacity-70 truncate">{item.artist}</p>
              <p className="text-xs text-font-color-black dark:text-font-color-white opacity-50">{item.album}</p>
              <div className="mt-2">
                <Button 
                  label={downloading === item.id ? 'Downloading...' : 'Download'} 
                  clickHandler={() => handleDownload(item)}
                  isDisabled={!!downloading}
                  className="text-xs px-3 py-1"
                  iconName="download"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
