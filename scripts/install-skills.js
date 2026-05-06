#!/usr/bin/env node

const { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } = require("node:fs");
const { homedir } = require("node:os");
const { join, resolve } = require("node:path");

const root = join(__dirname, "..");
const skillsDir = join(root, "skills");
const defaultTarget = join(homedir(), ".agents", "skills");
const targetDir = resolve(process.argv[2] || process.env.AGENT_SKILLS_DIR || defaultTarget);

function main() {
  if (!existsSync(skillsDir)) throw new Error(`skills directory not found: ${skillsDir}`);
  mkdirSync(targetDir, { recursive: true });

  const skillNames = readdirSync(skillsDir).filter((name) => statSync(join(skillsDir, name)).isDirectory());
  if (skillNames.length === 0) throw new Error("no skills found");

  for (const skillName of skillNames) {
    const source = join(skillsDir, skillName);
    const target = join(targetDir, skillName);
    rmSync(target, { recursive: true, force: true });
    cpSync(source, target, {
      recursive: true,
      filter: (path) => !path.split(/[/\\]/).includes("node_modules") && !path.endsWith(".DS_Store"),
    });
    console.log(`Installed ${skillName} -> ${target}`);
  }
}

main();
