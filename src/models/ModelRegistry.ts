import modelDataRaw from './modelRegistryData.json'

export interface TranscriptionModelDefinition {
  id: string
  name: string
  description: string
  descriptionKey?: string
  streaming?: boolean
  supportsThinking?: boolean
}

export interface CloudProviderData {
  id: string
  name: string
  models: TranscriptionModelDefinition[]
}

export interface LocalProviderData {
  id: string
  name: string
  models: Array<{
    id: string
    name: string
    description: string
    descriptionKey?: string
    size: string
    fileName: string
    hfRepo: string
    recommended?: boolean
  }>
}

export interface TranscriptionProviderData {
  id: string
  name: string
  models: TranscriptionModelDefinition[]
}

export interface WhisperModelDefinition {
  name: string
  description: string
  size: string
  sizeMb: number
  fileName: string
  downloadUrl: string
  recommended?: boolean
}

export interface ParakeetModelDefinition {
  name: string
  description: string
  size: string
  sizeMb: number
  downloadUrl: string
  extractDir: string
}

export class ModelRegistry {
  private static instance: ModelRegistry

  private constructor() {}

  static getInstance(): ModelRegistry {
    if (!ModelRegistry.instance) {
      ModelRegistry.instance = new ModelRegistry()
    }
    return ModelRegistry.instance
  }

  getCloudProviders(): CloudProviderData[] {
    return modelDataRaw.cloudProviders as CloudProviderData[]
  }

  getLocalProviders(): LocalProviderData[] {
    return modelDataRaw.localProviders as unknown as LocalProviderData[]
  }

  getTranscriptionProviders(): TranscriptionProviderData[] {
    return modelDataRaw.transcriptionProviders as unknown as TranscriptionProviderData[]
  }

  getWhisperModels(): Record<string, WhisperModelDefinition> {
    return modelDataRaw.whisperModels as unknown as Record<string, WhisperModelDefinition>
  }

  getParakeetModels(): Record<string, ParakeetModelDefinition> {
    return modelDataRaw.parakeetModels as unknown as Record<string, ParakeetModelDefinition>
  }
}
