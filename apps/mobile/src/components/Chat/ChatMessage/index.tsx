import { View } from '@tarojs/components';
import { Icon } from '@my/ui';

import { ChatMessage as Message } from '@/types/chat';
import { useSettingsStore } from '@/stores/settings.store';

import TextBlock from '../Blocks/TextBlock';
import MarkdownBlock from '../Blocks/MarkdownBlock';
import CodeBlock from '../Blocks/CodeBlock';
import TableBlock from '../Blocks/TableBlock';
import ChartBlock from '../Blocks/ChartBlock';
import ThinkingBlock from '../Blocks/ThinkingBlock';

import './index.scss';

interface Props {
  message: Message;
  onRetry?: (messageId: string) => void;
}

export default function ChatMessage({
  message,
  onRetry,
}: Props) {
  const isUser = message.role === 'user';
  const isAssistant = !isUser;
  const showStatus =
    isAssistant &&
    (message.status === 'sending' || message.status === 'streaming' || message.status === 'error');

  // 关闭"显示思考过程"时过滤 thinking 块（store 数据不变，仅渲染层过滤），
  // hasContent 同样基于过滤后内容计算，保证光标/typing/中断重试判定一致
  const showThinking = useSettingsStore(s => s.showThinking);
  const visibleBlocks = showThinking
    ? message.blocks
    : message.blocks.filter(
        b => !(b.type === 'text' && (b as any).thinking),
      );

  const hasContent = visibleBlocks.some(
    b => b.type === 'text' && (b as any).content?.length > 0
  );

  return (
    <View
      className={`message ${
        isUser ? 'user' : 'assistant'
      }`}
    >
      <View
        className={`bubble ${
          message.status === 'error' ? 'bubble-error' : ''
        }`}
      >
        {/* --- Blocks --- */}
        {visibleBlocks.map(
          (block, index) => {
            switch (block.type) {
              case 'text':
                // Route thinking blocks to ThinkingBlock component
                if ((block as any).thinking) {
                  return (
                    <ThinkingBlock
                      key={index}
                      content={block.content}
                      isStreaming={message.status === 'streaming'}
                    />
                  );
                }
                // Assistant messages use MarkdownBlock for formatted rendering
                if (isAssistant) {
                  return (
                    <MarkdownBlock
                      key={index}
                      content={block.content}
                    />
                  );
                }
                // User messages stay as plain text
                return (
                  <TextBlock
                    key={index}
                    block={block}
                  />
                );

              case 'code':
                return (
                  <CodeBlock
                    key={index}
                    block={block}
                  />
                );

              case 'table':
                return (
                  <TableBlock
                    key={index}
                    block={block}
                  />
                );

              case 'chart':
                return (
                  <ChartBlock
                    key={index}
                    block={block}
                  />
                );

              default:
                return null;
            }
          }
        )}

        {/* --- Streaming cursor --- */}
        {message.status === 'streaming' && hasContent && (
          <View className='streaming-cursor'>▌</View>
        )}

        {/* --- Status indicator --- */}
        {showStatus && (
          <View className='status-bar'>
            {/* Thinking indicator: breathing icon when waiting for first content */}
            {message.status === 'sending' && !hasContent && (
              <View className='thinking-indicator'>
                <Icon name='zhinengfenxi' size={48} color='#117C0D' />
              </View>
            )}

            {/* Typing dots: when sending but already has some content */}
            {message.status === 'sending' && hasContent && (
              <View className='typing-dots'>
                <View className='dot' />
                <View className='dot' />
                <View className='dot' />
              </View>
            )}

            {message.status === 'error' && (
              <View className='error-info'>
                <View className='error-text'>
                  响应失败
                </View>
                {onRetry && (
                  <View
                    className='retry-btn'
                    onClick={() =>
                      onRetry(message.id)
                    }
                  >
                    重试
                  </View>
                )}
              </View>
            )}

            {/* Interrupted (sending/streaming on reload) — show retry */}
            {message.status === 'sending' && onRetry && hasContent && (
              <View className='error-info interrupted'>
                <View className='error-text'>
                  响应中断
                </View>
                <View
                  className='retry-btn'
                  onClick={() =>
                    onRetry(message.id)
                  }
                >
                  重试
                </View>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}
