import { useState, useRef, useEffect } from 'react'
import { ModelRegistry } from '../../models/ModelRegistry'

type TabType = 'chat' | 'dictation' | 'models' | 'preferences' | 'history' | 'upload'
type ScopeType = 'chat' | 'dictation'
type ModeType = 'cloud' | 'local'

interface ChatMessage {
  id?: string
  role: 'user' | 'assistant'
  content: string
}

const registry = ModelRegistry.getInstance()

function App(): React.JSX.Element {
  // Check if we are running in the transparent floating widget window
  const params = new URLSearchParams(window.location.search)
  const isWidget =
    params.get('window') === 'widget' || window.location.search.includes('widget=true')

  const [currentTab, setCurrentTab] = useState<TabType>('dictation')

  // Settings Scope & Modes
  const [activeScope, setActiveScope] = useState<ScopeType>('chat')
  const [inferenceMode, setInferenceMode] = useState<ModeType>('cloud')

  // Selected Providers & Models
  const [selectedCloudProvider, setSelectedCloudProvider] = useState('openai')
  const [selectedLocalProvider, setSelectedLocalProvider] = useState('qwen')

  const [selectedChatModel, setSelectedChatModel] = useState('gpt-5.6-terra')
  const [selectedDictationModel, setSelectedDictationModel] = useState('whisper-1')

  // Dictation States
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<'idle' | 'recording' | 'transcribing' | 'success' | 'error'>(
    'idle'
  )
  const [errorMsg, setErrorMsg] = useState('')
  const [transcribedText, setTranscribedText] = useState('')

  // Conversational Chat States (Persisted threads flow)
  const [conversations, setConversations] = useState<any[]>([])
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [isChatStreaming, setIsChatStreaming] = useState(false)
  const [chatSearch, setChatSearch] = useState('')
  const [chatRefreshKey, setChatRefreshKey] = useState(0)

  // Preferences States
  const [activationKey, setActivationKey] = useState('Ctrl+Shift+K')
  const [theme, setTheme] = useState(
    localStorage.getItem('theme') || 'dark'
  )
  const [audioSource, setAudioSource] = useState<'mic' | 'system'>(
    (localStorage.getItem('audio_source') as 'mic' | 'system') || 'mic'
  )

  // Local Server & Downloader States
  const [localStatus, setLocalStatus] = useState({
    llamaInstalled: false,
    llamaRunning: false,
    whisperInstalled: false,
    whisperRunning: false,
    downloadedLlamaModels: [] as string[],
    downloadedWhisperModels: [] as string[]
  })
  const [activeDownloads, setActiveDownloads] = useState<
    Record<
      string,
      {
        percent: number
        status: string
        error?: string
        loadedBytes?: number
        totalBytes?: number
      }
    >
  >({})

  // History States
  const [historyItems, setHistoryItems] = useState<any[]>([])
  const [historySearch, setHistorySearch] = useState('')
  const [historyTypeFilter, setHistoryTypeFilter] = useState<'all' | 'dictation' | 'chat'>('all')

  // Upload Audio States
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'decoding' | 'transcribing' | 'success' | 'error'>('idle')
  const [uploadError, setUploadError] = useState('')
  const [uploadText, setUploadText] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  // Refs for hotkey listeners to bypass stale state closures
  const statusRef = useRef(status)
  const apiKeyRef = useRef(apiKey)
  const audioSourceRef = useRef(audioSource)

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    apiKeyRef.current = apiKey
  }, [apiKey])

  useEffect(() => {
    audioSourceRef.current = audioSource
  }, [audioSource])

  // Sync API Key per provider dynamically
  useEffect(() => {
    const savedKey = localStorage.getItem(`${selectedCloudProvider}_api_key`)
    setApiKey(savedKey || '')
  }, [selectedCloudProvider])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // Sync theme changes with root document element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Setup Event Sync & Global Shortcut listener on mount
  useEffect(() => {
    // Listen for state synchronization from the other window
    window.api.onSyncStatus((_event, syncedStatus, text) => {
      setStatus(syncedStatus as any)
      if (text) {
        setTranscribedText(text)
      }
    })

    // Listen for toggle recording commands (global hotkey or click)
    window.api.onToggleRecording(() => {
      if (statusRef.current === 'recording') {
        stopRecording()
      } else {
        startRecording()
      }
    })
  }, [])

  // Sync state back to main process whenever renderer updates status
  useEffect(() => {
    window.api.notifyStatusChange(status, transcribedText)
  }, [status, transcribedText])

  // Poll Local Server Status
  const checkLocalStatus = async (): Promise<void> => {
    try {
      const status = await window.api.getLocalServerStatus()
      setLocalStatus(status)
    } catch (e) {
      console.error('Failed to get local server status:', e)
    }
  }

  useEffect(() => {
    checkLocalStatus()
    const interval = setInterval(checkLocalStatus, 3000)
    return () => clearInterval(interval)
  }, [])

  // Listen to Download progress
  useEffect(() => {
    const removeListener = window.api.onDownloadProgress((_event, progress) => {
      setActiveDownloads((prev) => ({
        ...prev,
        [progress.id]: {
          percent: progress.percent,
          status: progress.status,
          error: progress.error,
          loadedBytes: progress.loadedBytes,
          totalBytes: progress.totalBytes
        }
      }))

      if (progress.status === 'completed' || progress.status === 'error') {
        checkLocalStatus()
      }
    })
    return () => removeListener()
  }, [])

  // Fetch history when tab opens
  const loadHistoryItems = async (): Promise<void> => {
    try {
      const items = await window.api.getHistory()
      setHistoryItems(items)
    } catch (e) {
      console.error('Failed to load history items:', e)
    }
  }

  useEffect(() => {
    if (currentTab === 'history') {
      loadHistoryItems()
    }
  }, [currentTab])

  // Multi-conversation persistence loading
  const loadConversations = async (): Promise<void> => {
    try {
      const list = await window.api.getAgentConversationsWithPreview(100, 0, false)
      setConversations(list)
    } catch (e) {
      console.error(e)
    }
  }

  useEffect(() => {
    if (currentTab === 'chat') {
      loadConversations()
    }
  }, [currentTab, chatRefreshKey])

  // Restore active conversation messages when returning to the Chat tab
  useEffect(() => {
    if (currentTab === 'chat' && activeConversationId !== null && !isChatStreaming) {
      const restoreMessages = async (): Promise<void> => {
        try {
          const conv = await window.api.getAgentConversation(activeConversationId)
          if (conv) {
            setChatMessages(
              conv.messages.map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content
              }))
            )
          }
        } catch (e) {
          console.error('Failed to restore chat messages:', e)
        }
      }
      restoreMessages()
    }
  }, [currentTab])

  const handleSelectConversation = async (id: number): Promise<void> => {
    try {
      setActiveConversationId(id)
      const conv = await window.api.getAgentConversation(id)
      if (conv) {
        setChatMessages(
          conv.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content
          }))
        )
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleNewChat = (): void => {
    setActiveConversationId(null)
    setChatMessages([])
  }

  const handleDeleteConversation = async (id: number, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    if (confirm('Delete this conversation thread permanently?')) {
      try {
        await window.api.deleteAgentConversation(id)
        if (activeConversationId === id) {
          handleNewChat()
        }
        setChatRefreshKey((k) => k + 1)
      } catch (err) {
        console.error(err)
      }
    }
  }

  const handleArchiveConversation = async (id: number, e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    try {
      await window.api.archiveAgentConversation(id)
      if (activeConversationId === id) {
        handleNewChat()
      }
      setChatRefreshKey((k) => k + 1)
    } catch (err) {
      console.error(err)
    }
  }

  const handleDeleteHistoryItem = async (id: string): Promise<void> => {
    try {
      const success = await window.api.deleteHistoryItem(id)
      if (success) {
        setHistoryItems((prev) => prev.filter((item) => item.id !== id))
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleClearHistory = async (): Promise<void> => {
    if (confirm('Are you sure you want to clear your transcription and chat history permanently?')) {
      try {
        await window.api.clearHistory()
        setHistoryItems([])
      } catch (e) {
        console.error(e)
      }
    }
  }

  const formatTime = (ts: number | string): string => {
    return new Date(ts).toLocaleString()
  }

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = e.target.value
    setApiKey(val)
    localStorage.setItem(`${selectedCloudProvider}_api_key`, val)
  }

  const handleDownloadBinaries = async (): Promise<void> => {
    try {
      await window.api.downloadLocalBinaries()
      checkLocalStatus()
    } catch (e) {
      console.error(e)
    }
  }

  const handleDownloadModel = async (type: 'llama' | 'whisper', _modelId: string, hfRepoOrName: string, fileName: string): Promise<void> => {
    try {
      await window.api.downloadLocalModel(type, hfRepoOrName, fileName)
      checkLocalStatus()
    } catch (e) {
      console.error(e)
    }
  }

  const handleCancelDownload = async (fileName: string): Promise<void> => {
    try {
      await window.api.cancelDownload(fileName)
    } catch (e) {
      console.error(e)
    }
  }

  const handleDeleteModel = async (type: 'llama' | 'whisper', fileName: string): Promise<void> => {
    if (confirm(`Are you sure you want to delete ${fileName}?`)) {
      try {
        const success = await window.api.deleteModel(type, fileName)
        if (success) {
          checkLocalStatus()
        }
      } catch (e) {
        console.error(e)
      }
    }
  }

  const startRecording = async (): Promise<void> => {
    try {
      setErrorMsg('')
      setTranscribedText('')
      chunksRef.current = []

      let stream: MediaStream
      if (audioSourceRef.current === 'system') {
        const sourceId = await window.api.getDesktopAudioSourceId()
        if (!sourceId) {
          throw new Error('Could not find desktop capture source. Check your screen sharing permissions.')
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId
            }
          },
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceId
            }
          }
        } as any)
        
        // Instantly stop and discard video track
        stream.getVideoTracks().forEach((track) => track.stop())
      } else {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      }

      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (e): void => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }

      mediaRecorder.onstop = async (): Promise<void> => {
        setStatus('transcribing')
        try {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
          const arrayBuffer = await blob.arrayBuffer()

          // Browser-side decoding and resampling to 16kHz mono WAV to support local Whisper
          let wavBuffer: ArrayBuffer
          try {
            const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
            
            const targetSampleRate = 16000
            const offlineCtx = new OfflineAudioContext(1, Math.round(audioBuffer.duration * targetSampleRate), targetSampleRate)
            const bufferSource = offlineCtx.createBufferSource()
            bufferSource.buffer = audioBuffer
            bufferSource.connect(offlineCtx.destination)
            bufferSource.start()
            
            const resampledBuffer = await offlineCtx.startRendering()
            wavBuffer = encodeWAV(resampledBuffer.getChannelData(0), targetSampleRate)
          } catch (decodeErr) {
            console.warn('Browser audio context decode failed, falling back to raw arrayBuffer', decodeErr)
            wavBuffer = arrayBuffer
          }

          const activeProvider = inferenceMode === 'cloud' ? selectedCloudProvider : 'local'
          const activeModel = inferenceMode === 'cloud' ? selectedDictationModel : selectedDictationModel
          const activeKey = localStorage.getItem(`${activeProvider}_api_key`) || apiKeyRef.current

          const result = await window.api.transcribeAudio(wavBuffer, activeProvider, activeModel, activeKey)

          if (result.success) {
            setStatus('success')
            setTranscribedText(result.text || '')
            // Clear success status after a few seconds
            setTimeout(() => setStatus('idle'), 3000)
          } else {
            setStatus('error')
            setErrorMsg(result.error || 'Unknown error occurred')
            setTimeout(() => setStatus('idle'), 4000)
          }
        } catch (err) {
          setStatus('error')
          setErrorMsg((err as Error).message)
          setTimeout(() => setStatus('idle'), 4000)
        } finally {
          stream.getTracks().forEach((track) => track.stop())
        }
      }

      mediaRecorder.start()
      setStatus('recording')
    } catch (err) {
      setStatus('error')
      setErrorMsg((err as Error).message || 'Microphone access denied')
      setTimeout(() => setStatus('idle'), 4000)
    }
  }

  const stopRecording = (): void => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }

  const toggleRecording = (): void => {
    if (status === 'recording') {
      stopRecording()
    } else {
      startRecording()
    }
  }

  // Chat Streaming Execution (Persisted to database manager)
  const sendChatMessage = async (): Promise<void> => {
    if (!chatInput.trim() || isChatStreaming) return

    const currentInputVal = chatInput
    setChatInput('')

    // Update messages UI optimistically
    const userMsg: ChatMessage = { role: 'user', content: currentInputVal }
    const updatedMessages = [...chatMessages, userMsg]
    setChatMessages(updatedMessages)
    setIsChatStreaming(true)

    try {
      let convId = activeConversationId
      if (!convId) {
        const title = currentInputVal.length > 30 ? `${currentInputVal.slice(0, 30)}...` : currentInputVal
        const newConv = await window.api.createAgentConversation(title)
        convId = newConv.id
        setActiveConversationId(convId)
      }

      // Save user message to database
      await window.api.addAgentMessage(convId, 'user', currentInputVal)

      const streamId = `stream_${Date.now()}`
      const assistantMsg: ChatMessage = { role: 'assistant', content: '' }
      setChatMessages((prev) => [...prev, assistantMsg])

      let fullResponse = ''
      window.api.onChatChunk(streamId, async (_event, data) => {
        if (data.error) {
          setIsChatStreaming(false)
          setChatMessages((prev) => {
            const next = [...prev]
            const lastIdx = next.length - 1
            if (lastIdx >= 0) {
              next[lastIdx] = {
                ...next[lastIdx],
                content: `Error: ${data.error}`
              }
            }
            return next
          })
          window.api.offChatChunk(streamId)
        } else if (data.done) {
          setIsChatStreaming(false)
          window.api.offChatChunk(streamId)
          // Save assistant message to database when complete
          if (convId) {
            await window.api.addAgentMessage(convId, 'assistant', fullResponse)
          }
          setChatRefreshKey((k) => k + 1)
        } else if (data.text) {
          fullResponse += data.text
          setChatMessages((prev) => {
            const next = [...prev]
            const lastIdx = next.length - 1
            if (lastIdx >= 0) {
              next[lastIdx] = {
                ...next[lastIdx],
                content: fullResponse
              }
            }
            return next
          })
        }
      })

      const activeProvider = inferenceMode === 'cloud' ? selectedCloudProvider : selectedLocalProvider
      const activeKey = localStorage.getItem(`${activeProvider}_api_key`) || apiKeyRef.current
      window.api.startChatStream(
        streamId,
        updatedMessages,
        activeProvider,
        selectedChatModel,
        activeKey
      )
    } catch (err) {
      console.error(err)
      setIsChatStreaming(false)
      // Display error as assistant message
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error sending message: ${(err as Error).message}` }
      ])
    }
  }

  // Upload Audio Transcription Process
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files
    if (files && files.length > 0) {
      setUploadFile(files[0])
      setUploadStatus('idle')
      setUploadError('')
      setUploadText('')
    }
  }

  const handleDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (): void => {
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setIsDragOver(false)
    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      const f = files[0]
      if (
        f.type.startsWith('audio/') ||
        ['.mp3', '.wav', '.m4a', '.webm', '.ogg', '.flac', '.aac'].some((ext) => f.name.toLowerCase().endsWith(ext))
      ) {
        setUploadFile(f)
        setUploadStatus('idle')
        setUploadError('')
        setUploadText('')
      } else {
        alert('Please drop a valid audio file.')
      }
    }
  }

  const handleTranscribeUpload = async (): Promise<void> => {
    if (!uploadFile) return
    setUploadStatus('decoding')
    setUploadError('')
    setUploadText('')

    try {
      const arrayBuffer = await uploadFile.arrayBuffer()
      
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)
      
      const targetSampleRate = 16000
      const offlineCtx = new OfflineAudioContext(1, Math.round(audioBuffer.duration * targetSampleRate), targetSampleRate)
      const bufferSource = offlineCtx.createBufferSource()
      bufferSource.buffer = audioBuffer
      bufferSource.connect(offlineCtx.destination)
      bufferSource.start()
      
      const resampledBuffer = await offlineCtx.startRendering()
      const wavBuffer = encodeWAV(resampledBuffer.getChannelData(0), targetSampleRate)

      setUploadStatus('transcribing')
      const activeProvider = inferenceMode === 'cloud' ? selectedCloudProvider : 'local'
      const activeModel = inferenceMode === 'cloud' ? selectedDictationModel : selectedDictationModel
      const activeKey = localStorage.getItem(`${activeProvider}_api_key`) || apiKeyRef.current

      const result = await window.api.transcribeAudio(wavBuffer, activeProvider, activeModel, activeKey)

      if (result.success) {
        setUploadStatus('success')
        setUploadText(result.text || '')
      } else {
        setUploadStatus('error')
        setUploadError(result.error || 'Failed to transcribe audio file.')
      }
    } catch (err) {
      console.error(err)
      setUploadStatus('error')
      setUploadError((err as Error).message || 'Failed to decode or parse audio file.')
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  // Fetch lists from Registry
  const cloudProviders = registry.getCloudProviders()
  const localProviders = registry.getLocalProviders()

  const currentCloudProviderData = cloudProviders.find((p) => p.id === selectedCloudProvider)
  const currentLocalProviderData = localProviders.find((p) => p.id === selectedLocalProvider)

  const handleCloudProviderSelect = (providerId: string): void => {
    setSelectedCloudProvider(providerId)
    const provider = cloudProviders.find((p) => p.id === providerId)
    if (provider && provider.models.length > 0) {
      if (activeScope === 'chat') {
        setSelectedChatModel(provider.models[0].id)
      } else {
        setSelectedDictationModel(provider.models[0].id)
      }
    }
  }

  const handleLocalProviderSelect = (providerId: string): void => {
    setSelectedLocalProvider(providerId)
    const provider = localProviders.find((p) => p.id === providerId)
    if (provider && provider.models.length > 0) {
      if (activeScope === 'chat') {
        setSelectedChatModel(provider.models[0].id)
      } else {
        setSelectedDictationModel(provider.models[0].id)
      }
    }
  }

  // WIDGET SCREEN RENDER
  if (isWidget) {
    return (
      <div className="widget-layout">
        <style>{`
          body {
            margin: 0;
            padding: 0;
            background: transparent !important;
            overflow: hidden;
          }

          .widget-layout {
            width: 100vw;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
          }

          .widget-circle {
            width: 76px;
            height: 76px;
            border-radius: 50%;
            background: rgba(15, 23, 42, 0.7);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1.5px solid rgba(255, 255, 255, 0.08);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            z-index: 10;
          }

          .widget-circle:hover {
            transform: scale(1.05);
            border-color: rgba(139, 92, 246, 0.4);
            background: rgba(15, 23, 42, 0.85);
          }

          .widget-circle.recording {
            background: rgba(239, 68, 68, 0.25);
            border-color: rgba(239, 68, 68, 0.6);
            box-shadow: 0 0 25px rgba(239, 68, 68, 0.4);
          }

          .widget-circle.transcribing {
            background: rgba(56, 189, 248, 0.25);
            border-color: rgba(56, 189, 248, 0.6);
            box-shadow: 0 0 25px rgba(56, 189, 248, 0.4);
          }

          .widget-circle.success {
            background: rgba(74, 222, 128, 0.25);
            border-color: rgba(74, 222, 128, 0.6);
            box-shadow: 0 0 25px rgba(74, 222, 128, 0.4);
          }

          .widget-circle.error {
            background: rgba(239, 68, 68, 0.25);
            border-color: rgba(239, 68, 68, 0.6);
            box-shadow: 0 0 25px rgba(239, 68, 68, 0.4);
          }

          .widget-pulse {
            position: absolute;
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: rgba(99, 102, 241, 0.2);
            z-index: -1;
            opacity: 0;
          }

          .widget-circle.recording .widget-pulse {
            background: rgba(239, 68, 68, 0.35);
            animation: pulse 1.5s infinite;
          }

          .widget-circle.transcribing .widget-pulse {
            background: rgba(56, 189, 248, 0.35);
            animation: pulse 1.5s infinite;
          }

          @keyframes pulse {
            0% { transform: scale(0.85); opacity: 0.5; }
            100% { transform: scale(1.35); opacity: 0; }
          }

          .widget-icon {
            width: 32px;
            height: 32px;
            fill: #c084fc;
            transition: fill 0.3s ease;
          }

          .widget-circle.recording .widget-icon {
            fill: #ef4444;
          }

          .widget-circle.transcribing .widget-icon {
            fill: #38bdf8;
            animation: spin 2s linear infinite;
          }

          .widget-circle.success .widget-icon {
            fill: #4ade80;
          }

          .widget-circle.error .widget-icon {
            fill: #ef4444;
          }

          @keyframes spin {
            100% { transform: rotate(360deg); }
          }
        `}</style>
        <div className={`widget-circle ${status}`} onClick={toggleRecording}>
          <div className="widget-pulse"></div>
          <svg className="widget-icon" viewBox="0 0 24 24">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
            <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
          </svg>
        </div>
      </div>
    )
  }

  // STANDARD CONTROL PANEL RENDER
  return (
    <div className="app-layout">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

        /* CSS variables based on active theme */
        :root[data-theme='dark'] {
          --bg-app: #0b0f17;
          --bg-sidebar: #07090e;
          --bg-panel: #111524;
          --border-primary: #1e293b;
          --border-focus: #334155;
          --text-primary: #f1f5f9;
          --text-secondary: #94a3b8;
          --text-muted: #64748b;
          --bg-input: #1e293b;
          --bg-hover: rgba(255, 255, 255, 0.02);
          --bg-active: rgba(139, 92, 246, 0.08);
          --accent: #8b5cf6;
          --accent-hover: #9d76fd;
        }

        :root[data-theme='light'] {
          --bg-app: #f8fafc;
          --bg-sidebar: #f1f5f9;
          --bg-panel: #ffffff;
          --border-primary: #e2e8f0;
          --border-focus: #cbd5e1;
          --text-primary: #0f172a;
          --text-secondary: #475569;
          --text-muted: #64748b;
          --bg-input: #f1f5f9;
          --bg-hover: rgba(0, 0, 0, 0.02);
          --bg-active: rgba(139, 92, 246, 0.08);
          --accent: #8b5cf6;
          --accent-hover: #7c3aed;
        }

        body {
          margin: 0;
          padding: 0;
          background: var(--bg-app);
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          color: var(--text-primary);
          height: 100vh;
          overflow: hidden;
        }

        .app-layout {
          display: flex;
          width: 100vw;
          height: 100vh;
          background: var(--bg-app);
        }

        /* Sidebar Styling */
        .sidebar {
          width: 250px;
          background: var(--bg-sidebar);
          border-right: 1px solid var(--border-primary);
          display: flex;
          flex-direction: column;
          padding: 24px 16px;
          box-sizing: border-box;
          height: 100%;
          flex-shrink: 0;
        }

        .logo-container {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 30px;
          padding-left: 8px;
        }

        .logo-icon {
          width: 28px;
          height: 28px;
          background: var(--accent);
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 600;
          font-size: 0.95rem;
        }

        .app-name {
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--text-primary);
        }

        .nav-menu {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex-grow: 1;
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 14px;
          border-radius: 8px;
          color: var(--text-secondary);
          font-size: 0.9rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
          border: 1px solid transparent;
        }

        .nav-item:hover {
          color: var(--text-primary);
          background: var(--bg-hover);
        }

        .nav-item.active {
          color: var(--text-primary);
          background: var(--bg-active);
          border: 1px solid rgba(139, 92, 246, 0.2);
        }

        .nav-icon {
          width: 18px;
          height: 18px;
          fill: currentColor;
        }

        .sidebar-footer {
          border-top: 1px solid var(--border-primary);
          padding-top: 16px;
          display: flex;
          align-items: center;
          gap: 10px;
          color: var(--text-muted);
          font-size: 0.75rem;
          font-weight: 500;
        }

        /* Viewport Styling */
        .viewport {
          flex-grow: 1;
          height: 100%;
          overflow: hidden;
          padding: 20px;
          box-sizing: border-box;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg-app);
        }

        .content-panel {
          width: 100%;
          max-width: 100%;
          height: 100%;
          background: var(--bg-panel);
          border: 1px solid var(--border-primary);
          border-radius: 16px;
          padding: 24px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .panel-title {
          font-size: 1.5rem;
          font-weight: 600;
          margin: 0 0 6px 0;
          color: var(--text-primary);
        }

        .panel-subtitle {
          font-size: 0.85rem;
          color: var(--text-muted);
          margin-bottom: 20px;
        }

        /* Dictation View Styling */
        .dictation-wrapper {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          margin: auto 0;
        }

        .mic-btn-container {
          position: relative;
          width: 130px;
          height: 130px;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .mic-btn {
          width: 90px;
          height: 90px;
          border-radius: 50%;
          background: var(--accent);
          border: none;
          outline: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          box-shadow: 0 4px 12px rgba(139, 92, 246, 0.2);
          transition: all 0.2s ease;
          z-index: 2;
        }

        .mic-btn:hover {
          transform: scale(1.03);
          background: var(--accent-hover);
        }

        .mic-btn:active {
          transform: scale(0.97);
        }

        .mic-btn.recording {
          background: #ef4444;
          box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);
        }

        .pulse-ring {
          position: absolute;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          background: rgba(139, 92, 246, 0.1);
          z-index: 1;
          animation: pulse 2s infinite;
          opacity: 0;
        }

        .mic-btn.recording ~ .pulse-ring {
          background: rgba(239, 68, 68, 0.15);
        }

        @keyframes pulse {
          0% { transform: scale(0.85); opacity: 0.6; }
          100% { transform: scale(1.2); opacity: 0; }
        }

        .status-text {
          font-size: 0.95rem;
          font-weight: 500;
          margin-bottom: 20px;
          height: 20px;
        }
        .status-idle { color: var(--text-secondary); }
        .status-recording { color: #f87171; }
        .status-transcribing { color: #38bdf8; }
        .status-success { color: #4ade80; }
        .status-error { color: #f87171; }

        .waveform {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 3px;
          height: 16px;
          margin-bottom: 20px;
        }
        .bar {
          width: 3px;
          height: 4px;
          background: var(--accent);
          border-radius: 1.5px;
          transition: height 0.1s ease;
        }
        .mic-btn.recording ~ .waveform .bar {
          background: #ef4444;
          animation: wave 1.2s ease-in-out infinite alternate;
        }
        .mic-btn.recording ~ .waveform .bar:nth-child(2) { animation-delay: 0.15s; }
        .mic-btn.recording ~ .waveform .bar:nth-child(3) { animation-delay: 0.3s; }
        .mic-btn.recording ~ .waveform .bar:nth-child(4) { animation-delay: 0.45s; }
        .mic-btn.recording ~ .waveform .bar:nth-child(5) { animation-delay: 0.6s; }

        @keyframes wave {
          0% { height: 4px; }
          100% { height: 18px; }
        }

        /* Conversational Chat View Styling */
        .chat-view-container {
          display: flex;
          height: 100%;
          width: 100%;
          box-sizing: border-box;
          overflow: hidden;
        }

        .chat-sidebar {
          width: 240px;
          border-right: 1px solid var(--border-primary);
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          padding-right: 14px;
          height: 100%;
          flex-shrink: 0;
        }

        .chat-sidebar-header {
          margin-bottom: 12px;
        }

        .new-chat-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          width: 100%;
          padding: 8px;
          background: var(--accent);
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 0.8rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .new-chat-btn:hover {
          background: var(--accent-hover);
        }

        .chat-threads-list {
          flex-grow: 1;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 10px;
          padding-right: 2px;
        }

        .chat-thread-item {
          padding: 8px 10px;
          border-radius: 6px;
          background: var(--bg-hover);
          border: 1px solid var(--border-primary);
          cursor: pointer;
          display: flex;
          flex-direction: column;
          gap: 3px;
          text-align: left;
          transition: all 0.15s ease;
        }

        .chat-thread-item:hover {
          border-color: var(--border-focus);
        }

        .chat-thread-item.active {
          background: var(--bg-active);
          border-color: rgba(139, 92, 246, 0.2);
        }

        .chat-thread-title {
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .chat-thread-preview {
          font-size: 0.7rem;
          color: var(--text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .chat-thread-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 4px;
        }

        .chat-thread-date {
          font-size: 0.6rem;
          color: var(--text-muted);
        }

        .chat-thread-actions {
          display: flex;
          gap: 4px;
        }

        .chat-thread-action-btn {
          background: transparent;
          border: none;
          padding: 2px;
          cursor: pointer;
          color: var(--text-muted);
          font-size: 0.65rem;
          font-weight: 600;
        }

        .chat-thread-action-btn:hover {
          color: #f87171;
        }

        .chat-main-window {
          flex-grow: 1;
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
          padding-left: 14px;
          box-sizing: border-box;
        }

        .chat-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid var(--border-primary);
          padding-bottom: 12px;
          margin-bottom: 16px;
        }

        .chat-model-info {
          font-size: 0.75rem;
          color: #a78bfa;
          background: rgba(139, 92, 246, 0.05);
          border: 1px solid rgba(139, 92, 246, 0.15);
          padding: 4px 8px;
          border-radius: 6px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .chat-messages {
          flex-grow: 1;
          display: flex;
          flex-direction: column;
          gap: 12px;
          overflow-y: auto;
          padding-right: 6px;
          margin-bottom: 16px;
          box-sizing: border-box;
        }

        .chat-bubble {
          max-width: 85%;
          padding: 10px 14px;
          border-radius: 12px;
          font-size: 0.9rem;
          line-height: 1.45;
          word-break: break-word;
        }

        .chat-bubble.user {
          align-self: flex-end;
          background: var(--accent);
          color: white;
          border-bottom-right-radius: 2px;
        }

        .chat-bubble.assistant {
          align-self: flex-start;
          background: var(--bg-input);
          border: 1px solid var(--border-primary);
          color: var(--text-primary);
          border-bottom-left-radius: 2px;
        }

        .chat-bubble.assistant code {
          background: rgba(0, 0, 0, 0.1);
          border-radius: 4px;
          padding: 2px 4px;
          font-family: monospace;
          color: #f472b6;
        }

        .chat-input-container {
          display: flex;
          gap: 8px;
          width: 100%;
          box-sizing: border-box;
        }

        .chat-input {
          flex-grow: 1;
          background: var(--bg-input);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          padding: 10px 14px;
          color: var(--text-primary);
          font-size: 0.9rem;
          outline: none;
          box-sizing: border-box;
          transition: all 0.15s ease;
        }

        .chat-input:focus {
          border-color: var(--accent);
        }

        .chat-send-btn {
          background: var(--accent);
          border: none;
          border-radius: 8px;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          cursor: pointer;
          transition: all 0.15s ease;
          flex-shrink: 0;
        }

        .chat-send-btn:hover {
          background: var(--accent-hover);
        }

        .chat-send-btn:disabled {
          background: var(--border-focus);
          cursor: not-allowed;
        }

        .chat-send-icon {
          width: 16px;
          height: 16px;
          fill: currentColor;
        }

        .typing-indicator {
          display: flex;
          gap: 3px;
          padding: 4px 6px;
        }

        .dot {
          width: 5px;
          height: 5px;
          background: var(--text-secondary);
          border-radius: 50%;
          animation: dot-blink 1.4s infinite both;
        }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }

        @keyframes dot-blink {
          0% { opacity: .2; }
          20% { opacity: 1; }
          100% { opacity: .2; }
        }

        /* Dropzone / Upload Area Styles */
        .dropzone {
          border: 2.5px dashed var(--border-primary);
          border-radius: 12px;
          padding: 40px 20px;
          background: var(--bg-hover);
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          margin-bottom: 20px;
          box-sizing: border-box;
          width: 100%;
        }

        .dropzone.dragover {
          border-color: var(--accent);
          background: rgba(139, 92, 246, 0.05);
        }

        .dropzone-icon {
          width: 44px;
          height: 44px;
          color: var(--text-muted);
          transition: color 0.2s ease;
        }

        .dropzone.dragover .dropzone-icon {
          color: var(--accent-hover);
        }

        .dropzone-text {
          font-size: 0.9rem;
          color: var(--text-secondary);
          margin: 0;
          font-weight: 500;
        }

        .dropzone-subtext {
          font-size: 0.75rem;
          color: var(--text-muted);
          margin: 0;
        }

        .file-card {
          background: var(--bg-input);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          padding: 12px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          box-sizing: border-box;
          margin-bottom: 20px;
        }

        .file-info {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
          text-align: left;
        }

        .file-name {
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--text-primary);
          word-break: break-all;
        }

        .file-size {
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        /* Scope Selector Tabs */
        .scope-tabs {
          display: flex;
          gap: 6px;
          background: var(--bg-input);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          padding: 3px;
          margin-bottom: 20px;
        }

        .scope-tab {
          flex: 1;
          padding: 8px 12px;
          text-align: center;
          font-size: 0.85rem;
          font-weight: 500;
          color: var(--text-secondary);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .scope-tab.active {
          background: var(--bg-panel);
          color: var(--text-primary);
        }

        /* Mode Option Cards */
        .mode-cards {
          display: flex;
          gap: 12px;
          margin-bottom: 20px;
          width: 100%;
        }

        .mode-card {
          flex: 1;
          background: var(--bg-input);
          border: 1px solid var(--border-primary);
          border-radius: 10px;
          padding: 14px;
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          text-align: left;
        }

        .mode-card:hover {
          border-color: var(--border-focus);
        }

        .mode-card.active {
          border-color: var(--accent);
          background: var(--bg-active);
        }

        .mode-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
        }

        .mode-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          border: 2px solid var(--text-muted);
          display: inline-block;
        }

        .mode-card.active .mode-dot {
          border-color: var(--accent);
          background: var(--accent);
        }

        .mode-label {
          font-weight: 600;
          font-size: 0.85rem;
          color: var(--text-primary);
        }

        .mode-desc {
          font-size: 0.75rem;
          color: var(--text-muted);
          margin: 0;
          line-height: 1.35;
        }

        /* Providers Buttons Layout */
        .providers-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 20px;
          width: 100%;
        }

        .provider-btn {
          padding: 6px 12px;
          background: var(--bg-input);
          border: 1px solid var(--border-primary);
          color: var(--text-secondary);
          border-radius: 8px;
          font-size: 0.8rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .provider-btn:hover {
          color: var(--text-primary);
          border-color: var(--border-focus);
        }

        .provider-btn.active {
          color: white;
          background: var(--accent);
          border-color: var(--accent);
        }

        /* Model Cards List */
        .models-cards-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 100%;
          overflow-y: auto;
          padding-right: 4px;
          margin-top: 8px;
        }

        .model-card-item {
          background: var(--bg-input);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          padding: 10px 14px;
          cursor: pointer;
          transition: all 0.15s ease;
          display: flex;
          justify-content: space-between;
          align-items: center;
          text-align: left;
        }

        .model-card-item:hover {
          border-color: var(--border-focus);
        }

        .model-card-item.active {
          border-color: var(--accent);
          background: var(--bg-active);
        }

        .model-details {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .model-name-container {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .model-name {
          font-weight: 600;
          font-size: 0.85rem;
          color: var(--text-primary);
        }

        .badge-recommended {
          background: rgba(139, 92, 246, 0.1);
          color: #c084fc;
          border: 1px solid rgba(139, 92, 246, 0.2);
          padding: 1px 4px;
          border-radius: 3px;
          font-size: 0.6rem;
          text-transform: uppercase;
          font-weight: 600;
        }

        .model-desc {
          font-size: 0.75rem;
          color: var(--text-muted);
        }

        .model-size-badge {
          background: var(--bg-panel);
          border: 1px solid var(--border-primary);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.7rem;
          color: var(--text-secondary);
          font-weight: 500;
        }

        /* Generic Forms Styling */
        .form-group {
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          margin-bottom: 20px;
          box-sizing: border-box;
        }

        .form-label {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: var(--text-muted);
          margin-bottom: 6px;
          font-weight: 600;
        }

        .form-input, .form-select {
          width: 100%;
          background: var(--bg-input);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
          padding: 10px 14px;
          color: var(--text-primary);
          font-size: 0.85rem;
          box-sizing: border-box;
          outline: none;
          transition: all 0.15s ease;
        }

        .form-input:focus, .form-select:focus {
          border-color: var(--accent);
        }

        .result-panel, .error-panel {
          width: 100%;
          border-radius: 10px;
          padding: 14px;
          box-sizing: border-box;
          text-align: left;
          font-size: 0.85rem;
          line-height: 1.4;
          margin-top: 8px;
        }

        .result-panel {
          background: rgba(74, 222, 128, 0.04);
          border: 1px solid rgba(74, 222, 128, 0.1);
        }

        .result-title {
          font-size: 0.7rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #4ade80;
          margin: 0 0 6px 0;
          font-weight: 600;
        }

        .result-text {
          color: var(--text-primary);
          margin: 0;
          word-break: break-word;
        }

        .error-panel {
          background: rgba(239, 68, 68, 0.04);
          border: 1px solid rgba(239, 68, 68, 0.1);
          color: #fca5a5;
        }

        /* Preferences Styling */
        .settings-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
          width: 100%;
        }

        .settings-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: var(--bg-input);
          border: 1px solid var(--border-primary);
          border-radius: 8px;
        }

        .settings-label-container {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }

        .settings-label {
          font-weight: 500;
          font-size: 0.85rem;
          color: var(--text-primary);
        }

        .settings-sublabel {
          font-size: 0.75rem;
          color: var(--text-muted);
          margin-top: 1px;
        }

        .mic-icon {
          width: 32px;
          height: 32px;
          fill: currentColor;
        }
      `}</style>

      {/* Sidebar Navigation */}
      <div className="sidebar">
        <div className="logo-container">
          <div className="logo-icon">W</div>
          <span className="app-name">Open Whisper</span>
        </div>

        <div className="nav-menu">
          <div
            onClick={(): void => setCurrentTab('dictation')}
            className={`nav-item ${currentTab === 'dictation' ? 'active' : ''}`}
          >
            <svg className="nav-icon" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
            Dictation
          </div>

          <div
            onClick={(): void => setCurrentTab('upload')}
            className={`nav-item ${currentTab === 'upload' ? 'active' : ''}`}
          >
            <svg className="nav-icon" viewBox="0 0 24 24">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" />
            </svg>
            Upload Audio
          </div>

          <div
            onClick={(): void => setCurrentTab('chat')}
            className={`nav-item ${currentTab === 'chat' ? 'active' : ''}`}
          >
            <svg className="nav-icon" viewBox="0 0 24 24">
              <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z" />
            </svg>
            Chat Agent
          </div>

          <div
            onClick={(): void => setCurrentTab('history')}
            className={`nav-item ${currentTab === 'history' ? 'active' : ''}`}
          >
            <svg className="nav-icon" viewBox="0 0 24 24">
              <path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z" />
            </svg>
            History Logs
          </div>

          <div
            onClick={(): void => setCurrentTab('models')}
            className={`nav-item ${currentTab === 'models' ? 'active' : ''}`}
          >
            <svg className="nav-icon" viewBox="0 0 24 24">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2zm0-4H7V7h10v2zm0 8H7v-2h10v2z" />
            </svg>
            AI Models
          </div>

          <div
            onClick={(): void => setCurrentTab('preferences')}
            className={`nav-item ${currentTab === 'preferences' ? 'active' : ''}`}
          >
            <svg className="nav-icon" viewBox="0 0 24 24">
              <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
            </svg>
            Preferences
          </div>
        </div>

        <div className="sidebar-footer">
          <span>v1.0.0</span>
          <span>•</span>
          <span>Local Engine Active</span>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="viewport">
        {currentTab === 'dictation' && (
          <div className="content-panel content-center">
            <div className="dictation-wrapper">
              <h2 className="panel-title">Voice Dictation</h2>
              <p className="panel-subtitle">Hold hotkey or click microphone to start dictation</p>

              <div className="mic-btn-container">
                <button
                  onClick={toggleRecording}
                  className={`mic-btn ${status === 'recording' ? 'recording' : ''}`}
                  disabled={status === 'transcribing'}
                  aria-label="Toggle Recording"
                >
                  <svg className="mic-icon" viewBox="0 0 24 24">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                  </svg>
                </button>
                <div className="pulse-ring"></div>
              </div>

              {status === 'recording' && (
                <div className="waveform">
                  <div className="bar"></div>
                  <div className="bar"></div>
                  <div className="bar"></div>
                  <div className="bar"></div>
                  <div className="bar"></div>
                </div>
              )}

              <div className={`status-text status-${status}`}>
                {status === 'idle' && (audioSource === 'system' ? 'Click Mic to Record System Audio' : 'Click Mic to Record Microphone')}
                {status === 'recording' && 'Recording... Click to Stop'}
                {status === 'transcribing' && 'Transcribing audio...'}
                {status === 'success' && 'Text Pasted at Cursor!'}
                {status === 'error' && 'Error'}
              </div>

              {status === 'success' && transcribedText && (
                <div className="result-panel">
                  <h4 className="result-title">Transcribed Text</h4>
                  <p className="result-text">{transcribedText}</p>
                </div>
              )}

              {status === 'error' && errorMsg && <div className="error-panel">{errorMsg}</div>}
            </div>
          </div>
        )}

        {currentTab === 'upload' && (
          <div className="content-panel" style={{ overflowY: 'auto' }}>
            <h2 className="panel-title">Upload Audio File</h2>
            <p className="panel-subtitle">Drop or select an audio file to transcribe offline or online</p>

            <div
              className={`dropzone ${isDragOver ? 'dragover' : ''}`}
              onClick={(): void => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <svg className="dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <p className="dropzone-text">Drag and drop audio file here, or click to browse</p>
              <p className="dropzone-subtext">Supported formats: MP3, WAV, M4A, WEBM, FLAC (Max 25MB for cloud)</p>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.flac,.aac"
                style={{ display: 'none' }}
              />
            </div>

            {uploadFile && (
              <div className="file-card">
                <div className="file-info">
                  <span className="file-name">{uploadFile.name}</span>
                  <span className="file-size">{formatFileSize(uploadFile.size)}</span>
                </div>
                <button
                  onClick={(): void => setUploadFile(null)}
                  style={{ background: 'transparent', border: 'none', color: '#f87171', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  Remove
                </button>
              </div>
            )}

            {uploadFile && uploadStatus === 'idle' && (
              <button
                onClick={(): void => {
                  handleTranscribeUpload()
                }}
                style={{ width: '100%', padding: '12px', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', marginBottom: '20px' }}
              >
                Transcribe File ({inferenceMode === 'cloud' ? selectedCloudProvider : 'local'})
              </button>
            )}

            {uploadStatus !== 'idle' && (
              <div className={`status-text status-${uploadStatus}`} style={{ marginBottom: '20px', textAlign: 'center' }}>
                {uploadStatus === 'decoding' && 'Decoding and resampling audio file in-browser...'}
                {uploadStatus === 'transcribing' && 'Transcribing audio buffer...'}
                {uploadStatus === 'success' && 'Transcription Complete!'}
                {uploadStatus === 'error' && 'Transcription Failed'}
              </div>
            )}

            {uploadStatus === 'success' && uploadText && (
              <div className="result-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h4 className="result-title" style={{ margin: 0 }}>Transcribed Text</h4>
                  <button
                    onClick={(): void => {
                      navigator.clipboard.writeText(uploadText)
                      alert('Copied to clipboard!')
                    }}
                    style={{ background: 'transparent', border: 'none', color: '#8b5cf6', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Copy Text
                  </button>
                </div>
                <p className="result-text">{uploadText}</p>
              </div>
            )}

            {uploadStatus === 'error' && uploadError && (
              <div className="error-panel" style={{ marginTop: '10px' }}>
                {uploadError}
              </div>
            )}
          </div>
        )}

        {currentTab === 'chat' && (
          <div className="content-panel">
            <div className="chat-view-container">
              {/* Left Pane: Conversations List */}
              <div className="chat-sidebar">
                <div className="chat-sidebar-header">
                  <button onClick={handleNewChat} className="new-chat-btn">
                    New Chat
                  </button>
                </div>
                <input
                  type="text"
                  value={chatSearch}
                  onChange={(e): void => setChatSearch(e.target.value)}
                  placeholder="Search chats..."
                  className="form-input"
                  style={{ padding: '6px 10px', fontSize: '0.75rem', marginBottom: '10px' }}
                />

                <div className="chat-threads-list">
                  {conversations
                    .filter((c) => c.title.toLowerCase().includes(chatSearch.toLowerCase()))
                    .map((c) => (
                      <div
                        key={c.id}
                        onClick={(): Promise<void> => handleSelectConversation(c.id)}
                        className={`chat-thread-item ${activeConversationId === c.id ? 'active' : ''}`}
                      >
                        <span className="chat-thread-title">{c.title}</span>
                        <span className="chat-thread-preview">{c.last_message || 'No messages yet'}</span>
                        <div className="chat-thread-meta">
                          <span className="chat-thread-date">{new Date(c.updated_at).toLocaleDateString()}</span>
                          <div className="chat-thread-actions">
                            <button
                              onClick={(e): Promise<void> => handleArchiveConversation(c.id, e)}
                              className="chat-thread-action-btn"
                              title="Archive"
                            >
                              Arc
                            </button>
                            <button
                              onClick={(e): Promise<void> => handleDeleteConversation(c.id, e)}
                              className="chat-thread-action-btn"
                              title="Delete"
                            >
                              Del
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  {conversations.length === 0 && (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '20px', textAlign: 'center' }}>
                      No active threads.
                    </span>
                  )}
                </div>
              </div>

              {/* Right Pane: Messages Window */}
              <div className="chat-main-window">
                <div className="chat-header">
                  <div>
                    <h2 className="panel-title" style={{ margin: 0, fontSize: '1.2rem' }}>
                      {activeConversationId
                        ? conversations.find((c) => c.id === activeConversationId)?.title || 'Active Chat'
                        : 'New Chat'}
                    </h2>
                    <p className="panel-subtitle" style={{ margin: 0, fontSize: '0.75rem' }}>
                      Conversational Assistant Session
                    </p>
                  </div>
                  <div className="chat-model-info">
                    {inferenceMode === 'cloud' ? selectedCloudProvider : selectedLocalProvider} /{' '}
                    {selectedChatModel}
                  </div>
                </div>

                <div className="chat-messages">
                  {chatMessages.map((msg, index) => (
                    <div key={index} className={`chat-bubble ${msg.role}`}>
                      {msg.content === '' && isChatStreaming && index === chatMessages.length - 1 ? (
                        <div className="typing-indicator">
                          <div className="dot"></div>
                          <div className="dot"></div>
                          <div className="dot"></div>
                        </div>
                      ) : (
                        msg.content
                          .split('`')
                          .map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part))
                      )}
                    </div>
                  ))}
                  {chatMessages.length === 0 && (
                    <div style={{ margin: 'auto', color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
                      Ask me anything, or configure settings in the AI Models tab.
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div className="chat-input-container">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e): void => setChatInput(e.target.value)}
                    onKeyDown={(e): void => {
                      if (e.key === 'Enter') sendChatMessage()
                    }}
                    placeholder="Type a message to prompt the agent..."
                    className="chat-input"
                    disabled={isChatStreaming}
                  />
                  <button
                    type="button"
                    onClick={sendChatMessage}
                    disabled={isChatStreaming || !chatInput.trim()}
                    className="chat-send-btn"
                    aria-label="Send Message"
                  >
                    <svg className="chat-send-icon" viewBox="0 0 24 24">
                      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {currentTab === 'history' && (
          <div className="content-panel" style={{ overflowY: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <h2 className="panel-title" style={{ margin: 0 }}>History Logs</h2>
              {historyItems.length > 0 && (
                <button
                  onClick={handleClearHistory}
                  style={{ padding: '6px 12px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  Clear All
                </button>
              )}
            </div>
            <p className="panel-subtitle">Review, search, and delete your past transcriptions and assistant conversations</p>

            {/* Filter controls */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              <input
                type="text"
                value={historySearch}
                onChange={(e): void => setHistorySearch(e.target.value)}
                placeholder="Search transcripts..."
                className="form-input"
                style={{ flexGrow: 1 }}
              />
              <select
                value={historyTypeFilter}
                onChange={(e): void => setHistoryTypeFilter(e.target.value as any)}
                className="form-select"
                style={{ width: '120px' }}
              >
                <option value="all">All Types</option>
                <option value="dictation">Dictation</option>
                <option value="chat">Chat completions</option>
              </select>
            </div>

            {/* Logs List Container */}
            <div style={{ flexGrow: 1, overflowY: 'auto', paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {historyItems
                .filter((item) => {
                  const matchSearch = item.text.toLowerCase().includes(historySearch.toLowerCase())
                  const matchType = historyTypeFilter === 'all' || item.type === historyTypeFilter
                  return matchSearch && matchType
                })
                .map((item) => (
                  <div
                    key={item.id}
                    style={{ background: 'var(--bg-input)', border: '1px solid var(--border-primary)', borderRadius: '8px', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px', textAlign: 'left' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', background: item.type === 'dictation' ? '#3b82f6' : '#8b5cf6', color: 'white', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                          {item.type}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {item.provider} / {item.model}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {formatTime(item.timestamp)}
                      </span>
                    </div>
                    
                    <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.4, wordBreak: 'break-word' }}>
                      {item.text}
                    </p>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid var(--border-primary)', paddingTop: '8px', marginTop: '4px' }}>
                      <button
                        onClick={(): void => {
                          navigator.clipboard.writeText(item.text)
                          alert('Copied to clipboard!')
                        }}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', padding: '2px 6px' }}
                      >
                        Copy
                      </button>
                      <button
                        onClick={(): void => {
                          handleDeleteHistoryItem(item.id)
                        }}
                        style={{ background: 'transparent', border: 'none', color: '#f87171', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', padding: '2px 6px' }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}

              {historyItems.filter((item) => {
                const matchSearch = item.text.toLowerCase().includes(historySearch.toLowerCase())
                const matchType = historyTypeFilter === 'all' || item.type === historyTypeFilter
                return matchSearch && matchType
              }).length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'center', marginTop: '40px' }}>
                  No historical items found matching your filters.
                </div>
              )}
            </div>
          </div>
        )}

        {currentTab === 'models' && (
          <div className="content-panel" style={{ overflowY: 'auto' }}>
            <h2 className="panel-title">AI Models</h2>
            <p className="panel-subtitle">Configure model parameters and API authentication keys</p>

            {/* Scope Selection Tabs */}
            <div className="scope-tabs">
              <div
                className={`scope-tab ${activeScope === 'chat' ? 'active' : ''}`}
                onClick={(): void => setActiveScope('chat')}
              >
                Chat Scope
              </div>
              <div
                className={`scope-tab ${activeScope === 'dictation' ? 'active' : ''}`}
                onClick={(): void => setActiveScope('dictation')}
              >
                Dictation Scope
              </div>
            </div>

            {/* Mode Option Selection */}
            <div className="mode-cards">
              <div
                className={`mode-card ${inferenceMode === 'cloud' ? 'active' : ''}`}
                onClick={(): void => setInferenceMode('cloud')}
              >
                <div className="mode-header">
                  <span className="mode-dot"></span>
                  <span className="mode-label">Cloud Providers</span>
                </div>
                <p className="mode-desc">
                  Bring your own API key to connect to cloud inference gateways.
                </p>
              </div>

              <div
                className={`mode-card ${inferenceMode === 'local' ? 'active' : ''}`}
                onClick={(): void => setInferenceMode('local')}
              >
                <div className="mode-header">
                  <span className="mode-dot"></span>
                  <span className="mode-label">Local Engines</span>
                </div>
                <p className="mode-desc">
                  Run on-device private models offline directly on your machine.
                </p>
              </div>
            </div>

            {/* Cloud Settings UI */}
            {inferenceMode === 'cloud' && (
              <>
                <div className="form-group">
                  <label className="form-label font-bold">Select Cloud Provider</label>
                  <div className="providers-list">
                    {cloudProviders.map((provider) => (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={(): void => handleCloudProviderSelect(provider.id)}
                        className={`provider-btn ${selectedCloudProvider === provider.id ? 'active' : ''}`}
                      >
                        {provider.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">
                    {selectedCloudProvider.toUpperCase()} API Key
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={handleApiKeyChange}
                    placeholder={`Paste your ${selectedCloudProvider} API key here`}
                    className="form-input"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">
                    Available Models for {selectedCloudProvider.toUpperCase()}
                  </label>
                  <div className="models-cards-list">
                    {currentCloudProviderData?.models.map((model) => (
                      <div
                        key={model.id}
                        onClick={(): void =>
                          activeScope === 'chat'
                            ? setSelectedChatModel(model.id)
                            : setSelectedDictationModel(model.id)
                        }
                        className={`model-card-item ${(activeScope === 'chat' ? selectedChatModel : selectedDictationModel) === model.id ? 'active' : ''}`}
                      >
                        <div className="model-details">
                          <div className="model-name-container">
                            <span className="model-name">{model.name}</span>
                            {model.supportsThinking && (
                              <span className="badge-recommended">Thinking</span>
                            )}
                          </div>
                          <span className="model-desc">{model.description}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Local Settings UI */}
            {inferenceMode === 'local' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', padding: '12px', background: 'var(--bg-input)', borderRadius: '8px', border: '1px solid var(--border-primary)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>Local Sidecar Services</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      Llama: {localStatus.llamaInstalled ? (localStatus.llamaRunning ? '🟢 Running' : '🔴 Stopped') : '❌ Missing'} |
                      Whisper: {localStatus.whisperInstalled ? (localStatus.whisperRunning ? '🟢 Running' : '🔴 Stopped') : '❌ Missing'}
                    </span>
                  </div>
                  {(!localStatus.llamaInstalled || !localStatus.whisperInstalled) && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                      <button
                        onClick={handleDownloadBinaries}
                        disabled={activeDownloads['llama']?.status === 'downloading' || activeDownloads['whisper']?.status === 'downloading'}
                        style={{ padding: '6px 12px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                      >
                        {activeDownloads['llama']?.status === 'downloading'
                          ? `Downloading Llama (${activeDownloads['llama']?.percent || 0}%)`
                          : activeDownloads['whisper']?.status === 'downloading'
                          ? `Downloading Whisper (${activeDownloads['whisper']?.percent || 0}%)`
                          : 'Download Binaries (25MB)'}
                      </button>
                      {(activeDownloads['llama']?.error || activeDownloads['whisper']?.error) && (
                        <span style={{ color: '#ef4444', fontSize: '0.7rem', maxWidth: '220px', textAlign: 'right', wordBreak: 'break-word' }}>
                          Error: {activeDownloads['llama']?.error || activeDownloads['whisper']?.error}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {activeScope === 'chat' ? (
                  <>
                    <div className="form-group">
                      <label className="form-label font-bold">Select Local Engine</label>
                      <div className="providers-list">
                        {localProviders.map((provider) => (
                          <button
                            key={provider.id}
                            type="button"
                            onClick={(): void => handleLocalProviderSelect(provider.id)}
                            className={`provider-btn ${selectedLocalProvider === provider.id ? 'active' : ''}`}
                          >
                            {provider.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label">
                        GGUF Local Model definitions for {selectedLocalProvider.toUpperCase()}
                      </label>
                      <div className="models-cards-list">
                        {currentLocalProviderData?.models.map((model: any) => {
                          const isDownloaded = localStatus.downloadedLlamaModels.includes(model.fileName)
                          const download = activeDownloads[model.fileName]
                          
                          return (
                            <div
                              key={model.id}
                              onClick={(): void => {
                                if (isDownloaded) {
                                  setSelectedChatModel(model.id)
                                }
                              }}
                              className={`model-card-item ${selectedChatModel === model.id ? 'active' : ''}`}
                              style={{ opacity: isDownloaded ? 1 : 0.6 }}
                            >
                              <div className="model-details">
                                <div className="model-name-container">
                                  <span className="model-name">{model.name}</span>
                                  {model.recommended && (
                                    <span className="badge-recommended">Recommended</span>
                                  )}
                                  {isDownloaded && <span style={{ color: '#4ade80', fontSize: '0.7rem', fontWeight: 600, marginLeft: '6px' }}>● Downloaded</span>}
                                </div>
                                <span className="model-desc">{model.description}</span>
                                {download?.status === 'downloading' && (
                                  <div style={{ width: '100%', marginTop: '6px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '3px' }}>
                                      <span>Downloading...</span>
                                      <span>
                                        {download.loadedBytes ? formatFileSize(download.loadedBytes) : '0 B'} of{' '}
                                        {download.totalBytes ? formatFileSize(download.totalBytes) : 'Unknown'}{' '}
                                        ({download.percent}%)
                                      </span>
                                    </div>
                                    <div style={{ width: '100%', height: '4px', background: 'var(--border-primary)', borderRadius: '2px', overflow: 'hidden' }}>
                                      <div style={{ width: `${download.percent}%`, height: '100%', background: 'var(--accent)' }}></div>
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="model-size-badge">{model.size}</span>
                                {isDownloaded ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleDeleteModel('llama', model.fileName)
                                    }}
                                    style={{ padding: '4px 8px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                                  >
                                    Delete
                                  </button>
                                ) : download?.status === 'downloading' ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleCancelDownload(model.fileName)
                                    }}
                                    style={{ padding: '4px 8px', background: '#334155', color: '#cbd5e1', border: 'none', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                                  >
                                    Cancel
                                  </button>
                                ) : (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleDownloadModel('llama', model.id, model.hfRepo, model.fileName)
                                    }}
                                    style={{ padding: '4px 8px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                                  >
                                    Get
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="form-group">
                    <label className="form-label">
                      Whisper Local Model definitions
                    </label>
                    <div className="models-cards-list">
                      {Object.entries(registry.getWhisperModels()).map(([key, model]) => {
                        const isDownloaded = localStatus.downloadedWhisperModels.includes(model.fileName)
                        const download = activeDownloads[model.fileName]

                        return (
                          <div
                            key={key}
                            onClick={(): void => {
                              if (isDownloaded) {
                                setSelectedDictationModel(key)
                              }
                            }}
                            className={`model-card-item ${selectedDictationModel === key ? 'active' : ''}`}
                            style={{ opacity: isDownloaded ? 1 : 0.6 }}
                          >
                            <div className="model-details">
                              <div className="model-name-container">
                                <span className="model-name">{model.name}</span>
                                {model.recommended && (
                                  <span className="badge-recommended">Recommended</span>
                                )}
                                {isDownloaded && <span style={{ color: '#4ade80', fontSize: '0.7rem', fontWeight: 600, marginLeft: '6px' }}>● Downloaded</span>}
                              </div>
                              <span className="model-desc">{model.description}</span>
                              {download?.status === 'downloading' && (
                                <div style={{ width: '100%', marginTop: '6px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: '3px' }}>
                                    <span>Downloading...</span>
                                    <span>
                                      {download.loadedBytes ? formatFileSize(download.loadedBytes) : '0 B'} of{' '}
                                      {download.totalBytes ? formatFileSize(download.totalBytes) : 'Unknown'}{' '}
                                      ({download.percent}%)
                                    </span>
                                  </div>
                                  <div style={{ width: '100%', height: '4px', background: 'var(--border-primary)', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ width: `${download.percent}%`, height: '100%', background: 'var(--accent)' }}></div>
                                  </div>
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="model-size-badge">{model.size}</span>
                              {isDownloaded ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDeleteModel('whisper', model.fileName)
                                  }}
                                  style={{ padding: '4px 8px', background: '#ef4444', color: 'white', border: 'none', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                                >
                                  Delete
                                </button>
                              ) : download?.status === 'downloading' ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleCancelDownload(model.fileName)
                                  }}
                                  style={{ padding: '4px 8px', background: '#334155', color: '#cbd5e1', border: 'none', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                                >
                                  Cancel
                                </button>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDownloadModel('whisper', key, 'ggerganov/whisper.cpp', model.fileName)
                                  }}
                                  style={{ padding: '4px 8px', background: 'var(--accent)', color: 'white', border: 'none', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                                >
                                  Get
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {currentTab === 'preferences' && (
          <div className="content-panel">
            <h2 className="panel-title">Preferences</h2>
            <p className="panel-subtitle">Adjust core application behavior and layout hotkeys</p>

            <div className="settings-list">
              <div className="settings-item">
                <div className="settings-label-container">
                  <span className="settings-label">Activation Hotkey</span>
                  <span className="settings-sublabel">Press to activate background dictation</span>
                </div>
                <input
                  type="text"
                  value={activationKey}
                  onChange={(e): void => setActivationKey(e.target.value)}
                  className="form-input"
                  style={{ width: '130px', textAlign: 'center' }}
                />
              </div>

              <div className="settings-item">
                <div className="settings-label-container">
                  <span className="settings-label">Audio Input Source</span>
                  <span className="settings-sublabel">Select audio capturing device</span>
                </div>
                <select
                  value={audioSource}
                  onChange={(e): void => {
                    const val = e.target.value as 'mic' | 'system'
                    setAudioSource(val)
                    localStorage.setItem('audio_source', val)
                  }}
                  className="form-select"
                  style={{ width: '150px' }}
                >
                  <option value="mic">Microphone</option>
                  <option value="system">System Loopback</option>
                </select>
              </div>

              <div className="settings-item">
                <div className="settings-label-container">
                  <span className="settings-label">Interface Theme Mode</span>
                  <span className="settings-sublabel">Switch application visuals theme style</span>
                </div>
                <select
                  value={theme}
                  onChange={(e): void => {
                    const val = e.target.value
                    setTheme(val)
                    localStorage.setItem('theme', val)
                  }}
                  className="form-select"
                  style={{ width: '120px' }}
                >
                  <option value="dark">Dark Theme</option>
                  <option value="light">Light Theme</option>
                </select>
              </div>

              <div className="settings-item">
                <div className="settings-label-container">
                  <span className="settings-label">Start on Login</span>
                  <span className="settings-sublabel">
                    Launch application automatically on login
                  </span>
                </div>
                <input
                  type="checkbox"
                  defaultChecked
                  style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Resampling and WAV helper functions
function encodeWAV(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)
  floatTo16BitPCM(view, 44, samples)
  return buffer
}

function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array): void {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]))
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
  }
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

export default App
