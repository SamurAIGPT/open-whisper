import { app } from 'electron'
import path from 'path'
import fs from 'fs'

export interface HistoryItem {
  id: string
  timestamp: number
  text: string
  provider: string
  model: string
  type: 'dictation' | 'chat'
}

export class HistoryManager {
  private static instance: HistoryManager
  private historyFile: string
  private cache: HistoryItem[] = []

  private constructor() {
    this.historyFile = path.join(app.getPath('userData'), 'history.json')
    this.loadHistory()
  }

  static getInstance(): HistoryManager {
    if (!HistoryManager.instance) {
      HistoryManager.instance = new HistoryManager()
    }
    return HistoryManager.instance
  }

  private loadHistory(): void {
    try {
      if (fs.existsSync(this.historyFile)) {
        const raw = fs.readFileSync(this.historyFile, 'utf-8')
        this.cache = JSON.parse(raw) as HistoryItem[]
        // Sort newest first
        this.cache.sort((a, b) => b.timestamp - a.timestamp)
      } else {
        this.cache = []
        this.saveHistory()
      }
    } catch (e) {
      console.error('Failed to load history file:', e)
      this.cache = []
    }
  }

  private saveHistory(): void {
    try {
      fs.writeFileSync(this.historyFile, JSON.stringify(this.cache, null, 2), 'utf-8')
    } catch (e) {
      console.error('Failed to write history file:', e)
    }
  }

  getHistory(): HistoryItem[] {
    return this.cache
  }

  addHistoryItem(text: string, provider: string, model: string, type: 'dictation' | 'chat'): HistoryItem {
    const item: HistoryItem = {
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      text,
      provider,
      model,
      type
    }
    
    this.cache.unshift(item)
    this.saveHistory()
    return item
  }

  deleteHistoryItem(id: string): boolean {
    const index = this.cache.findIndex(item => item.id === id)
    if (index !== -1) {
      this.cache.splice(index, 1)
      this.saveHistory()
      return true
    }
    return false
  }

  clearHistory(): void {
    this.cache = []
    this.saveHistory()
  }
}
