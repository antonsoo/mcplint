import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const [directory,out]=process.argv.slice(2);
const {SseMessageBounds}=await import(pathToFileURL(resolve(directory,'collectors/sse-bounds.js')));
const records=[];
for(const ending of ['\n','\r','\r\n']) for(const size of [16384,65536,262144,1048576]) {
 const unit=Buffer.from(':'+ending);
 const bytes=Buffer.alloc(unit.length*Math.floor(size/unit.length));
 for(let i=0;i<bytes.length;i+=unit.length) unit.copy(bytes,i);
 const samples=[];
 for(let r=0;r<3;r++) {const start=performance.now();new SseMessageBounds(10*1024*1024,()=>{throw Error('limit')}).feed(bytes);samples.push(performance.now()-start);}
 const median=[...samples].sort((a,b)=>a-b)[1];
 const record={ending:JSON.stringify(ending),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),samplesMs:samples,medianMs:median};records.push(record);console.log(JSON.stringify(record));
}
await writeFile(out,JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,scope:'SseMessageBounds.feed, 3 repetitions, synthetic valid comment lines; concurrent host load',records},null,2)+'\n');
