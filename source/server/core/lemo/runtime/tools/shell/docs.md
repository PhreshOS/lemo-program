# shell

Runs one non-interactive shell command. Each invocation is independent: there
is no retained working directory, environment, or shell session. Commands do
not require approval.

Use `inspect` before selecting a shell. It returns the user's default shell,
home directory, and every executable shell declared by the host:

```json
{ "action": "inspect" }
```

Use `run` with a command. The working directory defaults to `~/`. `shell` may
be an available name or absolute path returned by `inspect`; when omitted, the
default shell is used:

```json
{
  "action": "run",
  "command": "git status --short",
  "directory": "~/project",
  "shell": "zsh"
}
```

Standard output and standard error are combined in their observed order. Up to
16 KiB is returned inline. Larger output is retained in a Tool-owned temporary
file and represented by an opaque `output.id`, its byte size, and a short
preview. The file's contents are not written into Lemo's database.

Read retained output in bounded byte ranges:

```json
{
  "action": "read",
  "output": "00000000-0000-0000-0000-000000000000",
  "offset": 0,
  "limit": 16384
}
```

Continue from `next` until it is `null`. One read is limited to 64 KiB.
Temporary outputs belong to the current Lemo Server and disappear when it
exits. Pausing or cancelling the Task terminates its command and child process
group.
