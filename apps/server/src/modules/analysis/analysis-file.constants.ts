/**
 * 分析文件的上传面常量与内容门禁。
 *
 * 为什么需要内容门禁：扩展名是**客户端给的**，而 `XLSX.read` 会按**内容**
 * 自动识别格式 —— 一个 exe / pdf / 图片换个 `.xlsx` 后缀就能进解析器。
 * 扩展名白名单只挡得住手滑，挡不住有意为之。
 *
 * 定位：这是扩展名白名单**之外追加**的一层粗筛，不是完备的格式校验。
 * 刻意做得宽松，因为 Excel 在野外会产出各种奇怪但合法的组合
 * （`.xls` 名字装 tab 文本、`.xls` 名字装 OOXML），SheetJS 今天都能解析，
 * 严格配对会把合法内容挡在门外 —— 那是比漏放更糟的失败。
 */

/** 允许落盘的扩展名（改这里要同步改 multer 的文件名白名单） */
export const ALLOWED_ANALYSIS_EXTS = ['.xlsx', '.xls', '.csv'] as const;

/** 分析文件体积上限。multer 与 controller 共用同一个常量，避免两处漂移。 */
export const MAX_ANALYSIS_FILE_BYTES = 10 * 1024 * 1024;

/** 内容门禁只读文件头部这么多字节 */
export const CONTENT_SNIFF_BYTES = 4096;

export type AnalysisContentKind = 'zip' | 'ole2' | 'text';

const ZIP_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04
const OLE2_SIG = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); // 老式 .xls 的复合文档头

/** UTF-16 BOM：Excel「另存为 CSV」在部分语言下会产出 UTF-16 文本 */
const UTF16_BOMS = [Buffer.from([0xff, 0xfe]), Buffer.from([0xfe, 0xff])];

/**
 * 明确「绝不可能是表格」的头部魔数，命中即拒。
 *
 * 这是一个**黑名单式**的补充筛查（白名单是扩展名）：目的是把可执行文件、
 * PDF、图片这些送进 SheetJS 只会有风险、不可能有收益的输入挡在解析之前。
 */
const NON_SPREADSHEET_MAGICS: Buffer[] = [
  Buffer.from('%PDF'), // PDF
  Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG
  Buffer.from([0xff, 0xd8, 0xff]), // JPEG
  Buffer.from('GIF8'), // GIF
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]), // ELF
  Buffer.from('MZ'), // Windows PE
  Buffer.from('RIFF'), // WebP / WAV / AVI
  Buffer.from([0x1f, 0x8b]), // gzip
  Buffer.from('<!DOC'), // 明显是 HTML
  Buffer.from('<html'),
];

function startsWith(buf: Buffer, sig: Buffer): boolean {
  return buf.length >= sig.length && buf.subarray(0, sig.length).equals(sig);
}

/**
 * 按内容判定类别；返回 `null` 表示拒绝。
 *
 * 文本的判定不看编码，只看「前 4KB 里有没有 NUL 字节」—— UTF-8 与 GBK 的中文
 * CSV 都能过，而二进制文件在 4KB 内几乎必然出现 NUL。刻意不用 UTF-8 严格解码：
 * 中文 Excel 导出的 CSV 通常是 GBK，那样会把最正常的输入判成非法。
 */
export function detectAnalysisContent(buf: Buffer): AnalysisContentKind | null {
  if (buf.length === 0) return null;

  if (startsWith(buf, ZIP_SIG)) return 'zip'; // .xlsx（本质是 zip）
  if (startsWith(buf, OLE2_SIG)) return 'ole2'; // 老式 .xls

  // 黑名单在白名单判定之前：gzip 等格式的头部是任意字节，
  // 先排除掉才轮到宽松的文本判定
  if (NON_SPREADSHEET_MAGICS.some((magic) => startsWith(buf, magic))) {
    return null;
  }

  if (UTF16_BOMS.some((bom) => startsWith(buf, bom))) return 'text';

  return buf.includes(0x00) ? null : 'text';
}

/**
 * 扩展名与内容类别是否自洽。
 *
 * 只强制 `.xlsx ⇒ zip` 这一条 —— 它是唯一「后缀与容器形态有确定对应关系」
 * 的组合。其余不做严格配对，理由见文件头。
 */
export function isExtensionConsistentWithContent(
  ext: string,
  kind: AnalysisContentKind,
): boolean {
  if (ext === '.xlsx') return kind === 'zip';
  return true;
}
