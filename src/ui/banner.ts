import chalk from 'chalk';

export const INVAR_ASCII_LOGO = `
   _                            
  (_)                           
   _  _ __ __   __ __ _  _ __   
  | || '_ \\\\ \\ / // _\` || '__|  
  | || | | |\\ V /| (_| || |     
  |_||_| |_| \\_/  \\__,_||_|     
`;

export function printBanner(): void {
  console.log(chalk.bold.cyan(INVAR_ASCII_LOGO));
  console.log(
    chalk.bold.white(' invar ') +
      chalk.gray('v0.1.0') +
      chalk.dim(' • The Invariant-Guarded Transactional Kernel for AI Agents\n')
  );
}

export function formatBadge(status: string): string {
  switch (status.toUpperCase()) {
    case 'COMMITTED':
      return chalk.bgGreen.black.bold(' COMMITTED ');
    case 'ROLLED_BACK':
      return chalk.bgRed.white.bold(' ROLLED BACK ');
    case 'QUARANTINED':
      return chalk.bgYellow.black.bold(' QUARANTINED ');
    case 'TAMPERED':
    case 'TAMPER_BREACH':
      return chalk.bgRed.white.bold(' TAMPER BREACH ');
    case 'AST_VIOLATION':
      return chalk.bgMagenta.white.bold(' AST VIOLATION ');
    case 'TEST_FAILURE':
      return chalk.bgRed.white.bold(' TEST FAILURE ');
    default:
      return chalk.bgGray.white.bold(` ${status} `);
  }
}
