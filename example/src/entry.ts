import { spawn } from "node:child_process"
import { dirname, join, delimiter } from "node:path"

const nodeDirectory = dirname(process.execPath)
const npmPath = join(nodeDirectory, "npm")

const child = spawn(npmPath, ["--version"], {
  env: {
    ...process.env,
    PATH: [
      nodeDirectory,
      process.env.PATH,
    ].filter(Boolean).join(delimiter),
  },
})

let stdout = ""
let stderr = ""

child.stdout.on("data", data => {
  stdout += data
})

child.stderr.on("data", data => {
  stderr += data
})

child.on("error", error => {
  document.body.textContent = JSON.stringify({
    success: false,
    nodePath: process.execPath,
    npmPath,
    pathEnvironment: process.env.PATH,
    code: error.code,
    message: error.message,
  }, null, 2)
})

child.on("close", code => {
  document.body.textContent = JSON.stringify({
    success: code === 0,
    nodePath: process.execPath,
    npmPath,
    npmVersion: stdout.trim(),
    exitCode: code,
    stderr,
  }, null, 2)
})