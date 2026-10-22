// Explicit diagnostic-only cloud relay. The existing ingest service is not deployed or changed.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function buildCloudInterfaces({env, build}, relay, interfaces) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(env || '') || !/^[a-zA-Z0-9_.-]{1,100}$/.test(build || '')) throw Error('Explicit cloud environment and unique build label required');
  return `(function(){var module={exports:{}};\n${relay}\nvar config=${JSON.stringify({enabled:true,env,build,functionName:'phoneLogIngest'})};
config.keep=function(level,text){return /^(?:PHONE_LOG_START |\\[WXSLIM_(?:BOOT|RENDER_SUMMARY|FRAME_PROBE)\\])/.test(text);};
var api=module.exports.installPhoneLog(wx,console,config);
if(api){setTimeout(function(){api.flush();},20000);setTimeout(function(){api.stop();console.info('[WXSLIM_CLOUD_RELAY] bounded capture stopped');},60000);}
else console.warn('[WXSLIM_CLOUD_RELAY] unavailable; game continues');
})();\n${interfaces}`;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2), value=key=>args[args.indexOf(key)+1];
    if(args.length!==4 || !args.includes('--config') || !args.includes('--out')) throw Error('Use --config <private JSON> --out <new interfaces.js>');
    const config=JSON.parse(fs.readFileSync(value('--config'),'utf8'));
    const output=buildCloudInterfaces(config,fs.readFileSync(new URL('../../split/assets/phone-log.js',import.meta.url),'utf8'),fs.readFileSync(new URL('./local-interfaces.js',import.meta.url),'utf8'));
    fs.writeFileSync(value('--out'),output,{flag:'wx'});
  } catch(error){ console.error(error.message);process.exitCode=1; }
}
