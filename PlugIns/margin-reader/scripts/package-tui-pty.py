"""Installed CLI business workflow in a real OS PTY inside the network sandbox.

The keyboard scenario follows tests/tui-pty.cjs. The process under test is the
installed npm bin; fixture setup and persistence checks use only a fresh library.
"""
import errno,hashlib,json,os,pty,re,select,signal,socket,struct,subprocess,sys,termios,time,fcntl
node,binary,workspace,consumer,report_path=sys.argv[1:]
record=os.path.splitext(report_path)[0]+'.cast'
report={'platform':sys.platform,'scope':'installed bin, independent self-authored library, real PTY and fresh CLI persistence checks','network':'inherited macOS sandbox-exec deny network*, independently probed before TUI','results':[],'checks':[],'recording':record}
fixture='<h1>中文工作台</h1><p>中文目标🙂与完整学习流程。</p>'

def save():
 with open(report_path,'w',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)

def api(method,params=None):
 p=subprocess.run([node,binary,'--workspace',workspace,'--json','api',method,'--data',json.dumps(params or {},ensure_ascii=False)],cwd=consumer,env=os.environ,capture_output=True,text=True,timeout=60)
 assert p.returncode==0,(method,p.returncode,p.stdout,p.stderr)
 reply=json.loads(p.stdout);assert 'error' not in reply,(method,reply)
 return reply['result']

def run(mode):
 master,slave=pty.openpty()
 before=termios.tcgetattr(slave)
 def resize(cols,rows):
  fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',rows,cols,0,0))
 resize(132,30)
 env=dict(os.environ,TERM='xterm-256color',NO_COLOR='1')
 p=subprocess.Popen([node,binary,'--workspace',workspace,'tui'],cwd=consumer,stdin=slave,stdout=slave,stderr=slave,env=env)
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
   if text.encode() in frame and (absent is None or absent.encode() not in frame) and b'[PENDING]' not in frame and frame.endswith(b'\x1b[J'):return
   if p.poll() is not None:raise AssertionError('process exited waiting '+text+' tail '+data[-1800:].decode('utf8','replace'))
   pump()
  raise AssertionError('timeout waiting '+text+' offsets '+str(re.findall('UTF16[^\r\n]+',data.decode('utf8','replace'))[-8:])+' tail '+data[-1800:].decode('utf8','replace'))
 def send(keys,text=None,absent=None):
  mark=len(data);os.write(master,keys.encode());events.append([round(time.monotonic()-begin,4),'i',keys])
  if text:wait(text,mark,absent=absent)
  else:
   end=time.monotonic()+.10
   while time.monotonic()<end:pump(.01)
  if os.environ.get('MR_TUI_PTY_DEBUG'):print(repr(keys),re.findall('Focus[^\r\n]+',data.decode('utf8','replace'))[-1:],flush=True)
 try:
  wait('Ready / 就绪')
  if mode in ('normal','ctrl-c','SIGINT','SIGTERM'):
   mark=len(data);resize(36,6);os.kill(p.pid,signal.SIGWINCH);wait('terminal too small',mark)
   mark=len(data);resize(132,30);os.kill(p.pid,signal.SIGWINCH);wait('Ready / 就绪',mark)
  if mode=='workflow':
   wait('中文.html')
   send('\r','Focus Read 阅读')
   send('/','Search text');send('目标');send('\r','Search results');send('\r','Focus Read 阅读',absent='Search results');send('\x1b[1~')
   send('v')
   send('\x1b[C');send('\x1b[C')
   send('c','Excerpt preview')
   send('\r','Study set')
   send('\r','New study title')
   send('PTY学习集')
   send('\r','Confirm target')
   send('\r','1 cards')
   # Keyboard-only note edit, parent creation and subtree move.
   send('n','Edit note')
   send('\x1b[200~PTY中文笔记\r\n第二行🙂👩‍👩‍👧‍👦 é\x1b[201~','Pasted into draft')
   frame=data.rsplit(b'\x1b[H',1)[-1].decode('utf8','replace')
   assert 'Edit note' in frame and '第二行🙂👩‍👩‍👧‍👦 é' in frame,frame
   send('\n');send('第三行 Ctrl-J');send('\r','Saved')
   send('N','New note title');send('PTY父节点');send('\r','2 cards')
   send('\x1b[200~qSNR\x1b[201~','Paste requires')
   send('m','Move subtree');send('\x1b[B');send('\r','Saved',absent='Move subtree')
   send('g','┌ SPACE 空间脑图');send('+');send('H');send('0');send('\x1b[C')
   if record:
    frame=data.rsplit(b'\x1b[H',1)[-1].split(b'\x1b[J',1)[0].decode('utf8','replace').replace('\r','')
    assert 'PTY父节点' in frame and '中文' in frame,frame
    with open(record.replace('.cast','-map.txt'),'w',encoding='utf-8') as f:f.write(frame+'\n')
    report['spatialFrame']={'path':record.replace('.cast','-map.txt'),'sha256':hashlib.sha256((frame+'\n').encode()).hexdigest()}
   send('/','Search all cards');send('中文');send('\r','┌ SPACE 空间脑图')
   send('o','Focus Read 阅读');send('\x1b','┌ SPACE 空间脑图')
   # Resize through narrow and tiny, preserving reading/model state.
   resize(64,18);os.kill(p.pid,signal.SIGWINCH);wait('MarginReader',len(data))
   resize(28,7);os.kill(p.pid,signal.SIGWINCH);wait('Resize to at least',len(data))
   resize(132,30);os.kill(p.pid,signal.SIGWINCH);wait('┌ SPACE 空间脑图',len(data))
   send('g','Focus Knowledge 知识')
   send('a','Saved')
   send('R','Resume saved session');send('\x1b[B');send('\r','FSRS REVIEW')
   send('3','Reveal answer before grading')
   send(' ','ANSWER')
   send('3','1 / 1')
   send('u','0 / 1');send('U','1 / 1')
   send('q')
  elif mode=='reopen':
   send('S','Study set');send('\x1b[B');send('\r','2 cards')
   send('g','┌ SPACE 空间脑图');send('/','Search all cards');send('中文');send('\r','┌ SPACE 空间脑图')
   send('o','Focus Read 阅读');send('q')
  elif mode in ('SIGINT','SIGTERM'):
   os.kill(p.pid,getattr(signal,mode))
  elif mode=='ctrl-c':send('\x03')
  else:send('q')
  until=time.monotonic()+15
  while p.poll() is None and time.monotonic()<until:pump()
  if p.poll() is None:raise AssertionError('exit hung '+mode+' tail '+data[-1000:].decode('utf8','replace'))
  for _ in range(3):pump(.01)
  assert p.returncode==0,(mode,p.returncode,data[-1000:])
  assert b'\x1b[?1049h' in data and b'\x1b[?1049l' in data
  assert b'\x1b[?2004h' in data and b'\x1b[?2004l' in data
  assert data.rfind(b'\x1b[?25h')>data.find(b'\x1b[?25l')
  after=termios.tcgetattr(slave)
  # Darwin may set PENDIN while returning to canonical mode before the first read.
  # It is an OS-managed pending-retype flag, not raw mode or an application setting.
  if sys.platform=='darwin':
   before[3]&=~getattr(termios,'PENDIN',0);after[3]&=~getattr(termios,'PENDIN',0)
  assert after==before,(mode,'terminal attributes not restored',before,after,data[-600:])
  if record and mode=='workflow':
   with open(record,'w') as f:
    f.write(json.dumps({'version':2,'width':132,'height':30,'timestamp':int(time.time()),'title':'MarginReader installed CLI offline learning workflow','env':{'TERM':'xterm-256color','NO_COLOR':'1'}})+'\n')
    for e in events:f.write(json.dumps(e,ensure_ascii=False)+'\n')
  report['results'].append({'mode':mode,'passed':True,'capturedBytes':len(data),'seconds':round(time.monotonic()-begin,3)})
  print('PASS installed real PTY '+mode+' (raw/cursor/alternate-screen restored)',flush=True)
 except BaseException as error:
  report['results'].append({'mode':mode,'passed':False,'error':str(error)})
  raise
 finally:
  if p.poll() is None:p.kill();p.wait()
  os.close(master);os.close(slave);save()

try:
 assert os.path.realpath(workspace).startswith(os.path.realpath(consumer)+os.sep)
 os.mkdir(workspace)  # Reject existing paths; never inspect a user's library.
 with open(os.path.join(workspace,'中文.html'),'w',encoding='utf-8') as f:f.write(fixture)
 with socket.socket() as probe:
  probe.settimeout(3)
  try:probe.connect(('1.1.1.1',443))
  except OSError as error:assert error.errno==errno.EPERM,('network denial not established',error)
  else:raise AssertionError('OS sandbox allowed outbound TCP')
 report['checks'].append('independent outbound TCP probe denied with EPERM')
 for mode in ['workflow','reopen','normal','ctrl-c','SIGINT','SIGTERM']:run(mode)
 sets=api('study.list')['sets'];assert len(sets)==1,sets
 study=api('study.get',{'setId':sets[0]['id']})
 assert study['title']=='PTY学习集' and len(study['cards'])==2,study['title']
 excerpt=next(card for card in study['cards'] if card.get('source'))
 assert excerpt['text']=='中文',excerpt['text']
 assert excerpt['note']=='PTY中文笔记\n第二行🙂👩‍👩‍👧‍👦 é\n第三行 Ctrl-J',excerpt['note']
 assert next(card for card in study['cards'] if card['id']==excerpt['parentId'])['title']=='PTY父节点'
 assert len(excerpt['review']['logs'])==1,excerpt['review']
 assert study['reviewSession']['completed']==1 and study['review']['nextDue'],study['reviewSession']
 source=excerpt['source'];assert source['selection']=={'start':0,'end':2},source
 document=api('document.get',{'id':source['documentId']})
 assert source['sourceVersion']==document['sourceVersion'],(source,document)
 position=api('reader.position.get',{'id':source['documentId']})
 assert position['locator']['textOffset']==0,position
 with open(os.path.join(workspace,'中文.html'),encoding='utf-8') as f:assert f.read()==fixture,'source bytes changed'
 report['checks'].extend(['fresh installed CLI reopens exact Chinese excerpt and UTF-16 source binding','three-line note retains bracketed CRLF paste, Ctrl-J, emoji family and combining accent','subtree parent, one FSRS grade, completed session and next due survive restart','spatial search and source activation reopen original selection','self-authored source remains unchanged'])
 report['overall']='passed'
except BaseException as error:
 report['overall']='failed';report['error']=str(error);raise
finally:save()
print(json.dumps(report,ensure_ascii=False))
