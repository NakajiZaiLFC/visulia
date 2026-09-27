/** Rewrite exact FROM source tokens only. String literals/comments are not references.
 * Other occurrences as unquoted identifiers are rejected rather than guessed. */
export function rewriteRunReference(query:string,from:string,to:string):{query:string;matched:boolean}{
 const tokenPattern=/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:``|[^`])*`|[A-Za-z0-9_.*:{}-]+|[^\s]/g;
 let first=true,inFrom=false;
 const edits:{start:number;end:number}[]=[];
 for(const match of query.matchAll(tokenPattern)){
  const text=match[0],start=match.index!;
  if(text.startsWith('//')||text.startsWith('/*'))continue;
  if(first){first=false;inFrom=text.toUpperCase()==='FROM';if(inFrom)continue;}
  if(text==='|'||text.toUpperCase()==='METADATA')inFrom=false;
  const quoted=['"',"'",'`'].includes(text[0]!);
  const value=quoted?text.slice(1,-1):text;
  if(value!==from)continue;
  if(inFrom)edits.push({start,end:start+text.length});
  else if(!quoted)throw new Error('UNSUPPORTED_QUERY_TEMPLATE');
 }
 for(const edit of edits.reverse())query=query.slice(0,edit.start)+to+query.slice(edit.end);
 return {query,matched:edits.length>0};
}
