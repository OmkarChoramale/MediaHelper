from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import Optional
import os
import uuid
from downloader import Downloader

app = FastAPI(title="Downify API")

# CORS Setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

downloader_service = Downloader()

class DownloadRequest(BaseModel):
    url: str
    platform: str
    type: str  # video or audio
    quality: str # 1080, 128, etc.
    isPlaylist: bool = False
    playlist_start: Optional[int] = None
    playlist_end: Optional[int] = None

@app.get("/")
def read_root():
    return {"message": "Downify API is running"}

@app.post("/api/extract")
async def extract_info(request: DownloadRequest):
    try:
        info = downloader_service.extract_info(request.url)
        return info
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/queue-download")
async def queue_download(request: DownloadRequest, background_tasks: BackgroundTasks):
    task_id = str(uuid.uuid4())
    background_tasks.add_task(downloader_service.process_download, task_id, request)
    return {"task_id": task_id, "status": "queued"}

@app.get("/api/status/{task_id}")
async def get_status(task_id: str):
    status = downloader_service.get_status(task_id)
    if not status:
        raise HTTPException(status_code=404, detail="Task not found")
    return status

@app.get("/api/file/{file_id}")
async def get_file(file_id: str):
    file_path = downloader_service.get_file_path(file_id)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(file_path, filename=os.path.basename(file_path))
