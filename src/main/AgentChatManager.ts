import { app } from 'electron'
import path from 'path'
import fs from 'fs'

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  metadata?: string // JSON string
  created_at: string
}

export interface AgentConversation {
  id: number
  title: string
  noteId?: number
  created_at: string
  updated_at: string
  archived_at?: string
  messages: AgentMessage[]
}

export class AgentChatManager {
  private static instance: AgentChatManager
  private dbPath: string
  private conversations: AgentConversation[] = []

  private constructor() {
    this.dbPath = path.join(app.getPath('userData'), 'agent_conversations.json')
    this.load()
  }

  static getInstance(): AgentChatManager {
    if (!AgentChatManager.instance) {
      AgentChatManager.instance = new AgentChatManager()
    }
    return AgentChatManager.instance
  }

  private load(): void {
    try {
      if (fs.existsSync(this.dbPath)) {
        const raw = fs.readFileSync(this.dbPath, 'utf8')
        this.conversations = JSON.parse(raw)
      } else {
        this.conversations = []
        this.save()
      }
    } catch (e) {
      console.error('Failed to load agent conversations:', e)
      this.conversations = []
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.conversations, null, 2), 'utf8')
    } catch (e) {
      console.error('Failed to save agent conversations:', e)
    }
  }

  async getConversations(limit: number, offset: number, archived: boolean): Promise<any[]> {
    this.load()
    const filtered = this.conversations.filter((c) => {
      const isArchived = !!c.archived_at
      return archived ? isArchived : !isArchived
    })

    // Sort by updated_at descending
    filtered.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

    const paginated = filtered.slice(offset, offset + limit)

    return paginated.map((c) => ({
      id: c.id,
      title: c.title,
      last_message: c.messages[c.messages.length - 1]?.content || '',
      created_at: c.created_at,
      updated_at: c.updated_at,
      archived_at: c.archived_at
    }))
  }

  async getConversation(id: number): Promise<AgentConversation | null> {
    this.load()
    const conv = this.conversations.find((c) => c.id === id)
    return conv || null
  }

  async createConversation(title: string, noteId?: number): Promise<AgentConversation> {
    this.load()
    const newId = this.conversations.length > 0 ? Math.max(...this.conversations.map((c) => c.id)) + 1 : 1
    const now = new Date().toISOString()
    const newConv: AgentConversation = {
      id: newId,
      title: title || 'Untitled',
      noteId,
      created_at: now,
      updated_at: now,
      messages: []
    }
    this.conversations.push(newConv)
    this.save()
    return newConv
  }

  async addMessage(
    conversationId: number,
    role: 'user' | 'assistant',
    content: string,
    metadata?: any
  ): Promise<AgentMessage | null> {
    this.load()
    const conv = this.conversations.find((c) => c.id === conversationId)
    if (!conv) return null

    const now = new Date().toISOString()
    const msg: AgentMessage = {
      id: Math.random().toString(36).substring(2, 11),
      role,
      content,
      metadata: metadata ? JSON.stringify(metadata) : undefined,
      created_at: now
    }

    conv.messages.push(msg)
    conv.updated_at = now
    this.save()
    return msg
  }

  async deleteConversation(id: number): Promise<boolean> {
    this.load()
    const idx = this.conversations.findIndex((c) => c.id === id)
    if (idx === -1) return false
    this.conversations.splice(idx, 1)
    this.save()
    return true
  }

  async archiveConversation(id: number): Promise<boolean> {
    this.load()
    const conv = this.conversations.find((c) => c.id === id)
    if (!conv) return false
    conv.archived_at = new Date().toISOString()
    conv.updated_at = new Date().toISOString()
    this.save()
    return true
  }
}
