import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Op } from 'sequelize';
import { AnalysisService } from './analysis.service';

/**
 * P0-5：cleanupExpiredFiles 必须真正删掉磁盘文件，且不能误删
 * 仍在 PENDING/ANALYZING 的会话所依赖的文件。
 */
describe('AnalysisService 过期文件清理', () => {
  let tmpDir: string;
  let sessionModel: any;
  let fileModel: any;
  let chartModel: any;
  let resultModel: any;
  let service: AnalysisService;

  /** 造一个已落盘的「上传文件」，返回相对 cwd 的路径（与 DB 存法一致） */
  const makeDiskFile = (name: string): string => {
    const abs = path.join(tmpDir, name);
    fs.writeFileSync(abs, 'x');
    return abs;
  };

  const cwdSpy = () => jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-cleanup-'));
    sessionModel = {
      findAll: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue([0]),
    };
    fileModel = {
      findAll: jest.fn().mockResolvedValue([]),
      destroy: jest.fn().mockResolvedValue(undefined),
    };
    chartModel = { destroy: jest.fn().mockResolvedValue(undefined) };
    resultModel = { destroy: jest.fn().mockResolvedValue(undefined) };
    // 本 spec 只覆盖文件清理；阶段二新增的两个 model 补占位即可
    const tableModel: any = { destroy: jest.fn().mockResolvedValue(undefined) };
    const taskModel: any = { findOne: jest.fn().mockResolvedValue(null) };
    service = new AnalysisService(
      sessionModel,
      fileModel,
      chartModel,
      resultModel,
      tableModel,
      taskModel,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('删除过期文件的磁盘文件与 DB 记录', async () => {
    const spy = cwdSpy();
    const rel = '1786347962187-71322328.xlsx';
    const abs = makeDiskFile(rel);
    const destroy = jest.fn().mockResolvedValue(undefined);
    fileModel.findAll.mockResolvedValue([
      { id: 1, analysisId: null, fileUrl: rel, destroy },
    ]);

    const removed = await service.cleanupExpiredFiles();

    expect(removed).toBe(1);
    expect(fs.existsSync(abs)).toBe(false);
    expect(destroy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('跳过仍在 PENDING/ANALYZING 会话下的过期文件', async () => {
    const spy = cwdSpy();
    const active = 'active.xlsx';
    const orphan = 'orphan.xlsx';
    const activeAbs = makeDiskFile(active);
    const orphanAbs = makeDiskFile(orphan);
    const activeDestroy = jest.fn().mockResolvedValue(undefined);
    const orphanDestroy = jest.fn().mockResolvedValue(undefined);
    fileModel.findAll.mockResolvedValue([
      {
        id: 1,
        analysisId: 'sess-active',
        fileUrl: active,
        destroy: activeDestroy,
      },
      { id: 2, analysisId: null, fileUrl: orphan, destroy: orphanDestroy },
    ]);
    // 只有 sess-active 是活跃会话
    sessionModel.findAll.mockResolvedValue([{ id: 'sess-active' }]);

    const removed = await service.cleanupExpiredFiles();

    expect(removed).toBe(1);
    expect(fs.existsSync(activeAbs)).toBe(true);
    expect(activeDestroy).not.toHaveBeenCalled();
    expect(fs.existsSync(orphanAbs)).toBe(false);
    expect(orphanDestroy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('磁盘文件已不存在（ENOENT）时不抛，仍删除记录并计入', async () => {
    const spy = cwdSpy();
    const destroy = jest.fn().mockResolvedValue(undefined);
    fileModel.findAll.mockResolvedValue([
      { id: 1, analysisId: null, fileUrl: 'never-existed.xlsx', destroy },
    ]);

    await expect(service.cleanupExpiredFiles()).resolves.toBe(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('单条记录删除失败不阻断整批', async () => {
    const spy = cwdSpy();
    const okDestroy = jest.fn().mockResolvedValue(undefined);
    const badDestroy = jest.fn().mockRejectedValue(new Error('db down'));
    fileModel.findAll.mockResolvedValue([
      { id: 1, analysisId: null, fileUrl: 'a.xlsx', destroy: badDestroy },
      { id: 2, analysisId: null, fileUrl: 'b.xlsx', destroy: okDestroy },
    ]);

    const removed = await service.cleanupExpiredFiles();

    expect(removed).toBe(1);
    expect(okDestroy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('无过期文件时不查会话表', async () => {
    fileModel.findAll.mockResolvedValue([]);
    await expect(service.cleanupExpiredFiles()).resolves.toBe(0);
    expect(sessionModel.findAll).not.toHaveBeenCalled();
  });

  it('deleteSession 一并删除磁盘文件', async () => {
    const spy = cwdSpy();
    const rel = 'to-delete.xlsx';
    const abs = makeDiskFile(rel);
    const destroyFile = jest.fn().mockResolvedValue(undefined);
    const session = { destroy: jest.fn().mockResolvedValue(undefined) };
    sessionModel.findByPk = jest
      .fn()
      .mockResolvedValue({ id: 's1', userId: 7 });
    fileModel.findAll.mockResolvedValue([
      { id: 1, fileUrl: rel, destroy: destroyFile },
    ]);

    // getSession 走 findById 校验归属，这里直接注入最小可用的 session
    jest.spyOn(service, 'getSession').mockResolvedValue(session as any);

    await service.deleteSession(7, 's1');

    expect(fs.existsSync(abs)).toBe(false);
    expect(session.destroy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  describe('failStaleAnalyzingSessions', () => {
    it('只把「ANALYZING 且 updated_at 早于阈值」的会话置为 FAILED', async () => {
      const now = 1_700_000_000_000;
      jest.spyOn(Date, 'now').mockReturnValue(now);
      sessionModel.update.mockResolvedValue([3]);
      const maxAgeMs = 60 * 60 * 1000;

      const affected = await service.failStaleAnalyzingSessions(maxAgeMs);

      expect(affected).toBe(3);
      const [values, options] = sessionModel.update.mock.calls[0];
      expect(values).toEqual({ status: 'FAILED' });
      expect(options.where.status).toBe('ANALYZING');
      // 截止时刻 = 现在 - 阈值
      expect(options.where.updated_at[Op.lt].getTime()).toBe(now - maxAgeMs);
    });

    it('没有僵死会话时返回 0', async () => {
      sessionModel.update.mockResolvedValue([0]);
      await expect(
        service.failStaleAnalyzingSessions(60 * 60 * 1000),
      ).resolves.toBe(0);
    });
  });
});

/**
 * P2-5：analysis_files 的归属校验。
 *
 * fileId 是客户端自报的自增整数，此前 createSession 直接 findByPk 就挂上去，
 * 不校验归属 —— 任何登录用户都能拿别人的 fileId 建会话读别人的数据。
 */
describe('AnalysisService 文件归属（越权修复）', () => {
  let sessionModel: any;
  let fileModel: any;
  let service: AnalysisService;

  const dto = { fileId: '7', prompt: 'p', model: 'm', title: 't' };
  const future = () => new Date(Date.now() + 60 * 60 * 1000);

  beforeEach(() => {
    sessionModel = {
      create: jest.fn().mockResolvedValue({ id: 'session-1' }),
    };
    fileModel = {
      findByPk: jest.fn(),
      create: jest.fn(),
    };
    service = new AnalysisService(
      sessionModel,
      fileModel,
      { destroy: jest.fn() } as any,
      { destroy: jest.fn() } as any,
      { destroy: jest.fn() } as any,
      { findOne: jest.fn() } as any,
    );
  });

  it('他人的文件被拒绝，且不建会话、不挂关联', async () => {
    fileModel.findByPk.mockResolvedValue({
      userId: 2,
      expireAt: future(),
      update: jest.fn(),
    });

    await expect(service.createSession(1, dto)).rejects.toThrow(
      /无权使用该文件/,
    );
    // 校验失败必须是「零副作用」的：不能留下孤儿会话，也不能改动别人的文件
    expect(sessionModel.create).not.toHaveBeenCalled();
    expect(fileModel.findByPk).toHaveBeenCalledTimes(1);
    expect(fileModel.findByPk.mock.results[0].value).toBeTruthy();
  });

  it('归属为 null 的存量行同样被拒（迁移刻意选择的 fail-closed）', async () => {
    fileModel.findByPk.mockResolvedValue({
      userId: null,
      expireAt: future(),
      update: jest.fn(),
    });

    await expect(service.createSession(1, dto)).rejects.toThrow(
      /无权使用该文件/,
    );
    expect(sessionModel.create).not.toHaveBeenCalled();
  });

  it('归属判断先于过期判断（不把别人文件的过期时间泄露出去）', async () => {
    // 别人的 + 已过期：应当报「无权使用」而不是「已过期」——
    // 后者会泄露「这个 fileId 确实存在且曾经有效」
    fileModel.findByPk.mockResolvedValue({
      userId: 2,
      expireAt: new Date(Date.now() - 1000),
      update: jest.fn(),
    });

    await expect(service.createSession(1, dto)).rejects.toThrow(/无权使用/);
  });

  it('本人的文件正常创建会话并挂上关联', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    fileModel.findByPk.mockResolvedValue({
      userId: 1,
      expireAt: future(),
      update,
    });

    const session = await service.createSession(1, dto);

    expect(session).toEqual({ id: 'session-1' });
    expect(update).toHaveBeenCalledWith({ analysisId: 'session-1' });
  });

  it('本人但已过期的文件仍报「已过期」', async () => {
    fileModel.findByPk.mockResolvedValue({
      userId: 1,
      expireAt: new Date(Date.now() - 1000),
      update: jest.fn(),
    });

    await expect(service.createSession(1, dto)).rejects.toThrow(/已过期/);
    expect(sessionModel.create).not.toHaveBeenCalled();
  });

  it('fileId 查不到时仍建会话（既有语义不在此收紧）', async () => {
    fileModel.findByPk.mockResolvedValue(null);

    await expect(service.createSession(1, dto)).resolves.toEqual({
      id: 'session-1',
    });
    expect(sessionModel.create).toHaveBeenCalledTimes(1);
  });

  it('saveFileRecord 落归属并保留 24h 过期', async () => {
    fileModel.create.mockImplementation((values: any) =>
      Promise.resolve(values),
    );

    const before = Date.now();
    await service.saveFileRecord(7, null, 'n.xlsx', 'uploads/a.xlsx', 12);
    const values = fileModel.create.mock.calls[0][0];

    // userId 是归属的唯一写入点，漏了它越权校验就形同虚设
    expect(values.userId).toBe(7);
    expect(values.analysisId).toBeNull();
    expect(values.size).toBe(12);
    const ttl = values.expireAt.getTime() - before;
    expect(ttl).toBeGreaterThan(24 * 3600 * 1000 - 5000);
    expect(ttl).toBeLessThan(24 * 3600 * 1000 + 5000);
  });
});
