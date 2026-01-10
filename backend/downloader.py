import yt_dlp
import os
import threading
import json

class Downloader:
    def __init__(self):
        self.downloads_dir = os.path.join(os.getcwd(), "downloads")
        os.makedirs(self.downloads_dir, exist_ok=True)
        self.tasks = {} # task_id -> {status, progress, file_id, error}
        
        # Check for FFmpeg once on init
        import shutil
        self.has_ffmpeg = shutil.which('ffmpeg') is not None
        if not self.has_ffmpeg:
            print("WARNING: FFmpeg not found. High quality video merging will be disabled.")
        else:
            print("FFmpeg detected. High quality enabled.")

    def extract_info(self, url):
        ydl_opts = {
            'quiet': True,
            'skip_download': True,
            'force_ipv4': True,
            'socket_timeout': 15,
            'extract_flat': 'in_playlist', # Critical for fast playlist fetching
            'no_warnings': True,
        }
        
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                
                if 'entries' in info:
                    # It's a playlist or multiple items
                    entries = []
                    # Handle cases where entries is a generator or list
                    raw_entries = list(info.get('entries', []))
                    
                    for idx, entry in enumerate(raw_entries):
                        if idx > 2000: break 
                        if not entry: continue
                        
                        entries.append({
                            "index": idx + 1,
                            "id": entry.get('id', 'N/A'),
                            "title": entry.get('title', f'Video {idx+1}'),
                            "duration": entry.get('duration', 0),
                            "thumbnail": entry.get('thumbnails', [{}])[-1].get('url') if entry.get('thumbnails') else None
                        })

                    return {
                        "is_playlist": True,
                        "title": info.get('title', 'Playlist'),
                        "count": len(entries),
                        "platform": info.get('extractor_key', 'custom'),
                        "entries": entries
                    }
                
                # ... (previous code) ...
                
                # Single video
                formats = info.get('formats', [])
                duration = info.get('duration', 0)
                
                # Helper to get size
                def get_size(f):
                    if f.get('filesize'): return f['filesize']
                    if f.get('filesize_approx'): return f['filesize_approx']
                    if f.get('tbr') and duration: return int(f['tbr'] * 1000 / 8 * duration)
                    return 0

                # Find best audio size (for merging)
                best_audio_size = 0
                audio_formats = [f for f in formats if f.get('vcodec') == 'none' and f.get('acodec') != 'none']
                if audio_formats:
                    best_audio_f = max(audio_formats, key=lambda x: x.get('abr', 0) or 0)
                    best_audio_size = get_size(best_audio_f)

                # Map qualities to sizes
                sizes = {}
                
                # Video Sizes (Video Stream + Best Audio Stream)
                for q in [480, 720, 1080, 1440, 2160, 3840]:
                    candidates = [f for f in formats if f.get('height') == q and f.get('vcodec') != 'none']
                    if candidates:
                        best_vid = max(candidates, key=lambda x: get_size(x))
                        vid_size = get_size(best_vid)
                        if best_vid.get('acodec') != 'none':
                            total = vid_size
                        else:
                            total = vid_size + best_audio_size
                        sizes[str(q)] = total

                # Audio Sizes
                if duration:
                    sizes['128'] = int(128 * 1000 / 8 * duration)
                    sizes['320'] = int(320 * 1000 / 8 * duration)

                # Get Direct Playback URL
                playback_url = info.get('url')
                if not playback_url:
                     # Try to find a suitable mp4 format for playback
                     playback_formats = [f for f in formats if f.get('vcodec') != 'none' and f.get('acodec') != 'none' and f.get('ext') == 'mp4']
                     if playback_formats:
                         playback_url = playback_formats[-1].get('url') # Use the last (usually highest quality) one

                return {
                    "is_playlist": False,
                    "id": info.get('id'),
                    "title": info.get('title'),
                    "thumbnail": info.get('thumbnail'),
                    "duration": duration,
                    "platform": info.get('extractor_key'),
                    "sizes": sizes,
                    "video_url": playback_url
                }


        except Exception as e:
            # Fallback if something fails
            print(f"Extraction error: {e}")
            return {"title": "Unknown Media", "thumbnail": "", "sizes": {}}

    def get_status(self, task_id):
        return self.tasks.get(task_id)

    def get_file_path(self, file_id):
        return os.path.join(self.downloads_dir, file_id)

    def process_download(self, task_id, request):
        self.tasks[task_id] = {"status": "processing", "progress": 0}
        
        # specific directory for this task to avoid file conflicts and easy zipping
        task_dir = os.path.join(self.downloads_dir, task_id)
        os.makedirs(task_dir, exist_ok=True)
        
        try:
            ydl_opts = {
                'outtmpl': os.path.join(task_dir, '%(title)s.%(ext)s'),
                'progress_hooks': [lambda d: self._progress_hook(task_id, d)],
                # 'quiet': True,
                'verbose': True, # Enable verbose logging
                'overwrites': True,
                # Stop on errors for playlists? Maybe ignore.
                'ignoreerrors': True, 
                'restrictedfilenames': True, # Safer filenames
                'force_ipv4': True, # Fix for some network blocks
            }
            print(f"Starting download for task {task_id} in {task_dir}")
            
            if request.type == 'audio':
                ydl_opts.update({
                    'format': 'bestaudio/best',
                    'postprocessors': [{
                        'key': 'FFmpegExtractAudio',
                        'preferredcodec': 'mp3',
                        'preferredquality': request.quality,
                    }],
                })
            else:
                # Video Logic
                use_high_quality = self.has_ffmpeg
                
                if use_high_quality:
                    # Try best quality (requires FFmpeg usually)
                    if request.quality == '3840': height = 3840
                    elif request.quality == '2160': height = 2160
                    elif request.quality == '1440': height = 1440
                    elif request.quality == '1080': height = 1080
                    elif request.quality == '720': height = 720
                    else: height = 480
                    
                    ydl_opts.update({
                        'format': f'bestvideo[height={height}]+bestaudio/bestvideo[height<={height}]+bestaudio/best[height<={height}]',
                        'merge_output_format': 'mp4',
                    })
                else:
                    # No FFmpeg? Fast fallback immediate
                    print(f"Task {task_id}: FFmpeg missing, forcing standard quality (single file).")
                    ydl_opts['format'] = 'best'


            if request.platform == 'playlist' or request.isPlaylist:
                ydl_opts['yes_playlist'] = True
                if request.playlist_start and request.playlist_end:
                    ydl_opts['playlist_items'] = f"{request.playlist_start}-{request.playlist_end}"
                elif request.playlist_start:
                    ydl_opts['playlist_items'] = f"{request.playlist_start}:"
            else:
                ydl_opts['noplaylist'] = True

            # Execute Download
            print(f"Starting download for task {task_id}")
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.extract_info(request.url, download=True)

            # Check files
            files = os.listdir(task_dir)
            
            # Fallback logic removed as we decide upfront based on capability
            if not files:
                 # Last ditch effort if even single file failed (unexpected)
                 raise Exception("Download failed (No files found).")
                
            final_filenames = []
            for file in files:
                src = os.path.join(task_dir, file)
                dest = os.path.join(self.downloads_dir, file)
                if os.path.exists(dest): os.remove(dest)
                os.rename(src, dest)
                final_filenames.append(file)
            
            os.rmdir(task_dir)

            self.tasks[task_id]['status'] = 'completed'
            self.tasks[task_id]['file_id'] = final_filenames[0] # Primary file for simple cases
            self.tasks[task_id]['files'] = final_filenames      # All files for playlists
            self.tasks[task_id]['progress'] = 100
                
        except Exception as e:
            self.tasks[task_id] = {"status": "error", "error": str(e)}
            # Cleanup on error
            if os.path.exists(task_dir):
                import shutil
                shutil.rmtree(task_dir)




    def _progress_hook(self, task_id, d):
        if d['status'] == 'downloading':
            p = d.get('_percent_str', '0%').strip().replace('%','')
            # Remove ANSI colors if present
            import re
            p = re.sub(r'\x1b[[0-9;]*m', '', p)
            
            # Extract Speed and ETA
            speed = d.get('speed', 0) # bytes/s
            eta = d.get('eta', 0) # seconds
            
            self.tasks[task_id]['progress'] = float(p)
            self.tasks[task_id]['speed'] = speed
            self.tasks[task_id]['eta'] = eta
            
        elif d['status'] == 'finished':
            self.tasks[task_id]['progress'] = 100
            self.tasks[task_id]['status'] = 'processing' # Post-processing starts
