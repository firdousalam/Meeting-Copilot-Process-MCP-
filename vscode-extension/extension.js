const vscode = require('vscode');
const { spawn } = require('child_process');
const path = require('path');

let childProcess = null;

function startMcpServer() {
  const projectRoot = path.join(__dirname, '..');
  const serverScript = path.join(projectRoot, 'server.js');

  if (childProcess && !childProcess.killed) {
    vscode.window.showInformationMessage('Meeting Copilot MCP server is already running.');
    return;
  }

  childProcess = spawn(process.execPath, [serverScript], {
    cwd: projectRoot,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  childProcess.stdout.on('data', (data) => {
    const message = data.toString();
    if (message.trim()) {
      console.log('[Meeting Copilot MCP]', message.trim());
    }
  });

  childProcess.stderr.on('data', (data) => {
    const message = data.toString();
    if (message.trim()) {
      console.error('[Meeting Copilot MCP]', message.trim());
    }
  });

  childProcess.on('exit', (code) => {
    console.log(`Meeting Copilot MCP server exited with code ${code}`);
    childProcess = null;
  });

  vscode.window.showInformationMessage('Meeting Copilot MCP server started.');
}

function activate(context) {
  const startCommand = vscode.commands.registerCommand('meetingCopilot.start', startMcpServer);
  context.subscriptions.push(startCommand);

  vscode.window.showInformationMessage('Meeting Copilot extension activated.');
}

function deactivate() {
  if (childProcess) {
    childProcess.kill();
    childProcess = null;
  }
}

module.exports = {
  activate,
  deactivate
};
