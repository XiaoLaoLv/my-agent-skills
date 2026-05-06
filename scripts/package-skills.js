#!/usr/bin/env node

const { existsSync, mkdirSync, readdirSync, rmSync, statSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const root = join(__dirname, "..");
const skillsDir = join(root, "skills");
const distDir = join(root, "dist");

const excludeArgs = [
  "-x",
  "*/.DS_Store",
  "*/node_modules/*",
  "*/reports/*",
  "*/dist/*",
  "*.log",
];

function main() {
  mkdirSync(distDir, { recursive: true });
  const skillNames = readdirSync(skillsDir).filter((name) => statSync(join(skillsDir, name)).isDirectory());

  for (const skillName of skillNames) {
    const output = join(distDir, `${skillName}.skill`);
    if (existsSync(output)) rmSync(output);
    const result = spawnSync("zip", ["-r", output, skillName, ...excludeArgs], {
      cwd: skillsDir,
      stdio: "inherit",
    });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

main();
