/**
 * Dependency-free boundary for the Windows native folder chooser.
 * The PowerShell program is fixed; selected paths only travel back on stdout.
 */
const childProcess = require('node:child_process');

const PICK_FOLDER_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$dialog.ShowNewFolderButton = $false',
  'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }',
].join('; ');

function createWindowsFolderPicker(options = {}) {
  const platform = options.platform || process.platform;
  const execFile = options.execFile || childProcess.execFile;
  const executable = options.executable || 'powershell.exe';

  return {
    pick() {
      if (platform !== 'win32') return Promise.resolve({ status: 'error', code: 'unsupported_platform' });
      return new Promise((resolve) => {
        // Never enable a shell and never append user supplied values to args.
        execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', PICK_FOLDER_SCRIPT], {
          windowsHide: true,
          maxBuffer: 16 * 1024,
        }, (error, stdout) => {
          if (error) {
            resolve({ status: 'error', code: 'picker_unavailable' });
            return;
          }
          const selectedPath = String(stdout || '').trim();
          resolve(selectedPath ? { status: 'selected', path: selectedPath } : { status: 'cancelled' });
        });
      });
    },
  };
}

module.exports = { createWindowsFolderPicker, PICK_FOLDER_SCRIPT };
