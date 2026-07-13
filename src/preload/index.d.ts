import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      transcribeAudio: (
        arrayBuffer: ArrayBuffer,
        provider?: string,
        model?: string,
        apiKey?: string
      ) => Promise<{ success: boolean; text?: string; error?: string }>
      startChatStream: (
        streamId: string,
        messages: any[],
        provider: string,
        model: string,
        apiKey?: string
      ) => void
      onChatChunk: (
        streamId: string,
        callback: (event: any, data: { text?: string; done: boolean; error?: string }) => void
      ) => void
      offChatChunk: (streamId: string) => void
      onToggleRecording: (callback: () => void) => void
      notifyStatusChange: (status: string, text?: string) => void
      onSyncStatus: (callback: (event: any, status: string, text?: string) => void) => void
      getLocalServerStatus: () => Promise<{
        llamaInstalled: boolean
        llamaRunning: boolean
        whisperInstalled: boolean
        whisperRunning: boolean
        downloadedLlamaModels: string[]
        downloadedWhisperModels: string[]
      }>
      downloadLocalBinaries: () => Promise<void>
      downloadLocalModel: (type: 'llama' | 'whisper', hfRepoOrName: string, fileName: string) => Promise<{ success: boolean; path?: string; error?: string }>
      cancelDownload: (id: string) => Promise<boolean>
      deleteModel: (type: 'llama' | 'whisper', fileName: string) => Promise<boolean>
      onDownloadProgress: (callback: (event: any, progress: any) => void) => () => void
      getHistory: () => Promise<Array<{
        id: string
        timestamp: number
        text: string
        provider: string
        model: string
        type: 'dictation' | 'chat'
      }>>
      deleteHistoryItem: (id: string) => Promise<boolean>
      clearHistory: () => Promise<void>
      getDesktopAudioSourceId: () => Promise<string>
      getAgentConversationsWithPreview: (limit: number, offset: number, archived: boolean) => Promise<Array<{
        id: number
        title: string
        last_message: string
        created_at: string
        updated_at: string
        archived_at?: string
      }>>
      getAgentConversation: (id: number) => Promise<{
        id: number
        title: string
        noteId?: number
        created_at: string
        updated_at: string
        archived_at?: string
        messages: Array<{
          id: string
          role: 'user' | 'assistant'
          content: string
          metadata?: string
          created_at: string
        }>
      } | null>
      createAgentConversation: (title: string, noteId?: number) => Promise<{ id: number; title: string }>
      addAgentMessage: (conversationId: number, role: 'user' | 'assistant', content: string, metadata?: any) => Promise<any>
      deleteAgentConversation: (id: number) => Promise<boolean>
      archiveAgentConversation: (id: number) => Promise<boolean>
    }
  }
}
