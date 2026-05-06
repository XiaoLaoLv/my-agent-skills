#!/usr/bin/env node

const { existsSync, readdirSync, readFileSync, statSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const skillsDir = join(root, "skills");

function parseSimpleYaml(text) {
  const result = {};
  const lines = text.split(/\r?\n/);
  let currentObject = null;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const top = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (top) {
      const [, key, raw] = top;
      if (!raw) {
        result[key] = {};
        currentObject = result[key];
      } else {
        result[key] = unquote(raw.trim());
        currentObject = null;
      }
      continue;
    }
    const nested = line.match(/^\s+([A-Za-z0-9_-]+):\s*(.*)$/);
    if (nested && currentObject) {
      currentObject[nested[1]] = unquote(nested[2].trim());
    }
  }

  return result;
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function readFrontmatter(skillMd) {
  const text = readFileSync(skillMd, "utf8");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("missing YAML frontmatter");
  return parseSimpleYaml(match[1]);
}

function validateOpenAiYaml(path) {
  const text = readFileSync(path, "utf8");
  for (const required of ["display_name:", "short_description:", "default_prompt:"]) {
    if (!text.includes(required)) throw new Error(`agents/openai.yaml missing ${required}`);
  }
}

function main() {
  if (!existsSync(skillsDir)) throw new Error(`skills directory not found: ${skillsDir}`);
  const skillNames = readdirSync(skillsDir).filter((name) => statSync(join(skillsDir, name)).isDirectory());
  if (skillNames.length === 0) throw new Error("no skills found");

  let failures = 0;
  for (const dirName of skillNames) {
    const skillDir = join(skillsDir, dirName);
    const skillMd = join(skillDir, "SKILL.md");
    try {
      if (!existsSync(skillMd)) throw new Error("SKILL.md not found");
      const frontmatter = readFrontmatter(skillMd);
      if (!frontmatter.name) throw new Error("frontmatter missing name");
      if (!frontmatter.description) throw new Error("frontmatter missing description");
      if (!/^[a-z0-9-]+$/.test(frontmatter.name)) throw new Error(`invalid skill name: ${frontmatter.name}`);
      if (frontmatter.name !== dirName) throw new Error(`directory name '${dirName}' does not match skill name '${frontmatter.name}'`);

      const openaiYaml = join(skillDir, "agents", "openai.yaml");
      if (existsSync(openaiYaml)) validateOpenAiYaml(openaiYaml);

      console.log(`OK ${frontmatter.name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${dirName}: ${error.message}`);
    }
  }

  if (failures > 0) process.exit(1);
}

main();
