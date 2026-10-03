/**
 * Dependency-free boundary for the Windows native folder chooser.
 * The PowerShell program is fixed; selected paths only travel back on stdout.
 */
const childProcess = require('node:child_process');

const PICK_FOLDER_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$form = New-Object System.Windows.Forms.Form',
  '$form.TopMost = $true',
  '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$dialog.Description = "Select a workspace folder for NanoForge"',
  '$dialog.ShowNewFolderButton = $false',
  'if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }',
  '$form.Dispose()',
].join('; ');

function createWindowsFolderPicker(options = {}) {
  const platform = options.platform || process.platform;
  const execFile = options.execFile || childProcess.execFile;
  const executable = options.executable || 'powershell.exe';
  let activePick = null;

  return {
    pick() {
      if (platform !== 'win32') return Promise.resolve({ status: 'error', code: 'unsupported_platform' });
      if (activePick) return activePick;

      activePick = new Promise((resolve) => {
        // Never enable a shell and never append user supplied values to args.
        execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', PICK_FOLDER_SCRIPT], {
          windowsHide: true,
          maxBuffer: 16 * 1024,
        }, (error, stdout) => {
          activePick = null;
          if (error) {
            resolve({ status: 'error', code: 'picker_unavailable' });
            return;
          }
          const selectedPath = String(stdout || '').trim();
          resolve(selectedPath ? { status: 'selected', path: selectedPath } : { status: 'cancelled' });
        });
      });
      return activePick;
    },
  };
}

module.exports = { createWindowsFolderPicker, PICK_FOLDER_SCRIPT };
