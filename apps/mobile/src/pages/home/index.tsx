import { View } from "@tarojs/components";
import { useAuth } from "@/hooks/useAuth";

export default function HomePage() {
  // 鉴权
  useAuth();
  
  return (
    <View>
      AI 数据分析工作台首页
    </View>
  );
}