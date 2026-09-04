import { promoteCase } from "./lib/publish.mjs";
import { formatError, StartupError } from "./lib/errors.mjs";
import path from "node:path";

function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
const draftPath = arg("--draft");
const outputRoot = arg("--output-root");

async function main() {
  if (!draftPath) throw new StartupError("--draft path is required", "ARGUMENTS");
  const root = outputRoot ? path.resolve(outputRoot) : path.resolve("data/ai/startup");
  const result = await promoteCase({ draftPath: path.resolve(draftPath), caseRoot: path.join(root, "cases"), indexPath: path.join(root, "cases/index.json") });
  console.log(`Case promoted: ${result.finalPath}`);
}

main().catch((error) => { console.error(`Startup case promotion failed: ${formatError(error)}`); process.exitCode = 1; });
