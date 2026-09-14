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

Standard output and standard error are combined in their observed order. The
live result includes the command, directory, shell, exit code, signal, and
`output: { bytes, content }`. The Tool retains that metadata and up to 2,048
estimated tokens of output, with `truncated`, `tokens`, and `totalTokens`.
The active Task keeps the live result within its context budget.
`tasks.read_block` reads only the retained record. Prefer targeted commands for
large output; repeat only safe observations to obtain other details, never a
mutation merely to recreate its output. No temporary output file is created.
Pausing or cancelling the Task terminates its command and child process group.
