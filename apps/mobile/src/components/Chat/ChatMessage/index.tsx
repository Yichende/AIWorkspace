import { View } from '@tarojs/components';

import { ChatMessage as Message } from '@/types/chat';

import TextBlock from '../Blocks/TextBlock';
import CodeBlock from '../Blocks/CodeBlock';
import TableBlock from '../Blocks/TableBlock';
import ChartBlock from '../Blocks/ChartBlock';

import './index.scss';

interface Props {
  message: Message;
}

export default function ChatMessage({
  message,
}: Props) {
  const isUser =
    message.role === 'user';

  return (
    <View
      className={`message ${
        isUser ? 'user' : 'assistant'
      }`}
    >
      {!isUser && (
        <View className='avatar'>
          叶
        </View>
      )}

      <View className='bubble'>

        {message.blocks.map(
          (block, index) => {
            switch (block.type) {
              case 'text':
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

      </View>
    </View>
  );
}