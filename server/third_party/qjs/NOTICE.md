This directory contains fastschema/qjs v0.0.6 (MIT), including its prebuilt
QuickJS WebAssembly module. Original copyright and permission are in LICENSE.
Source: https://github.com/fastschema/qjs/tree/v0.0.6

Local changes are limited to options.go, runtime.go and value.go: expose wazero memory
pages and a filesystem-free mode, retain the embedded module's compiled code in
wazero's compilation cache with a separate runtime per execution, close the
runtime on failure and completion (including an already terminated instance), and release
evaluation malloc buffers and returned C strings with their matching allocators
to prevent memory growth during repeated streaming evaluations. The JavaScript
engine, parser, standard library and remaining Go value bindings retain upstream code.
No JavaScript interpreter or sandbox is implemented by dream-canvas.
