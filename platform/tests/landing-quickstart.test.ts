import { describe,expect,it } from 'vitest';
import { installCommand,localExample } from '../src/landing/content';

describe('Public quickstart command',()=>{
  it('starts the deployment-hosted CLI directly without a global installation or an unpublished registry package',()=>{
    expect(installCommand('https://YOUR-TRAQIVA.workers.dev')).toBe('npx --yes --no-audit https://YOUR-TRAQIVA.workers.dev/cli.tgz');
    expect(localExample('https://YOUR-TRAQIVA.workers.dev')).not.toContain('npm install --global');
  });
  it('keeps a self-hosted installation pointed at its own server',()=>{
    expect(installCommand('https://workspace.example.test')).toBe('npx --yes --no-audit https://workspace.example.test/cli.tgz init --url https://workspace.example.test');
    expect(installCommand('http://127.0.0.1:5173')).toContain('init --url http://127.0.0.1:5173');
  });
});
