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
16 KiB is returned inline. Larger output is persisted in full as part of the
raw Tool-result operation in Lemo's database. The immediate Model context sees
only a bounded preview and a durable operation identity. Read the complete
result lazily with the `tasks` tool:

```json
{
  "action": "read_block",
  "task": "task-id",
  "operation": "operation-id",
  "offset": 0,
  "tokens": 2048
}
```

Continue from `next` until it is `null`. No temporary output file is created.
Pausing or cancelling the Task terminates its command and child process group.
