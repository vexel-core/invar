import fs from 'node:fs';
import path from 'node:path';
import type { TransactionResult } from '../config/types.js';

export function saveAuditLog(baseDir: string, result: TransactionResult, intent?: string): string {
  const auditDir = path.join(baseDir, '.invar', 'audit');
  fs.mkdirSync(auditDir, { recursive: true });

  const record = {
    ...result,
    intent: intent || 'Manual / Subshell Task',
    timestamp: new Date().toISOString(),
  };

  const jsonFile = path.join(auditDir, `${result.txId}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify(record, null, 2), 'utf8');

  return jsonFile;
}
