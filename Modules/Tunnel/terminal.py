"""Interactive PTY broker. JSON lines in/out; the shell never sees protocol data."""
import sys
# Runtime imports must not change a signed application bundle.
sys.dont_write_bytecode = True
import base64
from collections import deque
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import selectors
import shlex
import signal
import struct
import termios
import transport

config = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
target = config.get('remote')
program = config.get('program')
startup = None
ready_marker = None
startup_buffer = b''
pending_input = []
if target:
    args = transport.ssh_args(target)
    args[args.index('-T')] = '-tt'
    if program:
        # A fixed Python bootstrap avoids shell interpolation of cwd or CLI arguments.
        payload = base64.b64encode(json.dumps({'cwd': target['directory'], 'root': config['root'], 'program': program, 'cli_bin': target.get('cli_bin')}).encode()).decode()
        bootstrap = "import base64,json,os; c=json.loads(base64.b64decode('" + payload + "')); r=os.path.realpath(c['root']); d=os.path.realpath(c['cwd']); "
        bootstrap += "assert os.path.normcase(os.path.commonpath([r,d]))==os.path.normcase(r), 'Worker directory escapes owner workspace'; os.chdir(d); "
        bootstrap += "[os.environ.pop(k,None) for k in list(os.environ) if k.startswith(('AGENTS_','AEXUS_')) or k in ('ELECTRON_RUN_AS_NODE','CLAUDECODE','CLAUDE_CODE_ENTRYPOINT','CODEX_THREAD_ID','CODEX_INTERNAL_ORIGINATOR_OVERRIDE')]; "
        bootstrap += "os.environ['PATH']=os.pathsep.join(p for p in os.environ.get('PATH','').split(os.pathsep) if '.agents-company' not in p.lower() and 'agentscompany' not in p.lower()); "
        bootstrap += "os.environ['PATH']=(c['cli_bin']+os.pathsep if c.get('cli_bin') else '')+os.environ['PATH']; "
        if target['os'] == 'windows':
            ready_marker = ('\x1b]777;' + os.urandom(12).hex() + '\x07').encode()
            bootstrap += 'print(' + repr(ready_marker.decode()) + ',flush=True); '
        bootstrap += "p=c['program']; os.execvpe(p[0],p,os.environ)" if target['os'] != 'windows' else "p=c['program']; shell=os.environ.get('COMSPEC','cmd.exe'); os.execvpe(shell,[shell,'/d','/s','/c',p[0]],os.environ)"
        encoded = base64.b64encode(bootstrap.encode()).decode()
        command = "exec(__import__('base64').b64decode('" + encoded + "'))"
        python = target.get('python') or ('python' if target['os'] == 'windows' else 'python3')
        if target['os'] == 'windows':
            # Feed the command after the real console prompt: ConPTY's SSH exec
            # path loses quoting/stdin for long startup commands. Hide shell setup.
            quote = lambda value: "'" + value.replace("'", "''") + "'"
            script = '& ' + quote(python) + ' -c ' + quote(bootstrap) + '; exit $LASTEXITCODE'
            startup = (script + '\r').encode()
            args += ['powershell.exe -NoLogo -NoProfile -NoExit']
        else:
            args += [shlex.quote(python) + ' -c ' + shlex.quote(command)]
    elif target['os'] == 'windows':
        directory = target['directory'].replace("'", "''")
        script = "try { Set-Location -LiteralPath '" + directory + "' -ErrorAction Stop } catch { Write-Error $_; exit 1 }"
        args += ['powershell.exe -NoLogo -NoProfile -NoExit -EncodedCommand ' + base64.b64encode(script.encode('utf-16le')).decode()]
    else:
        args += ['cd -- ' + shlex.quote(target['directory']) + ' && exec "${SHELL:-/bin/bash}" -l']
else:
    args = program or [os.environ.get('SHELL', '/bin/bash'), '-l']

pid, master = pty.fork()
if pid == 0:
    os.chdir(config['cwd'])
    os.environ['TERM'] = 'xterm-256color'
    os.execvpe(args[0], args, transport.ssh_env(target) if target else os.environ)

def send(value):
    print(json.dumps(value), flush=True)

def resize(cols, rows):
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', max(2, rows), max(2, cols), 0, 0))

def terminate(*_):
    raise SystemExit(0)

signal.signal(signal.SIGTERM, terminate)
resize(config.get('cols', 100), config.get('rows', 24))
selector = selectors.DefaultSelector()
os.set_blocking(master, False)
selector.register(master, selectors.EVENT_READ)
selector.register(0, selectors.EVENT_READ)
buffer = b''
reaped = False
writes = deque()
queued_bytes = 0
stdin_registered = True

def interests():
    global stdin_registered
    selector.modify(master, selectors.EVENT_READ | (selectors.EVENT_WRITE if writes else 0))
    accepting = queued_bytes + sum(len(data) for _, data in pending_input) < 1024 * 1024
    if accepting and not stdin_registered:
        selector.register(0, selectors.EVENT_READ)
    elif not accepting and stdin_registered:
        selector.unregister(0)
    stdin_registered = accepting

def enqueue(data, input_id=None):
    global queued_bytes
    if data:
        writes.append([memoryview(data), input_id])
        queued_bytes += len(data)
    elif input_id:
        send({'inputId': input_id})
    interests()

try:
    while True:
        for key, mask in selector.select():
            if key.fd == master:
                if mask & selectors.EVENT_READ:
                    try:
                        data = os.read(master, 65536)
                    except BlockingIOError:
                        data = None
                    except OSError as error:
                        if error.errno == errno.EIO:
                            data = b''
                        else:
                            raise
                    if data == b'':
                        _, status = os.waitpid(pid, 0)
                        reaped = True
                        if startup_buffer:
                            send({'data': base64.b64encode(startup_buffer).decode()})
                        exit_code = os.waitstatus_to_exitcode(status)
                        send({'exitCode': exit_code or (1 if ready_marker else 0)})
                        raise SystemExit(0)
                    if data is not None:
                        if ready_marker:
                            startup_buffer += data
                            if startup and re.search(rb'PS [\s\S]*>', startup_buffer):
                                enqueue(startup)
                                startup = None
                            if ready_marker not in startup_buffer:
                                continue
                            data = startup_buffer.split(ready_marker, 1)[1]
                            startup_buffer = b''
                            ready_marker = None
                            for input_id, pending in pending_input:
                                enqueue(pending, input_id)
                            pending_input.clear()
                            interests()
                        send({'data': base64.b64encode(data).decode()})
                if mask & selectors.EVENT_WRITE and writes:
                    pending, input_id = writes[0]
                    try:
                        count = os.write(master, pending[:65536])
                    except BlockingIOError:
                        continue
                    queued_bytes -= count
                    if count == len(pending):
                        writes.popleft()
                        if input_id:
                            send({'inputId': input_id})
                    else:
                        writes[0][0] = pending[count:]
                    interests()
            else:
                data = os.read(0, 65536)
                if not data:
                    raise SystemExit(0)
                buffer += data
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    request = json.loads(line)
                    if request['op'] == 'input':
                        data = request['data'].encode('utf-8')
                        if ready_marker:
                            pending_input.append((request.get('inputId'), data))
                            interests()
                        else:
                            enqueue(data, request.get('inputId'))
                    elif request['op'] == 'resize':
                        resize(request['cols'], request['rows'])
                    elif request['op'] == 'close':
                        raise SystemExit(0)
finally:
    selector.close()
    if not reaped:
        try:
            os.killpg(pid, signal.SIGHUP)
        except ProcessLookupError:
            pass
    os.close(master)
