import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from './errors.js';
import type { ComputeInput, ComputeResult } from './types.js';

export interface ReportRow {
  id: number;
  created_at: string;
  algo_version: string;
  input: ComputeInput;
  result: ComputeResult;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const p = dbPath ?? path.join(process.cwd(), 'data', 'cssc.db');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    this.db = new DatabaseSync(p);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        algo_version TEXT NOT NULL,
        input_json TEXT NOT NULL,
        result_json TEXT NOT NULL
      );
    `);
  }

  /** 计算成功才落库；任何一步失败都不会留下部分结果 */
  saveReport(input: ComputeInput, result: ComputeResult): number {
    const stmt = this.db.prepare(
      'INSERT INTO reports (created_at, algo_version, input_json, result_json) VALUES (?, ?, ?, ?)',
    );
    const info = stmt.run(
      new Date().toISOString(),
      result.algoVersion,
      JSON.stringify(input),
      JSON.stringify(result),
    );
    return Number(info.lastInsertRowid);
  }

  getReport(id: number): ReportRow {
    const row = this.db
      .prepare('SELECT * FROM reports WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!row) throw new ApiError('NOT_FOUND', `报告 ${id} 不存在`);
    return {
      id: row.id as number,
      created_at: row.created_at as string,
      algo_version: row.algo_version as string,
      input: JSON.parse(row.input_json as string) as ComputeInput,
      result: JSON.parse(row.result_json as string) as ComputeResult,
    };
  }

  listReports(): Array<{ id: number; created_at: string; algo_version: string }> {
    const rows = this.db
      .prepare('SELECT id, created_at, algo_version FROM reports ORDER BY id')
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as number,
      created_at: r.created_at as string,
      algo_version: r.algo_version as string,
    }));
  }

  close(): void {
    this.db.close();
  }
}
