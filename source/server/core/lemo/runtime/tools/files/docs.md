# files

Manages UTF-8 text files and directories. Relative paths start at the current
user's home directory (`~/`). Absolute paths are accepted. There is no retained
working directory, so every call is independent.

This capability is intentionally separate from PhreshOS Storage. It manages
ordinary user text files through a bounded contract designed for an agent.

## Discover and inspect

Use `list` to inspect one directory page. It defaults to `~`, 50 entries, and
never returns more than 200 entries. Continue with the returned `next` cursor:

```json
{ "action": "list", "path": "~/projects", "limit": 50 }
```

Directory pages reflect the live filesystem. If the directory changes between
pages, start again from cursor `0`. Use `inspect` for one path's kind, size, and
last modification time.

## Read

`read` returns a bounded line range together with the file's exact SHA-256
`revision`. It defaults to 200 lines and accepts at most 500 per call:

```json
{ "action": "read", "path": "~/project/source/app.ts", "startLine": 1, "lineCount": 200 }
```

Follow `nextLine` until it is `null`. Empty files return no start or end line.
Only valid UTF-8 files are accepted. One response is limited to 100,000
characters, and reading and editing are currently limited to files no larger
than 8 MiB; use `inspect` before working with unusually large files. Returned
line ranges preserve the file's original line endings so they remain safe edit
anchors.

## Create and write

`create` creates a new file and fails if it already exists. Missing parent
directories are created by default; set `parents` to `false` to require them to
exist.

`write` replaces the complete file and requires the revision returned by
`read`. It fails when the file changed after that read, preventing Lemo from
silently overwriting a newer version.

## Edit parts

`edit` changes exact textual anchors without rewriting the complete content in
the request. It also requires the latest revision:

```json
{
  "action": "edit",
  "path": "~/project/source/app.ts",
  "revision": "sha256:...",
  "changes": [
    { "oldText": "const port = 3000", "newText": "const port = 4000" }
  ]
}
```

An anchor must occur exactly once. If it occurs more than once, pass its
one-based `occurrence`. Changes are applied in the order supplied, so every
later anchor observes earlier changes. A stale revision or missing anchor fails
without changing the file.

## Directories and copying

`mkdir` recursively creates a directory path. `copy` copies one UTF-8 file or
directory tree to a new destination and fails if that destination exists.
Copying streams file contents, reports only aggregate counts, and stops when
the Task is paused or cancelled. Symbolic links, binary files, and special
filesystem entries are rejected.

## Delete

`delete` permanently removes one exact path and always requires user approval.
It removes a file, symbolic link, or empty directory by default. Set
`recursive` to `true` to remove a non-empty directory tree. A filesystem root
and the user's home directory cannot be deleted. Once an approved native
recursive deletion begins, it cannot be paused atomically; cancellation while
approval is pending still prevents it from starting.

There is deliberately no move operation yet. Reads are not copied into Memory.
Successful create, write, edit, mkdir, copy, and delete operations record only
a concise fact; raw invocations and results remain in the Task history.
