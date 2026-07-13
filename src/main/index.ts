import { app, shell, BrowserWindow, ipcMain, clipboard, globalShortcut, Tray, Menu, screen, desktopCapturer } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import fs, { writeFileSync, unlinkSync } from 'fs'
import { LocalServerManager } from './LocalServerManager'
import { HistoryManager } from './HistoryManager'
import { AgentChatManager } from './AgentChatManager'
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import icon from '../../resources/icon.png?asset'

let mainWindow: BrowserWindow | null = null
let widgetWindow: BrowserWindow | null = null
let tray: Tray | null = null

function createWidgetWindow(): void {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize
  const widgetWidth = 96
  const widgetHeight = 96
  const x = screenWidth - widgetWidth - 24
  const y = screenHeight - widgetHeight - 24

  widgetWindow = new BrowserWindow({
    width: widgetWidth,
    height: widgetHeight,
    x,
    y,
    title: 'Dictation Widget',
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    focusable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    widgetWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?window=widget`)
  } else {
    widgetWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { window: 'widget' }
    })
  }

  widgetWindow.on('closed', () => {
    widgetWindow = null
  })
}

function createTray(): void {
  try {
    tray = new Tray(icon)
  } catch (e) {
    // Fallback if icon loading fails
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Control Panel',
      click: (): void => {
        if (!mainWindow) {
          createWindow()
        } else {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    {
      label: 'Show Floating Widget',
      click: (): void => {
        if (!widgetWindow) {
          createWidgetWindow()
        } else {
          widgetWindow.show()
        }
      }
    },
    {
      label: 'Hide Floating Widget',
      click: (): void => {
        if (widgetWindow) {
          widgetWindow.hide()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: (): void => {
        app.quit()
      }
    }
  ])

  if (tray) {
    tray.setToolTip('Open Whisper')
    tray.setContextMenu(contextMenu)
    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide()
        } else {
          mainWindow.show()
          mainWindow.focus()
        }
      }
    })
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  // Local Server Handlers
  ipcMain.handle('get-local-server-status', async () => {
    return LocalServerManager.getInstance().getStatus()
  })

  ipcMain.handle('get-desktop-audio-source-id', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'] })
    return sources[0]?.id || ''
  })

  // Agent Conversation Handlers
  ipcMain.handle('get-agent-conversations-with-preview', async (_event, limit: number, offset: number, archived: boolean) => {
    return AgentChatManager.getInstance().getConversations(limit, offset, archived)
  })

  ipcMain.handle('get-agent-conversation', async (_event, id: number) => {
    return AgentChatManager.getInstance().getConversation(id)
  })

  ipcMain.handle('create-agent-conversation', async (_event, title: string, noteId?: number) => {
    return AgentChatManager.getInstance().createConversation(title, noteId)
  })

  ipcMain.handle('add-agent-message', async (_event, conversationId: number, role: 'user' | 'assistant', content: string, metadata?: any) => {
    return AgentChatManager.getInstance().addMessage(conversationId, role, content, metadata)
  })

  ipcMain.handle('delete-agent-conversation', async (_event, id: number) => {
    return AgentChatManager.getInstance().deleteConversation(id)
  })

  ipcMain.handle('archive-agent-conversation', async (_event, id: number) => {
    return AgentChatManager.getInstance().archiveConversation(id)
  })

  // History Handlers
  ipcMain.handle('get-history', async () => {
    return HistoryManager.getInstance().getHistory()
  })

  ipcMain.handle('delete-history-item', async (_event, id: string) => {
    return HistoryManager.getInstance().deleteHistoryItem(id)
  })

  ipcMain.handle('clear-history', async () => {
    return HistoryManager.getInstance().clearHistory()
  })

  ipcMain.handle('download-local-binaries', async () => {
    await LocalServerManager.getInstance().downloadBinaries()
  })

  ipcMain.handle('download-local-model', async (_event, type: 'llama' | 'whisper', hfRepoOrName: string, fileName: string) => {
    try {
      const path = await LocalServerManager.getInstance().downloadModel(type, hfRepoOrName, fileName)
      return { success: true, path }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('cancel-download', async (_event, id: string) => {
    return LocalServerManager.getInstance().cancelDownload(id)
  })

  ipcMain.handle('delete-model', async (_event, type: 'llama' | 'whisper', fileName: string) => {
    return LocalServerManager.getInstance().deleteModel(type, fileName)
  })

  LocalServerManager.getInstance().onProgress((progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-progress', progress)
    }
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.webContents.send('download-progress', progress)
    }
  })

  ipcMain.handle(
    'transcribe-audio',
    async (_event, arrayBuffer: ArrayBuffer, provider?: string, model?: string, apiKey?: string) => {
      try {
        let text = ''
        if (provider === 'local') {
          const modelMapping: Record<string, string> = {
            tiny: 'ggml-tiny.bin',
            base: 'ggml-base.bin',
            small: 'ggml-small.bin',
            medium: 'ggml-medium.bin',
            large: 'ggml-large-v3.bin',
            turbo: 'ggml-large-v3-turbo.bin'
          }
          const modelFilename = modelMapping[model || 'base'] || 'ggml-base.bin'
          const modelPath = join(app.getPath('userData'), 'models', 'whisper', modelFilename)

          if (!fs.existsSync(modelPath)) {
            throw new Error(`Local model "${modelFilename}" not downloaded. Please download it in AI Models settings.`)
          }

          const manager = LocalServerManager.getInstance()
          const running = await manager.startWhisperServer(modelPath)
          if (!running) {
            throw new Error('Failed to start local Whisper server.')
          }

          const buffer = Buffer.from(arrayBuffer)
          const formData = new FormData()
          const fileBlob = new Blob([buffer], { type: 'audio/wav' })
          formData.append('file', fileBlob, 'audio.wav')
          formData.append('response_format', 'json')

          const response = await fetch(`http://127.0.0.1:${manager.whisperPort}/inference`, {
            method: 'POST',
            body: formData
          })

          if (!response.ok) {
            const errText = await response.text()
            throw new Error(`Local Whisper server error: ${response.status} ${errText}`)
          }

          const data = (await response.json()) as { text: string }
          text = data.text
        } else {
          // Cloud Whisper
          const effectiveKey = apiKey || process.env.OPENAI_API_KEY
          if (!effectiveKey) {
            throw new Error(
              'OpenAI API key not configured. Please enter your API key in the configuration panel.'
            )
          }

          const buffer = Buffer.from(arrayBuffer)
          const tempFilePath = join(tmpdir(), `audio_${Date.now()}.webm`)
          writeFileSync(tempFilePath, buffer)

          const formData = new FormData()
          const fileBlob = new Blob([buffer], { type: 'audio/webm' })
          formData.append('file', fileBlob, 'audio.webm')
          formData.append('model', 'whisper-1')

          const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${effectiveKey}`
            },
            body: formData
          })

          try {
            unlinkSync(tempFilePath)
          } catch (e) {
            console.error('Failed to delete temp file:', e)
          }

          if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`OpenAI API Error: ${response.status} ${errorText}`)
          }

          const data = (await response.json()) as { text: string }
          text = data.text
        }

        if (text && text.trim()) {
          HistoryManager.getInstance().addHistoryItem(text, provider || 'cloud', model || 'whisper-1', 'dictation')
          clipboard.writeText(text)

          if (process.platform === 'win32') {
            spawn('powershell.exe', [
              '-NoProfile',
              '-NonInteractive',
              '-WindowStyle',
              'Hidden',
              '-ExecutionPolicy',
              'Bypass',
              '-Command',
              "[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');[System.Windows.Forms.SendKeys]::SendWait('^v')"
            ])
          } else if (process.platform === 'darwin') {
            spawn('osascript', [
              '-e',
              'tell application "System Events" to keystroke "v" using command down'
            ])
          } else {
            spawn('xdotool', ['key', 'ctrl+v'])
          }
        }

        return { success: true, text }
      } catch (error) {
        console.error('Transcription error:', error)
        return { success: false, error: (error as Error).message }
      }
    }
  )

  ipcMain.on(
    'start-chat-stream',
    async (
      event,
      streamId: string,
      messages: any[],
      provider: string,
      model: string,
      apiKey?: string
    ) => {
      const webContents = event.sender
      try {
        let baseURL = 'https://api.openai.com/v1/chat/completions'
        const headers: Record<string, string> = {
          'Content-Type': 'application/json'
        }

        const isLocalProvider = ['qwen', 'gemma', 'mistral', 'llama', 'openai-oss'].includes(provider)

        if (isLocalProvider) {
          const localModelMapping: Record<string, string> = {
            'qwen-2.5-1.5b': 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
            'qwen-2.5-7b': 'Qwen2.5-7B-Instruct-Q5_K_M.gguf',
            'mistral-nemo-12b-instruct-q4_k_m': 'Mistral-Nemo-12B-Instruct.Q4_K_M.gguf',
            'mistral-7b-instruct-v0.3-q4_k_m': 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
            'mistral-7b-instruct-v0.3-q5_k_m': 'Mistral-7B-Instruct-v0.3-Q5_K_M.gguf',
            'llama-3.2-1b-instruct-q4_k_m': 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
            'llama-3.2-3b-instruct-q4_k_m': 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
            'llama-3.1-8b-instruct-q4_k_m': 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
            'gpt-oss-20b-mxfp4': 'gpt-oss-20b-mxfp4.gguf',
            'gemma-4-31b-it-q4_k_m': 'google_gemma-4-31B-it-Q4_K_M.gguf',
            'gemma-4-26b-a4b-it-q4_k_m': 'google_gemma-4-26B-A4B-it-Q4_K_M.gguf',
            'gemma-3-12b-it-q4_k_m': 'google_gemma-3-12b-it-Q4_K_M.gguf',
            'gemma-3-4b-it-q4_k_m': 'google_gemma-3-4b-it-Q4_K_M.gguf',
            'gemma-3-1b-it-q4_k_m': 'google_gemma-3-1b-it-Q4_K_M.gguf'
          }
          const modelFilename = localModelMapping[model] || `${model}.gguf`
          const modelPath = join(app.getPath('userData'), 'models', 'llama', modelFilename)

          if (!fs.existsSync(modelPath)) {
            throw new Error(`Local model "${modelFilename}" not downloaded. Please download it in AI Models settings.`)
          }

          const manager = LocalServerManager.getInstance()
          const running = await manager.startLlamaServer(modelPath)
          if (!running) {
            throw new Error('Failed to start local Llama server.')
          }

          baseURL = `http://127.0.0.1:${manager.llamaPort}/v1/chat/completions`
        } else {
          const effectiveKey = apiKey || process.env.OPENAI_API_KEY
          if (!effectiveKey) {
            throw new Error('API key not configured. Please add your key in the AI Models settings.')
          }
          headers['Authorization'] = `Bearer ${effectiveKey}`

          if (provider === 'groq') {
            baseURL = 'https://api.groq.com/openai/v1/chat/completions'
          } else if (provider === 'openrouter') {
            baseURL = 'https://openrouter.ai/api/v1/chat/completions'
          } else if (provider === 'gemini') {
            baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
          }
        }

        const response = await fetch(baseURL, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: model,
            messages: messages.map((m: any) => ({
              role: m.role,
              content: m.content
            })),
            stream: true
          })
        })

        if (!response.ok) {
          const errText = await response.text()
          throw new Error(`Inference API Error: ${response.status} ${errText}`)
        }

        const reader = response.body?.getReader()
        if (!reader) {
          throw new Error('Response body reader not available.')
        }

        const decoder = new TextDecoder()
        let buffer = ''
        let fullResponse = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            if (trimmed === 'data: [DONE]') {
              if (fullResponse.trim()) {
                HistoryManager.getInstance().addHistoryItem(fullResponse, provider, model, 'chat')
              }
              webContents.send(`chat-chunk-${streamId}`, { done: true })
              return
            }

            if (trimmed.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(trimmed.slice(6))
                const content = parsed.choices?.[0]?.delta?.content || ''
                if (content) {
                  fullResponse += content
                  webContents.send(`chat-chunk-${streamId}`, { text: content, done: false })
                }
              } catch (e) {
                // Ignore parse error
              }
            }
          }
        }

        if (fullResponse.trim()) {
          HistoryManager.getInstance().addHistoryItem(fullResponse, provider, model, 'chat')
        }
        webContents.send(`chat-chunk-${streamId}`, { done: true })
      } catch (error) {
        console.error('Chat stream error:', error)
        webContents.send(`chat-chunk-${streamId}`, { done: true, error: (error as Error).message })
      }
    }
  )

  ipcMain.on('status-changed', (_event, status: string, text?: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync-status', status, text)
    }
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.webContents.send('sync-status', status, text)
    }
  })

  globalShortcut.register('Ctrl+Shift+K', () => {
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      widgetWindow.webContents.send('toggle-recording')
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('toggle-recording')
    }
  })

  createWindow()
  createTray()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  LocalServerManager.getInstance().stopAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
