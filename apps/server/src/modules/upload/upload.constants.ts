/**
 * 头像格式白名单（不含 gif），以 magic bytes 判定为准，
 * 不信任声明 MIME（微信等客户端可能发送 application/octet-stream 或与实际不符）。
 */
export const AVATAR_FORMATS: Array<{
  mime: string;
  ext: string;
  matches: (buf: Buffer) => boolean;
}> = [
  {
    mime: 'image/png',
    ext: 'png',
    matches: (buf) => {
      const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      return buf.length >= 8 && sig.every((byte, i) => buf[i] === byte);
    },
  },
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    matches: (buf) =>
      buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff,
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    matches: (buf) =>
      // RIFF .... WEBP
      buf.length >= 12 &&
      buf.toString('ascii', 0, 4) === 'RIFF' &&
      buf.toString('ascii', 8, 12) === 'WEBP',
  },
];

/** 按 magic bytes 检测实际图片格式，返回 mime；非白名单图片返回 null */
export function detectImageFormat(buf: Buffer): string | null {
  const hit = AVATAR_FORMATS.find((f) => f.matches(buf));
  return hit ? hit.mime : null;
}
