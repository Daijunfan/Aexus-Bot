import fs from 'node:fs'
import path from 'node:path'
import {DatabaseSync} from 'node:sqlite'

/** Only configuration/IDs and explicit user saves belong in the Mac database. */
export const CHANNEL_CONTENT_KEYS:Record<string,string>={posts:'id',media:'id',source_avatars:'source_id',channel_messages:'id',channel_message_attachments:'message_id',channel_message_notices:'message_id',channel_message_triggers:'message_id'}
export type ContentChange={table:string;key:string;sequence:number;row:Record<string,any>|null}
let disk:DatabaseSync|undefined,depth=0,loading=false
const metadataDirty=new Set<string>()
const quoted=(name:string)=>'"'+name.replaceAll('"','""')+'"'
function insert(target:DatabaseSync,table:string,row:Record<string,any>){
 const keys=Object.keys(row)
 target.prepare('INSERT OR REPLACE INTO '+quoted(table)+'('+keys.map(quoted).join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(key=>row[key]))
}
export function memoryChannelDatabase(persistent:DatabaseSync){
 disk=persistent
 const memory=new DatabaseSync(':memory:');memory.exec('PRAGMA temp_store=MEMORY;PRAGMA foreign_keys=OFF;')
 const schema=persistent.prepare("SELECT name,type,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type='index'").all() as {name:string;type:string;sql:string}[]
 for(const row of schema)memory.exec(row.sql)
 const migrated=!!persistent.prepare("SELECT 1 FROM metadata WHERE key='content_memory_migrated'").get()
 for(const row of schema.filter(row=>row.type==='table')){
  if(migrated&&CHANNEL_CONTENT_KEYS[row.name])continue
  const limit=migrated&&(CHANNEL_CONTENT_KEYS[row.name]||row.name==='channel_user_reads')?' LIMIT '+(row.name==='channel_user_reads'?1000:384):''
  for(const value of persistent.prepare('SELECT * FROM '+quoted(row.name)+limit).all()){
   insert(memory,row.name,value)
  }
 }
 memory.exec('PRAGMA foreign_keys=ON;CREATE TEMP TABLE content_dirty(table_name TEXT NOT NULL,item_key TEXT NOT NULL,sequence INTEGER PRIMARY KEY AUTOINCREMENT,UNIQUE(table_name,item_key));')
 for(const [table,key] of Object.entries(CHANNEL_CONTENT_KEYS))for(const [operation,alias] of [['INSERT','NEW'],['UPDATE','NEW'],['DELETE','OLD']]){
  memory.exec(`CREATE TEMP TRIGGER dirty_${table}_${operation} AFTER ${operation} ON ${table} BEGIN INSERT INTO content_dirty(table_name,item_key) VALUES('${table}',${alias}.${key}) ON CONFLICT(table_name,item_key) DO UPDATE SET sequence=(SELECT COALESCE(MAX(sequence),0)+1 FROM content_dirty); END;`)
 }
 memory.exec('CREATE TEMP TABLE reads_dirty(id TEXT PRIMARY KEY)')
 for(const [operation,alias] of [['INSERT','NEW'],['UPDATE','NEW'],['DELETE','OLD']])memory.exec(`CREATE TEMP TRIGGER mirror_reads_${operation} AFTER ${operation} ON channel_user_reads BEGIN INSERT OR IGNORE INTO reads_dirty VALUES(${alias}.entry_id);END`)
 persistent.exec('PRAGMA foreign_keys=OFF;')
 return memory
}
export function metadataMutation(memory:DatabaseSync,sql:string){
 const table=sql.match(/^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?([a-z_]+)/i)?.[1]
 if(!table||CHANNEL_CONTENT_KEYS[table]||table==='content_dirty'||loading)return
 metadataDirty.add(table)
 if(!depth)flushMetadata(memory)
}
function flushMetadata(memory:DatabaseSync){
 if(!disk||!metadataDirty.size)return
 disk.exec('BEGIN IMMEDIATE')
 try{for(const table of metadataDirty){if(table==='channel_user_reads'){for(const value of memory.prepare('SELECT id FROM reads_dirty').all()){const row=memory.prepare('SELECT * FROM channel_user_reads WHERE entry_id=?').get(value.id);if(row)insert(disk,table,row);else disk.prepare('DELETE FROM channel_user_reads WHERE entry_id=?').run(value.id)}memory.exec('DELETE FROM reads_dirty');continue}disk.exec('DELETE FROM '+quoted(table));for(const row of memory.prepare('SELECT * FROM '+quoted(table)).all())insert(disk,table,row)}disk.exec('COMMIT');metadataDirty.clear()}catch(error){disk.exec('ROLLBACK');throw error}
}
export function metadataTransaction(memory:DatabaseSync,work:()=>any){
 const previous=new Set(metadataDirty);depth++;memory.exec('BEGIN IMMEDIATE')
 let value:any
 try{value=work();memory.exec('COMMIT')}catch(error){memory.exec('ROLLBACK');metadataDirty.clear();for(const table of previous)metadataDirty.add(table);throw error}finally{depth--}
 if(!depth)flushMetadata(memory);return value
}
export function contentChanges(memory:DatabaseSync):ContentChange[]{return (memory.prepare('SELECT * FROM content_dirty ORDER BY sequence').all() as any[]).map(change=>({table:change.table_name,key:change.item_key,sequence:change.sequence,row:memory.prepare('SELECT * FROM '+quoted(change.table_name)+' WHERE '+quoted(CHANNEL_CONTENT_KEYS[change.table_name])+'=?').get(change.item_key) as any??null}))}
export function acknowledgeContent(memory:DatabaseSync,changes:ContentChange[]){for(const change of changes)memory.prepare('DELETE FROM content_dirty WHERE table_name=? AND item_key=? AND sequence=?').run(change.table,change.key,change.sequence)}
/** Drop only clean RAM cache rows; these deletes never become archive mutations. */
export function forgetCachedPosts(memory:DatabaseSync,ids:string[]){
 for(const id of ids){
  const media=memory.prepare('SELECT id FROM media WHERE post_id=?').all(id) as {id:string}[]
  if(memory.prepare("SELECT 1 FROM content_dirty WHERE (table_name='posts' AND item_key=?) OR (table_name='media' AND item_key IN (SELECT id FROM media WHERE post_id=?))").get(id,id))continue
  memory.prepare('DELETE FROM media WHERE post_id=?').run(id);memory.prepare('DELETE FROM posts WHERE id=?').run(id)
  memory.prepare("DELETE FROM content_dirty WHERE table_name='posts' AND item_key=?").run(id)
  for(const row of media)memory.prepare("DELETE FROM content_dirty WHERE table_name='media' AND item_key=?").run(row.id)
 }
}
export function hydrateContent(memory:DatabaseSync,rows:{table:string;row:Record<string,any>}[]){
 loading=true;memory.exec('PRAGMA foreign_keys=OFF')
 try{for(const {table,row} of rows){if(!CHANNEL_CONTENT_KEYS[table])throw Error('Unknown remote content table');const key=String(row[CHANNEL_CONTENT_KEYS[table]]);if(memory.prepare('SELECT 1 FROM content_dirty WHERE table_name=? AND item_key=?').get(table,key))continue;insert(memory,table,row);memory.prepare('DELETE FROM content_dirty WHERE table_name=? AND item_key=?').run(table,key)}}finally{memory.exec('PRAGMA foreign_keys=ON');loading=false}
}
export function readPersistedReads(offset:number,limit:number){return disk?.prepare('SELECT * FROM channel_user_reads ORDER BY entry_id LIMIT ? OFFSET ?').all(limit,offset)??[]}
export function markChannelContent(memory:DatabaseSync){for(const [table,key] of Object.entries(CHANNEL_CONTENT_KEYS))memory.exec(`INSERT OR IGNORE INTO content_dirty(table_name,item_key) SELECT '${table}',${key} FROM ${table}`)}
export function persistSavedPost(memory:DatabaseSync,id:string,mediaDirectory?:string){
 if(!disk)throw Error('Channel database is not initialized')
 const post=memory.prepare('SELECT * FROM posts WHERE id=?').get(id) as any,old=disk.prepare('SELECT file FROM media WHERE post_id=?').all(id) as {file:string}[]
 disk.prepare('DELETE FROM posts WHERE id=?').run(id);disk.prepare('DELETE FROM media WHERE post_id=?').run(id)
 if(post&&post.state==='active'&&post.saved_at!==null){insert(disk,'posts',post);for(const row of memory.prepare('SELECT * FROM media WHERE post_id=?').all(id))insert(disk,'media',row);const avatar=memory.prepare('SELECT * FROM source_avatars WHERE source_id=?').get(post.source_id);if(avatar)insert(disk,'source_avatars',avatar)}
 else if(mediaDirectory)for(const row of old){if(!disk.prepare('SELECT 1 FROM media WHERE file=?').get(row.file)){const file=path.resolve(mediaDirectory,row.file);if(path.dirname(file)===path.resolve(mediaDirectory))fs.rmSync(file,{force:true})}}
 disk.exec('DELETE FROM source_avatars WHERE source_id NOT IN (SELECT source_id FROM posts);PRAGMA wal_checkpoint(TRUNCATE)')
}
export function purgeUnsavedDiskContent(mediaDirectory:string,savedMessageIds:string[]=[]){
 if(!disk)throw Error('Channel database is not initialized')
 const obsolete=disk.prepare('SELECT file FROM media WHERE post_id NOT IN (SELECT id FROM posts WHERE saved_at IS NOT NULL)').all() as {file:string}[]
 disk.exec("CREATE TEMP TABLE saved_channel_messages(id TEXT PRIMARY KEY)")
 for(const id of savedMessageIds)disk.prepare('INSERT OR IGNORE INTO saved_channel_messages VALUES(?)').run(id)
 disk.exec("DELETE FROM posts WHERE saved_at IS NULL;DELETE FROM media WHERE post_id NOT IN (SELECT id FROM posts);DELETE FROM source_avatars WHERE source_id NOT IN (SELECT source_id FROM posts);DELETE FROM channel_messages WHERE id NOT IN (SELECT id FROM saved_channel_messages);DELETE FROM channel_message_attachments WHERE message_id NOT IN (SELECT id FROM channel_messages);DELETE FROM channel_message_notices WHERE message_id NOT IN (SELECT id FROM channel_messages);DELETE FROM channel_message_triggers;DROP TABLE saved_channel_messages;PRAGMA wal_checkpoint(TRUNCATE);VACUUM;PRAGMA wal_checkpoint(TRUNCATE);")
 for(const row of obsolete){const file=path.resolve(mediaDirectory,row.file);if(path.dirname(file)===path.resolve(mediaDirectory))fs.rmSync(file,{force:true})}
}
export function persistSavedChannelMessage(memory:DatabaseSync,id:string,saved:boolean){
 if(!disk)throw Error('Channel database is not initialized')
 for(const table of ['channel_message_attachments','channel_message_notices'])disk.prepare('DELETE FROM '+quoted(table)+' WHERE message_id=?').run(id)
 disk.prepare('DELETE FROM channel_messages WHERE id=?').run(id)
 if(saved){const message=memory.prepare('SELECT * FROM channel_messages WHERE id=?').get(id);if(!message)throw Error('Unknown channel message');insert(disk,'channel_messages',message);for(const table of ['channel_message_attachments','channel_message_notices'])for(const row of memory.prepare('SELECT * FROM '+quoted(table)+' WHERE message_id=?').all(id))insert(disk,table,row)}
 disk.exec('PRAGMA wal_checkpoint(TRUNCATE)')
}
export function closeChannelPersistence(){disk?.close();disk=undefined;metadataDirty.clear();depth=0}
