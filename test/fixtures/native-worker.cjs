#!/usr/bin/env node
// Protocol onboarding is only for fixture employees. Raw Worker startup has no args.
if(process.argv.includes('--version')){process.stdout.write('native-cli 1.0.0-fixture\n');process.exit(0)}
else if(process.argv.includes('--help')){process.stdout.write('Native CLI fixture --stream-json\n');process.exit(0)}
else if(process.argv[2]==='login'&&process.argv[3]==='status'||process.argv[2]==='auth'&&process.argv[3]==='status'){process.stdout.write('{"loggedIn":true}\n');process.exit(0)}
else if(process.argv.includes('app-server'))require('./initialization-codex.cjs')
else{
 const fs=require('node:fs')
 const record=value=>fs.appendFileSync(process.env.NATIVE_WORKER_CAPTURE,JSON.stringify(value)+'\n')
 record({type:'start',pid:process.pid,argv:process.argv.slice(2),cwd:process.cwd(),keys:Object.keys(process.env),path:process.env.PATH,home:process.env.CODEX_HOME})
 process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write((process.env.NATIVE_WORKER_BRACKETED_PASTE==='0'?'':'\x1b[?2004h')+'NATIVE WORKER READY\r\n')
 process.stdin.on('data',buffer=>{const text=buffer.toString();record({type:'input',pid:process.pid,text});process.stdout.write('RAW '+text+'\r\n');if(text.includes('\x03')){process.stdout.write('NATIVE INTERRUPTED\r\n');process.exit(0)}})
}
