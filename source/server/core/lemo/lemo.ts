import LemoDatabase, { type LemoDatabaseSource } from "./database"

/** The one enduring Lemo entity. */
export default class Lemo {

    private constructor() {}

    public static async wakeUp(database: LemoDatabaseSource): Promise<Lemo> {

        await LemoDatabase.open(database)

        return new Lemo()
    }
}
