import Table from 'cli-table3';
import chalk from 'chalk';
import { formatBadge } from './banner.js';
import type { QuarantineManifest } from '../tx/quarantine.js';

export function formatAuditTable(logs: any[]): string {
  const table = new Table({
    head: [
      chalk.cyan.bold('Tx ID'),
      chalk.cyan.bold('Status'),
      chalk.cyan.bold('Intent / Command'),
      chalk.cyan.bold('Timestamp'),
    ],
    style: { head: [], border: ['gray'] },
  });

  for (const log of logs) {
    table.push([
      chalk.white.bold(log.txId),
      formatBadge(log.status),
      chalk.yellow(log.intent ? log.intent.substring(0, 45) : 'N/A'),
      chalk.gray(new Date(log.timestamp).toLocaleString()),
    ]);
  }

  return table.toString();
}

export function formatQuarantineTable(items: QuarantineManifest[]): string {
  const table = new Table({
    head: [
      chalk.yellow.bold('Tx ID'),
      chalk.yellow.bold('Status'),
      chalk.yellow.bold('Reason'),
      chalk.yellow.bold('Timestamp'),
    ],
    style: { head: [], border: ['gray'] },
  });

  for (const item of items) {
    table.push([
      chalk.white.bold(item.txId),
      formatBadge(item.status),
      chalk.white(item.reason.substring(0, 50)),
      chalk.gray(new Date(item.timestamp).toLocaleString()),
    ]);
  }

  return table.toString();
}

export function formatDiffPreview(diff: string, maxLines = 15): string {
  if (!diff) return chalk.gray('No changes recorded.');

  const lines = diff.split(/\r?\n/);
  const preview = lines.slice(0, maxLines).map((line) => {
    if (line.startsWith('+') && !line.startsWith('+++')) return chalk.green(line);
    if (line.startsWith('-') && !line.startsWith('---')) return chalk.red(line);
    if (line.startsWith('@@')) return chalk.cyan(line);
    return chalk.gray(line);
  });

  if (lines.length > maxLines) {
    preview.push(chalk.dim(`... (${lines.length - maxLines} more lines)`));
  }

  return preview.join('\n');
}

export function formatAstViolations(violations: string[]): string {
  const formatted = violations.map((v) => {
    if (v.includes('[BOUNDARY_VIOLATION]')) {
      return `${chalk.red.bold('✖ Boundary Leak:')} ${v.replace('[BOUNDARY_VIOLATION] ', '')}`;
    }
    if (v.includes('[COMPLEXITY_EXCEEDED]')) {
      return `${chalk.yellow.bold('▲ High Complexity:')} ${v.replace('[COMPLEXITY_EXCEEDED] ', '')}`;
    }
    if (v.includes('[LINE_COUNT_EXCEEDED]')) {
      return `${chalk.yellow.bold('▲ Monolithic Function:')} ${v.replace('[LINE_COUNT_EXCEEDED] ', '')}`;
    }
    if (v.includes('[DUPLICATE_SYMBOL]')) {
      return `${chalk.magenta.bold('◆ Duplicate Symbol:')} ${v.replace('[DUPLICATE_SYMBOL] ', '')}`;
    }
    return chalk.red(`• ${v}`);
  });

  return formatted.join('\n');
}
