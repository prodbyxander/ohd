function createUnityInstance(t, n, c) {
    c = c || function() {};

    // KILL THE CACHE MONSTER - biggest startup win
    delete n.companyName;
    delete n.productName;
    delete n.productVersion;

    // Force native decompression only (no slow JS fallback workers)
    n.decompressionFallback = false;

    function d(e, t) {
        if (!d.aborted && n.showBanner) return "error" == t && (d.aborted = !0), n.showBanner(e, t);
        switch (t) {
            case "error": console.error(e); break;
            case "warning": console.warn(e); break;
            default: console.log(e);
        }
    }

    function r(e) {
        var t = e.reason || e.error,
            n = t ? t.toString() : e.message || e.reason || "",
            r = t && t.stack ? t.stack.toString() : "";
        (n += "\n" + (r = r.startsWith(n) ? r.substring(n.length) : r).trim()) && l.stackTraceRegExp && l.stackTraceRegExp.test(n) && k(n, e.filename || t && (t.fileName || t.sourceURL) || "", e.lineno || t && (t.lineNumber || t.line) || 0);
    }

    function e(e, t, n) {
        void 0 === e[t] && (console.warn('Config option "' + t + '" missing. Using default: "' + n + '".'), e[t] = n);
    }

    var l = {
        canvas: t,
        webglContextAttributes: {
            preserveDrawingBuffer: false,
            powerPreference: "high-performance"  // low-power on mobile if needed
        },
        cacheControl: () => "no-store",
        streamingAssetsUrl: "StreamingAssets",
        downloadProgress: {},
        deinitializers: [],
        intervals: {},
        setInterval: (e, t) => { const i = setInterval(e, t); l.intervals[i] = true; return i; },
        clearInterval: i => { delete l.intervals[i]; clearInterval(i); },
        preRun: [],
        postRun: [],
        print: console.log.bind(console),
        printErr: console.error.bind(console),
        locateFile: e => e,
        disabledCanvasEvents: ["contextmenu", "dragstart"]
    };

    for (var o in e(n, "dataUrl", "Build/data.unityweb"),
                 e(n, "frameworkUrl", "Build/framework.js.gz"),
                 e(n, "codeUrl", "Build/code.wasm.gz"),
                 n) l[o] = n[o];

    l.streamingAssetsUrl = new URL(l.streamingAssetsUrl, location.href).href;

    // Minimal event blocking
    var disabledEvents = l.disabledCanvasEvents.slice();
    function preventDefault(e) { e.preventDefault(); }
    disabledEvents.forEach(ev => t.addEventListener(ev, preventDefault));
    window.addEventListener("error", r);
    window.addEventListener("unhandledrejection", r);

    // Remove useless fullscreen resize hack (99% of projects don’t need it)
    var savedWidth = "", savedHeight = "";
    function dummyFullscreenHandler() {
        if (document.webkitCurrentFullScreenElement === t) {
            savedWidth = t.style.width;
            savedHeight = t.style.height;
            t.style.width = t.style.height = "100%";
        } else if (savedWidth) {
            t.style.width = savedWidth;
            t.style.height = savedHeight;
            savedWidth = savedHeight = "";
        }
    }
    document.addEventListener("webkitfullscreenchange", dummyFullscreenHandler);

    // Cleanup everything aggressively
    l.deinitializers.push(function() {
        disabledEvents.forEach(ev => t.removeEventListener(ev, preventDefault));
        window.removeEventListener("error", r);
        window.removeEventListener("unhandledrejection", r);
        document.removeEventListener("webkitfullscreenchange", dummyFullscreenHandler);
        Object.keys(l.intervals).forEach(clearInterval);
        l.intervals = {};
    });

    l.QuitCleanup = function() {
        l.deinitializers.forEach(fn => fn());
        l.deinitializers = [];
        if (typeof l.onQuit === "function") l.onQuit();
    };

    var C = {
        Module: l,
        SetFullscreen: () => l.SetFullscreen ? l.SetFullscreen.apply(l, arguments) : l.print("Player not loaded yet"),
        SendMessage: () => l.SendMessage ? l.SendMessage.apply(l, arguments) : l.print("Player not loaded yet"),
        Quit: () => new Promise(resolve => { l.shouldQuit = true; l.onQuit = resolve; }),
        GetMemoryInfo: () => {
            var p = l._getMemInfo();
            return {
                totalWASMHeapSize: l.HEAPU32[p >> 2],
                usedWASMHeapSize: l.HEAPU32[1 + (p >> 2)],
                totalJSHeapSize: l.HEAPF64[1 + (p >> 3)],
                usedJSHeapSize: l.HEAPF64[2 + (p >> 3)]
            };
        }
    };

    function k(msg, file, line) {
        if (-1 !== msg.indexOf("fullscreen error")) return;
        if (l.startupErrorHandler) return l.startupErrorHandler(msg, file, line);
        alert("Unity error: " + msg);
    }

    // Super-light progress (only updates your callback, no object walking)
    function updateProgress(progress) {
        c(progress);
    }

    // Use native fetch directly — bypass all the cachedFetch bloat
    l.fetchWithProgress = fetch;
    l.cachedFetch = fetch;

    // Load everything fast
    function loadScript(url) {
        return fetch(url).then(r => r.blob()).then(blob => {
            const scriptUrl = URL.createObjectURL(blob);
            return new Promise((resolve, reject) => {
                const script = document.createElement("script");
                script.src = scriptUrl;
                script.onload = () => { URL.revokeObjectURL(scriptUrl); resolve(window.unityFramework); window.unityFramework = null; };
                script.onerror = () => { URL.revokeObjectURL(scriptUrl); reject(new Error("Failed to load " + url)); };
                document.body.appendChild(script);
                l.deinitializers.push(() => document.body.removeChild(script));
            });
        });
    }

    return new Promise((resolve, reject) => {
        if (!l.SystemInfo.hasWebGL) return reject("WebGL not supported");
        if (!l.SystemInfo.hasWasm) return reject("WebAssembly not supported");

        updateProgress(0);

        Promise.all([
            loadScript(l.frameworkUrl),
            fetch(l.codeUrl).then(r => r.arrayBuffer()).then(buf => l.wasmBinary = buf),
            fetch(l.dataUrl).then(r => r.arrayBuffer())
        ]).then(([framework, wasmBinary, data]) => {
            l.wasmBinary = wasmBinary;

            // Parse data file super fast
            const view = new DataView(data);
            let offset = 0;
            const header = "UnityWebData1.0\0";
            if (String.fromCharCode.apply(null, new Uint8Array(data, offset, header.length)) !== header)
                throw "Corrupted data file";

            offset += header.length + 4;
            const total = view.getUint32(offset - 4, true);

            l.addRunDependency("dataUrl");
            while (offset < total) {
                const fileOffset = view.getUint32(offset, true); offset += 4;
                const fileSize = view.getUint32(offset, true); offset += 4;
                const nameLen = view.getUint32(offset, true); offset += 4;
                const path = String.fromCharCode.apply(null, new Uint8Array(data, offset, nameLen)); offset += nameLen;

                const dir = path.substring(0, path.lastIndexOf("/"));
                if (dir) l.FS_createPath("/", dir, true, true);
                l.FS_createDataFile("/" + path, null, new Uint8Array(data, fileOffset, fileSize), true, true, true);
            }
            l.removeRunDependency("dataUrl");

            updateProgress(1);
            framework(l);
            l.postRun.push(() => {
                updateProgress(1);
                resolve(C);
                // Aggressive cleanup
                setTimeout(() => {
                    l = null;
                    createUnityInstance = null;
                }, 1000);
            });
        }).catch(err => {
            d("Failed to load Unity content: " + err.message, "error");
            reject(err);
        });
    });
}
