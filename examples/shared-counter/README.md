# Lumiana shared counter

A small counter whose in-memory state lives in a Lumiana shared Worker. Open multiple tabs or
reload the page to see every session use the same counter instance.

```sh
bun install
bun dev
```

The counter survives browser sessions while the Lumiana process remains alive. Restarting the
process resets it to zero.
