#!/usr/bin/env node
/**
 * ci:check —— 提交前在本地复现 CI 的检查。
 *
 * 为什么不直接用 `a && b && c`：CI 用 `--continue` 让所有包都报错，而不是第一个就中断。
 * 本地也应当一次跑完拿到全部问题，而不是修一个再跑一次。
 *
 * 除了照抄 CI 的五个步骤，这里还多了一道「追踪守卫」——见 guard() 的注释，
 * 它拦的是 CI 五步在本地**永远发现不了**的一类故障。
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ARGV = process.argv.slice(2)
const FULL = ARGV.includes('--full')
const FORCE = ARGV.includes('--force')
const ALLOW_UNTRACKED = process.env.CI_CHECK_ALLOW_UNTRACKED === '1'

// 直接调 turbo 的入口，而不是 spawn('pnpm', ...)：
//  1. Windows 上 Node 20 不允许无 shell 执行 pnpm.cmd，会 ENOENT
//  2. `pnpm run` 会吃掉 --force 这类标志（pnpm 自己也有 --force）
const TURBO_BIN = path.join(ROOT, 'node_modules', 'turbo', 'bin', 'turbo')

const MAX_BUFFER = 64 * 1024 * 1024
const TAIL_LINES = 40
const WALK_LIMIT = 50000
// 只在真正的终端里上色：管道（pnpm ci:check | tail）或 NO_COLOR 下输出纯文本，
// 否则转义序列会混进日志和 CI 归档里。
const COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
const wrap = (code) => (s) => (COLOR ? `\x1b[${code}m${String(s)}\x1b[0m` : String(s))
const C = { dim: wrap(2), red: wrap(31), green: wrap(32), yellow: wrap(33), bold: wrap(1) }

const toPosix = (p) => p.split(/[\\/]/).join('/')
const relFromRoot = (abs) => toPosix(path.relative(ROOT, abs))

/** 统一的 git 调用。quotepath=false 关掉 CJK 路径的八进制转义，否则报错信息不可读。 */
function git(args, { input } = {}) {
  return spawnSync('git', ['-C', ROOT, '-c', 'core.quotepath=false', ...args], {
    input,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  })
}

// ── 追踪守卫 ────────────────────────────────────────────────────────────────
//
// 拦的是「工作区里有、仓库里没有」的源码文件。
//
// 为什么 CI 五步在本地发现不了：本地跑的是工作区。文件明明在磁盘上，
// type-check 能解析到它，lint 能读到它，测试也照样过——直到推进 GitHub，
// 那边只看得到仓库里的内容，于是 `Cannot find module` 加一串级联报错。
// 靠的是 git 的视角，不是编译器的视角。

const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'])

// 不笼统匹配 .json：.gitignore 明确忽略了 /apps/mobile/project.private.config.json，
// 微信开发者工具一打开就会重新生成它，用扩展名匹配必然误报。
const JSON_BASENAMES = [
  /^package\.json$/,
  /^tsconfig(\.[\w.-]+)?\.json$/,
  /^vitest\.config\.[\w.-]+$/,
  /^\.eslintrc\.json$/,
]

// 按目录名剪枝。node_modules 单独一个就 15 万条，不可能遍历。
// 实测这些名字在 apps/、packages/ 下除真实构建产物外零命中。
const PRUNE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'temp', 'tmp', '.cache', '.turbo', '.taro',
  '.temp', 'coverage', '.nyc_output', 'logs', 'uploads',
  '.wechat-web-devtools', 'models', 'ollama-models', 'docker-data',
  '.pnpm-store', '.vscode', '.idea', '.claude', '.git',
])

function isSourceFile(relPath) {
  const base = path.posix.basename(relPath)
  if (JSON_BASENAMES.some((re) => re.test(base))) return true
  return SOURCE_EXTS.has(path.posix.extname(base).toLowerCase())
}

/** 从 apps/ 和 packages/ 遍历源码文件，按目录名剪枝。 */
function walkSourceFiles() {
  const files = []
  const stack = ['apps', 'packages']
    .map((d) => path.join(ROOT, d))
    .filter((d) => fs.existsSync(d))

  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!PRUNE_DIRS.has(entry.name)) stack.push(full)
      } else if (entry.isFile() && isSourceFile(relFromRoot(full))) {
        files.push(relFromRoot(full))
        if (files.length >= WALK_LIMIT) return { files, capped: true }
      }
    }
  }
  return { files, capped: false }
}

/** CI 关键文件：不在仓库里 CI 就跑不起来，且它们都不是「源码扩展名」，靠扩展名匹配兜不住。 */
const CRITICAL_FILES = [
  '.npmrc',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'tsconfig.base.json',
  'package.json',
  'apps/server/package.json',
  'apps/mobile/package.json',
  'packages/analysis-parser/package.json',
  'packages/constants/package.json',
  'packages/types/package.json',
  'packages/ui/package.json',
  'packages/utils/package.json',
  'apps/mobile/.env.development',
  'apps/mobile/.env.production',
  'apps/mobile/.env.test',
]

function guard() {
  const { files, capped } = walkSourceFiles()

  // git check-ignore 默认会看索引，已追踪的文件不会被判为 ignored —— 正合需要。
  const ignored = new Map()
  const ciRes = git(['check-ignore', '-v', '-z', '--stdin'], { input: files.join('\0') + '\0' })
  if (ciRes.status === 0 || ciRes.status === 1) {
    // -z 的格式是每条记录四个 NUL 分隔字段：source、linenum、pattern、pathname
    const fields = (ciRes.stdout || '').split('\0')
    for (let i = 0; i + 3 < fields.length; i += 4) {
      const [, line, pattern, p] = [fields[i], fields[i + 1], fields[i + 2], fields[i + 3]]
      if (!p) continue
      ignored.set(toPosix(p), { line, pattern })
    }
  }

  const tracked = new Set(
    (git(['ls-files', '-z', '--', 'apps', 'packages']).stdout || '')
      .split('\0')
      .filter(Boolean)
      .map(toPosix),
  )

  const ignoredFiles = []
  const untrackedFiles = []
  for (const f of files) {
    if (ignored.has(f)) ignoredFiles.push({ file: f, ...ignored.get(f) })
    else if (!tracked.has(f)) untrackedFiles.push(f)
  }

  const missingCritical = CRITICAL_FILES.filter(
    (p) => fs.existsSync(path.join(ROOT, p)) && git(['ls-files', '--error-unmatch', '--', p]).status !== 0,
  )

  return { ignoredFiles, untrackedFiles, missingCritical, capped }
}

function printGuard(rows) {
  const { ignoredFiles, untrackedFiles, missingCritical, capped } = rows

  if (capped) {
    console.log(C.yellow(`  ! 遍历超过 ${WALK_LIMIT} 个文件已提前结束，守卫结果可能不完整`))
  }

  for (const { file, line, pattern } of ignoredFiles) {
    console.log(C.red(`  ✘ ${file}`))
    console.log(`      被 .gitignore:${line} 的 \`${pattern}\` 忽略，不会进仓库，CI 必然失败`)
    console.log(C.dim(`      修复：给该模式加锚点（如 /${pattern.replace(/\/$/, '')}/），或加例外 !${file}`))
  }

  if (untrackedFiles.length) {
    console.log(C.red(`  ✘ ${untrackedFiles.length} 个源码文件尚未纳入 git：`))
    for (const f of untrackedFiles) console.log(`      ${f}`)
    console.log(C.dim(`      修复：git add ${untrackedFiles.join(' ')}`))
    if (!ALLOW_UNTRACKED) {
      console.log(C.dim('      如需放行（开发中的临时文件）：CI_CHECK_ALLOW_UNTRACKED=1 pnpm ci:check'))
    }
  }

  for (const f of missingCritical) {
    console.log(C.red(`  ✘ CI 关键文件不在仓库中：${f}`))
  }

  const ok = ignoredFiles.length === 0 && missingCritical.length === 0 && (untrackedFiles.length === 0 || ALLOW_UNTRACKED)
  return ok
}

// ── 步骤执行 ────────────────────────────────────────────────────────────────

function runStep(name, cmd, argv, opts = {}) {
  return new Promise((resolve) => {
    const started = Date.now()
    console.log(`\n${C.bold(`▸ ${name}`)}`)

    let child
    try {
      child = spawn(cmd, argv, {
        cwd: opts.cwd ?? ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: opts.shell ?? false,
        env: opts.env ?? process.env,
      })
    } catch (err) {
      resolve({ code: -1, ms: Date.now() - started, lines: [String(err?.message ?? err)] })
      return
    }

    const lines = []
    const onData = (buf) => {
      const text = buf.toString('utf8')
      process.stdout.write(text)
      for (const l of text.split(/\r?\n/)) {
        if (!l) continue
        lines.push(l)
        if (lines.length > TAIL_LINES) lines.shift()
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)

    const done = (code) => resolve({ code, ms: Date.now() - started, lines })
    child.on('error', (err) => { lines.push(String(err?.message ?? err)); done(-1) })
    child.on('close', (code) => done(code ?? -1))
  })
}

/** turbo 步骤。--ui=stream 避免 TUI 控制字符污染输出；errors-only 让通过的包保持安静。 */
function turboStep(name, task) {
  const argv = [TURBO_BIN, 'run', task, '--continue', '--ui=stream', '--output-logs=errors-only']
  if (FORCE) argv.push('--force')
  return runStep(name, process.execPath, argv)
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

const mode = FORCE ? 'full + --force（忽略 turbo 缓存）' : FULL ? 'full' : 'fast'
console.log(C.bold(`ci:check [${mode}]`))
console.log(C.dim(`  root: ${ROOT}`))

const results = []
const record = (name, ok, ms, repro, extra) => results.push({ name, ok, ms, repro, extra })

// 1. install 校验。失败即中止 —— node_modules 与 lockfile 不匹配时，后续输出全是噪声。
//    full 走真实安装与 CI 逐字一致；fast 用 --lockfile-only，快但不读 node_modules，
//    因此看不见「node_modules 与提交的 .npmrc 不匹配」这类问题。
const installArgs = FULL
  ? ['install', '--frozen-lockfile']
  : ['install', '--frozen-lockfile', '--lockfile-only']
const installRepro = `pnpm ${installArgs.join(' ')}`
// Windows 上 pnpm 是 .cmd，必须借 shell 才能 spawn。参数是常量，无转义风险。
//
// CI=true 与 CI 环境一致（GitHub Actions 默认设置它），同时也是必需的：
// 没有 TTY 时 pnpm 遇到需要重建 node_modules 的场景会直接
// ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY 退出。
const installRes = await runStep('install', 'pnpm', installArgs, {
  shell: process.platform === 'win32',
  env: { ...process.env, CI: 'true' },
})
record('install', installRes.code === 0, installRes.ms, installRepro)

if (installRes.code !== 0) {
  console.log(C.red(`\n✘ install 失败，中止后续步骤（后续检查都基于 node_modules）`))
  console.log(C.dim(`  reproduce: ${installRepro}`))
  printSummary(results)
  process.exitCode = 1
} else {
  // 2. 追踪守卫。失败也继续跑后面的 turbo 步骤 —— 一次拿全信息。
  console.log(`\n${C.bold('▸ source-tracking')}`)
  const guardStarted = Date.now()
  const guardRows = guard()
  const guardOk = printGuard(guardRows)
  record('source-tracking', guardOk, Date.now() - guardStarted, 'pnpm ci:check')

  // 3~6. turbo 步骤
  const tasks = [['lint', 'lint'], ['type-check', 'type-check']]
  if (FULL) tasks.push(['test', 'test'], ['build', 'build'])

  for (const [task, label] of tasks) {
    const res = await turboStep(label, task)
    record(
      label,
      res.code === 0,
      res.ms,
      `${path.basename(process.execPath)} ${path.relative(ROOT, path.join('node_modules/turbo/bin/turbo'))} run ${task} --continue${FORCE ? ' --force' : ''}`,
    )
  }

  printSummary(results)
  process.exitCode = results.every((r) => r.ok) ? 0 : 1
}

function printSummary(rows) {
  const bar = '─'.repeat(52)
  console.log(`\n${bar}`)
  for (const r of rows) {
    const mark = r.ok ? C.green('PASS') : C.red('FAIL')
    console.log(`  ${mark}  ${r.name.padEnd(16)} ${C.dim(`${(r.ms / 1000).toFixed(1)}s`)}`)
    if (!r.ok) console.log(C.dim(`        reproduce: ${r.repro}`))
  }
  const failed = rows.filter((r) => !r.ok)
  const skipped = FULL ? [] : ['test', 'build']
  for (const s of skipped) console.log(`  ${C.dim('SKIP')}  ${s.padEnd(16)} ${C.dim('(--full 才会执行)')}`)
  console.log(bar)
  console.log(
    failed.length
      ? C.red(`RESULT: FAILED (${failed.length} of ${rows.length} steps)`)
      : C.green(`RESULT: PASSED (${rows.length} steps)`) + (skipped.length ? C.dim(`  ·  未含 ${skipped.join(', ')}`) : ''),
  )
}
