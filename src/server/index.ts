import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { ReportStore } from '../db/sqlite.js';
import { ReportService } from '../service/reportService.js';
import { ValidationError } from '../core/validate.js';

interface AppContext {
  service: ReportService;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buf.length;
    if (size > 4 * 1024 * 1024) {
      throw new ValidationError('LIMIT_EXCEEDED', '请求体超过 4MB 限制');
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('JSON_INVALID', '请求体不是合法 JSON');
  }
}

function matchPath(pathname: string): { name: string; params: string[] } | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 2 && parts[0] === 'reports' && parts[1] === 'compute')
    return { name: 'compute', params: [] };
  if (parts.length === 2 && parts[0] === 'reports' && parts[1] === 'history')
    return { name: 'history', params: [] };
  if (parts.length === 3 && parts[0] === 'reports')
    return { name: 'get', params: [parts[1]!] };
  if (parts.length === 5 && parts[0] === 'reports' && parts[3] === 'explain')
    return { name: 'explain', params: [parts[1]!, parts[2]!, parts[4]!] };
  if (parts.length === 5 && parts[0] === 'reports' && parts[2] === 'compare')
    return { name: 'compare', params: [parts[1]!, parts[3]!] };
  if (parts.length === 4 && parts[0] === 'reports' && parts[3] === 'export')
    return { name: 'export', params: [parts[1]!] };
  return null;
}

export function createApp(ctx: AppContext): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const route = matchPath(url.pathname);
      if (!route || req.method !== 'POST' && req.method !== 'GET') {
        return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '未知路由' } });
      }

      if (route.name === 'compute' && req.method === 'POST') {
        const input = await readJson(req);
        const created = ctx.service.create(input as never);
        return sendJson(res, created.reused ? 200 : 201, created);
      }

      if (route.name === 'history' && req.method === 'GET') {
        const limit = Number(url.searchParams.get('limit') ?? '20');
        return sendJson(res, 200, { history: ctx.service.history(Number.isFinite(limit) ? limit : 20) });
      }

      if (route.name === 'get' && req.method === 'GET') {
        const loaded = ctx.service.get(route.params[0]!);
        return loaded
          ? sendJson(res, 200, loaded.report)
          : sendJson(res, 404, { error: { code: 'REPORT_NOT_FOUND', message: '报告不存在' } });
      }

      if (route.name === 'explain' && req.method === 'POST') {
        const [id, elementId, property] = route.params;
        const out = ctx.service.explain(id!, elementId!, property!);
        return 'error' in out
          ? sendJson(res, 404, { error: { code: 'EXPLAIN_FAILED', message: out.error } })
          : sendJson(res, 200, out);
      }

      if (route.name === 'compare' && req.method === 'POST') {
        const out = ctx.service.compare(route.params[0]!, route.params[1]!);
        return 'error' in out
          ? sendJson(res, 404, { error: { code: 'COMPARE_FAILED', message: out.error } })
          : sendJson(res, 200, out);
      }

      if (route.name === 'export' && req.method === 'GET') {
        const loaded = ctx.service.get(route.params[0]!);
        res.setHeader('content-disposition', `attachment; filename="report-${route.params[0]}.json"`);
        return loaded
          ? sendJson(res, 200, loaded.report)
          : sendJson(res, 404, { error: { code: 'REPORT_NOT_FOUND', message: '报告不存在' } });
      }

      return sendJson(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '方法不允许' } });
    } catch (err) {
      if (err instanceof ValidationError) {
        return sendJson(res, 400, { error: { code: err.code, message: err.message } });
      }
      const message = err instanceof Error ? err.message : String(err);
      return sendJson(res, 500, { error: { code: 'INTERNAL_ERROR', message } });
    }
  });
}

/** 请求一个空闲端口（端口 0 由操作系统分配）。 */
export function pickFreePort(preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.on('error', reject);
    srv.listen(preferred ?? 0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => {
        if (addr && typeof addr === 'object') resolve(addr.port);
        else reject(new Error('无法获取空闲端口'));
      });
    });
  });
}

async function main(): Promise<void> {
  const dbPath = process.env.CSS_EXPLAIN_DB ?? join(process.cwd(), 'data', 'reports.db');
  const store = new ReportStore(dbPath);
  const service = new ReportService(store);
  const app = createApp({ service });

  const requested = process.env.PORT ? Number(process.env.PORT) : undefined;
  const port = await pickFreePort(requested);
  app.listen(port, '127.0.0.1', () => {
    console.log(`CSS 层叠解释服务已启动: http://127.0.0.1:${port}`);
    console.log(`数据文件: ${dbPath}`);
    console.log('路由:');
    console.log('  POST /reports/compute            导入并计算（冻结为新报告）');
    console.log('  GET  /reports/:id                获取完整报告');
    console.log('  POST /reports/:id/explain/:elId/:property  解释来源');
    console.log('  POST /reports/:a/compare/:b       比较两个报告版本');
    console.log('  GET  /reports/history             查询历史');
    console.log('  GET  /reports/:id/export          JSON 导出');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
