import ora, { type Ora } from 'ora';
import chalk from 'chalk';

export class InvarSpinner {
  private spinner: Ora;
  private startTime: number;

  constructor(initialText: string) {
    this.startTime = Date.now();
    this.spinner = ora({
      text: chalk.blue(initialText),
      color: 'cyan',
    }).start();
  }

  public step(current: number, total: number, message: string): void {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    this.spinner.text = `${chalk.dim(`[${current}/${total}]`)} ${chalk.blue(message)} ${chalk.gray(`(${elapsed}s)`)}`;
  }

  public setText(message: string): void {
    this.spinner.text = chalk.blue(message);
  }

  public succeed(message: string): void {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    this.spinner.succeed(`${chalk.green.bold(message)} ${chalk.gray(`(${elapsed}s total)`)}`);
  }

  public fail(message: string): void {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    this.spinner.fail(`${chalk.red.bold(message)} ${chalk.gray(`(${elapsed}s total)`)}`);
  }
}

export function createSpinner(initialText: string): InvarSpinner {
  return new InvarSpinner(initialText);
}
