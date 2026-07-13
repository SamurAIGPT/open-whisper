import { spawn, exec, ChildProcess } from 'child_process'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'
import net from 'net'

export interface DownloadProgress {
  type: 'binary' | 'model'
  id: string
  percent: number
  status: 'idle' | 'downloading' | 'completed' | 'error'
  error?: string
  loadedBytes?: number
  totalBytes?: number
}

export class LocalServerManager {
  private static instance: LocalServerManager
  
  private llamaProcess: ChildProcess | null = null
  private whisperProcess: ChildProcess | null = null
  private activeRequests = new Map<string, () => void>()
  
  public llamaPort = 8221
  public whisperPort = 8178
  
  private installDir: string
  private progressCallbacks: Set<(progress: DownloadProgress) => void> = new Set()

  private constructor() {
    this.installDir = path.join(app.getPath('userData'), 'local-binaries')
    fs.mkdirSync(this.installDir, { recursive: true })
  }

  static getInstance(): LocalServerManager {
    if (!LocalServerManager.instance) {
      LocalServerManager.instance = new LocalServerManager()
    }
    return LocalServerManager.instance
  }

  onProgress(callback: (progress: DownloadProgress) => void): () => void {
    this.progressCallbacks.add(callback)
    return () => this.progressCallbacks.delete(callback)
  }

  private emitProgress(progress: DownloadProgress): void {
    for (const cb of this.progressCallbacks) {
      cb(progress)
    }
  }

  // Get status of local servers
  getStatus(): {
    llamaInstalled: boolean
    llamaRunning: boolean
    whisperInstalled: boolean
    whisperRunning: boolean
    downloadedLlamaModels: string[]
    downloadedWhisperModels: string[]
  } {
    const platformExt = process.platform === 'win32' ? '.exe' : ''
    const llamaBinary = path.join(this.installDir, `llama-server${platformExt}`)
    const whisperBinary = path.join(this.installDir, `whisper-server${platformExt}`)
    
    const llamaModelsDir = path.join(app.getPath('userData'), 'models', 'llama')
    const whisperModelsDir = path.join(app.getPath('userData'), 'models', 'whisper')
    
    const downloadedLlamaModels = fs.existsSync(llamaModelsDir) 
      ? fs.readdirSync(llamaModelsDir).filter(f => {
          if (!f.endsWith('.gguf')) return false
          try {
            return fs.statSync(path.join(llamaModelsDir, f)).size > 0
          } catch {
            return false
          }
        })
      : []
    const downloadedWhisperModels = fs.existsSync(whisperModelsDir) 
      ? fs.readdirSync(whisperModelsDir).filter(f => {
          if (!f.endsWith('.bin')) return false
          try {
            return fs.statSync(path.join(whisperModelsDir, f)).size > 0
          } catch {
            return false
          }
        })
      : []

    let llamaInstalled = false
    try {
      llamaInstalled = fs.existsSync(llamaBinary) && fs.statSync(llamaBinary).size > 0
    } catch {}

    let whisperInstalled = false
    try {
      whisperInstalled = fs.existsSync(whisperBinary) && fs.statSync(whisperBinary).size > 0
    } catch {}

    return {
      llamaInstalled,
      llamaRunning: this.llamaProcess !== null && !this.llamaProcess.killed,
      whisperInstalled,
      whisperRunning: this.whisperProcess !== null && !this.whisperProcess.killed,
      downloadedLlamaModels,
      downloadedWhisperModels
    }
  }

  // Find a free port in a range
  private async findFreePort(startPort: number): Promise<number> {
    return new Promise((resolve) => {
      const server = net.createServer()
      server.listen(startPort, '127.0.0.1', () => {
        const addr = server.address()
        const port = typeof addr === 'string' ? startPort : addr?.port || startPort
        server.close(() => resolve(port))
      })
      server.on('error', () => {
        resolve(this.findFreePort(startPort + 1))
      })
    })
  }

  // Spawns Llama Cpp Server
  async startLlamaServer(modelPath: string): Promise<boolean> {
    if (this.llamaProcess && !this.llamaProcess.killed) {
      return true
    }

    const platformExt = process.platform === 'win32' ? '.exe' : ''
    const binaryPath = path.join(this.installDir, `llama-server${platformExt}`)

    if (!fs.existsSync(binaryPath)) {
      throw new Error('Llama server binary is not installed')
    }

    if (!fs.existsSync(modelPath)) {
      throw new Error(`Model file not found at ${modelPath}`)
    }

    this.llamaPort = await this.findFreePort(8221)

    // Spawn server process: llama-server -m <modelPath> --port <port> -c 2048
    this.llamaProcess = spawn(binaryPath, [
      '-m', modelPath,
      '--port', this.llamaPort.toString(),
      '-c', '2048',
      '--host', '127.0.0.1'
    ])

    return new Promise((resolve) => {
      let isResolved = false
      
      const checkInterval = setInterval(async () => {
        const ready = await this.checkPortHealth(this.llamaPort)
        if (ready) {
          clearInterval(checkInterval)
          if (!isResolved) {
            isResolved = true
            resolve(true)
          }
        }
      }, 500)

      this.llamaProcess?.on('close', () => {
        clearInterval(checkInterval)
        this.llamaProcess = null
        if (!isResolved) {
          isResolved = true
          resolve(false)
        }
      })

      // Timeout safety
      setTimeout(() => {
        clearInterval(checkInterval)
        if (!isResolved) {
          isResolved = true
          resolve(false)
        }
      }, 30000)
    })
  }

  // Spawns Whisper Cpp Server
  async startWhisperServer(modelPath: string): Promise<boolean> {
    if (this.whisperProcess && !this.whisperProcess.killed) {
      return true
    }

    const platformExt = process.platform === 'win32' ? '.exe' : ''
    const binaryPath = path.join(this.installDir, `whisper-server${platformExt}`)

    if (!fs.existsSync(binaryPath)) {
      throw new Error('Whisper server binary is not installed')
    }

    if (!fs.existsSync(modelPath)) {
      throw new Error(`Whisper model file not found at ${modelPath}`)
    }

    this.whisperPort = await this.findFreePort(8178)

    // Spawn server process: whisper-server -m <modelPath> --port <port> --host 127.0.0.1
    this.whisperProcess = spawn(binaryPath, [
      '-m', modelPath,
      '--port', this.whisperPort.toString(),
      '--host', '127.0.0.1'
    ])

    return new Promise((resolve) => {
      let isResolved = false
      
      const checkInterval = setInterval(async () => {
        const ready = await this.checkPortHealth(this.whisperPort)
        if (ready) {
          clearInterval(checkInterval)
          if (!isResolved) {
            isResolved = true
            resolve(true)
          }
        }
      }, 500)

      this.whisperProcess?.on('close', () => {
        clearInterval(checkInterval)
        this.whisperProcess = null
        if (!isResolved) {
          isResolved = true
          resolve(false)
        }
      })

      // Timeout safety
      setTimeout(() => {
        clearInterval(checkInterval)
        if (!isResolved) {
          isResolved = true
          resolve(false)
        }
      }, 30000)
    })
  }

  private async checkPortHealth(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path: '/',
        method: 'GET',
        timeout: 1000
      }, (res) => {
        resolve(res.statusCode === 200 || res.statusCode === 404)
        res.resume()
      })
      req.on('error', () => resolve(false))
      req.on('timeout', () => {
        req.destroy()
        resolve(false)
      })
      req.end()
    })
  }

  // Stops all servers
  stopAll(): void {
    if (this.llamaProcess) {
      this.llamaProcess.kill('SIGTERM')
      this.llamaProcess = null
    }
    if (this.whisperProcess) {
      this.whisperProcess.kill('SIGTERM')
      this.whisperProcess = null
    }
  }

  // Downloads Llama.cpp and Whisper.cpp release packages
  async downloadBinaries(): Promise<void> {
    const platform = process.platform
    const arch = process.arch
    
    // Construct URLs
    let llamaUrl = ''
    let whisperUrl = ''
    
    if (platform === 'win32') {
      llamaUrl = 'https://github.com/ggml-org/llama.cpp/releases/download/b9763/llama-b9763-bin-win-cpu-x64.zip'
      whisperUrl = 'https://github.com/OpenWhispr/whisper.cpp/releases/download/v1.7.1-bin-3/whisper-server-win32-x64-cpu.zip'
    } else if (platform === 'darwin') {
      llamaUrl = `https://github.com/ggml-org/llama.cpp/releases/download/b9763/llama-${arch === 'arm64' ? 'arm64' : 'x64'}-apple-darwin.zip`
      whisperUrl = `https://github.com/OpenWhispr/whisper.cpp/releases/download/v1.7.1-bin-3/whisper-server-darwin-${arch === 'arm64' ? 'arm64' : 'x64'}.zip`
    } else {
      // Linux fallback
      llamaUrl = 'https://github.com/ggml-org/llama.cpp/releases/download/b9763/llama-bin-ubuntu-x64.tar.gz'
      whisperUrl = 'https://github.com/OpenWhispr/whisper.cpp/releases/download/v1.7.1-bin-3/whisper-server-linux-x64-cpu.zip'
    }

    const tempZipLlama = path.join(this.installDir, 'llama-temp.zip')
    const tempZipWhisper = path.join(this.installDir, 'whisper-temp.zip')

    try {
      // 1. Download Llama Zip
      this.emitProgress({ type: 'binary', id: 'llama', percent: 0, status: 'downloading', loadedBytes: 0, totalBytes: 0 })
      await this.downloadWithRedirects('llama', llamaUrl, tempZipLlama, (p, loaded, total) => {
        this.emitProgress({ type: 'binary', id: 'llama', percent: p, status: 'downloading', loadedBytes: loaded, totalBytes: total })
      })
      this.emitProgress({ type: 'binary', id: 'llama', percent: 100, status: 'completed' })

      // 2. Download Whisper Zip
      this.emitProgress({ type: 'binary', id: 'whisper', percent: 0, status: 'downloading', loadedBytes: 0, totalBytes: 0 })
      await this.downloadWithRedirects('whisper', whisperUrl, tempZipWhisper, (p, loaded, total) => {
        this.emitProgress({ type: 'binary', id: 'whisper', percent: p, status: 'downloading', loadedBytes: loaded, totalBytes: total })
      })
      this.emitProgress({ type: 'binary', id: 'whisper', percent: 100, status: 'completed' })

      // 3. Extract archives
      const tempExtractLlama = path.join(this.installDir, 'llama_extracted')
      const tempExtractWhisper = path.join(this.installDir, 'whisper_extracted')
      
      fs.mkdirSync(tempExtractLlama, { recursive: true })
      fs.mkdirSync(tempExtractWhisper, { recursive: true })

      await this.extractArchive(tempZipLlama, tempExtractLlama)
      await this.extractArchive(tempZipWhisper, tempExtractWhisper)

      // 4. Locate and position binary targets
      const platformExt = platform === 'win32' ? '.exe' : ''
      const llamaServerTarget = `llama-server${platformExt}`
      const whisperServerTarget = `whisper-server${platformExt}`

      const foundLlama = this.findFileRecursive(tempExtractLlama, llamaServerTarget)
      const foundWhisper = this.findFileRecursive(tempExtractWhisper, whisperServerTarget)

      if (foundLlama) {
        fs.copyFileSync(foundLlama, path.join(this.installDir, llamaServerTarget))
        if (platform !== 'win32') fs.chmodSync(path.join(this.installDir, llamaServerTarget), 0o755)
      } else {
        throw new Error('llama-server binary not found in downloaded archive')
      }

      if (foundWhisper) {
        fs.copyFileSync(foundWhisper, path.join(this.installDir, whisperServerTarget))
        if (platform !== 'win32') fs.chmodSync(path.join(this.installDir, whisperServerTarget), 0o755)
      } else {
        throw new Error('whisper-server binary not found in downloaded archive')
      }

      // Cleanup
      this.cleanupFolder(tempExtractLlama)
      this.cleanupFolder(tempExtractWhisper)
      if (fs.existsSync(tempZipLlama)) fs.unlinkSync(tempZipLlama)
      if (fs.existsSync(tempZipWhisper)) fs.unlinkSync(tempZipWhisper)

    } catch (err) {
      this.emitProgress({ type: 'binary', id: 'llama', percent: 0, status: 'error', error: (err as Error).message })
      this.emitProgress({ type: 'binary', id: 'whisper', percent: 0, status: 'error', error: (err as Error).message })
      throw err;
    }
  }

  // Downloads a GGUF or Speech model file
  async downloadModel(type: 'llama' | 'whisper', hfRepoOrName: string, fileName: string): Promise<string> {
    const destDir = path.join(app.getPath('userData'), 'models', type)
    fs.mkdirSync(destDir, { recursive: true })
    const destPath = path.join(destDir, fileName)
    const tempPath = `${destPath}.tmp`

    if (fs.existsSync(destPath)) {
      try {
        const stats = fs.statSync(destPath)
        if (stats.size > 0) {
          return destPath
        } else {
          fs.unlinkSync(destPath)
        }
      } catch {}
    }

    let downloadUrl = ''
    if (type === 'llama') {
      downloadUrl = `https://huggingface.co/${hfRepoOrName}/resolve/main/${fileName}`
    } else {
      // Whisper models
      downloadUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${fileName}`
    }

    this.emitProgress({ type: 'model', id: fileName, percent: 0, status: 'downloading', loadedBytes: 0, totalBytes: 0 })

    try {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath) } catch {}
      }
      await this.downloadWithRedirects(fileName, downloadUrl, tempPath, (p, loaded, total) => {
        this.emitProgress({ type: 'model', id: fileName, percent: p, status: 'downloading', loadedBytes: loaded, totalBytes: total })
      })
      fs.renameSync(tempPath, destPath)
      this.emitProgress({ type: 'model', id: fileName, percent: 100, status: 'completed' })
      return destPath
    } catch (err) {
      this.emitProgress({ type: 'model', id: fileName, percent: 0, status: 'error', error: (err as Error).message })
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath) } catch {}
      }
      throw err
    }
  }

  private async downloadWithRedirects(id: string, url: string, destPath: string, onProgress: (p: number, loaded: number, total: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(destPath)
      
      let activeReq: http.ClientRequest | null = null
      let activeRes: http.IncomingMessage | null = null
      let isCancelled = false

      const abort = (): void => {
        isCancelled = true
        if (activeRes) {
          try { activeRes.destroy() } catch {}
        }
        if (activeReq) {
          try { activeReq.destroy() } catch {}
        }
        file.destroy()
        
        setTimeout(() => {
          if (fs.existsSync(destPath)) {
            try { fs.unlinkSync(destPath) } catch {}
          }
        }, 100)
        
        reject(new Error('Download cancelled'))
      }

      this.activeRequests.set(id, abort)

      file.on('error', (err) => {
        file.destroy()
        this.activeRequests.delete(id)
        if (!isCancelled) {
          if (fs.existsSync(destPath)) {
            try { fs.unlinkSync(destPath) } catch {}
          }
          reject(err)
        }
      })

      file.on('finish', () => {
        this.activeRequests.delete(id)
        if (!isCancelled) {
          resolve()
        }
      })

      const request = (targetUrl: string): void => {
        if (isCancelled) return

        const client = targetUrl.startsWith('https') ? https : http
        
        const req = client.get(targetUrl, (response) => {
          if (isCancelled) {
            try { response.destroy() } catch {}
            return
          }

          activeRes = response
          
          if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
            const redirectUrl = response.headers.location!
            const resolvedUrl = new URL(redirectUrl, targetUrl).toString()
            request(resolvedUrl)
            return
          }
          
          if (response.statusCode !== 200) {
            file.destroy()
            this.activeRequests.delete(id)
            if (fs.existsSync(destPath)) {
              try { fs.unlinkSync(destPath) } catch {}
            }
            reject(new Error(`Failed to download: Status Code ${response.statusCode}`))
            return
          }

          const totalBytes = parseInt(response.headers['content-length'] || '0', 10)
          let downloadedBytes = 0

          response.on('data', (chunk) => {
            if (isCancelled) return
            downloadedBytes += chunk.length
            file.write(chunk)
            if (totalBytes > 0) {
              const percent = Math.round((downloadedBytes / totalBytes) * 100)
              onProgress(percent, downloadedBytes, totalBytes)
            } else {
              onProgress(0, downloadedBytes, 0)
            }
          })

          response.on('end', () => {
            if (!isCancelled) {
              file.end()
            }
          })
        })

        req.on('error', (err) => {
          if (!isCancelled) {
            file.destroy()
            this.activeRequests.delete(id)
            if (fs.existsSync(destPath)) {
              try { fs.unlinkSync(destPath) } catch {}
            }
            reject(err)
          }
        })

        activeReq = req
      }

      request(url)
    })
  }

  private async extractArchive(archivePath: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let cmd = ''
      if (process.platform === 'win32') {
        cmd = `powershell.exe -NoProfile -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`
      } else {
        cmd = `unzip -o "${archivePath}" -d "${destDir}"`
      }

      exec(cmd, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  private findFileRecursive(dir: string, targetName: string): string | null {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const found = this.findFileRecursive(fullPath, targetName)
        if (found) return found
      } else if (entry.name.toLowerCase() === targetName.toLowerCase()) {
        return fullPath
      }
    }
    return null
  }

  private cleanupFolder(dir: string): void {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    } catch {
      // ignore
    }
  }

  async cancelDownload(id: string): Promise<boolean> {
    const abort = this.activeRequests.get(id)
    if (abort) {
      abort()
      this.activeRequests.delete(id)
      return true
    }
    return false
  }

  async deleteModel(type: 'llama' | 'whisper', fileName: string): Promise<boolean> {
    const destDir = path.join(app.getPath('userData'), 'models', type)
    const filePath = path.join(destDir, fileName)
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
        return true
      } catch (e) {
        console.error(`Failed to delete model ${fileName}:`, e)
        return false
      }
    }
    return false
  }
}
