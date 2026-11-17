This directory contains fastschema/qjs v0.0.6 (MIT), including its prebuilt
QuickJS WebAssembly module. Original copyright and permission are in LICENSE.
Source: https://github.com/fastschema/qjs/tree/v0.0.6

Local changes are limited to options.go and runtime.go: expose wazero memory
pages and a filesystem-free mode, use a shared compilation cache with a separate
runtime per execution, close the runtime on failure and completion. The JavaScript
engine, parser, standard library and Go value bindings remain upstream code.
No JavaScript interpreter or sandbox is implemented by dream-canvas.
