import { createRequire } from 'module';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

var require$1 = (
			true
				? /* @__PURE__ */ createRequire(import.meta.url)
				: require
		);

function isStringArray(entryPoints) {
  if (Array.isArray(entryPoints) && entryPoints.some((entrypoint) => typeof entrypoint === "string"))
    return true;
  return false;
}
function transformToObject(entryPoints, outbase) {
  const separator = entryPoints[0].includes("\\") ? path.win32.sep : path.posix.sep;
  if (!outbase) {
    const hierarchy = entryPoints[0].split(separator);
    let i = 0;
    outbase = "";
    let nextOutbase = "";
    do {
      outbase = nextOutbase;
      i++;
      nextOutbase = hierarchy.slice(0, i).join(separator);
    } while (entryPoints.every(
      (entrypoint) => entrypoint.startsWith(`${nextOutbase}${separator}`)
    ));
  }
  const newEntrypoints = {};
  for (const entrypoint of entryPoints) {
    const destination = (outbase ? entrypoint.replace(`${outbase}${separator}`, "") : entrypoint).replace(/.(js|ts)$/, "");
    newEntrypoints[destination] = entrypoint;
  }
  return newEntrypoints;
}
function transformToNewEntryPointsType(entryPoints) {
  const newEntrypointsType = [];
  for (const [key, value] of Object.entries(entryPoints)) {
    newEntrypointsType.push({ in: value, out: key });
  }
  return newEntrypointsType;
}
function esbuildPluginPino({
  transports = []
}) {
  return {
    name: "pino",
    setup(currentBuild) {
      const pino = path.dirname(require$1.resolve("pino"));
      const threadStream = path.dirname(require$1.resolve("thread-stream"));
      const { entryPoints, outbase } = currentBuild.initialOptions;
      const customEntrypoints = {
        "thread-stream-worker": path.join(threadStream, "lib/worker.js"),
        "pino-worker": path.join(pino, "lib/worker.js"),
        "pino-pipeline-worker": path.join(pino, "lib/worker-pipeline.js"),
        "pino-file": path.join(pino, "file.js")
      };
      const transportsEntrypoints = Object.fromEntries(
        transports.map((transport) => [transport, require$1.resolve(transport)])
      );
      let newEntrypoints = [];
      if (isStringArray(entryPoints)) {
        newEntrypoints = transformToNewEntryPointsType({
          ...transformToObject(entryPoints, outbase),
          ...customEntrypoints,
          ...transportsEntrypoints
        });
      } else if (Array.isArray(entryPoints)) {
        newEntrypoints = [
          ...entryPoints,
          ...transformToNewEntryPointsType({
            ...customEntrypoints,
            ...transportsEntrypoints
          })
        ];
      } else {
        newEntrypoints = transformToNewEntryPointsType({
          ...entryPoints,
          ...customEntrypoints,
          ...transportsEntrypoints
        });
      }
      currentBuild.initialOptions.entryPoints = newEntrypoints;
      let pinoBundlerRan = false;
      currentBuild.onEnd(() => {
        pinoBundlerRan = false;
      });
      currentBuild.onLoad({ filter: /pino\.js$/ }, async (args) => {
        if (pinoBundlerRan)
          return;
        pinoBundlerRan = true;
        const contents = await readFile(args.path, "utf8");
        let absoluteOutputPath = "";
        const { outdir = "dist" } = currentBuild.initialOptions;
        if (path.isAbsolute(outdir)) {
          absoluteOutputPath = outdir.replace(/\\/g, "\\\\");
        } else {
          const workingDir = currentBuild.initialOptions.absWorkingDir ? `"${currentBuild.initialOptions.absWorkingDir.replace(/\\/g, "\\\\")}"` : "process.cwd()";
          absoluteOutputPath = `\${${workingDir}}\${require('path').sep}${currentBuild.initialOptions.outdir || "dist"}`;
        }
        const functionDeclaration = `
          function pinoBundlerAbsolutePath(p) {
            try {
              return require('path').join(\`${absoluteOutputPath}\`.replace(/\\\\/g, '/'), p)
            } catch(e) {
              const f = new Function('p', 'return new URL(p, import.meta.url).pathname');
              return f(p)
            }
          }
        `;
        const pinoOverrides = Object.keys({
          ...customEntrypoints,
          ...transportsEntrypoints
        }).map(
          (id) => `'${id === "pino-file" ? "pino/file" : id}': pinoBundlerAbsolutePath('./${id}.js')`
        ).join(",");
        const globalThisDeclaration = `
          globalThis.__bundlerPathsOverrides = { ...(globalThis.__bundlerPathsOverrides || {}), ${pinoOverrides}}
        `;
        const code = functionDeclaration + globalThisDeclaration;
        return {
          contents: code + contents
        };
      });
    }
  };
}

export { esbuildPluginPino as default };
