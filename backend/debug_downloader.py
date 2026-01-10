from downloader import Downloader
from main import DownloadRequest
import os
import time

# Create dummy request
req = DownloadRequest(
    url="https://www.youtube.com/watch?v=jNQXAC9IVRw", # Me at the zoo (Short, reliable)
    platform="youtube",
    type="video",
    quality="1080",
    isPlaylist=False
)

dl = Downloader()
task_id = "test_task_" + str(int(time.time()))

print(f"Running test task: {task_id}")
try:
    dl.process_download(task_id, req)
    print("Download success!")
    print(dl.get_status(task_id))
except Exception as e:
    print(f"Download failed: {e}")
    # Check if task dir exists
    task_dir = os.path.join(dl.downloads_dir, task_id)
    if os.path.exists(task_dir):
        print(f"Task dir contains: {os.listdir(task_dir)}")
    else:
        print("Task dir does not exist")
