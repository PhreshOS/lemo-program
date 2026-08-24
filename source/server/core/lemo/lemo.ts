import LemoDatabase, { type LemoDatabaseSource } from "./database"
import type ClientChannel from "../client-channel"
import Memory from "./memory"
import Task, { type TaskRequest } from "./task"
import Runtime from "./runtime/runtime"
import Executions from "./executions"

/** The one enduring Lemo entity. */
export default class Lemo {

    private constructor(
        private readonly database: LemoDatabase,
        private readonly executions: Executions
    ) {}

    public static async wakeUp(database: LemoDatabaseSource, client: ClientChannel): Promise<Lemo> {

        const opened = await LemoDatabase.open(database)
        const memory = new Memory(opened)
        const runtime = new Runtime(memory, client)
        const executions = new Executions(opened, memory, runtime)

        await executions.recover()

        return new Lemo(opened, executions)
    }

    /** Starts one independent Task without waiting for its execution. */
    public task(request: TaskRequest): Promise<Task> {

        return Task.create(this.database, this.executions, request)
    }

    /** Reconstructs an existing Task handle from its durable identity. */
    public findTask(id: string): Promise<Task | null> {

        return Task.open(this.database, this.executions, id)
    }

    /** Reconstructs all Tasks from their durable identities. */
    public async tasks(): Promise<readonly Task[]> {

        return Object.freeze(await Promise.all(
            (await this.database.tasks()).map(async id => (await Task.open(this.database, this.executions, id))!)
        ))
    }
}
