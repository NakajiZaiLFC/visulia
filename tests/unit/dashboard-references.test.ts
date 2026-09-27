import test from 'node:test';
import assert from 'node:assert/strict';
import {rewriteRunReference} from '../../src/dashboard/references.js';
const old='visulia-old',next='visulia-new';
test('quoted FROM sources are portable while filter literals and comments are unchanged',()=>{
 const query='// visulia-old\nFROM "visulia-old", another METADATA _id | WHERE event.original == "visulia-old" /* visulia-old */';
 assert.equal(rewriteRunReference(query,old,next).query,'// visulia-old\nFROM visulia-new, another METADATA _id | WHERE event.original == "visulia-old" /* visulia-old */');
});
test('unsupported non-FROM index references fail instead of retaining an old run silently',()=>{
 assert.throws(()=>rewriteRunReference('FROM visulia-old | LOOKUP JOIN visulia-old ON id',old,next),/UNSUPPORTED_QUERY_TEMPLATE/);
 assert.equal(rewriteRunReference('FROM visulia-old-extra | KEEP id',old,next).matched,false);
});
