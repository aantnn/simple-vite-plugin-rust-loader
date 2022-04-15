/**
 * MIT License
 * contains code parts from https://github.com/wasm-tool/rollup-plugin-rust
 * 
 * usage:
 * 
 *      import init, {exported_func} from '**projectname**'/Cargo.toml"
 *      await init()
 *      exported_func()
 * 
 */
 import {spawn} from 'child_process';
 import {basename, dirname, join, resolve} from 'path';
 import { readFile } from 'fs';
 import rimraf from 'rimraf';
 import {parse as toml_parse} from 'toml';
 

 const wasm_index = "index_bg.wasm";

 export default function rust(options = {}) {
    let config;
    // TODO should the filter affect the watching ?
    // TODO should the filter affect the Rust compilation ?
    //const filter = createFilter(options.include, options.exclude);

    const state = {
        fileIds: new Set(),
    };

    if (options.watchPatterns == null) {
        options.watchPatterns = [
            "src/**"
        ];
    }

    if (options.importHook == null) {
        options.importHook = function (path) { return JSON.stringify(path); };
    }

    if (options.serverPath == null) {
        options.serverPath = "";
    }

    if (options.cargoArgs == null) {
        options.cargoArgs = [];
    }

    if (options.inlineWasm == null) {
        options.inlineWasm = false;
    }

    if (options.verbose == null) {
        options.verbose = false;
    }

    if (options.nodejs == null) {
        options.nodejs = false;
    }

    return {
        name: "rust",
          
        configResolved(resolvedConfig) {
            // store the resolved config
            config = resolvedConfig
            options.debug = config.mode !== 'production';
          },

        buildStart(rollup) {
            state.fileIds.clear();

            if (this.meta.watchMode || rollup.watch) {
                if (options.watch == null) {
                    options.watch = true;
                }
            }
        },
        async transform(source, id, ssr) {
            if (basename(id) === "Cargo.toml") {
                    return wasm_pack(source, id, options, ssr)
            }
        },

    };
};


async function wasm_pack (source, id, options, ssr) {  
    const dir = dirname(id);
        const target_dir = await get_target_dir(dir);
        const _toml = toml_parse(source);
        const name = _toml.package.name;
        const out_dir = resolve(join(target_dir, "wasm-pack", name));

    await rm(out_dir);

    const args = [
        "--log-level", (options.verbose ? "info" : "error"),
        "build",
        "--out-dir", out_dir,
        "--out-name", "index",
        "--target",  "web",
        (options.debug ? "--dev" : "--release"),
        "--",
    ].concat(options.cargoArgs);

    // TODO pretty hacky, but needed to make it work on Windows
    const command = (process.platform === "win32" ? "wasm-pack.cmd" : "wasm-pack");

    try {
        // TODO what if it tries to build the same crate multiple times ?
        // TODO maybe it can run `cargo fetch` without locking ?
        await lock(async function () {
            await wait(spawn(command, args, { cwd: dir, stdio: "inherit" }));
        });

    } catch (e) {
        if (e.code === "ENOENT") {
            throw new Error("Could not find wasm-pack, install it with `yarn add --dev wasm-pack` or `npm install --save-dev wasm-pack`");

        } else if (options.verbose) {
            throw e;

        } else {
            throw new Error("Rust compilation failed");
        }
    }
    
    let code = (await read(join(out_dir, "index.js"))).toString();
   
    const wasm_path = join(out_dir, wasm_index);
    const reg= /\bnew\s+URL\s*\(\s*('[^']+'|"[^"]+"|`[^`]+`)\s*,\s*import\.meta\.url\s*\)/g;
    let meta_replace
    if (ssr) {
        meta_replace = "input"
        code = code.replace(/export default init;/g, "") 
        code = `import * as fs from 'fs';
                const bytes = fs.readFileSync("${wasm_path}");
                export default () => init(WebAssembly.compile(bytes));
                ${code}`;
    } else {
        // see https://vitejs.dev/guide/assets.html#explicit-url-imports
        meta_replace =  `new URL(wasmUrl,  window.location.origin)`;
        code = `import wasmUrl from '${out_dir}/${wasm_index}?url';${code}`
    }
    return {code: code.replace(reg, meta_replace)}
        
}


 function rm(path) {
     return new Promise(function (resolve, reject) {
         rimraf(path, { glob: false }, function (err) {
             if (err) {
                 reject(err);
 
             } else {
                 resolve();
             }
         });
     });
 }
 
 function read(path) {
     return new Promise(function (resolve, reject) {
         readFile(path, function (err, file) {
             if (err) {
                 reject(err);
 
             } else {
                 resolve(file);
             }
         });
     });
 }
 
 
 function wait(p) {
     return new Promise((resolve, reject) => {
         p.on("close", (code) => {
             if (code === 0) {
                 resolve();
 
             } else {
                 reject(new Error("Command `" + p.spawnargs.join(" ") + "` failed with error code: " + code));
             }
         });
 
         p.on("error", reject);
     });
 }
 
 
 const lockState = {
     locked: false,
     pending: [],
 };
 
 async function lock(f) {
     if (lockState.locked) {
         await new Promise(function (resolve, reject) {
             lockState.pending.push(resolve);
         });
 
         if (lockState.locked) {
             throw new Error("Invalid lock state");
         }
     }
 
     lockState.locked = true;
 
     try {
         return await f();
 
     } finally {
         lockState.locked = false;
 
         if (lockState.pending.length !== 0) {
             const resolve = lockState.pending.shift();
             // Wake up pending task
             resolve();
         }
     }
 }
 
 
 async function get_target_dir(dir) {
     return "target";
 
     // TODO make this faster somehow
     //const metadata = await exec("cargo metadata --no-deps --format-version 1", { cwd: dir });
     //return JSON.parse(metadata).target_directory;
 }
 
 
 
