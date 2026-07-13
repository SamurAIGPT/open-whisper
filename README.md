# 🎙️ Open Whisper

Open Whisper is a premium, high-performance desktop application for real-time dictation, audio transcription, and conversational AI. Built with Electron, React, and TypeScript, it integrates seamlessly with both leading cloud LLM API providers and local private engine sidecars (using `whisper.cpp` and `llama.cpp`) for zero-latency, private, and offline transcription and chat.

---

## ✨ Features

### 🎧 Dictation & Audio Transcription
- **Universal Capture**: Record and transcribe speech in real-time from either your Microphone or System/Desktop audio.
- **Background Dictation**: Set a global hotkey activation combination (e.g., `Ctrl+Shift+K`) to toggle transcription in the background.
- **Audio File Upload**: Drag-and-drop or upload standard audio formats (`.mp3`, `.wav`, `.m4a`, etc.) for offline audio processing.

### 💬 Chat Agent
- **Full-Width Premium Chat View**: Clean, modern interface designed to occupy the full viewport width with standard responsive panels.
- **Dynamic Response Streaming**: Real-time character-by-character token streaming from conversational AI providers.
- **Isolated Credentials**: Model API keys are kept isolated in secure `localStorage` matching the format `${provider}_api_key`. Switching models doesn't cause key mismatches.
- **Thread Sync & Restoration**: Automatic loading and synchronization of historical chat conversation threads from the SQL database on tab navigation.

### 🖥️ Local AI Models Manager
- **Dynamic Binary Downloader**: Automatically checks system binary paths for `llama-server` and `whisper-server`. Automatically downloads CPU/GPU-optimized releases (25MB) with relative redirection handling and downloads status reports.
- **Model Downloader**: Browse recommended Hugging Face GGUF weights, trigger downloads with real-time progress details (size downloaded in MB/GB, percentage, and total size), pause/cancel active streams, or delete models to free up disk space.
- **Local Server Lifecycle**: Spawns and kills background servers dynamically on free ports (Llama/Whisper sidecar orchestration).

### 📜 History Logs
- **Searchable Database**: View, search, filter, and inspect detailed metadata for all past dictation and chat sessions.
- **Log Management**: Delete individual logs or clear history with a single click.

---

## 🛠️ Technology Stack

- **Framework**: Electron (Desktop container wrapper)
- **Frontend**: React, TypeScript, HTML5 (Semantic Structure)
- **Styling**: Modern CSS (featuring custom themes, fluid typography, transitions, and flexible viewport layouts)
- **Local AI Engines**: `llama.cpp` (LLM inference server sidecar), `whisper.cpp` (Speech-to-text inference sidecar)
- **Database**: SQL / JSON local registry manager

---

## 🚀 Getting Started

### 📋 Prerequisites
Ensure you have [Node.js](https://nodejs.org/) (v18+) and `npm` installed.

### 📦 Installation
Clone the repository and install all node packages:
```bash
# Clone the repository
$ git clone https://github.com/SamurAIGPT/open-whisper.git
$ cd open-whisper

# Install dependencies
$ npm install
```

### 💻 Development Mode
Start the development server and launch the Electron application:
```bash
# Run in development mode
$ npm run dev
```

### 🏗️ Production Build
To package and build the production-ready desktop bundle for your OS:

```bash
# Compile and build for Windows
$ npm run build:win

# Compile and build for macOS
$ npm run build:mac

# Compile and build for Linux
$ npm run build:linux
```

---

## 🔒 Content Security Policy (CSP) & Google Fonts
The application restricts resources under a secure Content Security Policy. It is pre-configured to allow the premium **Inter** font family to load over the web from Google Fonts servers:
- **Style Sources**: `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`
- **Font Sources**: `font-src 'self' https://fonts.gstatic.com`

---

## 📂 Project Structure

```text
├── src
│   ├── main                  # Electron main process (OS integrations, IPC registry, Llama/Whisper servers lifecycle)
│   │   ├── LocalServerManager.ts  # Handles download requests, redirect pipelines, temp unlinks, and process spawns
│   │   ├── AgentChatManager.ts    # Manages conversational SQLite/JSON histories
│   │   └── index.ts               # IPC routers and main system hooks
│   ├── preload               # Preload scripts and security-braced API bridge definitions
│   └── renderer              # React web view (UI screens, audio capture hooks, and styling stylesheets)
│       ├── src
│       │   ├── assets        # Base styles, variables, and Inter typography definitions
│       │   ├── App.tsx       # Core React component layout, themes, pages, and download wrappers
│       │   └── main.tsx      # Renderer initialization
```

---

## 💡 Local Development Tips
- **Temp Files**: Local models download to a temporary file (`.tmp`) first, and are renamed to `.gguf` / `.bin` only upon completing successfully. This guarantees incomplete downloads will not block retries.
- **Port Health Checks**: The background service automatically queries port health endpoints (`http://127.0.0.1:<port>/`) to verify local servers are completely running before transitioning states in the UI.
