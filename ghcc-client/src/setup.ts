import fs from 'fs';
import path from 'path';
import os from 'os';

const platform = os.platform();
const arch = os.arch();

let binaryName: string;
if (platform === 'linux') {
  binaryName = arch === 'arm64' ? 'ttyd-linux-arm64' : 'ttyd-linux-x64';
} else if (platform === 'darwin') {
  binaryName = arch === 'arm64' ? 'ttyd-darwin-arm64' : 'ttyd-darwin-x64';
} else {
  console.log(`⚠️  Platform ${platform} is not officially supported`);
  console.log('For Windows users: Install WSL2 and run ghcc-client inside WSL');
  console.log('See: https://docs.microsoft.com/en-us/windows/wsl/install');
  process.exit(0);
}

const binaryPath = path.join(__dirname, '..', 'binaries', binaryName);

if (fs.existsSync(binaryPath)) {
  try {
    fs.chmodSync(binaryPath, '755');
    console.log('✅ ghcc-client installed successfully!');
    console.log('');
    console.log('Get started:');
    console.log('  ghcc-client start    # Start remote session');
    console.log('  ghcc-client status   # Check status');
    console.log('  ghcc-client --help   # See all commands');
    console.log('');
  } catch (error) {
    console.error('Failed to make ttyd binary executable:', (error as Error).message);
  }
} else {
  console.log(`⚠️  ttyd binary not found for ${platform}-${arch}`);
  console.log('You may need to install ttyd manually');
}
