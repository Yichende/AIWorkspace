import { Text } from '@tarojs/components';

export default function TextBlock({
  block,
}: any) {
  return (
    <Text className='text-block'>
      {block.content}
    </Text>
  );
}