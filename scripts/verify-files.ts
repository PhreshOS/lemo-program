import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import files from "../source/server/core/lemo/runtime/tools/files/files"
import TextFiles from "../source/server/core/lemo/runtime/tools/files/internal/text-files"

assert.equal(files.definition.name, "files")
assert.match(files.docs, /Relative paths start at the current\s+user's home directory/)
assert.match(JSON.stringify(files.definition.parameters), /"const":"edit"/)

const root = await mkdtemp(join(tmpdir(), "lemo-files-"))
const filesystem = new TextFiles()

try {
    const project = join(root, "project")
    const source = join(project, "source")
    const file = join(source, "app.ts")

    const directory = await filesystem.directory(source)

    assert.equal(directory.kind, "directory")

    const created = await filesystem.create(file, "const port = 3000\nstart(port)\n")

    assert.match(created.revision, /^sha256:/)

    const first = await filesystem.read(file, 1, 1)

    assert.equal(first.content, "const port = 3000")
    assert.equal(first.nextLine, 2)
    assert.equal(first.totalLines, 2)

    const edited = await filesystem.edit(file, first.revision, [{
        oldText: "3000",
        newText: "4000"
    }])

    assert.notEqual(edited.revision, first.revision)
    assert.equal((await filesystem.read(file)).content, "const port = 4000\nstart(port)")

    await filesystem.create(join(source, "second.ts"), "export {}\n")

    await assert.rejects(
        filesystem.write(file, first.revision, "stale"),
        /changed after it was read/
    )

    const page = await filesystem.list(source, 0, 1)

    assert.equal(page.entries.length, 1)
    assert(["app.ts", "second.ts"].includes(page.entries[0]?.name ?? ""))
    assert.equal(page.next, 1)

    const windowsLines = join(source, "windows.txt")

    await filesystem.create(windowsLines, "first\r\nsecond\r\n")
    assert.equal((await filesystem.read(windowsLines, 1, 2)).content, "first\r\nsecond")

    const copied = await filesystem.copy(project, join(root, "copy"))

    assert.deepEqual(
        { files: copied.files, directories: copied.directories },
        { files: 3, directories: 2 }
    )
    assert.equal((await filesystem.read(join(root, "copy/source/app.ts"))).content, (
        "const port = 4000\nstart(port)"
    ))

    const deletion = await filesystem.delete(join(root, "copy"), true)

    assert.equal(deletion.kind, "directory")
    await assert.rejects(filesystem.inspect(join(root, "copy")), /ENOENT/)
    assert(await files.approval?.({ action: "delete", path: project }))
    assert.equal(await files.approval?.({ action: "read", path: file }), null)

    const binary = join(root, "binary.dat")

    await writeFile(binary, Uint8Array.from([0xff, 0xfe]))
    await assert.rejects(filesystem.read(binary), /not valid UTF-8/)
    await assert.rejects(filesystem.copy(binary, join(root, "binary-copy")), /not valid UTF-8/)
} finally {
    await rm(root, { recursive: true, force: true })
}

console.log("files verification passed")
