import React, { useState, useEffect, useRef } from 'react';
import { Download, Link, Loader2, CheckCircle2, AlertCircle, Youtube, Instagram, Twitter, Music, Video, FileDown, List, Check, Search, Play, X } from 'lucide-react';

const API_BASE = 'http://localhost:8000';

function formatSize(bytes) {
  if (!bytes) return '';
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  if (bytes === 0) return '0 Byte';
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  return Math.round(bytes / Math.pow(1024, i), 2) + ' ' + sizes[i];
}

function formatDuration(seconds) {
  if (!seconds) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')} `;
}

export default function MediaDownloader() {
  const [platform, setPlatform] = useState('youtube');
  const [downloadType, setDownloadType] = useState('video');
  const [quality, setQuality] = useState('1080');
  const [audioQuality, setAudioQuality] = useState('128');
  const [loading, setLoading] = useState(false);
  const [fetchingInfo, setFetchingInfo] = useState(false);
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(0);
  const [downloadLink, setDownloadLink] = useState(null);

  // Tab-specific state storage
  const [tabsData, setTabsData] = useState({
    youtube: { url: '', mediaInfo: null, playlistStart: '', playlistEnd: '' },
    playlist: { url: '', mediaInfo: null, playlistStart: '', playlistEnd: '' },
    instagram: { url: '', mediaInfo: null, playlistStart: '', playlistEnd: '' }
  });

  const [isPlaying, setIsPlaying] = useState(false);
  const debouncedUrl = useRef('');

  // Helper to access current tab's data
  // We use a getter to ensure we always have the latest state relative to 'platform'
  const activeData = tabsData[platform] || tabsData['youtube'];

  const setUrl = (newUrl) => {
    setTabsData(prev => ({
      ...prev,
      [platform]: { ...prev[platform], url: newUrl }
    }));
  };

  const setMediaInfo = (info) => {
    setTabsData(prev => ({
      ...prev,
      [platform]: { ...prev[platform], mediaInfo: info }
    }));
  };

  const setPlaylistStart = (val) => {
    setTabsData(prev => ({
      ...prev,
      [platform]: { ...prev[platform], playlistStart: val }
    }));
  };

  const setPlaylistEnd = (val) => {
    setTabsData(prev => ({
      ...prev,
      [platform]: { ...prev[platform], playlistEnd: val }
    }));
  };

  const videoQualities = [
    { value: '480', label: '480p' },
    { value: '720', label: '720p (HD)' },
    { value: '1080', label: '1080p (FHD)' },
    { value: '1440', label: '1440p (2K)' },
    { value: '2160', label: '2160p (4K)' },
    { value: '3840', label: '3840p (UHD)' }
  ];

  const audioQualities = [
    { value: '128', label: '128 kbps' },
    { value: '320', label: '320 kbps' }
  ];

  useEffect(() => {
    if (!loading) setStatus(null);
    if (!loading) setProgress(0);
    if (!loading) setDownloadLink(null);
  }, [platform, downloadType, quality, audioQuality]);

  useEffect(() => {
    if (status?.type === 'success') {
      const timer = setTimeout(() => setStatus(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [status]);

  useEffect(() => {
    // Current URL comes from activeData
    const currentUrl = activeData.url;
    if (!currentUrl) return;

    // Platform auto-switch logic (only if empty state in target tab?)
    // Actually, user wants tab persistence, so we shouldn't auto-switch as aggressively 
    // unless it's a fresh paste. For now, strict tab persistence means we respect the tab user clicked.
    // However, if user pastes an Insta link in Youtube tab, we might want to suggest switching.
    // But for simplicity and complying with "remember only youtube content", we keep logic simple.

    // We only fetch if URL changes
    const timer = setTimeout(() => {
      if (currentUrl !== debouncedUrl.current) {
        debouncedUrl.current = currentUrl;
        fetchMediaInfo();
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [activeData.url, platform]); // specific dependency on activeData.url

  const fetchMediaInfo = async () => {
    if (!activeData.url.trim()) return;
    setFetchingInfo(true);
    setMediaInfo(null); // Clear current result while fetching

    try {
      // Note: We use the 'platform' state as the source of truth for extracting
      // unless we want auto-detection.
      let detectionPlatform = platform;
      if (activeData.url.includes('instagram.com')) detectionPlatform = 'instagram';
      else if (activeData.url.includes('list=') || activeData.url.includes('playlist')) detectionPlatform = 'playlist';

      // If detected platform differs from current tab, we should probably JUST use the current tab's mode?
      // Or auto-switch? The user said "switch during this insta or playlist they not show", 
      // implying isolation. So we stick to current platform if possible, or just send 'currentPlatform' to backend.

      const res = await fetch(`${API_BASE}/api/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: activeData.url, platform: detectionPlatform, type: downloadType, quality: '1080' })
      });
      const data = await res.json();
      if (res.ok) {
        setMediaInfo(data);
        setIsPlaying(false);
        if (data.is_playlist && data.entries) {
          setPlaylistStart(1);
          setPlaylistEnd(Math.min(data.count, 10));
        }
      } else {
        setStatus({ type: 'error', message: 'Could not fetch details. Check URL.' });
      }
    } catch (e) {
      setStatus({ type: 'error', message: 'Connection Error' });
    } finally {
      setFetchingInfo(false);
    }
  };

  const handleDownload = async () => {
    if (!activeData.url.trim()) {
      setStatus({ type: 'error', message: 'Please enter a valid URL' });
      return;
    }

    setLoading(true);
    setStatus({ type: 'info', message: 'Starting Download...' });
    setProgress(0);
    setDownloadLink(null);

    try {
      // Determine effective platform based on URL content or tab
      let effectivePlatform = platform;
      if (activeData.url.includes('instagram.com')) effectivePlatform = 'instagram';
      else if (activeData.url.includes('list=') && platform === 'playlist') effectivePlatform = 'playlist';

      const payload = {
        url: activeData.url,
        platform: effectivePlatform,
        type: downloadType,
        quality: downloadType === 'audio' ? audioQuality : quality,
        isPlaylist: effectivePlatform === 'playlist' || (activeData.mediaInfo?.is_playlist),
        playlist_start: (effectivePlatform === 'playlist' || activeData.mediaInfo?.is_playlist) && activeData.playlistStart ? parseInt(activeData.playlistStart) : null,
        playlist_end: (effectivePlatform === 'playlist' || activeData.mediaInfo?.is_playlist) && activeData.playlistEnd ? parseInt(activeData.playlistEnd) : null
      };

      const res = await fetch(`${API_BASE}/api/queue-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('Failed to start download');

      const { task_id } = await res.json();

      const interval = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API_BASE}/api/status/${task_id}`);
          if (!statusRes.ok) return;

          const data = await statusRes.json();

          if (data.status === 'processing') {
            setStatus({ type: 'info', message: `Downloading... ${Math.round(data.progress)}%`, speed: data.speed, eta: data.eta });
            setProgress(data.progress);
          } else if (data.status === 'completed') {
            clearInterval(interval);
            setLoading(false);
            setProgress(100);
            setStatus({ type: 'success', message: 'Download Complete!' });

            // Auto-Download Trigger
            const trigger = (fid) => {
              const link = document.createElement('a');
              link.href = `${API_BASE}/api/file/${fid}`;
              link.setAttribute('download', ''); // Force download
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            };

            if (data.files && data.files.length > 0) {
              // Playlist: Download all files with small stagger
              data.files.forEach((f, i) => setTimeout(() => trigger(f), i * 800));
              setDownloadLink(`${API_BASE}/api/file/${data.files[0]}`); // Fallback link
            } else {
              trigger(data.file_id);
              setDownloadLink(`${API_BASE}/api/file/${data.file_id}`);
            }
          } else if (data.status === 'error') {
            clearInterval(interval);
            setLoading(false);
            setStatus({ type: 'error', message: data.error || 'Download failed' });
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }, 500);

    } catch (err) {
      setLoading(false);
      setStatus({ type: 'error', message: err.message });
    }
  };

  const downloadFile = () => {
    if (downloadLink) {
      window.location.href = downloadLink;
      setTimeout(() => {
        setStatus(null);
        setDownloadLink(null);
        setProgress(0);
      }, 3000);
    }
  };

  const handlePlaylistClick = (idx) => {
    const start = activeData.playlistStart;
    const end = activeData.playlistEnd;

    if (start === '' || (start !== '' && end !== '')) {
      setPlaylistStart(idx);
      setPlaylistEnd(idx);
    } else {
      let s = parseInt(start);
      let e = idx;
      if (e < s) {
        [s, e] = [e, s];
      }
      setPlaylistStart(s);
      setPlaylistEnd(e);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#12122b] via-[#212140] to-[#12122b] text-white font-sans selection:bg-purple-500 selection:text-white overflow-x-hidden">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap');
        body { font-family: 'Outfit', sans-serif; }
        .glass-panel {
          background: rgba(255, 255, 255, 0.04);
          backdrop-filter: blur(24px);
          -webkit-backdrop-filter: blur(24px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 10px 40px -10px rgba(0, 0, 0, 0.5);
        }
        .neon-glow {
          box-shadow: 0 0 20px rgba(124, 58, 237, 0.3);
        }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.1); border-radius: 20px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }
        
        @keyframes gradient-x {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .animate-gradient-x {
          background-size: 200% 200%;
          animation: gradient-x 2s ease infinite;
        }
      `}</style>

      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] bg-purple-600/30 rounded-full blur-[100px] mix-blend-screen animate-pulse duration-3000"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] bg-blue-600/30 rounded-full blur-[100px] mix-blend-screen animate-pulse duration-5000" style={{ animationDelay: '1s' }}></div>
        <div className="absolute top-[40%] left-[40%] w-[30vw] h-[30vw] bg-pink-600/20 rounded-full blur-[100px] mix-blend-screen animate-pulse duration-4000" style={{ animationDelay: '2s' }}></div>
      </div>

      <div className="relative z-10 container mx-auto px-6 py-10 min-h-screen flex flex-col items-center justify-center">

        {/* Title */}
        <div className="text-center mb-16 relative">
          <div className="absolute -inset-10 bg-gradient-to-r from-purple-500/20 to-blue-500/20 blur-3xl rounded-full opacity-50"></div>
          <div className="relative flex items-center justify-center gap-4 mb-2">
            <div className="p-3 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-500 shadow-lg shadow-purple-500/30">
              <Download className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-6xl font-black text-white tracking-tight drop-shadow-xl">Downify</h1>
          </div>
          <p className="text-lg text-white/40 tracking-[0.2em] font-medium uppercase">Ultra-Premium Downloader</p>
        </div>

        {/* Content Container (Fixed Width Cards, Side-by-Side) */}
        <div className="flex flex-col xl:flex-row items-center justify-center gap-8 w-full max-w-[95vw] transition-all duration-500">

          {/* Left Card: Controls (Fixed Width) */}
          <div className={`w-full max-w-[620px] transition-all duration-500 ${activeData.mediaInfo?.is_playlist ? '' : ''}`}>
            <div className="glass-panel rounded-[2.5rem] p-8 md:p-10 relative overflow-hidden">

              {/* Tabs */}
              <div className="flex p-1.5 bg-black/20 rounded-2xl mb-8 border border-white/5 backdrop-blur-md">
                {[
                  { id: 'youtube', icon: Youtube, label: 'YouTube', color: 'bg-red-500' },
                  { id: 'playlist', icon: List, label: 'Playlist', color: 'bg-blue-500' },
                  { id: 'instagram', icon: Instagram, label: 'Instagram', color: 'bg-gradient-to-tr from-purple-500 to-orange-500' }
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => { setPlatform(p.id); setStatus(null); setIsPlaying(false); }}
                    className={`flex-1 py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${platform === p.id
                      ? `${p.color} text-white shadow-lg scale-100 ring-1 ring-white/20`
                      : 'text-white/40 hover:text-white hover:bg-white/5'
                      }`}
                  >
                    <p.icon size={18} /> <span className="text-sm md:text-base">{p.label}</span>
                  </button>
                ))}
              </div>

              {/* Input */}
              <div className="relative mb-8 group">
                <div className={`absolute -inset-0.5 rounded-2xl opacity-0 group-focus-within:opacity-100 blur transition duration-500 bg-gradient-to-r ${platform === 'youtube' ? 'from-red-500 to-orange-500' : 'from-blue-500 to-purple-500'}`}></div>
                <div className="relative bg-[#0f0f1a] rounded-2xl flex items-center border border-white/10 group-focus-within:border-transparent transition-all">
                  <div className="pl-6 text-white/30"><Search size={22} /></div>
                  <input
                    type="text"
                    value={activeData.url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="Paste link here..."
                    className="w-full px-5 py-5 bg-transparent text-white text-lg placeholder-white/20 focus:outline-none font-medium"
                  />
                  {fetchingInfo && <div className="pr-5"><Loader2 className="animate-spin text-white/40" /></div>}
                </div>
              </div>

              {/* Media Preview (Interactive) */}
              {activeData.mediaInfo && !activeData.mediaInfo.is_playlist && (
                <div className="mb-8 bg-black/40 rounded-2xl overflow-hidden border border-white/10 shadow-2xl relative group">
                  {/* Neon Glow Border */}
                  <div className="absolute inset-0 rounded-2xl ring-1 ring-white/10 group-hover:ring-white/30 transition-all pointer-events-none z-20"></div>

                  {isPlaying ? (
                    <div className="aspect-video w-full bg-black relative">
                      {activeData.mediaInfo.platform === 'youtube' || platform === 'youtube' ? (
                        <iframe
                          src={`https://www.youtube.com/embed/${activeData.mediaInfo.id}?autoplay=1`}
                          title="Preview"
                          className="w-full h-full absolute inset-0"
                          allow="autoplay; encrypted-media"
                          allowFullScreen
                        ></iframe>
                      ) : activeData.mediaInfo.video_url ? (
                        <video controls autoPlay src={activeData.mediaInfo.video_url} className="w-full h-full object-contain" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white/50 bg-white/5">
                          <div className="text-center">
                            <Video size={48} className="mx-auto mb-2 opacity-50" />
                            <p className="text-sm font-bold uppercase tracking-widest">Preview Mode</p>
                          </div>
                        </div>
                      )}
                      <button
                        onClick={() => setIsPlaying(false)}
                        className="absolute top-4 right-4 bg-black/60 backdrop-blur-md text-white p-2 rounded-full hover:bg-black/80 transition-all z-30"
                      >
                        <X size={20} />
                      </button>
                    </div>
                  ) : (
                    <div className={`relative aspect-video w-full ${!activeData.mediaInfo.is_playlist ? 'cursor-pointer group/preview' : ''}`} onClick={() => !activeData.mediaInfo.is_playlist && setIsPlaying(true)}>
                      {activeData.mediaInfo.thumbnail ? (
                        <img src={activeData.mediaInfo.thumbnail} alt="Ref" className={`w-full h-full object-cover ${!activeData.mediaInfo.is_playlist ? 'opacity-60 group-hover/preview:opacity-40' : 'opacity-80'} transition-all duration-500 scale-100 ${!activeData.mediaInfo.is_playlist ? 'group-hover/preview:scale-105' : ''}`} />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-indigo-900 via-purple-900 to-black flex items-center justify-center">
                          <Video className="text-white/20 w-16 h-16" />
                        </div>
                      )}

                      {/* Play Button Overlay (Only for non-playlist) */}
                      {!activeData.mediaInfo.is_playlist && (
                        <div className="absolute inset-0 flex items-center justify-center z-10">
                          <div className="w-16 h-16 bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center border border-white/20 shadow-[0_0_30px_rgba(255,255,255,0.1)] group-hover/preview:scale-110 transition-all duration-300 group-hover/preview:bg-white/20">
                            <Play className="fill-white text-white ml-1" size={32} />
                          </div>
                        </div>
                      )}

                      {/* Info Overlay */}
                      <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
                        <h3 className="font-bold text-xl text-white leading-tight mb-1 line-clamp-1 drop-shadow-md">{activeData.mediaInfo.title || 'Unknown Media'}</h3>
                        <div className="flex items-center gap-3 text-xs font-bold text-blue-200 uppercase tracking-wider">
                          <span className="bg-blue-600/30 px-2 py-0.5 rounded text-blue-100">{activeData.mediaInfo.platform}</span>
                          {activeData.mediaInfo.duration && <span>{formatDuration(activeData.mediaInfo.duration)}</span>}
                          {activeData.mediaInfo.is_playlist && <span className="bg-purple-600/30 px-2 py-0.5 rounded text-purple-100">PLAYLIST</span>}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}


              {/* Playlist Settings (Manual Override) */}
              {platform === 'playlist' && (
                <div className="flex gap-4 mb-8">
                  <div className="flex-1 bg-white/5 rounded-2xl p-4 border border-white/5 focus-within:border-white/20 transition-all">
                    <label className="text-[10px] uppercase font-bold text-white/30 block mb-1">Start #</label>
                    <input type="number" value={activeData.playlistStart || ''} onChange={e => setPlaylistStart(e.target.value)} className="w-full bg-transparent text-2xl font-bold text-white focus:outline-none text-center" placeholder="1" />
                  </div>
                  <div className="flex-1 bg-white/5 rounded-2xl p-4 border border-white/5 focus-within:border-white/20 transition-all text-right">
                    <label className="text-[10px] uppercase font-bold text-white/30 block mb-1">End #</label>
                    <input type="number" value={activeData.playlistEnd || ''} onChange={e => setPlaylistEnd(e.target.value)} className="w-full bg-transparent text-2xl font-bold text-white focus:outline-none text-center" placeholder="Max" />
                  </div>
                </div>
              )}

              {/* Format Selection (Tabs) */}
              <div className="mb-6">
                <div className="text-xs font-bold text-white/30 uppercase tracking-widest mb-3">Format</div>
                <div className="bg-black/20 p-1.5 rounded-xl flex border border-white/5">
                  <button onClick={() => setDownloadType('video')} className={`flex-1 py-3 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all ${downloadType === 'video' ? 'bg-white/10 text-white shadow-sm' : 'text-white/30 hover:text-white'}`}><Video size={16} /> Video</button>
                  <button onClick={() => setDownloadType('audio')} className={`flex-1 py-3 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all ${downloadType === 'audio' ? 'bg-white/10 text-white shadow-sm' : 'text-white/30 hover:text-white'}`}><Music size={16} /> Audio</button>
                </div>
              </div>

              {/* Quality Selection (Grid) */}
              <div className="mb-10">
                <div className="text-xs font-bold text-white/30 uppercase tracking-widest mb-3">Quality</div>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                  {(downloadType === 'video' ? videoQualities : audioQualities).map(q => (
                    <button
                      key={q.value}
                      onClick={() => downloadType === 'video' ? setQuality(q.value) : setAudioQuality(q.value)}
                      className={`relative p-3 rounded-xl border text-left transition-all group overflow-hidden ${(downloadType === 'video' ? quality : audioQuality) === q.value
                        ? 'bg-blue-600/20 border-blue-500/50 shadow-[0_0_15px_rgba(37,99,235,0.2)]'
                        : 'bg-white/5 border-transparent hover:bg-white/10'
                        }`}
                    >
                      <span className={`block text-sm font-bold ${(downloadType === 'video' ? quality : audioQuality) === q.value ? 'text-white' : 'text-white/60'}`}>{q.label}</span>
                      {activeData.mediaInfo?.sizes?.[q.value] && (
                        <span className={`text-[10px] font-medium block mt-0.5 ${(downloadType === 'video' ? quality : audioQuality) === q.value ? 'text-blue-200' : 'text-white/20'}`}>{formatSize(activeData.mediaInfo.sizes[q.value])}</span>
                      )}
                      {(downloadType === 'video' ? quality : audioQuality) === q.value && (
                        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-400 shadow-[0_0_10px_#60a5fa]"></div>
                      )}

                    </button>
                  ))}
                </div>
              </div>

              {/* Download Button */}
              <button
                onClick={!downloadLink ? handleDownload : downloadFile}
                disabled={loading}
                className={`w-full py-6 rounded-2xl font-black text-xl tracking-wide shadow-2xl transition-all relative overflow-hidden group ${downloadLink
                  ? 'bg-emerald-500 shadow-emerald-500/40 hover:shadow-emerald-500/60 hover:scale-[1.02]'
                  : 'bg-blue-600 shadow-blue-600/40 hover:shadow-[0_0_40px_rgba(37,99,235,0.6)] hover:scale-[1.02] active:scale-[0.98]'
                  }`}
              >
                <div className={`absolute inset-0 bg-gradient-to-r ${downloadLink ? 'from-emerald-400 to-emerald-600' : 'from-blue-500 via-indigo-500 to-purple-600'} transition-all duration-500 opacity-80 group-hover:opacity-100 ${loading ? 'animate-pulse' : ''}`}></div>
                <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 brightness-100 mix-blend-overlay"></div>

                <span className="relative z-10 flex items-center justify-center gap-3 drop-shadow-md">
                  {loading ? <Loader2 className="animate-spin" strokeWidth={3} /> : downloadLink ? <FileDown strokeWidth={3} /> : <Download strokeWidth={3} />}
                  {loading ? "PROCESSING..." : downloadLink ? "SAVE FILE" : "DOWNLOAD"}
                </span>
              </button>

              {/* Cyber Progress Bar (New) */}
              {
                loading && (
                  <div className="mt-8 bg-black/40 rounded-2xl p-6 border border-white/10 relative overflow-hidden animate-fade-in-up">
                    {/* Detailed Stats Header */}
                    <div className="flex justify-between items-end mb-4 relative z-10">
                      <div>
                        <div className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1">Status</div>
                        <div className="text-white font-bold flex items-center gap-2">
                          <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
                          DOWNLOADING...
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1">Percentage</div>
                        <div className="text-3xl font-black text-white leading-none">{Math.round(progress)}<span className="text-lg text-white/40">%</span></div>
                      </div>
                    </div>

                    {/* The Bar */}
                    <div className="h-6 w-full bg-white/5 rounded-full overflow-hidden border border-white/5 relative z-10 box-content p-1">
                      <div className="h-full rounded-full bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 relative transition-all duration-300 ease-out shadow-[0_0_20px_rgba(59,130,246,0.5)]" style={{ width: `${Math.max(5, progress)}%` }}>
                        {/* Stripe animation */}
                        {/* <div className="absolute inset-0" style={{backgroundImage: 'linear-gradient(45deg,rgba(255,255,255,0.15) 25%,transparent 25%,transparent 50%,rgba(255,255,255,0.15) 50%,rgba(255,255,255,0.15) 75%,transparent 75%,transparent)', backgroundSize: '1rem 1rem'}}></div> */}
                        <div className="w-full h-full bg-white/10 animate-pulse"></div>
                      </div>
                    </div>

                    {/* Speed and ETA (Footer) */}
                    <div className="flex justify-between items-center mt-4 relative z-10">
                      <div className="bg-white/5 rounded-lg px-3 py-2 border border-white/5">
                        <span className="text-[10px] text-white/40 font-bold uppercase block">Speed</span>
                        <span className="text-sm font-mono text-blue-300">{status?.speed ? formatSize(status.speed) + '/s' : '--'}</span>
                      </div>
                      <div className="bg-white/5 rounded-lg px-3 py-2 border border-white/5">
                        <span className="text-[10px] text-white/40 font-bold uppercase block">Time Left</span>
                        <span className="text-sm font-mono text-purple-300">{status?.eta ? status.eta + 's' : '--'}</span>
                      </div>
                    </div>
                  </div>
                )
              }

            </div>
          </div>

          {/* Right Card: Playlist (Fixed Width, Slides In) */}
          {
            activeData.mediaInfo?.is_playlist && activeData.mediaInfo.entries && (
              <div className="w-full max-w-[550px] animate-fade-in-right h-[800px]">
                <div className="glass-panel rounded-[2.5rem] p-8 h-full flex flex-col">
                  <div className="pb-6 border-b border-white/5 mb-4">
                    <h2 className="text-2xl font-bold text-white mb-1 line-clamp-1">{activeData.mediaInfo.title}</h2>
                    <div className="flex items-center gap-3 text-sm font-medium text-white/40">
                      <span>{activeData.mediaInfo.entries.length} Videos</span>
                      <span>•</span>
                      <span>{formatDuration(activeData.mediaInfo.entries.reduce((acc, curr) => acc + (curr.duration || 0), 0))} Total</span>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-2">
                    {activeData.mediaInfo.entries.map((entry) => {
                      const idx = entry.index;
                      const isStart = idx === parseInt(activeData.playlistStart);
                      const isEnd = idx === parseInt(activeData.playlistEnd);
                      const inRange = idx > (parseInt(activeData.playlistStart) || 0) && idx < (parseInt(activeData.playlistEnd) || 0);
                      const isSelected = isStart || isEnd || inRange;

                      return (
                        <div
                          key={idx}
                          onClick={() => handlePlaylistClick(idx)}
                          className={`p-3 rounded-xl flex items-center gap-4 cursor-pointer border transition-all ${isSelected
                            ? 'bg-blue-600/20 border-blue-500/50'
                            : 'bg-white/5 border-transparent hover:bg-white/10'
                            }`}
                        >
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${isSelected ? 'bg-blue-500 text-white' : 'bg-black/30 text-white/30'
                            }`}>
                            {isStart || isEnd ? <Check size={14} /> : idx}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className={`text-sm font-semibold truncate ${isSelected ? 'text-white' : 'text-white/60'}`}>{entry.title}</h4>
                            <span className="text-[10px] font-bold text-white/20">{formatDuration(entry.duration)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="pt-4 text-center text-xs font-bold text-white/30 uppercase tracking-widest">
                    Tap to Select Range
                  </div>
                </div>
              </div>
            )
          }

        </div>

        {
          status && (status.type === 'success' || status.type === 'error') && (
            <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
              <div className={`pointer-events-auto bg-[#1a1c2e]/90 backdrop-blur-md border border-white/10 px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 animate-fade-in-down ${status.type === 'error' ? 'shadow-red-500/20 border-red-500/20 text-red-100' : 'shadow-green-500/20 border-green-500/20 text-green-100'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${status.type === 'error' ? 'bg-red-500/20 text-red-500' : 'bg-green-500/20 text-green-500'}`}>
                  {status.type === 'error' ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
                </div>
                <h3 className="text-sm font-bold">{status.message}</h3>
              </div>
            </div>
          )
        }

      </div>
    </div>
  );
}
