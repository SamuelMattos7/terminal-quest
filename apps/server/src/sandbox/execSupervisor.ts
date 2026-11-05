// Run inside the sandbox, never on the host. Python is already in tq-base.
// A Linux subreaper adopts even double-forked / setsid descendants:
// https://man7.org/linux/man-pages/man2/PR_SET_CHILD_SUBREAPER.2const.html
// Repeatedly kill and reap direct children until none remain. Adoption on
// parent death makes this cover the entire tree without racing a /proc scan
// of descendants or relying on a process group that setsid can escape.
export const EXEC_SUPERVISOR = String.raw`
import base64, ctypes, json, os, pwd, selectors, signal, subprocess, sys, tempfile, time

libc = ctypes.CDLL(None, use_errno=True)
if libc.prctl(36, 1, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), "PR_SET_CHILD_SUBREAPER")

duration, marker, user = float(sys.argv[1]), sys.argv[2], sys.argv[3]
account = pwd.getpwuid(int(user)) if user.isdecimal() else pwd.getpwnam(user)
input_bytes = int(sys.argv[4])
input_file = None
if input_bytes >= 0:
    # Give the command EOF without half-closing the Docker transport.
    input_file = tempfile.TemporaryFile()
    while input_bytes:
        chunk = sys.stdin.buffer.read(min(input_bytes, 65536))
        if not chunk:
            raise EOFError("exec stdin ended before the announced byte count")
        input_file.write(chunk)
        input_bytes -= len(chunk)
    input_file.seek(0)
deadline = time.monotonic() + duration
command = json.loads(base64.b64decode(''.join(sys.argv[5:])))
try:
    child = subprocess.Popen(command,
        stdin=input_file if input_file is not None else subprocess.DEVNULL, user=account.pw_uid,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        group=account.pw_gid, extra_groups=os.getgrouplist(account.pw_name, account.pw_gid))
except OSError as error:
    print(str(error), file=sys.stderr)
    sys.exit(127 if isinstance(error, FileNotFoundError) else 126)
finally:
    if input_file is not None:
        input_file.close()

outputs = selectors.DefaultSelector()
for pipe, target in [(child.stdout, 1), (child.stderr, 2)]:
    os.set_blocking(pipe.fileno(), False)
    outputs.register(pipe, selectors.EVENT_READ, target)

def forward(wait):
    for key, _ in outputs.select(wait):
        data = os.read(key.fd, 65536)
        if not data:
            outputs.unregister(key.fileobj)
            key.fileobj.close()
            continue
        try:
            while data:
                data = data[os.write(key.data, data):]
        except BrokenPipeError:
            # The host may have disconnected on output overflow. Keep the
            # independent deadline alive and drain output until termination.
            pass

while child.poll() is None:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        break
    forward(min(0.01, remaining))
else:
    # Preserve Docker exec semantics: successful setup may intentionally
    # leave services running. Drain already-written bytes without waiting
    # on output descriptors those services inherited.
    while outputs.select(0):
        forward(0)
    code = child.returncode
    sys.exit(code if code >= 0 else 128 - code)

children_path = '/proc/self/task/%d/children' % os.getpid()
while True:
    with open(children_path) as children:
        pids = [int(pid) for pid in children.read().split()]
    for pid in pids:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        while os.waitpid(-1, os.WNOHANG)[0] != 0:
            pass
    except ChildProcessError:
        break
    time.sleep(0.001)

while outputs.get_map():
    forward(0)

# Emit only after every descendant has exited and been reaped. A per-exec
# nonce distinguishes timeout from a command's legitimate exit 124 or 137.
os.write(2, marker.encode('ascii'))
sys.exit(124)
`;

export const EXEC_CLEANUP_GRACE_MS = 5000;
