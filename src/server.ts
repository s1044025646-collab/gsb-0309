import http from 'node:http';
import { computeStyles } from './cascade.js';
import { Store } from './db.js';
import { ApiError } from './errors.js';
import { compareResults, explain } from './explain.js';
import { validateInput } from './validate.js';
import type { ComputeInput } from './types.js';

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(data);
}

function sendError(res: http.ServerResponse, err: unknown): void {
  if (err instanceof ApiError) {
    sendJson(res, 400, { error: { code: err.code, message: err.message, details: err.details } });
  } else {
    sendJson(res, 500, { error: { code: 'INTERNAL', message: String(err) } });
  }
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf-8');
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('BAD_REQUEST', '请求体不是合法 JSON');
  }
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const method = req.method ?? 'GET';

      // POST /api/reports  导入元素树与规则并计算全树样式
      if (method === 'POST' && path === '/api/reports') {
        const input = (await readBody(req)) as ComputeInput;
        validateInput(input);
        const result = computeStyles(input);
        const id = store.saveReport(input, result);
        sendJson(res, 201, { id, algoVersion: result.algoVersion, result });
        return;
      }

      // GET /api/reports  查询历史
      if (method === 'GET' && path === '/api/reports') {
        sendJson(res, 200, { reports: store.listReports() });
        return;
      }

      // GET /api/reports/compare?a=1&b=2  比较两个报告版本
      if (method === 'GET' && path === '/api/reports/compare') {
        const a = Number(url.searchParams.get('a'));
        const b = Number(url.searchParams.get('b'));
        if (!Number.isInteger(a) || !Number.isInteger(b)) {
          throw new ApiError('BAD_REQUEST', '需要整数参数 a 和 b');
        }
        const diffs = compareResults(store.getReport(a).result, store.getReport(b).result);
        sendJson(res, 200, { a, b, diffs });
        return;
      }

      const m = /^\/api\/reports\/(\d+)(\/explain|\/export)?$/.exec(path);
      if (method === 'GET' && m) {
        const id = Number(m[1]);
        const report = store.getReport(id);
        const sub = m[2];
        if (sub === '/explain') {
          const element = Number(url.searchParams.get('element'));
          const property = url.searchParams.get('property') ?? '';
          if (!Number.isInteger(element)) throw new ApiError('BAD_REQUEST', '需要整数参数 element');
          sendJson(res, 200, { reportId: id, ...explain(report.result, element, property) });
          return;
        }
        if (sub === '/export') {
          sendJson(res, 200, report);
          return;
        }
        sendJson(res, 200, { id: report.id, created_at: report.created_at, algo_version: report.algo_version, result: report.result });
        return;
      }

      throw new ApiError('NOT_FOUND', `${method} ${path} 不存在`);
    } catch (err) {
      sendError(res, err);
    }
  });
}

export function startServer(store: Store, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer(store);
    server.on('error', reject);
    server.listen(port, () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : port);
    });
  });
}
