# Use Python 3.11 as base image
FROM python:3.11-slim

# Install system dependencies (FFmpeg is required)
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements and install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir uvicorn

# Copy application code
COPY . .

# Create downloads directory
RUN mkdir -p downloads

# Expose port (Render sets PORT env var)
EXPOSE 8000

# Command to run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
