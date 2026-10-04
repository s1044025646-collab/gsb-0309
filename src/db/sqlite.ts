import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ReportRecord {
  id: string;
  algorithmVersion: string;
  inputHash: string;
  inputJson: string;
  reportJson: string;
  createdAt: string;
}

/**
 * SQLite 持久化：冻结树、规则顺序、行内声明和算法版本。
 * 相同输入（规范化后）返回同一报告 id；更改输入产生新报告。
 */
export class ReportStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        algorithm_version TEXT NOT NULL,
        input_hash TEXT NOT NULL UNIQUE,
        input_json TEXT NOT NULL,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);
    `);
  }

  /** 按输入哈希查找已有报告（幂等：相同输入不重复计算/保存）。 */
  findByHash(inputHash: string): ReportRecord | null {
    const row = this.db
      .prepare('SELECT * FROM reports WHERE input_hash = ?')
      .get(inputHash) as
      | {
          id: string;
          algorithm_version: string;
          input_hash: string;
          input_json: string;
          report_json: string;
          created_at: string;
        }
      | undefined;
    return row ? this.toRecord(row) : null;
  }

  getById(id: string): ReportRecord | null {
    const row = this.db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as
      | {
          id: string;
          algorithm_version: string;
          input_hash: string;
          input_json: string;
          report_json: string;
          created_at: string;
        }
      | undefined;
    return row ? this.toRecord(row) : null;
  }

  save(rec: ReportRecord): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO reports
         (id, algorithm_version, input_hash, input_json, report_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        rec.id,
        rec.algorithmVersion,
        rec.inputHash,
        rec.inputJson,
        rec.reportJson,
        rec.createdAt,
      );
  }

  list(limit: number): ReportRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM reports ORDER BY created_at DESC LIMIT ?')
      .all(limit) as {
      id: string;
      algorithm_version: string;
      input_hash: string;
      input_json: string;
      report_json: string;
      created_at: string;
    }[];
    return rows.map((r) => this.toRecord(r));
  }

  close(): void {
    this.db.close();
  }

  private toRecord(row: {
    id: string;
    algorithm_version: string;
    input_hash: string;
    input_json: string;
    report_json: string;
    created_at: string;
  }): ReportRecord {
    return {
      id: row.id,
      algorithmVersion: row.algorithm_version,
      inputHash: row.input_hash,
      inputJson: row.input_json,
      reportJson: row.report_json,
      createdAt: row.created_at,
    };
  }
}
