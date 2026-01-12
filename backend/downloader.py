import yt_dlp
import os
import threading
import json
import shutil

class Downloader:
    def __init__(self):
        self.downloads_dir = os.path.join(os.getcwd(), "downloads")
        os.makedirs(self.downloads_dir, exist_ok=True)
        self.tasks = {} # task_id -> {status, progress, file_id, error}
        
        # Check for FFmpeg once on init
        # Check for FFmpeg once on init
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
                    # Use Total Bitrate (tbr) if available
                    if f.get('tbr') and duration: return int(f['tbr'] * 1000 / 8 * duration)
                    # Use Video+Audio Bitrate if available
                    if f.get('vbr') and duration:
                        vbr = f['vbr']
                        abr = f.get('abr', 128) # Default audio 128k
                        return int((vbr + abr) * 1000 / 8 * duration)
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
                # First, gather all available unique heights
                unique_heights = sorted(list(set([f.get('height') for f in formats if f.get('height') and f.get('vcodec') != 'none'])))
                
                for q in unique_heights:
                    candidates = [f for f in formats if f.get('height') == q and f.get('vcodec') != 'none']
                    if candidates:
                        best_vid = max(candidates, key=lambda x: get_size(x))
                        vid_size = get_size(best_vid)
                        
                        if vid_size > 0:
                            if best_vid.get('acodec') != 'none':
                                total = vid_size
                            else:
                                total = vid_size + best_audio_size
                            sizes[str(q)] = total

                # Audio Sizes
                if duration:
                    sizes['128'] = int(128 * 1000 / 8 * duration)
                    sizes['320'] = int(320 * 1000 / 8 * duration)

                # Fallback Estimation for missing sizes (e.g. Instagram)
                # Check for "0" sizes or missing sizes and estimate them
                # We prioritize the calculated sizes above, but if they failed (0), we guess.
                
                # If sizes is empty but we have duration, we should populate for standard resolutions if they "likely" exist?
                # Actually, for Instagram, we usually only see one resolution.
                
                for k, v in sizes.items():
                    if v == 0 and duration:
                         # key is resolution (str)
                         if k.isdigit():
                             res = int(k)
                             # Revised Constants (More Realistic for Web/Social Media)
                             # 1080p: ~2000kbps (was 3000)
                             # 720p: ~1000kbps (was 1500)
                             # 480p: ~700kbps
                             bitrate = 2000 if res >= 1080 else 1000 if res >= 720 else 700
                             sizes[k] = int(bitrate * 1000 / 8 * duration)
                             
                # Special Case: If we have NO sizes but valid duration (e.g. some Instagram cases with no heights parsed?)
                # We assume 1080p equivalent exists.
                if not sizes and duration:
                    sizes['1080'] = int(2000 * 1000 / 8 * duration)

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
            # Determine Output Directory (Smart Folders)
            # Fetch info first to get title for folder name? 
            # We can use the request.url to get a quick title or just use task_id initially and rename?
            # Better: use yt-dlp to download directly to final folder.
            
            # For playlists, we want a folder name. For single files, maybe just the file in downloads (user didn't convert to zip)
            # actually user asked for "one new folder with good playlist name"
            
            # We'll stick to task_dir for temp processing to avoid concurrency issues, 
            # BUT we will change how we finalize.
            
            ydl_opts = {
                'outtmpl': os.path.join(task_dir, '%(title)s.%(ext)s'),
                'progress_hooks': [lambda d: self._progress_hook(task_id, d)],
                # 'quiet': True,
                'verbose': True, 
                'overwrites': True,
                'ignoreerrors': True, 
                'restrictedfilenames': True,
                'force_ipv4': True, 
                'ffmpeg_location': shutil.which('ffmpeg'),
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
                    # Map requested quality
                    target_height = 480
                    if request.quality == '4320': target_height = 4320
                    elif request.quality == '3840': target_height = 3840
                    elif request.quality == '2160': target_height = 2160
                    elif request.quality == '1440': target_height = 1440
                    elif request.quality == '1080': target_height = 1080
                    elif request.quality == '720': target_height = 720
                    
                    # Detect Source Resolution (Fast Check)
                    should_upscale = False
                    try:
                        with yt_dlp.YoutubeDL({'quiet':True, 'force_ipv4':True}) as ydl_temp:
                             info = ydl_temp.extract_info(request.url, download=False)
                             best_height = 0
                             if 'formats' in info:
                                 v_formats = [f for f in info['formats'] if f.get('height') and f.get('vcodec') != 'none']
                                 if v_formats:
                                     best_height = max(f['height'] for f in v_formats)
                             
                             if best_height > 0 and best_height < target_height:
                                 should_upscale = True
                                 print(f"Task {task_id}: Smart Upscaling Active ({best_height}p -> {target_height}p)")
                             elif best_height == 0 and target_height >= 1440:
                                 # Fallback: If we couldn't detect height (common on some extractors like Insta),
                                 # but user wants high quality (2K/4K), assume source is lower and FORCE upscale.
                                 should_upscale = True
                                 print(f"Task {task_id}: Force Upscaling (Unknown Source Height) -> {target_height}p")
                             else:
                                 print(f"Task {task_id}: Upscale NOT needed. Best found: {best_height}p, Target: {target_height}p")
                    except Exception as e:
                        print(f"Upscale check error: {e}")
                        # On error, if high quality requested, force it?
                        if target_height >= 1440:
                            should_upscale = True
                            print(f"Task {task_id}: Error checking source, forcing upscale to {target_height}p safely.")

                    if should_upscale:
                        print(f"Task {task_id}: APPLYING FFMPEG SCALE")
                        # Upscale Mode: Re-encode video with scale filter, ensure audio is included (AAC)
                        ydl_opts.update({
                            'format': 'bestvideo+bestaudio/best',
                            'merge_output_format': 'mp4',
                            'postprocessor_args': {
                                'ffmpeg': [
                                    '-vf', f'scale=-2:{target_height}:flags=lanczos',
                                    '-c:v', 'libx264',
                                    '-preset', 'fast', # Speed up re-encoding
                                    '-c:a', 'aac',    # Force Audio
                                    '-b:a', '192k'
                                ]
                            }
                        })
                    else:
                        # Native Mode: Try to get exact match
                        ydl_opts.update({
                            'format': f'bestvideo[height={target_height}]+bestaudio/bestvideo+bestaudio/best',
                            'merge_output_format': 'mp4',
                        })
                else:
                    # No FFmpeg? Fast fallback immediate
                    print(f"Task {task_id}: FFmpeg missing, forcing standard quality (single file).")
                    ydl_opts['format'] = 'best'


            if request.platform == 'playlist' or request.isPlaylist:
                ydl_opts['yes_playlist'] = True
                if request.playlist_start or request.playlist_end:
                     # ensure 1-based index is handled correctly by yt-dlp (it expects 1-based)
                     start = request.playlist_start if request.playlist_start else 1
                     if request.playlist_end:
                         ydl_opts['playlist_items'] = f"{start}-{request.playlist_end}"
                     else:
                         ydl_opts['playlist_items'] = f"{start}:"
            else:
                ydl_opts['noplaylist'] = True

            # Execute Download
            print(f"Starting download for task {task_id}")
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.extract_info(request.url, download=True)

            # Check files
            files = os.listdir(task_dir)

            # Manual Merge Fallback (If yt-dlp failed to merge)
            if len(files) >= 2 and not (request.platform == 'playlist' or request.isPlaylist):
                print(f"Task {task_id}: Detected separate files, attempting manual merge...")
                import subprocess
                
                video_files = [f for f in files if f.endswith('.mp4') or f.endswith('.webm')]
                audio_files = [f for f in files if f.endswith('.m4a') or f.endswith('.mp3')] # Common audio formats
                
                if video_files and audio_files:
                    v_file = os.path.join(task_dir, video_files[0])
                    a_file = os.path.join(task_dir, audio_files[0])
                    out_file = os.path.join(task_dir, "merged_output.mp4")
                    
                    cmd = [
                        shutil.which('ffmpeg'),
                        '-i', v_file,
                        '-i', a_file,
                        '-c:v', 'copy', # Video is likely already processed/scaled
                        '-c:a', 'aac',  # Ensure audio is AAC
                        '-strict', 'experimental',
                        out_file
                    ]
                    
                    try:
                        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        print(f"Task {task_id}: Manual merge successful.")
                        # Remove originals
                        os.remove(v_file)
                        os.remove(a_file)
                        files = ["merged_output.mp4"]
                    except Exception as e:
                        print(f"Manual merge failed: {e}")

            
            # Fallback logic removed as we decide upfront based on capability
            if not files:
                 # Last ditch effort if even single file failed (unexpected)
                 raise Exception("Download failed (No files found).")
                
            # Post-Download Organization
            # If playlist, move task_dir to downloads/Title
            # If single, move file to downloads/
            
            final_filenames = []
            final_path = ""
            
            if request.isPlaylist or request.platform == 'playlist':
                 # Get playlist title from first file or by metadata? 
                 # Usually we can get it from extraction, but we skipped it here.
                 # Let's naming convention: "Playlist_<task_id>" if we can't find better, 
                 # or try to extract title from one of the files info json if we saved it?
                 # Simpler: Use "Playlist_{First_File_Name_Base}" or just let the user see the folder.
                 # Updated Requirement: "one new folder with good playlist name"
                 
                 # Let's attempt to retrieve playlist title via a quick extract if costly? No.
                 # Let's use the task_id as unique folder for now but rename it if possible.
                 # Actually, let's look at the filenames.
                 
                 # Use title if available
                 import re
                 safe_title = re.sub(r'[<>:"/\\|?*]', '_', request.title) if request.title else f"Playlist_{task_id[:8]}"
                 final_folder_name = safe_title
                 
                 final_playlist_dir = os.path.join(self.downloads_dir, final_folder_name)
                 if os.path.exists(final_playlist_dir): 
                     # If exists, maybe append task_id to avoid collision or just merge?
                     # User wants "one new folder", implying overwrite or merge.
                     # Let's clean it if it exists to be fresh? Or just merge.
                     # "Clean it" might delete previous downloads. Merge is safer but might leave old files.
                     # Let's remove if it exists to ensure exact match of current request? 
                     # No, that's dangerous. Let's start fresh.
                     pass 
                 else:
                     os.makedirs(final_playlist_dir, exist_ok=True)
                 
                 # Move contents of task_dir to final_playlist_dir
                 # task_dir has the files
                 for file in os.listdir(task_dir):
                     shutil.move(os.path.join(task_dir, file), os.path.join(final_playlist_dir, file))
                 
                 os.rmdir(task_dir)
                 
                 final_filenames = os.listdir(final_playlist_dir)
                 final_path = final_folder_name
                 
                 # Update task to reflect folder
                 self.tasks[task_id]['output_type'] = 'folder'
                 self.tasks[task_id]['file_id'] = final_folder_name
                 
            else:
                # Single file behavior (keep existing)
                for file in files:
                    src = os.path.join(task_dir, file)
                    dest = os.path.join(self.downloads_dir, file)
                    if os.path.exists(dest): os.remove(dest)
                    os.rename(src, dest)
                    final_filenames.append(file)
                os.rmdir(task_dir)
                self.tasks[task_id]['output_type'] = 'file'
                self.tasks[task_id]['file_id'] = final_filenames[0]

            self.tasks[task_id]['status'] = 'completed'
            self.tasks[task_id]['files'] = final_filenames
            self.tasks[task_id]['progress'] = 100
                
        except Exception as e:
            self.tasks[task_id] = {"status": "error", "error": str(e)}
            # Cleanup on error
            if os.path.exists(task_dir):
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
            filename = os.path.basename(d.get('filename', 'Unknown'))
            
            # Playlist Info
            info = d.get('info_dict', {})
            playlist_index = info.get('playlist_index')
            n_entries = info.get('n_entries')
            
            self.tasks[task_id]['status'] = 'processing' # Keep status as processing for UI
            self.tasks[task_id]['progress'] = float(p)
            self.tasks[task_id]['speed'] = speed
            self.tasks[task_id]['eta'] = eta
            self.tasks[task_id]['current_file'] = filename
            
            # Update Playlist Progress
            if playlist_index and n_entries:
                 self.tasks[task_id]['playlist_index'] = playlist_index
                 self.tasks[task_id]['playlist_total'] = n_entries
            
        elif d['status'] == 'finished':
            self.tasks[task_id]['progress'] = 100
            self.tasks[task_id]['status'] = 'processing' # Post-processing starts logic
