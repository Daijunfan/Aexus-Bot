"use strict";
// Real OS PTY tests (Python stdlib only). No real library, browser or model turns.
const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path"),
  { spawn } = require("node:child_process"),
  assert = require("node:assert/strict");
const python = String.raw`
import re,os,sys,pty,subprocess,termios,fcntl,struct,signal,time,select,json
root,workspace,node,record=sys.argv[1:]
code="""const {createPlugin}=require('./runtime.cjs');const {runTui}=require('./tui/index.cjs');(async()=>{const client=await createPlugin({workspace:process.argv[1]});try{if(process.env.TUI_INIT_FAIL){const request=client.request.bind(client);client.request=r=>r.method==='fs.list'?Promise.resolve({error:{message:'PTY initialization failure',data:{code:'INIT_FAILURE'}}}):request(r);}if(process.env.TUI_CRASH)setTimeout(()=>{throw Error('PTY intentional exception')},350);await runTui({client,workspace:process.argv[1],input:process.stdin,output:process.stdout,errorOutput:process.stderr});}finally{await client.close();}})().catch(e=>{console.error(e.message);process.exitCode=1});"""
def run(mode):
 if mode=='long':
  with open(os.path.join(workspace,'long.html'),'w',encoding='utf8') as f:f.write('<p>'+'龙'*13000+'</p>')
 master,slave=pty.openpty()
 before=termios.tcgetattr(slave)
 def resize(cols,rows):
  fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',rows,cols,0,0))
 resize(132,30)
 env=dict(os.environ,TERM='xterm-256color',NO_COLOR='1')
 if mode=='exception':env['TUI_CRASH']='1'
 if mode=='init-failure':env['TUI_INIT_FAIL']='1'
 p=subprocess.Popen([node,'-e',code,workspace],cwd=root,stdin=slave,stdout=slave,stderr=slave,env=env)
 data=b'';events=[];begin=time.monotonic()
 def pump(timeout=.03):
  nonlocal data
  if select.select([master],[],[],timeout)[0]:
   try:chunk=os.read(master,65536)
   except OSError:return
   data+=chunk;events.append([round(time.monotonic()-begin,4),'o',chunk.decode('utf8','replace')])
 def wait(text,mark=0,seconds=15,absent=None):
  until=time.monotonic()+seconds
  while time.monotonic()<until:
   frame=data[mark:].rsplit(b'\x1b[H',1)[-1]
   if text.encode() in frame and b'[PENDING]' not in frame and frame.endswith(b'\x1b[J') and (absent is None or absent.encode() not in frame):return
   if p.poll() is not None:raise AssertionError('process exited waiting '+text+' tail '+data[-1800:].decode('utf8','replace'))
   pump()
  raise AssertionError('timeout waiting '+text+' absent '+str(absent)+' offsets '+str(re.findall('UTF16[^\r\n]+',data.decode('utf8','replace'))[-8:])+' tail '+data[-1800:].decode('utf8','replace'))
 def send(keys,text=None,absent=None):
  mark=len(data);os.write(master,keys.encode());events.append([round(time.monotonic()-begin,4),'i',keys])
  if text:wait(text,mark,absent=absent)
  else:
   end=time.monotonic()+.10
   while time.monotonic()<end:pump(.01)
  if os.environ.get('MR_TUI_PTY_DEBUG'):print(repr(keys),re.findall('Focus[^\r\n]+',data.decode('utf8','replace'))[-1:],flush=True)
 try:
  if mode!='init-failure':wait('Ready / 就绪')
  if mode=='workflow':
   wait('中文.html')
   send('\r','Focus Read 阅读')
   send('/','Search text');send('目标');send('\r','Search results');send('\r','Focus Read 阅读',absent='Search results');send('\x1b[1~')
   send('v')
   send('\x1b[C');send('\x1b[C')
   send('c','Excerpt preview')
   send('n','Excerpt note');send('PTY初始批注');send('\r','Excerpt preview')
   send('t','Excerpt tags');send('终端, 摘录');send('\r','Excerpt preview')
   send('s','Excerpt style');send('\x1b[B');send('\x1b[B');send('\r','Excerpt preview')
   send('\r','Study set')
   send('\r','New study title')
   send('PTY学习集')
   send('\r','Confirm target')
   send('\r','1 cards')
   # Keyboard-only note edit, parent creation and subtree move.
   send('n','Edit note')
   assert 'PTY初始批注' in data.rsplit(b'\x1b[H',1)[-1].decode('utf8','replace')
   send('\x15')
   send('\x1b[200~PTY中文笔记\r\n第二行🙂👩‍👩‍👧‍👦 é\x1b[201~','Pasted into draft')
   frame=data.rsplit(b'\x1b[H',1)[-1].decode('utf8','replace')
   assert 'Edit note' in frame and '第二行🙂👩‍👩‍👧‍👦 é' in frame,frame
   send('\n');send('第三行 Ctrl-J');send('\r','Saved')
   send('N','New note title');send('PTY父节点');send('\r','2 cards')
   # A queued editor frame can still carry the previous operation's Saved
   # status. Require the editor to disappear before issuing the next input.
   send(' ','Edit title');send('\r','Saved',absent='Edit title')
   send('\x1b[200~qSNR\x1b[201~','Paste requires')
   send('m','Move subtree');send('\x1b[B');send('\r','Saved',absent='Move subtree')
   send('g','┌ SPACE 空间脑图')
   send('\t','Focus Library 文库')
   assert '┌ SPACE 空间脑图'.encode() not in data.rsplit(b'\x1b[H',1)[-1]
   send('g','┌ SPACE 空间脑图')
   send('\x1b[Z','Focus Read 阅读')
   assert '┌ SPACE 空间脑图'.encode() not in data.rsplit(b'\x1b[H',1)[-1]
   send('g','┌ SPACE 空间脑图');send('+');send('H');send('0');send('\x1b[C')
   if record:
    frame=data.rsplit(b'\x1b[H',1)[-1].split(b'\x1b[J',1)[0].decode('utf8','replace').replace('\r','')
    with open(record.replace('.cast','-map.txt'),'w') as f:f.write(frame+'\n')
   send('/','Search all cards');send('中文');send('\r','┌ SPACE 空间脑图')
   send('o','Focus Read 阅读');send('\x1b','┌ SPACE 空间脑图')
   # Resize through narrow and tiny, preserving reading/model state.
   resize(64,18);os.kill(p.pid,signal.SIGWINCH);wait('MarginReader',len(data))
   resize(28,7);os.kill(p.pid,signal.SIGWINCH);wait('Resize to at least',len(data))
   resize(132,30);os.kill(p.pid,signal.SIGWINCH);wait('┌ SPACE 空间脑图',len(data))
   send('g','Focus Knowledge 知识')
   send('a','Saved')
   send('R','Resume saved session');send('\x1b[B');send('\r','FSRS REVIEW')
   send('\t','Focus Library 文库')
   assert b'FSRS REVIEW' not in data.rsplit(b'\x1b[H',1)[-1]
   send('R','Resume saved session');send('\r','FSRS REVIEW')
   send('\x1b[Z','Focus Read 阅读')
   assert b'FSRS REVIEW' not in data.rsplit(b'\x1b[H',1)[-1]
   send('R','Resume saved session');send('\r','FSRS REVIEW')
   send('3','Reveal answer before grading')
   send(' ','ANSWER')
   send('3','1 / 1')
   send('u','0 / 1');send('U','1 / 1')
   send('q')
  elif mode=='long':
   wait('long.html')
   if not re.search(rb'>\s+long\.html',data.rsplit(b'\x1b[H',1)[-1]):send('\x1b[B')
   send('\r','Focus Read 阅读')
   send('v')
   send('\x1b[4~','SELECT')
   send('c','Selection exceeds 12000')
   assert b'Excerpt preview' not in data.rsplit(b'\x1b[H',1)[-1]
   send('\x1b[1~','SELECT')
   send('v')
   send('\x1b[1;2C','SELECT')
   send('c','Excerpt preview')
   send('\x1b','Cancelled')
   send('!','Recover drafts')
   send('\r','Excerpt preview')
   send('\x1b','Cancelled')
   send('q','Unsaved drafts')
   send('\x1b[B')
   send('\r')
  elif mode in ('SIGINT','SIGTERM'):
   os.kill(p.pid,getattr(signal,mode))
  elif mode in ('exception','init-failure'):pass
  elif mode=='ctrl-c':send('\x03')
  else:send('q')
  until=time.monotonic()+15
  while p.poll() is None and time.monotonic()<until:pump()
  if p.poll() is None:raise AssertionError('exit hung '+mode+' tail '+data[-1000:].decode('utf8','replace'))
  for _ in range(3):pump(.01)
  assert p.returncode==(1 if mode in ('exception','init-failure') else 0),(mode,p.returncode,data[-1000:])
  assert b'\x1b[?1049h' in data and b'\x1b[?1049l' in data
  assert b'\x1b[?2004h' in data and b'\x1b[?2004l' in data
  assert data.rfind(b'\x1b[?25h')>data.find(b'\x1b[?25l')
  after=termios.tcgetattr(slave)
  # Darwin may set PENDIN while returning to canonical mode before the first read.
  # It is an OS-managed pending-retype flag, not raw mode or an application setting.
  before[3]&=~getattr(termios,'PENDIN',0);after[3]&=~getattr(termios,'PENDIN',0)
  assert after==before,(mode,'terminal attributes not restored',before,after,data[-600:])
  if record and mode=='workflow':
   with open(record,'w') as f:
    f.write(json.dumps({'version':2,'width':132,'height':30,'timestamp':int(time.time()),'title':'MarginReader real PTY learning workflow','env':{'TERM':'xterm-256color','NO_COLOR':'1'}})+'\n')
    for e in events:f.write(json.dumps(e,ensure_ascii=False)+'\n')
  print('PASS real PTY '+mode+' (raw/cursor/alternate-screen restored)',flush=True)
 finally:
  if p.poll() is None:p.kill();p.wait()
  os.close(master);os.close(slave)
for mode in ['workflow','normal','ctrl-c','SIGINT','SIGTERM','exception','init-failure','long']:run(mode)
`;
(async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mr-tui-pty-"));
  let client;
  try {
    await fs.writeFile(
      path.join(workspace, "中文.html"),
      "<h1>中文工作台</h1><p>中文目标🙂与完整学习流程。</p>",
    );
    const record = process.argv.includes("--record")
      ? path.resolve(process.argv[process.argv.indexOf("--record") + 1])
      : "";
    if (record) await fs.mkdir(path.dirname(record), { recursive: true });
    await new Promise((resolve, reject) => {
      const p = spawn(
        "python3",
        [
          "-c",
          python,
          path.resolve(__dirname, ".."),
          workspace,
          process.execPath,
          record,
        ],
        { stdio: "inherit" },
      );
      p.on("error", reject);
      p.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("PTY tests failed: " + code)),
      );
    });
    client = await require("../runtime.cjs").createPlugin({ workspace });
    const api = async (method, params = {}) => {
      const r = await client.request({ jsonrpc: "2.0", id: 1, method, params });
      assert(!r.error, JSON.stringify(r.error));
      return r.result;
    };
    const sets = (await api("study.list")).sets;
    assert.equal(sets.length, 1);
    const set = await api("study.get", { setId: sets[0].id }),
      excerpt = set.cards.find((c) => c.source);
    assert.equal(excerpt.text, "中文");
    assert.deepEqual(excerpt.tags, ["终端", "摘录"]);
    assert.equal(excerpt.annotation.style, "underline");
    assert.equal(excerpt.note, "PTY中文笔记\n第二行🙂👩‍👩‍👧‍👦 é\n第三行 Ctrl-J");
    assert.equal(
      set.cards.find((c) => c.id === excerpt.parentId).title,
      "PTY父节点",
    );
    assert.equal(excerpt.review.logs.length, 1);
    assert.equal(set.reviewSession.completed, 1);
    assert(set.review.nextDue);
    console.log(
      "PASS reopen: exact Chinese excerpt, source binding, subtree, note, FSRS log and persisted session",
    );
  } finally {
    await client?.close();
    await fs.rm(workspace, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
