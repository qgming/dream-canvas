package app

import (
	"strings"
	"testing"
)

func TestCanvasUpscaleDefaultPrompt(t *testing.T) {
	for _, capability := range []string{"image", "video"} {
		input := generationInput{Capability: capability}
		if err := canvasNodeDefaultPrompt(canvasUpscaleNodeType, &input); err != nil { t.Fatal(err) }
		if !strings.Contains(input.Prompt, "source "+capability) || !strings.Contains(input.Prompt, "preserving") { t.Fatalf("missing preservation instruction for %s", capability) }
		input.Prompt = "explicit prompt"
		if err := canvasNodeDefaultPrompt(canvasUpscaleNodeType, &input); err != nil || input.Prompt != "explicit prompt" { t.Fatalf("explicit prompt changed: %v", err) }
	}
	ordinary := generationInput{Capability: "image"}
	if err := canvasNodeDefaultPrompt("image", &ordinary); err != nil || ordinary.Prompt != "" { t.Fatalf("ordinary generation changed: %v", err) }
	invalid := generationInput{Capability: "text"}
	if err := canvasNodeDefaultPrompt(canvasUpscaleNodeType, &invalid); err == nil { t.Fatal("text accepted by upscale node") }
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
		version := ScriptVersion{ID: capability+"-version", AdapterID: capability+"-adapter", Parameters: encode([]parameterControl{{Key: "source", Label: "Source", Type: "reference", Role: capability}})}
		if err := application.db.Create(&version).Error; err != nil { t.Fatal(err) }
		model := ChannelModel{ID: capability+"-model", ChannelID: channel.ID, Model: capability, Capability: capability, AdapterID: version.AdapterID, AdapterVersionID: version.ID, Enabled: true, ParameterOverrides: JSON(`{}`)}
		if err := application.db.Create(&model).Error; err != nil { t.Fatal(err) }
		project, err := application.CreateProject("owner", projectInput{Title: "Upscale", Document: JSON(`{"nodes":[{"id":"target","type":"upscale:media","title":"Upscale","position":{"x":0,"y":0},"width":420,"height":280,"metadata":{}}],"connections":[]}`)})
		if err != nil { t.Fatal(err) }
		asset := Asset{ID: capability+"-source", UserID: "owner", Kind: capability, SaveState: "saved"}
		if err := application.db.Create(&asset).Error; err != nil { t.Fatal(err) }
		input := generationInput{ChannelID: channel.ID, ModelID: model.ID, Capability: capability, ProjectID: project.ID, NodeID: "target", ProjectVersion: project.Version, Parameters: JSON(`{}`), References: []assetInput{{AssetID: asset.ID, Role: capability}}}
		if _, err := application.generationSnapshot("owner", &input); err != nil { t.Fatal(err) }
		if !strings.Contains(input.Prompt, "source "+capability) { t.Fatalf("default prompt missing from %s task input", capability) }
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
