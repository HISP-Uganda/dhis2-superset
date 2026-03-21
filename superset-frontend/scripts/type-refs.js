#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');
const ts = require('typescript');

const frontendRoot = path.resolve(__dirname, '..');
const tsconfigPath = path.join(frontendRoot, 'tsconfig.json');

function readProjectReferences(configPath) {
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  }

  const references = Array.isArray(config.config.references)
    ? config.config.references
    : [];

  return references
    .map(reference => reference && reference.path)
    .filter(referencePath => typeof referencePath === 'string' && referencePath.length > 0);
}

const projectReferences = readProjectReferences(tsconfigPath);

if (projectReferences.length === 0) {
  process.exit(0);
}

const tscBin = require.resolve('typescript/bin/tsc');
const tscArgs = ['-b', '--pretty', 'false', '--force', ...projectReferences];
const result = spawnSync(process.execPath, [tscBin, ...tscArgs], {
  cwd: frontendRoot,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
