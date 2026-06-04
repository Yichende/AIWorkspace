import { View } from '@tarojs/components';
import Towxml from 'towxml';

interface Props {
  content: string;
}

export default function MarkdownBlock({
  content,
}: Props) {
  const nodes = Towxml(content, 'markdown');

  return (
    <View>
      <mp-html content={nodes} />
    </View>
  );
}