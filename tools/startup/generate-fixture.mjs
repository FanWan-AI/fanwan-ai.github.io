import os from "node:os";
import path from "node:path";
import { buildFixture } from "./lib/fixtures.mjs";
import { publishDaily, promoteCase, validatePublicPaths, writeCaseDraft } from "./lib/publish.mjs";
import { deterministicCaseVerification, deterministicDailyVerification } from "./lib/verify.mjs";
import { formatError } from "./lib/errors.mjs";

function arg(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }

async function main() {
  const outputRoot = path.resolve(arg("--output-root") || await (async () => path.join(os.tmpdir(), `fanwan-ai-startup-fixture-${Date.now()}`))());
  const { daily, case: caseDocument } = buildFixture();
  const dailyCheck = deterministicDailyVerification(daily);
  if (!dailyCheck.approved) throw new Error(`Fixture daily unexpectedly failed: ${dailyCheck.issues.join("; ")}`);
  await publishDaily(daily, { outputPath: path.join(outputRoot, "opportunities/latest.json"), archiveDir: path.join(outputRoot, "opportunities/archive") });
  const caseCheck = deterministicCaseVerification(caseDocument);
  if (!caseCheck.approved) throw new Error(`Fixture case unexpectedly failed: ${caseCheck.issues.join("; ")}`);
  const draftPath = path.join(outputRoot, "cases/drafts", `${caseDocument.slug}.json`);
  await writeCaseDraft(caseDocument, draftPath);
  await promoteCase({ draftPath, caseRoot: path.join(outputRoot, "cases"), indexPath: path.join(outputRoot, "cases/index.json") });
  const checked = await validatePublicPaths({ opportunityPath: path.join(outputRoot, "opportunities/latest.json"), indexPath: path.join(outputRoot, "cases/index.json"), caseRoot: path.join(outputRoot, "cases") });
  console.log(`Offline startup fixture passed (${checked.length} public files): ${outputRoot}`);
}

main().catch((error) => { console.error(`Startup fixture failed: ${formatError(error)}`); process.exitCode = 1; });
