import { View } from '@tarojs/components';

export default function CodeBlock({
  block,
}: any) {
  return (
    <View className='code-block'>
      {block.content}
    </View>
  );
}