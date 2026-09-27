import { promises as fs } from 'node:fs';
import path from 'node:path';
import { appHome } from './paths.js';

const settingPath = () => path.join(appHome(), 'remote-approval.json');

export async function readRemoteAutoApproval(): Promise<boolean> {
  try {
    const value = JSON.parse(await fs.readFile(settingPath(), 'utf8')) as { desktopAutoApprove?: unknown };
    return value.desktopAutoApprove === true;
  } catch {
    return false;
  }
}

export async function writeRemoteAutoApproval(enabled: boolean): Promise<void> {
  const file = settingPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ desktopAutoApprove: enabled }), { mode: 0o600 });
  await fs.rename(temporary, file);
}
