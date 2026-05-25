export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AIChart {
  type: string
  option: Record<string, any>
}