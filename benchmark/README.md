# diffshub bench

A small public benchmark harness for @pierre/diffs branches. A Bun server keeps
a queue of benchmark passes and executes them strictly one at a time; everything
is streamed live to every visitor over SSE: queue state, console spans, build
output, and a JPEG screencast of the page being benchmarked.

The benchmarked **versions** are git branches the server manages itself: it
keeps one clone in its data volume (origin = the fork, upstream =
pierrecomputer/pierre), and for each requested version checks the branch head
out into a per-version worktree, runs `bun install`, builds the workspace
packages and the branch's diffshub app (`apps/diffshub` when the branch has one,
`apps/docs` with `NEXT_PUBLIC_SITE=diffshub` otherwise), and serves it on an
internal port for the duration of the runs that need it. Builds are cached by
commit sha and branches are re-fetched on every matrix submission, so a version
is rebuilt exactly when its branch moved — the bench always compares current
branch states with zero manual steps.

Each pass launches a fresh headless Chromium with a throwaway profile (the OS
peak-memory counter lives and dies with the renderer process, and a reused
profile would carry caches between passes), loads one diff, waits for the app's
own `reading patch stream` console span, then reads the renderer's memory from
the OS (`/proc/<pid>/status`: `VmHWM` peak, `VmRSS`+`VmSwap` current) before and
after a forced GC.

## Local run

```bash
bun benchmark/server.ts
# open http://localhost:3000
```

On macOS it uses Google Chrome and `vmmap` (physical footprint + peak) instead
of chromium + /proc.

## Deploy (Dokploy)

Deploy from the `clemg/benchmark` branch:

- Build: Dockerfile `./Dockerfile` (repo root), build path `/`
- Port: 3000, domain e.g. `diffshub-bench.example.com`
- Volume: mount a persistent volume at `/data` (clone, builds, run history)
- Env (all optional): `ORIGIN_URL` (default
  `https://github.com/clemg/pierre.git`), `UPSTREAM_URL` (default
  `https://github.com/pierrecomputer/pierre.git`), `ARM_PORT` (default 4600)

## Sizing

One pass = one Chromium + one Next server for the version being measured. The
linux v6.0..v7.0 diff peaks around 4.6GB of renderer memory on `main` and ~1.8GB
on the byte-parsing branch — the host needs that much free or the renderer gets
OOM-killed (which the bench reports as a "renderer crashed" result rather than
failing the run). Each version's cached build uses a few GB of disk in the
volume. First build of a version takes a few minutes; watch it in the live log.

## API

- `POST /api/bench` `{selections: [{version, diff}], customPath?, passes: 1-5}`
  — `diff` is a preset label or `custom` (paired with `customPath`). Expands the
  matrix into the queue (pass-major order: every selected cell runs once before
  any second pass).
- `GET /api/events` — SSE feed (`state`, `log`, `frame`, `result`).
- `POST /api/cancel` — clears the queue and aborts the current run.
- `GET /api/results.jsonl` — raw pass results.
