// Re-read retained scratch files independently of the live drive's renderer
// and numeric-line extractor. Answers may contain prose; these files may not.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile,readdir,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('../docs/user-session/',import.meta.url))
const good=Array.from({length:500},(_,i)=>String(i+1)).join('\n')
function exact(text){return text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').replace(/\n$/,'')===good}
assert.ok(exact(good+'\n'))
assert.ok(exact('\uFEFF'+good.replace(/\n/g,'\r\n')+'\r\n'))
assert.equal(exact(''),false)
assert.equal(exact(good+'\nunrequested prose'),false)
assert.equal(exact(good.replace('\n237\n','\n238\n')),false)
const names=(await readdir(root)).filter(n=>/^2026-09-(09|10)T.*-frontier-accept-edits-\d+$/.test(n)).sort()
assert.ok(names.length>0,'No write sessions; cannot conclude')
const checks=[]
for(const name of names){
  const d=JSON.parse(await readFile(join(root,name,'measurement.json'),'utf8'))
  if(d.error)continue // Harness-cancelled batches are NOT completed write tests.
  for(const w of d.writes){
    const expected=d.cards.find(c=>c.name===w.name)?.phase!=='did not start'
    const path=join(d.workspace,w.name+'.txt')
    try{
      const text=await readFile(path,'utf8')
      checks.push({session:name,file:w.name+'.txt',expected,exactLines:exact(text),sha256:createHash('sha256').update(text).digest('hex')})
    }catch(error){
      if(error.code!=='ENOENT')throw error
      checks.push({session:name,file:w.name+'.txt',expected,missing:true,exactLines:false})
    }
  }
}
assert.ok(checks.some(c=>c.exactLines),'No successful file control')
const report={checkedAt:new Date().toISOString(),checks,
  // Revision-1 solo refused the assignment. Retain its failure, do not let it
  // contaminate the revision-2 stress verdict or disappear from the record.
  failures:checks.filter(c=>c.expected&&!c.exactLines)}
console.log(JSON.stringify(report,null,2))
if(process.argv.includes('--save'))await writeFile(new URL('../docs/cap-frontier-file-recheck-2026-09-09.json',import.meta.url),JSON.stringify(report,null,2)+'\n')
if(report.failures.length)process.exitCode=1
