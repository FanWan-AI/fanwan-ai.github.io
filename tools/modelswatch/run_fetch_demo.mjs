#!/usr/bin/env node
import { fetchHFTop } from './fetch_hf.js';
import { fetchGithubTop } from './fetch_github.js';
import { info, debug } from './log.js';

async function run(){
  try{
    info('Running HF fetch with MODELSWATCH_HF_LIMIT=' + (process.env.MODELSWATCH_HF_LIMIT || '(unset)'));
    const hf = await fetchHFTop();
    info('HF items fetched:', Array.isArray(hf) ? hf.length : 'NA');
  }catch(e){
    console.error('HF fetch failed:', e && e.message || e);
  }
  try{
    info('Running GitHub fetch with MODELSWATCH_GH_PER_PAGE=' + (process.env.MODELSWATCH_GH_PER_PAGE || '(unset)'));
    const gh = await fetchGithubTop();
    info('GitHub items fetched:', Array.isArray(gh) ? gh.length : 'NA');
  }catch(e){
    console.error('GitHub fetch failed:', e && e.message || e);
  }
}

if (process.argv[1] && process.argv[1].endsWith('run_fetch_demo.mjs')) run();
