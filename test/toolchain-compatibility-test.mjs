// Exercise the actual downstream consumers retained by security dependency overrides.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {micromark} from 'micromark'
import {math,mathHtml} from 'micromark-extension-math'

const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..')
const {FileMatcher}=require('app-builder-lib/out/fileMatcher'),{createFilter}=require('app-builder-lib/out/util/filter')
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),matcher=new FileMatcher(root,path.join(root,'out'),value=>value,pkg.build.files),patterns=[]
matcher.computeParsedPatterns(patterns)
const allowed=createFilter(root,patterns),file={isDirectory:()=>false}
for(const relative of ['out/main/index.js','out/renderer/index.html','bin/agents','API.md','docs/KNOWLEDGE_CHANNELS.md'])assert.equal(allowed(path.join(root,relative),file),true,'Required package resource: '+relative)
for(const relative of ['image.png','sources.md','workspaces/private.md','.env'])assert.equal(allowed(path.join(root,relative),file),false,'Private working file: '+relative)

const universal=createRequire(require.resolve('@electron/universal/package.json'))('minimatch')
assert.equal(universal.minimatch('nested/native-arm64.node','native-*.node',{matchBase:true}),true)
assert.equal(universal.minimatch('nested/native-x64.node','native-arm64.node',{matchBase:true}),false)
const html=micromark('Inline $x^2 + y^2$\n\n$$\n\\frac{1}{2}\\pi\n$$\n',{extensions:[math()],htmlExtensions:[mathHtml()]})
assert.ok(html.includes('class="katex"'));assert.ok(html.includes('katex-display'));assert.ok(!html.includes('katex-error'))
console.log('PASS actual builder resource/private-file filtering, native basename allowlists and complete math rendering with patched dependency APIs')
