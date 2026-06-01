import { View, Image } from "@tarojs/components";

import "./index.scss";

export default function AnimatedLogo() {
  return (
    <View className='animated-logo'>
      <Image
        className='logo-image'
        src='/images/aiworkspace-logo.webp'
        mode='aspectFit'
      />
    </View>
  );
}