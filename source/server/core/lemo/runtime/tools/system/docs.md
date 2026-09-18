# system

This is Lemo's single interface to PhreshOS. Every request follows Core's
Execute contract and is performed through the ordinary System handles, so the
current Program permissions and System behavior remain authoritative.

Discover the available operations with:

```json
{"$domain":"operation","$operation":"list"}
```

Describe one operation before using an unfamiliar request shape:

```json
{"$domain":"operation","$operation":"describe","domain":"endpoint","operation":"ask"}
```

Programs may publish their own agent contract. Find the Program and read that
contract before invoking its events:

```json
{"$domain":"program","$operation":"agent","identity":"program-identity"}
```

The Program contract explains its event names, inputs, results, and operating
rules. Use the same `system` Tool to perform the Execute requests it describes.
System failures are Tool failures; they are not converted into successful
result objects.
