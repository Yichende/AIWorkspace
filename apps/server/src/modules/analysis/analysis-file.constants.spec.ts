import {
  ALLOWED_ANALYSIS_EXTS,
  detectAnalysisContent,
  isExtensionConsistentWithContent,
} from './analysis-file.constants';

const ZIP_HEAD = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.alloc(60, 0x11),
]);

const OLE2_HEAD = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.alloc(60, 0x22),
]);

describe('detectAnalysisContent', () => {
  it('识别 zip 容器（.xlsx 的本质）', () => {
    expect(detectAnalysisContent(ZIP_HEAD)).toBe('zip');
  });

  it('识别 OLE2 复合文档（老式 .xls）', () => {
    expect(detectAnalysisContent(OLE2_HEAD)).toBe('ole2');
  });

  it('识别 UTF-8 文本 CSV', () => {
    const csv = Buffer.from('姓名,年龄\n张三,20\n李四,30\n', 'utf-8');
    expect(detectAnalysisContent(csv)).toBe('text');
  });

  it('识别 GBK 文本 CSV（回归：不能按 UTF-8 严格解码）', () => {
    // 中文 Excel「另存为 CSV」默认就是 GBK。按 UTF-8 严格解码会把
    // 这份最正常的输入判成非法 —— 那才是真正的回归。
    // 0xD6D0 0xCEC4 = GBK 的「中文」
    const gbk = Buffer.concat([
      Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x2c, 0x31, 0x32, 0x0a]),
      Buffer.from([0xd5, 0xc5, 0xc8, 0xfd, 0x2c, 0x32, 0x30, 0x0a]),
    ]);
    expect(detectAnalysisContent(gbk)).toBe('text');
  });

  it('识别带 UTF-16 BOM 的文本', () => {
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('a,b\n1,2\n', 'utf16le'),
    ]);
    expect(detectAnalysisContent(utf16)).toBe('text');
  });

  it('大文件的头部截断仍能判定（只读前 4KB 就够）', () => {
    // 真实 xlsx 动辄几 MB，门禁只拿到前 4096 字节
    const head = ZIP_HEAD.subarray(0, 64);
    expect(detectAnalysisContent(head)).toBe('zip');
  });

  it.each([
    ['PDF', Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(20)])],
    [
      'PNG',
      Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(20)]),
    ],
    [
      'JPEG',
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]),
    ],
    ['GIF', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)])],
    [
      'ELF',
      Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(20)]),
    ],
    ['PE(MZ)', Buffer.concat([Buffer.from('MZ\x90\x00'), Buffer.alloc(20)])],
    [
      'gzip',
      Buffer.concat([Buffer.from([0x1f, 0x8b, 0x08]), Buffer.alloc(20)]),
    ],
    ['HTML', Buffer.from('<!DOCTYPE html><html><body>hi</body></html>')],
  ])('拒绝明显不是表格的内容：%s', (_label, buf) => {
    expect(detectAnalysisContent(buf)).toBeNull();
  });

  it('拒绝含 NUL 的二进制（文本判定的兜底）', () => {
    const binary = Buffer.concat([
      Buffer.from('some header'),
      Buffer.from([0x00, 0x01, 0x02]),
      Buffer.alloc(20, 0x41),
    ]);
    expect(detectAnalysisContent(binary)).toBeNull();
  });

  it('拒绝空文件', () => {
    expect(detectAnalysisContent(Buffer.alloc(0))).toBeNull();
  });
});

describe('isExtensionConsistentWithContent', () => {
  it('.xlsx 必须是 zip 容器', () => {
    // 这是唯一「后缀与容器形态有确定对应关系」的组合
    expect(isExtensionConsistentWithContent('.xlsx', 'zip')).toBe(true);
    expect(isExtensionConsistentWithContent('.xlsx', 'text')).toBe(false);
    expect(isExtensionConsistentWithContent('.xlsx', 'ole2')).toBe(false);
  });

  it('其余扩展名不做严格配对（Excel 在野外会产出各种合法组合）', () => {
    // `.xls` 名字装 tab 文本、`.csv` 名字装 OLE2 —— SheetJS 今天都能解析，
    // 严格配对会把合法内容挡在门外，比漏放更糟
    expect(isExtensionConsistentWithContent('.xls', 'text')).toBe(true);
    expect(isExtensionConsistentWithContent('.xls', 'zip')).toBe(true);
    expect(isExtensionConsistentWithContent('.xls', 'ole2')).toBe(true);
    expect(isExtensionConsistentWithContent('.csv', 'text')).toBe(true);
    expect(isExtensionConsistentWithContent('.csv', 'ole2')).toBe(true);
  });
});

describe('ALLOWED_ANALYSIS_EXTS', () => {
  it('与 multer 的文件名白名单同源，且都是小写带点形式', () => {
    for (const ext of ALLOWED_ANALYSIS_EXTS) {
      expect(ext).toMatch(/^\.[a-z0-9]+$/);
    }
  });
});
