import assert from 'node:assert/strict'
import {mentionAt,mentionLabels,mentionTargets} from '../src/renderer/src/chat/useMentionPicker.ts'

const members=[{id:'hua',title:'小花'},{id:'wang',title:'小王'},{id:'a',title:'Ann'},{id:'ab',title:'Anna'},{id:'name',title:'John Doe'}]
assert.deepEqual(mentionTargets('小花，你和@小王 去调研一下',['wang'],members),['wang'])
assert.deepEqual(mentionTargets('小花，你和小王去调研一下',['wang'],members),[])
assert.deepEqual(mentionTargets('@小花 与＠小王 一起调研',['hua','wang'],members),['hua','wang'])
assert.deepEqual(mentionTargets('@Anna',['a','ab'],members),['ab'])
assert.deepEqual(mentionTargets('@John Doe 整理结论',['name'],members),['name'])
assert.equal(mentionTargets('请@all 一起检查',['wang'],members),'all')
assert.deepEqual(mentionTargets('请@小王 整理','all',members),['wang'])
assert.deepEqual(mentionTargets('普通文字','all',members),[])
assert.deepEqual(mentionTargets('@小王 是字面文字，尚未选择员工',[],members),[])
assert.deepEqual(mentionLabels(['name','wang'],members),['小王','John Doe'])
const draft='小花，你和@小去调研一下',caret=draft.indexOf('@')+2
assert.deepEqual(mentionAt(draft,caret),{start:draft.indexOf('@'),end:caret,query:'小'})
console.log('PASS inline mention routing: positions, deleted tags, stable IDs, full-width tags, spaced names, longest-name matching and @all')
