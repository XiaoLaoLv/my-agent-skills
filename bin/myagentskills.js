#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const { join } = require("node:path");

const root = join(__dirname, "..");
const command = process.argv[2];
const args = process.argv.slice(3);

const commands = {
  install: join(root, "scripts", "install-skills.js"),
  validate: join(root, "scripts", "validate-skills.js"),
  package: join(root, "scripts", "package-skills.js"),
};

function printHelp() {
  console.log(`Usage:
  myagentskills [-- <target-skills-dir>]
  myagentskills install [target-skills-dir]
  myagentskills validate
  myagentskills package

Default command is install. If no target is provided, installs to ~/.agents/skills.`);
}

let script;
let scriptArgs;

if (!command || command === "--") {
  script = commands.install;
  scriptArgs = command === "--" ? args : [];
} else if (command === "-h" || command === "--help" || command === "help") {
  printHelp();
  process.exit(0);
} else if (commands[command]) {
  script = commands[command];
  scriptArgs = args;
} else {
  script = commands.install;
  scriptArgs = process.argv.slice(2);
}

const result = spawnSync(process.execPath, [script, ...scriptArgs], {
  cwd: root,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
