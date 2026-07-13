import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  transcribeAudio: (arrayBuffer: ArrayBuffer, provider?: string, model?: string, apiKey?: string) =>
    ipcRenderer.invoke('transcribe-audio', arrayBuffer, provider, model, apiKey),
  startChatStream: (
    streamId: string,
    messages: any[],
    provider: string,
    model: string,
    apiKey?: string
  ) => ipcRenderer.send('start-chat-stream', streamId, messages, provider, model, apiKey),
  onChatChunk: (
    streamId: string,
    callback: (event: any, data: { text?: string; done: boolean; error?: string }) => void
  ) => {
    ipcRenderer.on(`chat-chunk-${streamId}`, callback)
  },
  offChatChunk: (streamId: string) => {
    ipcRenderer.removeAllListeners(`chat-chunk-${streamId}`)
  },
  onToggleRecording: (callback: () => void) => {
    ipcRenderer.on('toggle-recording', () => callback())
  },
  notifyStatusChange: (status: string, text?: string) => {
    ipcRenderer.send('status-changed', status, text)
  },
  onSyncStatus: (callback: (event: any, status: string, text?: string) => void) => {
    ipcRenderer.on('sync-status', callback)
  },
  getLocalServerStatus: () => ipcRenderer.invoke('get-local-server-status'),
  downloadLocalBinaries: () => ipcRenderer.invoke('download-local-binaries'),
  downloadLocalModel: (type: 'llama' | 'whisper', hfRepoOrName: string, fileName: string) =>
    ipcRenderer.invoke('download-local-model', type, hfRepoOrName, fileName),
  cancelDownload: (id: string) => ipcRenderer.invoke('cancel-download', id),
  deleteModel: (type: 'llama' | 'whisper', fileName: string) =>
    ipcRenderer.invoke('delete-model', type, fileName),
  onDownloadProgress: (callback: (event: any, progress: any) => void) => {
    ipcRenderer.on('download-progress', callback)
    return () => {
      ipcRenderer.removeListener('download-progress', callback)
    }
  },
  getHistory: () => ipcRenderer.invoke('get-history'),
  deleteHistoryItem: (id: string) => ipcRenderer.invoke('delete-history-item', id),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  getDesktopAudioSourceId: () => ipcRenderer.invoke('get-desktop-audio-source-id'),
  getAgentConversationsWithPreview: (limit: number, offset: number, archived: boolean) =>
    ipcRenderer.invoke('get-agent-conversations-with-preview', limit, offset, archived),
  getAgentConversation: (id: number) => ipcRenderer.invoke('get-agent-conversation', id),
  createAgentConversation: (title: string, noteId?: number) =>
    ipcRenderer.invoke('create-agent-conversation', title, noteId),
  addAgentMessage: (conversationId: number, role: 'user' | 'assistant', content: string, metadata?: any) =>
    ipcRenderer.invoke('add-agent-message', conversationId, role, content, metadata),
  deleteAgentConversation: (id: number) => ipcRenderer.invoke('delete-agent-conversation', id),
  archiveAgentConversation: (id: number) => ipcRenderer.invoke('archive-agent-conversation', id)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
