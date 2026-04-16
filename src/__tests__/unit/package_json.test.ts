import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const pkg = JSON.parse(
  readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')
);

describe('package.json', () => {
  it('scripts.console equals "node dist/console/index.js"', () => {
    expect(pkg.scripts.console).toBe('node dist/console/index.js');
  });

  it('bin["bridge-console"] equals "dist/console/index.js"', () => {
    expect(pkg.bin['bridge-console']).toBe('dist/console/index.js');
  });
});
