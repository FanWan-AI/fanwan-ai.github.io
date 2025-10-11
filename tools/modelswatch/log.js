// Model Watch logging helper
// Enable verbose debug logs by setting MODELSWATCH_DEBUG=1|true|yes|on
import util from 'util';
const DEBUG = /^(1|true|yes|on)$/i.test(process.env.MODELSWATCH_DEBUG || '');
function ts(){ return new Date().toISOString(); }

function formatMsg(level, args){
	try {
		const msg = args && args.length ? util.format(...args) : '';
		return `[modelswatch][${level}][${ts()}] ${msg}`.trim();
	} catch {
		return `[modelswatch][${level}][${ts()}]`;
	}
}

export function debug(...args){ if(DEBUG) console.debug(formatMsg('debug', args)); }
export function info(...args){ console.log(formatMsg('info', args)); }
export function warn(...args){ console.warn(formatMsg('warn', args)); }
export function error(...args){ console.error(formatMsg('error', args)); }
export function summary(label, obj){ if(DEBUG) console.debug(`[modelswatch][debug][${ts()}] ${label}:`, JSON.stringify(obj, null, 2)); }
export default { debug, info, warn, error, summary };
