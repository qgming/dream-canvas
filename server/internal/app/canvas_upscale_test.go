package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCanvasUpscaleDefaultPrompt(t *testing.T) {
	for _, capability := range []string{"image", "video"} {
		input := generationInput{Capability: capability}
		if err := canvasNodeDefaultPrompt(canvasUpscaleNodeType, &input); err != nil { t.Fatal(err) }
		if !strings.Contains(input.Prompt, "source "+capability) || !strings.Contains(input.Prompt, "preserving") { t.Fatalf("missing preservation instruction for %s", capability) }
		for _, instruction := range []string{"compression artifacts", "natural fine textures", "identities", "text and logos", "invented details", "oversharpening", "excessive smoothing"} {
			if !strings.Contains(input.Prompt, instruction) { t.Fatalf("missing %s instruction for %s", instruction, capability) }
		}
		if capability == "video" && (!strings.Contains(input.Prompt, "temporal consistency") || !strings.Contains(input.Prompt, "flicker") || !strings.Contains(input.Prompt, "frame rate, duration and audio")) { t.Fatal("missing video continuity instruction") }
		defaultPrompt := input.Prompt
		input.Prompt = " \t\n"
		if err := canvasNodeDefaultPrompt(canvasUpscaleNodeType, &input); err != nil || input.Prompt != defaultPrompt { t.Fatalf("whitespace prompt did not use %s default: %v", capability, err) }
		input.Prompt = "explicit prompt"
		if err := canvasNodeDefaultPrompt(canvasUpscaleNodeType, &input); err != nil || input.Prompt != "explicit prompt" { t.Fatalf("explicit prompt changed: %v", err) }
	}
	imageInput := generationInput{Capability: "image", Parameters: JSON(`{"resolution":"4k","quality":"high"}`)}
	if err := canvasNodeDefaultPrompt(canvasUpscaleNodeType, &imageInput); err != nil { t.Fatal(err) }
	if !strings.Contains(imageInput.Prompt, "Target output resolution: 4K") || !strings.Contains(imageInput.Prompt, "Requested output quality: high") { t.Fatalf("selected image targets missing from prompt: %s", imageInput.Prompt) }
	imageInput.Prompt = "Keep the original lettering unchanged."
	if err := canvasNodeDefaultPrompt(canvasUpscaleNodeType, &imageInput); err != nil { t.Fatal(err) }
	if imageInput.Prompt != "Keep the original lettering unchanged." { t.Fatal("explicit instructions were changed") }
	automatic := generationInput{Capability: "image", Parameters: JSON(`{"resolution":"auto","quality":"auto"}`)}
	if err := canvasNodeDefaultPrompt(canvasUpscaleNodeType, &automatic); err != nil { t.Fatal(err) }
	if strings.Contains(automatic.Prompt, "Target output resolution:") || strings.Contains(automatic.Prompt, "Requested output quality:") { t.Fatal("auto was described as a concrete target") }
	ordinary := generationInput{Capability: "image"}
	if err := canvasNodeDefaultPrompt("image", &ordinary); err != nil || ordinary.Prompt != "" { t.Fatalf("ordinary generation changed: %v", err) }
	invalid := generationInput{Capability: "text"}
	if err := canvasNodeDefaultPrompt(canvasUpscaleNodeType, &invalid); err == nil { t.Fatal("text accepted by upscale node") }
}

func TestCanvasUpscaleImageSizeMatchesSourceRatio(t *testing.T) {
	size := parameterControl{Key: "size", Label: "Size", Type: "text", Suggestions: []parameterOption{{Label: "1:1", Value: "1:1"}, {Label: "16:9", Value: "16:9"}, {Label: "9:16", Value: "9:16"}}}
	parameters := map[string]any{"size": "auto", "resolution": "4k"}
	if err := canvasUpscaleImageSize([]parameterControl{size}, parameters, 1672, 941); err != nil { t.Fatal(err) }
	if parameters["size"] != "16:9" { t.Fatalf("source ratio was not retained: %v", parameters["size"]) }
	parameters = map[string]any{"size": "auto"}
	if err := canvasUpscaleImageSize([]parameterControl{size}, parameters, 900, 1600); err != nil { t.Fatal(err) }
	if parameters["size"] != "9:16" { t.Fatalf("portrait ratio was not retained: %v", parameters["size"]) }
	if err := canvasUpscaleImageSize([]parameterControl{size}, map[string]any{}, 0, 0); err == nil { t.Fatal("missing source dimensions were silently replaced by a default ratio") }
	size.Options = []parameterOption{{Label: "1:1", Value: "1:1"}}
	parameters = map[string]any{"size": "auto"}
	if err := canvasUpscaleImageSize([]parameterControl{size}, parameters, 1672, 941); err != nil { t.Fatal(err) }
	if parameters["size"] != "1:1" { t.Fatal("ratio suggestions bypassed restricted model options") }
}

func TestCanvasUpscaleBuiltinRegistration(t *testing.T) {
	application := historyTestApp(t)
	var record CanvasPluginRecord
	if err := application.db.First(&record, "id = ?", "upscale").Error; err != nil { t.Fatal(err) }
	if !record.Builtin || !record.Enabled || record.PublishedVersionID != "builtin" { t.Fatal("upscale is not an enabled builtin") }
	nodes, err := application.ListCanvasNodes(); if err != nil { t.Fatal(err) }
	found := false
	for _, node := range nodes { if node.Type == canvasUpscaleNodeType { found = true } }
	if !found { t.Fatal("upscale node missing from shared catalog") }
	if err := application.db.Model(&record).Update("enabled", false).Error; err != nil { t.Fatal(err) }
	if err := application.installBuiltinCanvasPlugins(); err != nil { t.Fatal(err) }
	if err := application.db.First(&record, "id = ?", "upscale").Error; err != nil { t.Fatal(err) }
	if record.Enabled { t.Fatal("startup reset the administrator's disabled state") }
}

func TestCanvasUpscaleTaskSnapshotFillsEmptyPrompt(t *testing.T) {
	application := historyTestApp(t)
	if err := application.db.AutoMigrate(&Channel{}, &ChannelModel{}, &ScriptVersion{}); err != nil { t.Fatal(err) }
	channel := Channel{ID: "channel", Name: "Channel", Secret: "test-credential", Enabled: true}
	if err := application.db.Create(&channel).Error; err != nil { t.Fatal(err) }
	for _, capability := range []string{"image", "video"} {
		controls := []parameterControl{{Key: "source", Label: "Source", Type: "reference", Role: capability}}
		if capability == "image" {
			controls = append(controls,
				parameterControl{Key: "size", Label: "Size", Type: "text", Default: "auto", Required: true, Suggestions: []parameterOption{{Label: "1:1", Value: "1:1"}, {Label: "16:9", Value: "16:9"}}},
				parameterControl{Key: "resolution", Label: "Resolution", Type: "select", Default: "4k", Required: true, Options: []parameterOption{{Label: "4K", Value: "4k"}}},
				parameterControl{Key: "quality", Label: "Quality", Type: "select", Default: "high", Options: []parameterOption{{Label: "High", Value: "high"}}},
			)
		}
		version := ScriptVersion{ID: capability+"-version", AdapterID: capability+"-adapter", Parameters: encode(controls)}
		if err := application.db.Create(&version).Error; err != nil { t.Fatal(err) }
		model := ChannelModel{ID: capability+"-model", ChannelID: channel.ID, Model: capability, Capability: capability, AdapterID: version.AdapterID, AdapterVersionID: version.ID, Enabled: true, ParameterOverrides: JSON(`{}`)}
		if err := application.db.Create(&model).Error; err != nil { t.Fatal(err) }
		project, err := application.CreateProject("owner", projectInput{Title: "Upscale", Document: JSON(`{"nodes":[{"id":"target","type":"upscale:media","title":"Upscale","position":{"x":0,"y":0},"width":420,"height":280,"metadata":{}}],"connections":[]}`)})
		if err != nil { t.Fatal(err) }
		asset := Asset{ID: capability+"-source", UserID: "owner", Kind: capability, SaveState: "saved", Width: 1672, Height: 941}
		if err := application.db.Create(&asset).Error; err != nil { t.Fatal(err) }
		input := generationInput{ChannelID: channel.ID, ModelID: model.ID, Capability: capability, ProjectID: project.ID, NodeID: "target", ProjectVersion: project.Version, Parameters: JSON(`{}`), References: []assetInput{{AssetID: asset.ID, Role: capability}}}
		if _, err := application.generationSnapshot("owner", &input); err != nil { t.Fatal(err) }
		if !strings.Contains(input.Prompt, "source "+capability) { t.Fatalf("default prompt missing from %s task input", capability) }
		if capability == "image" {
			var parameters map[string]any
			if err := json.Unmarshal(input.Parameters, &parameters); err != nil { t.Fatal(err) }
			if parameters["size"] != "16:9" || parameters["resolution"] != "4k" || parameters["quality"] != "high" { t.Fatalf("resolved upscale targets were lost: %v", parameters) }
			if !strings.Contains(input.Prompt, "Target output resolution: 4K") || !strings.Contains(input.Prompt, "Requested output quality: high") { t.Fatal("prompt was built before resolving model defaults") }
		}
		input.NodeID, input.ProjectID, input.Prompt = "", "", ""
		if _, err := application.generationSnapshot("owner", &input); err == nil { t.Fatal("ordinary task bypassed prompt requirement") }
	}
}

func TestCanvasUpscaleRejectsAmbiguousSource(t *testing.T) {
	for _, references := range [][]assetInput{nil, {{AssetID: "image", Role: "image"}}, {{AssetID: "first", Role: "video"}, {AssetID: "second", Role: "video"}}} {
		input := generationInput{Capability: "video", References: references}
		if err := validateCanvasUpscaleSource(canvasUpscaleNodeType, input); err == nil { t.Fatal("invalid upscale source accepted") }
		if err := validateCanvasUpscaleSource("video", input); err != nil { t.Fatal("ordinary video source rules changed") }
	}
	if err := validateCanvasUpscaleSource(canvasUpscaleNodeType, generationInput{Capability: "video", References: []assetInput{{AssetID: "video", Role: "video"}}}); err != nil { t.Fatal(err) }
}
