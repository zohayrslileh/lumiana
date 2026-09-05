import { System } from '@phreshos/node';

const system = await System.connect();

const button = document.createElement("button")

button.textContent = "Create"

button.addEventListener("click", async function () {

  const settings = await system.program.find("settings")

  if (settings) console.log(await settings.process.create())
})

document.body.appendChild(button)