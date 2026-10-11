// Compare this rule alone on retained registry metadata; no server is contacted.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [baselineRoot,output]=process.argv.slice(2);
const before=(await import(pathToFileURL(resolve(baselineRoot,'dist/core/rules/descriptions.js')))).enumUnexplained;
const after=(await import('../../dist/core/rules/descriptions.js')).enumUnexplained;
const {collectFile,resolveConfig}=await import('../../dist/index.js');
const config=resolveConfig({file:{}});const groups=[];
for(const [group,manifestName] of [['servers','manifest.json'],['heldout','manifest-heldout.json']]) {
 const root=resolve('studies/registry-census/cache',group);const rows=[];
 const manifest=JSON.parse(await readFile(resolve('studies/registry-census',manifestName),'utf8'));
 for(const server of manifest.servers.filter(server=>server.tools).sort((a,b)=>a.name.localeCompare(b.name))) {
  const filename=createHash('sha1').update(server.name).digest('hex')+'.json';
  const path=resolve(root,filename);const bytes=await readFile(path);const raw=JSON.parse(bytes);
  if(!Array.isArray(raw.tools)||!raw.tools.length)throw new Error(`Missing tool snapshot for ${server.name}`);
  const target=await collectFile(path,raw.qualifiedName??filename);
  const ctx={target,config};let previous;
  try{previous=before.check(ctx);}catch(error){previous={error:error.name,message:error.message};}
  const current=after.check(ctx);
  const keys=rows=>rows.map(f=>`${f.subject.name}/${f.message.match(/^Parameter "([^"]+)"/)?.[1]}`).sort();
  const changed=!Array.isArray(previous)||JSON.stringify(keys(previous))!==JSON.stringify(keys(current));
  rows.push({name:raw.qualifiedName??filename,inputSha256:createHash('sha256').update(bytes).digest('hex'),tools:target.tools.length,
    before:Array.isArray(previous)?previous.length:previous,after:current.length,
    ...(changed?{changed:true,previous,current,evidence:target.tools.filter(t=>{
      const names=new Set([...(Array.isArray(previous)?previous:[]),...current].map(f=>f.subject.name));return names.has(t.name);
    }).map(t=>({name:t.name,properties:t.inputSchema?.properties}))}:{})});
 }
 groups.push({group,servers:rows.length,tools:rows.reduce((n,r)=>n+r.tools,0),beforeFindings:rows.reduce((n,r)=>n+(typeof r.before==='number'?r.before:0),0),beforeFailures:rows.filter(r=>typeof r.before!=='number').length,afterFindings:rows.reduce((n,r)=>n+r.after,0),changedServers:rows.filter(r=>r.changed).length,rows});
}
const summaries=groups.map(({rows,...summary})=>({
 ...summary,
 inputManifestSha256:createHash('sha256').update(JSON.stringify(rows.map(row=>[row.name,row.inputSha256]))).digest('hex'),
 changes:rows.filter(row=>row.changed).map(row=>{
  const key=f=>`${f.subject.name}/${f.message.match(/^Parameter "([^"]+)"/)?.[1]}`;
  const old=new Set(Array.isArray(row.previous)?row.previous.map(key):[]);const next=new Set(row.current.map(key));
  const removed=[...old].filter(k=>!next.has(k));const added=[...next].filter(k=>!old.has(k));
  const changed=new Set([...removed,...added]);
  return {name:row.name,inputSha256:row.inputSha256,removed,added,evidence:row.evidence.flatMap(tool=>
   Object.entries(tool.properties??{}).filter(([name])=>changed.has(`${tool.name}/${name}`))
    .map(([name,prop])=>({tool:tool.name,parameter:name,enum:prop.enum,description:prop.description??null})))};
 })
}));
await writeFile(output,JSON.stringify({scope:'Retained registry snapshots, this informational rule only. No model behavior or production usage is measured.',groups:summaries},null,2)+'\n');
console.log(groups.map(({rows,...summary})=>summary));
