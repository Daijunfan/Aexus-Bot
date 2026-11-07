"""Raw monitored program stdio; the remote supervisor owns only its child tree."""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import zlib

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import transport

SUPERVISOR = r'''
import json,os,pathlib,shutil,signal,subprocess,sys,threading
c=CONFIG
root=os.path.realpath(c['root']); cwd=os.path.realpath(c['cwd'])
if os.path.normcase(os.path.commonpath([root,cwd]))!=os.path.normcase(root): raise ValueError('Monitor cwd escapes owner workspace')
env=os.environ.copy()
for k in list(env):
 if k.startswith(('AGENTS_','AEXUS_')) or k in ('ELECTRON_RUN_AS_NODE','CLAUDECODE','CODEX_THREAD_ID','CODEX_INTERNAL_ORIGINATOR_OVERRIDE'): env.pop(k,None)
env['PATH']=os.pathsep.join(p for p in env.get('PATH','').split(os.pathsep) if '.agents-company' not in p.lower() and 'agentscompany' not in p.lower())
env['PYTHONUNBUFFERED']='1'; env['PYTHONIOENCODING']='utf-8'
program=c['program']
if program[0] in ('python','python3'): program=[sys.executable,*program[1:]]
executable=shutil.which(program[0],path=env.get('PATH')) or program[0]
if os.name=='nt' and executable.lower().endswith(('.bat','.cmd')): raise ValueError('Run a batch program explicitly through cmd.exe /d /s /c')
child=subprocess.Popen([executable,*program[1:]],cwd=cwd,env=env,stdin=subprocess.DEVNULL,stdout=sys.stdout.buffer,stderr=sys.stderr.buffer,start_new_session=os.name!='nt',creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP|subprocess.CREATE_NO_WINDOW) if os.name=='nt' else 0)
lock=threading.Lock()
def stop():
 with lock:
  if child.poll() is not None: return
  try:
   if os.name=='nt': subprocess.run(['taskkill','/PID',str(child.pid),'/T'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   else: os.killpg(child.pid,signal.SIGTERM)
   child.wait(timeout=2)
  except subprocess.TimeoutExpired:
   if os.name=='nt': subprocess.run(['taskkill','/PID',str(child.pid),'/T','/F'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
   else: os.killpg(child.pid,signal.SIGKILL)
  except ProcessLookupError: pass
def disconnected():
 try: sys.stdin.buffer.read()
 finally: stop()
threading.Thread(target=disconnected,daemon=True).start()
try: code=child.wait()
finally: stop()
raise SystemExit(code)
'''


def main():
    data=json.loads(base64.urlsafe_b64decode(sys.argv[1]+'=='))
    if data.get('local'):
        exec(SUPERVISOR,{'CONFIG':{'root':data['root'],'cwd':data['cwd'],'program':data['program']}})
        return 0
    target=data['target']
    source='CONFIG='+repr({'root':data['root'],'cwd':target['directory'],'program':data['program']})+'\n'+SUPERVISOR
    child=subprocess.Popen(transport.server_command(target),stdin=subprocess.PIPE,env=transport.ssh_env(target))
    child.stdin.write(base64.b64encode(zlib.compress(source.encode()))+b'\n'); child.stdin.flush()
    def pump():
        try:
            while True:
                data=os.read(sys.stdin.fileno(),65536)
                if not data: break
                child.stdin.write(data); child.stdin.flush()
        except BrokenPipeError: pass
        finally:
            try: child.stdin.close()
            except BrokenPipeError: pass
    threading.Thread(target=pump,daemon=True).start()
    return child.wait()


if __name__=='__main__': raise SystemExit(main())
