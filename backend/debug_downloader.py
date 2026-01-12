from downloader import Downloader
from main import DownloadRequest
import os
import time

# Create dummy request
req = DownloadRequest(
    url="https://www.youtube.com/watch?v=LXb3EKWsInQ", # 4K Video
    platform="youtube",
    type="video",
    quality="4320", # Request 8K
    isPlaylist=False,
    title="Debug 8K Test"
)

dl = Downloader()
task_id = "test_8k_" + str(int(time.time()))

print(f"Running test task: {task_id}")
try:
    dl.process_download(task_id, req)
    print("Download success!")
    print(f"Status: {dl.get_status(task_id)}")
    
except Exception as e:
    print(f"Download failed: {e}")
