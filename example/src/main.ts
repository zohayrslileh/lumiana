import { connect } from "lumiana/client"

await connect.credentials({ username: "lumiana", password: "lumiana" })

await import("./entry.ts")