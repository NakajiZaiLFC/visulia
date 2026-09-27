import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {exportRunTemplate} from '../../src/cli/templates.js';
test('template export copies only configuration and refuses to overwrite a local file',async t=>{
 const root=await mkdtemp(join(tmpdir(),'visulia-template-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const config={metadata:{format:'pipe-v1'},parser:'. = {}',mapping:{dynamic:'strict'}};
 const file=join(root,'config.json');
 await exportRunTemplate(file,{config,token:'must-not-export',state:'checked'});
 assert.deepEqual(JSON.parse(await readFile(file,'utf8')),config);
 assert.equal((await stat(file)).mode&0o777,0o600);
 await assert.rejects(exportRunTemplate(file,{config:{...config,parser:'changed'}}),/TEMPLATE_EXISTS/);
 assert.deepEqual(JSON.parse(await readFile(file,'utf8')),config);
});
