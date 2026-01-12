# Use Python 3.11 as base image
FROM python:3.11-slim

# Install system dependencies
# ffmpeg: for backend
# nodejs + npm: for building frontend
# git: generic utility
RUN apt-get update && \
    apt-get install -y ffmpeg nodejs npm git && \
    rm -rf /var/lib/apt/lists/*

# --- FRONTEND BUILD ---
WORKDIR /app/frontend
# Copy frontend package files
COPY frontend/package*.json ./
# Install frontend deps
RUN npm install
# Copy frontend source
COPY frontend/ .
# Build React app
RUN npm run build
# The build output is now in /app/frontend/dist

# --- BACKEND SETUP ---
WORKDIR /app/backend
# Copy backend requirements
COPY backend/requirements.txt .
# Install backend deps
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir uvicorn
# Copy backend source
COPY backend/ .

# Expose port
EXPOSE 8000

# Run the app
# We are in /app/backend, so we run main:app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
