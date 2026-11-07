// Runs inside VS Code. The workspace is empty and `opencode.serverUrl` points at a closed port, so the
// extension must come up, register everything, and show an error state without starting any service.
const assert = require("node:assert")
const vscode = require("vscode")

exports.run = async function run() {
  await vscode.workspace.getConfiguration("opencode").update("serverUrl", "http://127.0.0.1:9", vscode.ConfigurationTarget.Global)
  const ext = vscode.extensions.getExtension("sr-web-studio.opencode-unofficial")
  assert.ok(ext, "extension is installed from the development path")
  await ext.activate()
  assert.strictEqual(ext.isActive, true)

  const commands = await vscode.commands.getCommands(true)
  for (const id of ["opencode.focus", "opencode.newSession", "opencode.reconnect", "opencode.setPassword", "opencode.clearPassword", "opencode.setCliPath", "opencode.openGlobalConfig"]) {
    assert.ok(commands.includes(id), `command ${id} is registered`)
  }
  await vscode.commands.executeCommand("opencode.focus")
  await vscode.commands.executeCommand("opencode.newSession")
  console.log("host smoke test passed")
}
