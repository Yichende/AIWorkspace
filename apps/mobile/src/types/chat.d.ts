export type BlockType =
  | 'markdown'
  | 'chart'
  | 'table'
  | 'custom';

export interface TextBlock {
  type: 'text';
  content: string;
}

export interface CodeBlock {
  type: 'code';
  language: string;
  content: string;
}

export interface TableBlock {
  type: 'table';
  columns: string[];
  data: Record<string, any>[];
}

export interface ChartBlock {
  type: 'chart';
  option: any;
}

export interface CustomBlock {
  type: 'custom';
  payload: any;
}

export type MessageBlock =
  | TextBlock
  | CodeBlock
  | TableBlock
  | ChartBlock
  | CustomBlock;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  blocks: MessageBlock[];
  createdAt: number;
}