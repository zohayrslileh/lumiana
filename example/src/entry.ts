import express from "express"

const app = express()

app.get("/", (_request, response) => response.send("Hello"))

app.listen(3000)

document.body.textContent = "Running"