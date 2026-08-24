import type LLMModel from "../llm/model"
import Task, { type TaskChannel } from "./task"

export interface LemoSource {
    snapshots(): Promise<readonly import("@server/core/lemo/task").TaskSnapshot[]>
    create(input: string, model: LLMModel): Promise<TaskChannel>
    open(task: string): Promise<TaskChannel>
}

/** The local Client handle for Lemo's authoritative capabilities. */
export default class Lemo {

    public constructor(private readonly source: LemoSource) {}

    public async task(request: Readonly<{ input: string; model: LLMModel }>) {

        return Task.connect(await this.source.create(request.input, request.model))
    }

    public async tasks(): Promise<readonly Task[]> {

        const snapshots = await this.source.snapshots()

        return Object.freeze(await Promise.all(snapshots.map(async snapshot => (
            snapshot.status === "running" || snapshot.status === "paused"
                ? Task.connect(await this.source.open(snapshot.id))
                : Task.from(snapshot, unavailableControl)
        ))))
    }
}

const unavailableControl = {
    async pause() { throw new Error("This Task is no longer active") },
    async cancel() { throw new Error("This Task is no longer active") },
    async continue() { throw new Error("This Task is no longer active") }
}
