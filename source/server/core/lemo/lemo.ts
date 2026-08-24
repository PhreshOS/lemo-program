import LemoDatabase, { type LemoDatabaseSource } from "./database"
import Memory from "./memory"
import Task, { type TaskRequest } from "./task"
import Runtime from "./runtime/runtime"

/** The one enduring Lemo entity. */
export default class Lemo {

    private constructor(
        private readonly database: LemoDatabase,
        private readonly runtime: Runtime
    ) {}

    public static async wakeUp(database: LemoDatabaseSource): Promise<Lemo> {

        const opened = await LemoDatabase.open(database)

        return new Lemo(opened, new Runtime(new Memory(opened)))
    }

    /** Starts one independent Task without waiting for its execution. */
    public task(request: TaskRequest): Promise<Task> {

        return Task.create(this.database, this.runtime, request)
    }

    /** Reconstructs an existing Task handle from its durable identity. */
    public findTask(id: string): Promise<Task | null> {

        return Task.open(this.database, this.runtime, id)
    }

    /** Reconstructs all Tasks from their durable identities. */
    public async tasks(): Promise<readonly Task[]> {

        return Object.freeze(await Promise.all(
            (await this.database.tasks()).map(async id => (await Task.open(this.database, this.runtime, id))!)
        ))
    }
}
