import { extractScholarpush } from "./scholarpush.js";
import { extractModelswatch } from "./modelswatch.js";
import { extractAiradar } from "./airadar.js";
import { extractSiteDocs } from "./site-docs.js";

const EXTRACTORS = {
  scholarpush: extractScholarpush,
  modelswatch_gh: (ctx) => extractModelswatch({ ...ctx, flavour: "github" }),
  modelswatch_hf: (ctx) => extractModelswatch({ ...ctx, flavour: "huggingface" }),
  airadar: extractAiradar,
  site_docs: extractSiteDocs,
};

export function getExtractor(id) {
  const fn = EXTRACTORS[id];
  if (!fn) {
    throw new Error(`No extractor registered for source id "${id}"`);
  }
  return fn;
}
