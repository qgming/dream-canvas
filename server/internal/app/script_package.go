package app

import (
    "encoding/json"
    "errors"
    "fmt"
    "path"
    "strconv"
    "strings"
    "unicode/utf8"

    "github.com/evanw/esbuild/pkg/api"
)

type scriptManifest struct {
    SchemaVersion int `json:"schemaVersion"`
    Name string `json:"name"`
    Capability string `json:"capability"`
    Description string `json:"description"`
    Entry string `json:"entry"`
    Inputs string `json:"inputs"`
    Phases []string `json:"phases"`
    Features struct { Tools bool `json:"tools"`; Streaming bool `json:"streaming"` } `json:"features"`
    Auth struct { Type string `json:"type"`; Header string `json:"header,omitempty"`; Prefix string `json:"prefix,omitempty"` } `json:"auth"`
}

func scriptPackagePath(name string) bool {
    if name == "" || path.IsAbs(name) || path.Clean(name) != name || strings.ContainsAny(name, "\\:\x00\r\n") || strings.HasPrefix(name, ".") { return false }
    for _, part := range strings.Split(name, "/") { if part == "" || strings.HasPrefix(part, ".") { return false } }
    return path.Ext(name) == ".js" || path.Ext(name) == ".json"
}

func readScriptPackage(raw JSON) (scriptManifest, map[string]string, JSON, error) {
    var manifest scriptManifest; var files map[string]string
    invalid := func(message string) (scriptManifest, map[string]string, JSON, error) { return manifest, nil, nil, problem(400, "invalid_script_package", message) }
    if json.Unmarshal(raw, &files) != nil || files == nil { return invalid("接口脚本需要 files 文件映射") }
    for name, content := range files { if !scriptPackagePath(name) || !utf8.ValidString(content) { return invalid("仅支持包内相对路径的 UTF-8 JS / JSON 文件") }; if path.Ext(name) == ".json" && !json.Valid([]byte(content)) { return invalid("JSON 文件无效："+name) } }
    if json.Unmarshal([]byte(files["script.json"]), &manifest) != nil || manifest.SchemaVersion != 1 || !includes([]string{"text", "image", "video", "audio"}, manifest.Capability) { return invalid("script.json 需要 schemaVersion:1、名称和正确的 capability") }
    if err := validTitle(manifest.Name); err != nil { return manifest, nil, nil, err }
    if manifest.Entry == "" { manifest.Entry = "adapter.js" }; if manifest.Inputs == "" { manifest.Inputs = "inputs.json" }
    if !scriptPackagePath(manifest.Entry) || path.Ext(manifest.Entry) != ".js" || files[manifest.Entry] == "" { return invalid("entry 需要指向包内 JS 模块") }
    if !scriptPackagePath(manifest.Inputs) || path.Ext(manifest.Inputs) != ".json" || manifest.Inputs == "script.json" { return invalid("inputs 需要指向输入定义 JSON") }
    seen := map[string]bool{}
    for _, phase := range manifest.Phases { if !includes([]string{"validate", "submit", "stream", "query", "result", "usage", "cancel"}, phase) || seen[phase] { return invalid("phases 需要不重复的受支持阶段") }; seen[phase] = true }
    if !seen["submit"] || !seen["result"] || manifest.Features.Streaming && !seen["stream"] || manifest.Features.Tools && manifest.Capability != "text" { return invalid("需要 submit / result；流式需 stream，工具调用只适用于文本") }
    if manifest.Auth.Type != "" && manifest.Auth.Type != "bearer" && manifest.Auth.Type != "header" && manifest.Auth.Type != "none" { return invalid("auth.type 支持 bearer / header / none") }
    if manifest.Auth.Type == "header" && (!validHeaderName(manifest.Auth.Header) || includes([]string{"host", "cookie", "content-length", "connection", "transfer-encoding"}, strings.ToLower(manifest.Auth.Header)) || strings.ContainsAny(manifest.Auth.Prefix, "\r\n")) { return invalid("认证头或前缀无效") }
    parameters := JSON(files[manifest.Inputs]); if err := validateParameters(parameters); err != nil { return manifest, nil, nil, err }
    return manifest, files, parameters, nil
}

func newScriptPackage(name, capability, description string) JSON {
    manifest := scriptManifest{SchemaVersion: 1, Name: name, Capability: capability, Description: description, Entry: "adapter.js", Inputs: "inputs.json", Phases: []string{"submit", "result"}}
    manifest.Auth.Type = "bearer"
    return encode(map[string]string{"script.json": prettyJSON(manifest), "inputs.json": "[]\n", "adapter.js": "export async function submit({model, prompt, params, images, videos, audios}) {\n  throw new Error('Map the documented provider request');\n}\n\nexport async function result({response, input}) {\n  throw new Error('Normalize the documented provider response');\n}\n"})
}

func prettyJSON(value any) string { result, _ := json.MarshalIndent(value, "", "  "); return string(result)+"\n" }

// Compilation only resolves this in-memory package. No server paths or external modules.
func compileScriptPackage(raw JSON) (JSON, JSON, error) {
    manifest, files, parameters, err := readScriptPackage(raw); if err != nil { return nil, nil, err }
    loader := api.Plugin{Name: "model-script", Setup: func(build api.PluginBuild) {
        build.OnResolve(api.OnResolveOptions{Filter: ".*"}, func(args api.OnResolveArgs) (api.OnResolveResult, error) {
            if !strings.HasPrefix(args.Path, "./") && !strings.HasPrefix(args.Path, "../") { return api.OnResolveResult{}, errors.New("only relative package imports are allowed") }
            name := path.Join(path.Dir(args.Importer), args.Path)
            if !scriptPackagePath(name) { return api.OnResolveResult{}, errors.New("import escapes the script package") }; if _, exists := files[name]; !exists { return api.OnResolveResult{}, fmt.Errorf("package file not found: %s", name) }
            return api.OnResolveResult{Path: name, Namespace: "model-script"}, nil
        })
        build.OnLoad(api.OnLoadOptions{Filter: ".*", Namespace: "model-script"}, func(args api.OnLoadArgs) (api.OnLoadResult, error) { content, exists := files[args.Path]; if !exists { return api.OnLoadResult{}, errors.New("file not found") }; kind := api.LoaderJS; if path.Ext(args.Path) == ".json" { kind = api.LoaderJSON }; return api.OnLoadResult{Contents: &content, Loader: kind}, nil })
    }}
    scripts := map[string]string{}
    for _, phase := range manifest.Phases {
        entry := "export { "+phase+" as default } from "+strconv.Quote("./"+manifest.Entry)+";"
        result := api.Build(api.BuildOptions{Stdin: &api.StdinOptions{Contents: entry, Sourcefile: "__entry.js", Loader: api.LoaderJS}, Bundle: true, Write: false, Format: api.FormatIIFE, GlobalName: "__scriptEntry", Platform: api.PlatformNeutral, Target: api.ES2022, LogLevel: api.LogLevelSilent, Plugins: []api.Plugin{loader}})
        if len(result.Errors) > 0 { message := result.Errors[0]; location := ""; if message.Location != nil { location = message.Location.File+":"+strconv.Itoa(message.Location.Line)+" " }; return nil, nil, problem(400, "script_compile_failed", phase+"："+location+message.Text) }
        if len(result.OutputFiles) != 1 { return nil, nil, problem(400, "script_compile_failed", "脚本入口必须生成一个模块") }
        scripts[phase] = string(result.OutputFiles[0].Contents)+"\nreturn await __scriptEntry.default(input,{encode,sign});"
    }
    return encode(scripts), parameters, nil
}
