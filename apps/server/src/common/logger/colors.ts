/**
 * ANSI 终端颜色常量
 * 用于格式化终端日志输出
 */
export const Colors = {
  Reset: '\x1b[0m',
  Bright: '\x1b[1m',
  Dim: '\x1b[2m',

  // 前景色
  Green: '\x1b[32m',
  Yellow: '\x1b[33m',
  Red: '\x1b[31m',
  Cyan: '\x1b[36m',
  White: '\x1b[37m',
  Gray: '\x1b[90m',

  // 背景色（半透明效果）
  BgRed: '\x1b[41m',
  BgGreen: '\x1b[42m',
  BgYellow: '\x1b[43m',
} as const;

/**
 * 预设样式组合
 */
export const Styles = {
  /** 成功 - 绿色 */
  success: (text: string) =>
    `${Colors.Green}${Colors.Bright}${text}${Colors.Reset}`,
  /** 警告 - 黄色 */
  warn: (text: string) =>
    `${Colors.Yellow}${Colors.Bright}${text}${Colors.Reset}`,
  /** 错误 - 红色 */
  error: (text: string) =>
    `${Colors.Red}${Colors.Bright}${text}${Colors.Reset}`,
  /** 路径/方法 - 青色 */
  method: (text: string) => `${Colors.Cyan}${text}${Colors.Reset}`,
  /** 弱化文字 - 灰色 */
  dim: (text: string) => `${Colors.Gray}${text}${Colors.Reset}`,
  /** 高亮 */
  bright: (text: string) => `${Colors.Bright}${text}${Colors.Reset}`,
  /** 标签（如 [HTTP]） */
  tag: (text: string) => `${Colors.Gray}[${text}]${Colors.Reset}`,
} as const;
