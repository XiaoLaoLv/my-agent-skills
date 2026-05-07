#!/usr/bin/env node

const { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } = require("node:fs");
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
    const envFile = join(target, ".env");
    const existingEnv = existsSync(envFile) ? readFileSync(envFile) : null;

    rmSync(target, { recursive: true, force: true });
    cpSync(source, target, {
      recursive: true,
      filter: (path) => {
        const parts = path.split(/[/\\]/);
        return !parts.includes("node_modules") && !path.endsWith(".DS_Store") && !path.endsWith(`${skillName}/.env`);
      },
    });
    const envExample = join(target, ".env.example");
    if (existingEnv) {
      writeFileSync(envFile, existingEnv, { mode: 0o600 });
      console.log(`  Preserved existing ${envFile}`);
    } else if (existsSync(envExample)) {
      copyFileSync(envExample, envFile);
      console.log(`  Created ${envFile}; please fill in required secrets.`);
    }
    console.log(`Installed ${skillName} -> ${target}`);
  }
}

main();
