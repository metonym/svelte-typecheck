#!/usr/bin/env node
import {
  daemonCommand,
  runArguments,
  runThroughDaemon,
  wantsDaemon,
} from "./daemon.ts";

// A run handed to a daemon loads only this client, not the checker.
const argv = process.argv.slice(2);
const command = argv.length === 1 ? argv[0] : undefined;
const here = async (args: string[]) => (await import("./main.ts")).main(args);
if (command === "start" || command === "stop" || command === "status")
  process.exitCode = await daemonCommand(command);
else if (wantsDaemon(argv)) {
  const args = runArguments(argv);
  process.exitCode = await runThroughDaemon(args, () => here(args));
} else process.exitCode = await here(argv);
