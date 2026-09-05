import { Hono } from "hono"
import { serve } from "@hono/node-server"

const app = new Hono()

app.get("/", context => {
  return context.text("Hello from Hono")
})

serve({
  fetch: app.fetch,
  port: 3000,
})

console.log("Hono is running on http://localhost:3000")