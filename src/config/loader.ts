import fs from 'node:fs';
import path from 'node:path';
import * as toml from 'smol-toml';
import type { InvarConfig } from './types.js';
import { getDefaultConfig } from './defaults.js';

export function loadConfig(cwd: string = process.cwd()): InvarConfig {
  const tomlPath = path.join(cwd, '.invar.toml');
  const jsonPath = path.join(cwd, 'invar.config.json');

  const defaults = getDefaultConfig(cwd);

  if (fs.existsSync(tomlPath)) {
    try {
      const raw = fs.readFileSync(tomlPath, 'utf8');
      const parsed = toml.parse(raw) as unknown as Partial<InvarConfig>;
      return mergeConfigs(defaults, parsed);
    } catch (err: any) {
      console.warn(`[invar] Warning: Failed to parse .invar.toml (${err.message}). Using defaults.`);
    }
  }

  if (fs.existsSync(jsonPath)) {
    try {
      const raw = fs.readFileSync(jsonPath, 'utf8');
      const parsed = JSON.parse(raw);
      return mergeConfigs(defaults, parsed);
    } catch (err: any) {
      console.warn(`[invar] Warning: Failed to parse invar.config.json (${err.message}). Using defaults.`);
    }
  }

  return defaults;
}

function mergeConfigs(defaults: InvarConfig, custom: Partial<InvarConfig>): InvarConfig {
  return {
    project: {
      ...defaults.project,
      ...custom.project,
    },
    vault: {
      ...defaults.vault,
      ...custom.vault,
    },
    shadow: {
      ...defaults.shadow,
      ...custom.shadow,
    },
    invariants: {
      ...defaults.invariants,
      ...custom.invariants,
    },
  };
}
