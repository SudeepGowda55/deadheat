---
name: deadheat
description: Prove whether a web app silently loses one user's work when two users save at the same moment, and fix it. Use after changing any handler that reads state and then writes it (bookings, edits, stock, limits, redemptions), or when asked about race conditions, double booking or lost updates.
---

# Dead Heat

Dead Heat drives two real browser users with Kane CLI, freezes both of their save requests at a proxy,
releases them in a chosen order, and has Kane CLI check after a reload whether each user's work is
still there. A user who was told yes and whose work is gone has been **silently lost**.

## When to reach for it

A handler is a candidate when it checks something and then writes: "is the slot free, then book",
"load the record, then save the whole form", "is stock above zero, then decrement", "has this code
been used, then mark it used". Read the routes you changed and list these before writing races.

## Write the race

`deadheat init` writes `deadheat.json`. One race is two users and four plain-English sentences each:

- `setup` (optional): get to the point where the old state is on screen, for example log in and open the edit form.
- `do`: the action that ends in the save.
- `kept`: what must be true after a reload if this user's work survived.
- `refused`: what the screen says if the app turned this user down honestly.

`hold` names the save request, for example `POST /book` or `PUT /api/tasks/*`. Leave it out to hold
the first request that is not a read. `app.start` and `app.reset` are shell commands that restart the
app and restore its data before every order, so each race starts from the same state.

## Run it and read the result

```
deadheat race --agent
```

Standard output is one JSON object per line. The last line has `"event":"report"` and a `results`
array, one entry per order (`together`, `first-then-second`, `second-then-first`):

- `verdict`: `clean`, `lost` (a user was told yes and their work is gone), `broken` (the invariant
  failed), `no-race` (the two saves were never frozen together, so fix `hold` or the `do` steps), `error`.
- `users[].told`: the exact message that user saw. `users[].outcome`: `kept`, `refused` or `lost`.
- `users[].keptSummary`: what Kane CLI saw on that user's screen after the reload.

Exit code 0 means every order was clean, 1 means a user silently lost or the invariant broke, 2 means
the race could not be run.

## Fix it

Change the application, never the race file. Make the check and the write one atomic step (a unique
constraint, a conditional update, a transaction, a row version), or reject the stale write and tell
that user. Then run `deadheat race --agent` again. The work is done only when every order is clean,
which means the loser is now either kept or refused honestly.

`deadheat fix --with "<your command> {brief}"` runs this loop from the outside: it writes the failure
to a brief, calls your command, restarts the app and races again, and stops if the race file changes.
